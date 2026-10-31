"""Validation for client-supplied transaction rows.

Shared by single create, bulk import, and legacy local-storage migration so
every write path enforces the same rules. The account is always resolved
server-side; clients can never choose it.
"""

import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.categories import list_categories_for_user
from app.db import first, get_supabase
from app.timeutil import iso, now_iso, parse_datetime
from app.user import ensure_default_account, get_user_row

# Upper bound on a single amount; anything larger is a typo or abuse.
MAX_AMOUNT = 1_000_000_000_000
MAX_MERCHANT = 200
MAX_NOTE = 500
MAX_TRANSCRIPT = 2000

_CURRENCY_RE = re.compile(r"^[A-Za-z]{3}$")
_DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass
class TxContext:
    """Server-resolved facts needed to validate a user's rows."""

    account_id: str
    home_currency: str
    category_ids: set[str] = field(default_factory=set)
    category_id_by_name: dict[str, str] = field(default_factory=dict)


def load_tx_context(user_id: str) -> TxContext:
    """Loads the default account, home currency, and visible categories."""

    def find_default() -> dict[str, Any] | None:
        res = (
            get_supabase()
            .table("accounts")
            .select("id")
            .eq("user_id", user_id)
            .eq("is_default", True)
            .limit(1)
            .execute()
        )
        return first(res)

    default = find_default()
    if not default:
        ensure_default_account(user_id)
        default = find_default()
    if not default:
        raise RuntimeError(f"No default account for user {user_id}")

    user = get_user_row(user_id)
    cats = list_categories_for_user(user_id)
    return TxContext(
        account_id=default["id"],
        home_currency=(user or {}).get("home_currency") or "INR",
        category_ids={c["id"] for c in cats},
        category_id_by_name={c["name"].strip().lower(): c["id"] for c in cats},
    )


def is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def js_round(n: float) -> int:
    """Rounds half up, like JS `Math.round` (Python's `round` is banker's)."""
    return math.floor(n + 0.5)


def parse_amount(value: Any) -> int | None:
    """Validates an amount. Amounts are whole currency units, so fractional
    input is rounded."""
    if not is_number(value) or not math.isfinite(value) or value <= 0 or value > MAX_AMOUNT:
        return None
    rounded = js_round(value)
    return rounded if rounded > 0 else None


def parse_date(value: Any) -> str | None:
    """Parses a date string to an ISO timestamp. YYYY-MM-DD means midnight UTC."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if _DATE_ONLY_RE.match(text):
        try:
            return iso(datetime.fromisoformat(text).replace(tzinfo=timezone.utc))
        except ValueError:
            return None
    dt = parse_datetime(text)
    return iso(dt) if dt else None


def _js_str(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def optional_text(value: Any, max_len: int) -> str | None:
    if value is None:
        return None
    s = _js_str(value).strip()
    return s[:max_len] if s else None


def validate_transaction_input(
    raw: dict[str, Any],
    ctx: TxContext,
    allowed_sources: tuple[str, ...],
    default_source: str,
) -> tuple[dict[str, Any] | None, str | None]:
    """Validates one snake_case row from the client.

    Accepts `transacted_at` or `date`, and `category_id` or `category_name`.
    Returns (row, None) on success or (None, error) on failure.
    """
    amount = parse_amount(raw.get("amount_minor"))
    if amount is None:
        return None, "Amount must be > 0"

    merchant = optional_text(raw.get("merchant_raw"), MAX_MERCHANT)
    if not merchant:
        return None, "Merchant is required"

    category_id: str | None = None
    raw_cat = raw.get("category_id")
    if raw_cat is not None:
        if not isinstance(raw_cat, str) or raw_cat not in ctx.category_ids:
            return None, "Unknown category"
        category_id = raw_cat
    elif isinstance(raw.get("category_name"), str):
        category_id = ctx.category_id_by_name.get(raw["category_name"].strip().lower())

    currency = raw.get("currency")
    currency = (
        currency.upper()
        if isinstance(currency, str) and _CURRENCY_RE.match(currency)
        else ctx.home_currency
    )

    direction = raw.get("direction")
    if direction not in ("income", "transfer"):
        direction = "expense"

    source = raw.get("source")
    if source not in allowed_sources:
        source = default_source

    confidence = raw.get("confidence")
    confidence = (
        js_round(confidence * 100) / 100
        if is_number(confidence) and 0 <= confidence <= 1
        else None
    )

    transacted_at = parse_date(raw.get("transacted_at")) or parse_date(raw.get("date")) or now_iso()

    if "merchant_canonical" in raw and raw["merchant_canonical"] is None:
        merchant_canonical = None
    else:
        merchant_canonical = optional_text(raw.get("merchant_canonical"), MAX_MERCHANT) or merchant

    return {
        "account_id": ctx.account_id,
        "category_id": category_id,
        "amount_minor": amount,
        "currency": currency,
        "direction": direction,
        "merchant_raw": merchant,
        "merchant_canonical": merchant_canonical,
        "note": optional_text(raw.get("note"), MAX_NOTE),
        "transacted_at": transacted_at,
        "source": source,
        "confidence": confidence if source == "voice" else None,
        "raw_transcript": (
            optional_text(raw.get("raw_transcript"), MAX_TRANSCRIPT) if source == "voice" else None
        ),
        "clarified": False,
    }, None
