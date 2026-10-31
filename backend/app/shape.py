"""Turns database rows into the camelCase `Transaction` shape the UI uses
(see lib/schema.ts), and shared money formatting."""

from datetime import datetime, timedelta
from typing import Any

from app.timeutil import parse_datetime


def index_categories(cats: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {c["id"]: c for c in cats}


def to_number(value: Any) -> int | float:
    """Coerces a numeric DB value (which may arrive as a string) to a number."""
    n = float(value)
    return int(n) if n.is_integer() else n


def to_ui_transaction(row: dict[str, Any], categories: dict[str, dict[str, Any]]) -> dict[str, Any]:
    cat = categories.get(row["category_id"]) if row.get("category_id") else None
    merchant = row.get("merchant_raw") or "Expense"
    icon_source = (cat or {}).get("icon") or merchant
    confidence = row.get("confidence")
    ui = {
        "id": row["id"],
        "userId": row.get("user_id"),
        "accountId": row.get("account_id"),
        "categoryId": row.get("category_id"),
        "amountMinor": to_number(row["amount_minor"]),
        "currency": row.get("currency"),
        "direction": row.get("direction"),
        "merchantRaw": merchant,
        "merchantCanonical": row.get("merchant_canonical"),
        "transactedAt": row.get("transacted_at"),
        "createdAt": row.get("created_at"),
        "source": row.get("source"),
        "confidence": None if confidence is None else to_number(confidence),
        "rawTranscript": row.get("raw_transcript"),
        "clarified": row.get("clarified"),
        "icon": str(icon_source)[:1].upper(),
        "tone": (cat or {}).get("tone") or "neutral",
        "date": format_relative(row["transacted_at"]),
        "categoryName": (cat or {}).get("name"),
    }
    # `note` is optional in the UI type; omit it rather than send null.
    if row.get("note") is not None:
        ui["note"] = row["note"]
    return ui


def format_relative(iso_str: str) -> str:
    """ "Today, 9:42 AM", "Yesterday, 7:10 PM", or "Mon, 8:04 AM" (server-local)."""
    d = parse_datetime(iso_str)
    if d is None:
        return ""
    d = d.astimezone()
    now = datetime.now().astimezone()
    time = f"{d.hour % 12 or 12}:{d.minute:02d} {'AM' if d.hour < 12 else 'PM'}"
    if d.date() == now.date():
        return f"Today, {time}"
    if d.date() == (now - timedelta(days=1)).date():
        return f"Yesterday, {time}"
    return f"{d.strftime('%a')}, {time}"


def money(value: float) -> str:
    """Formats rupees with Indian digit grouping, e.g. 123456.5 -> "₹1,23,456.50"."""
    sign = "-" if value < 0 else ""
    whole, frac = f"{abs(value):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups) + "," + tail
    return f"{sign}₹{whole}.{frac}"
