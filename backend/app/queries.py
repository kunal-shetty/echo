"""Query engine for spoken questions about transactions.

Resolves relative date ranges, category/merchant filters, and builds the
headline and spoken summary for the voice UI.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from app.categories import list_categories_for_user
from app.db import get_supabase, rows
from app.shape import index_categories, money, to_number, to_ui_transaction
from app.timeutil import iso

QueryKind = Literal["sum", "list", "biggest"]
QueryRange = Literal["today", "yesterday", "this_week", "this_month", "last_month", "all"]
Direction = Literal["expense", "income"]

# NLQ filter fields/operators the LLM may use. Anything else is dropped.
NLQ_FIELDS = {"category_id", "merchant_canonical", "merchant_raw", "direction", "transacted_at"}
NLQ_OPERATORS = {"eq", "ilike", "gte", "lt", "in"}

# Echo's "today" means IST-day boundaries wherever the server runs.
# Asia/Kolkata is +5:30 with no DST.
IST_OFFSET = timedelta(hours=5, minutes=30)

# Cap the underlying fetch so a "list all" doesn't pull thousands of rows.
FETCH_LIMIT = 200


@dataclass
class QueryFilters:
    kind: QueryKind
    range: QueryRange | None
    # Category name, resolved to an id server-side.
    category_name: str | None
    # Merchant name, fuzzy-matched.
    merchant: str | None
    limit: int | None
    # Restrict to one direction. None = both.
    direction: Direction | None
    # Advanced spec for complex queries.
    nlq_spec: dict[str, Any] | None = None


def sanitize_filter_text(text: str) -> str:
    """Prepares LLM-derived text for a double-quoted PostgREST filter value.

    Quoting neutralizes the filter syntax characters (`,` `.` `:` `(` `)`);
    we strip the characters that could end the quoted string (`"` and
    backslash) and the LIKE wildcards (`%` `_` `*`).
    """
    text = re.sub(r'["\\%_*]', " ", text)
    return re.sub(r"\s+", " ", text).strip()[:80]


def range_bounds(range_: QueryRange | None, now: datetime) -> tuple[datetime, datetime] | None:
    """The [start, end) UTC instants for the named period, or None for "all"."""
    ist_now = now.astimezone(timezone.utc) + IST_OFFSET
    # Midnight IST today, expressed as a real UTC instant.
    ist_midnight = datetime(ist_now.year, ist_now.month, ist_now.day, tzinfo=timezone.utc) - IST_OFFSET

    def day_start(offset_days: int) -> datetime:
        return ist_midnight + timedelta(days=offset_days)

    def month_start(year: int, month: int) -> datetime:
        if month == 0:
            year, month = year - 1, 12
        return datetime(year, month, 1, tzinfo=timezone.utc) - IST_OFFSET

    if range_ == "today":
        return day_start(0), day_start(1)
    if range_ == "yesterday":
        return day_start(-1), day_start(0)
    if range_ == "this_week":
        # en-IN weeks start on Monday.
        return day_start(-ist_now.weekday()), day_start(1)
    if range_ == "this_month":
        return month_start(ist_now.year, ist_now.month), day_start(1)
    if range_ == "last_month":
        return (
            month_start(ist_now.year, ist_now.month - 1),
            month_start(ist_now.year, ist_now.month),
        )
    return None


def _range_label(range_: QueryRange | None) -> str:
    return {
        "today": "today",
        "yesterday": "yesterday",
        "this_week": "this week",
        "this_month": "this month",
        "last_month": "last month",
    }.get(range_ or "all", "so far")


def _is_scalar(v: Any) -> bool:
    return isinstance(v, (str, int, float, bool))


def _aggregate_nlq(spec: dict[str, Any], top: list[dict[str, Any]]) -> float | None:
    amounts = [to_number(r["amount_minor"]) for r in top]
    if not amounts:
        return None
    agg = spec.get("aggregate")
    if agg == "sum":
        return sum(amounts)
    if agg == "count":
        return len(amounts)
    if agg == "max":
        return max(amounts)
    if agg == "min":
        return min(amounts)
    if agg == "avg":
        return round(sum(amounts) / len(amounts))
    return None


def run_query(user_id: str, filters: QueryFilters) -> dict[str, Any]:
    """Runs a spoken query and returns the data plus human-readable summaries."""
    range_ = filters.range or "all"
    now = datetime.now(timezone.utc)

    try:
        cats = list_categories_for_user(user_id)
    except Exception:
        cats = []
    category_id = None
    if filters.category_name:
        wanted = filters.category_name.lower()
        category_id = next((c["id"] for c in cats if c["name"].lower() == wanted), None)

    q = (
        get_supabase()
        .table("transactions")
        .select("*")
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .order("transacted_at", desc=True)
    )

    if filters.nlq_spec:
        bounds = range_bounds(filters.nlq_spec.get("range") or "all", now)
        if bounds:
            q = q.gte("transacted_at", iso(bounds[0])).lt("transacted_at", iso(bounds[1]))
        for f in filters.nlq_spec.get("filters") or []:
            field_, op, value = f.get("field"), f.get("operator"), f.get("value")
            if not isinstance(field_, str) or not isinstance(op, str):
                continue
            if field_ not in NLQ_FIELDS or op not in NLQ_OPERATORS:
                continue
            if op == "in":
                if isinstance(value, list) and all(_is_scalar(v) for v in value):
                    q = q.in_(field_, value)
                continue
            if not _is_scalar(value):
                continue
            if op == "eq":
                q = q.eq(field_, value)
            elif op == "ilike":
                q = q.ilike(field_, f"%{value}%")
            elif op == "gte":
                q = q.gte(field_, value)
            elif op == "lt":
                q = q.lt(field_, value)
    else:
        bounds = range_bounds(range_, now)
        if bounds:
            q = q.gte("transacted_at", iso(bounds[0])).lt("transacted_at", iso(bounds[1]))
        if category_id:
            q = q.eq("category_id", category_id)
        if filters.direction:
            q = q.eq("direction", filters.direction)
        merchant = sanitize_filter_text(filters.merchant) if filters.merchant else ""
        if merchant:
            q = q.or_(
                f'merchant_canonical.ilike."%{merchant}%",merchant_raw.ilike."%{merchant}%"'
            )

    data = rows(q.limit(FETCH_LIMIT).execute())

    top = list(data)
    if filters.kind == "biggest":
        top = sorted(top, key=lambda r: to_number(r["amount_minor"]), reverse=True)[:1]
    elif filters.kind == "list":
        top = top[: filters.limit or 5]

    ui_cats = index_categories(cats)
    ui_rows = [to_ui_transaction(r, ui_cats) for r in top]

    if filters.nlq_spec:
        total = _aggregate_nlq(filters.nlq_spec, top)
    elif filters.kind == "biggest":
        total = ui_rows[0]["amountMinor"] if ui_rows else None
    else:
        total = sum(to_number(r["amount_minor"]) for r in top)

    return {
        "kind": filters.kind,
        "range": range_,
        "headline": _build_headline(filters, total or 0, len(ui_rows)),
        "spoken": _build_spoken(filters, total or 0, len(ui_rows)),
        "total": None if filters.kind == "list" else total,
        "rows": ui_rows,
        "filters": {"categoryName": filters.category_name, "merchant": filters.merchant},
    }


def _where(f: QueryFilters) -> str:
    where = ""
    if f.category_name:
        where += f" on {f.category_name.lower()}"
    if f.merchant:
        where += f" on {f.merchant}"
    return where


def _verb(direction: Direction | None) -> tuple[str, str]:
    """(past tense, noun) for the direction."""
    return ("earned", "income") if direction == "income" else ("spent", "expense")


def _build_headline(f: QueryFilters, total: float, row_count: int) -> str:
    range_ = _range_label(f.range)
    where = _where(f)
    past, noun = _verb(f.direction)
    where_part = f" {where.strip()}" if where else ""

    if f.kind == "biggest":
        if row_count == 0:
            return f"No {noun}s found{where_part} {range_}."
        count = f"1 {noun}" if row_count == 1 else f"{row_count} {noun}s"
        return f"Biggest {range_}: {money(total)}{where} — {count}."
    if f.kind == "list":
        if row_count == 0:
            return f"No {noun}s found{where_part} {range_}."
        return f"Last {min(f.limit or row_count, row_count)} {noun}s{where} {range_}."
    if row_count == 0:
        return f"You haven't {past} anything{where_part} {range_}."
    return f"You {past} {money(total)}{where} {range_}."


def _build_spoken(f: QueryFilters, total: float, row_count: int) -> str:
    range_ = _range_label(f.range)
    where = _where(f)
    past, noun = _verb(f.direction)

    if f.kind == "biggest":
        if row_count == 0:
            return f"You have no {noun}s{where} {range_}."
        return f"Your biggest {noun}{where} {range_} was {money(total)}."
    if f.kind == "list":
        return f"{row_count} {noun}s{where} {range_}. Want details?"
    if row_count == 0:
        return f"You haven't {past} anything{where} {range_}."
    return f"You {past} {money(total)}{where} {range_}."
