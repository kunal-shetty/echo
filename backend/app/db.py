"""Supabase admin client.

The service-role client bypasses Row Level Security, so every query must be
scoped to the session's user by the caller.
"""

import os
from typing import Any

from supabase import Client, create_client

_admin: Client | None = None


def is_supabase_configured() -> bool:
    return bool(os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY"))


def get_supabase() -> Client:
    global _admin
    if _admin is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError(
                "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
            )
        _admin = create_client(url, key)
    return _admin


def rows(res: Any) -> list[dict[str, Any]]:
    """The rows of an executed query (empty if none)."""
    data = getattr(res, "data", None)
    return data if isinstance(data, list) else []


def first(res: Any) -> dict[str, Any] | None:
    """The first row of an executed query, or None."""
    data = getattr(res, "data", None)
    if isinstance(data, list):
        return data[0] if data else None
    return data if isinstance(data, dict) else None
