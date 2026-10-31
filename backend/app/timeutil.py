"""Date helpers that mirror the JavaScript `Date` behavior the API had."""

from datetime import datetime, timezone
from typing import Any

from dateutil import parser as dateparser


def iso(dt: datetime) -> str:
    """Formats like JS `toISOString()`: UTC with milliseconds and a `Z`."""
    return (
        dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    )


def now_iso() -> str:
    return iso(datetime.now(timezone.utc))


def parse_datetime(value: Any) -> datetime | None:
    """Parses a date string. Strings without an offset are local time, as in JS."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        try:
            dt = dateparser.parse(text)
        except (ValueError, OverflowError):
            return None
    return dt if dt.tzinfo else dt.astimezone()


def format_human_date(iso_str: str) -> str:
    """Formats a timestamp as "Wed, 19 Aug 2026, 7:42 pm" in server-local time."""
    dt = parse_datetime(iso_str) or datetime.now().astimezone()
    dt = dt.astimezone()
    hour = dt.hour % 12 or 12
    ampm = "am" if dt.hour < 12 else "pm"
    return f"{dt.strftime('%a, %d %b %Y')}, {hour}:{dt.minute:02d} {ampm}"
