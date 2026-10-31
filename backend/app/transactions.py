"""Transaction persistence.

Rows mirror schema.sql `public.transactions`. Every function takes the
caller's user id explicitly; routes resolve it from the session and every
query is scoped by it.
"""

from typing import Any

from app.db import first, get_supabase, rows
from app.timeutil import now_iso


def list_transactions(user_id: str, limit: int = 100) -> list[dict[str, Any]]:
    res = (
        get_supabase()
        .table("transactions")
        .select("*")
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .order("transacted_at", desc=True)
        .limit(limit)
        .execute()
    )
    return rows(res)


def create_transaction(user_id: str, row: dict[str, Any]) -> dict[str, Any]:
    res = get_supabase().table("transactions").insert({**row, "user_id": user_id}).execute()
    return rows(res)[0]


def delete_transaction(user_id: str, tx_id: str) -> bool:
    """Soft-deletes a transaction. True if a row was deleted."""
    res = (
        get_supabase()
        .table("transactions")
        .update({"deleted_at": now_iso()})
        .eq("id", tx_id)
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .execute()
    )
    return len(rows(res)) > 0


def update_transaction(user_id: str, tx_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("transactions")
        .update({**patch, "clarified": True})
        .eq("id", tx_id)
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .execute()
    )
    return first(res)


def get_transaction(user_id: str, tx_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("transactions")
        .select("*")
        .eq("id", tx_id)
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .limit(1)
        .execute()
    )
    return first(res)


def bulk_create_transactions(user_id: str, new_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not new_rows:
        return []
    tagged = [{**r, "user_id": user_id} for r in new_rows]
    return rows(get_supabase().table("transactions").insert(tagged).execute())
