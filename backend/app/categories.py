"""System-seeded categories (user_id NULL) and user-defined custom categories."""

from typing import Any

from app.db import first, get_supabase, rows
from app.ids import is_uuid

TONES = {"violet", "orange", "blue", "green", "pink", "red", "neutral"}

# Lucide icon names allowed for categories. Keep in sync with lib/icon-vocab.ts,
# which drives the frontend icon picker.
ICON_VOCAB = {
    # 7 seeded system categories
    "UtensilsCrossed",
    "ShoppingBasket",
    "Car",
    "Music",
    "ShoppingBag",
    "Receipt",
    "Package",
    # Common additions for user-created categories
    "Home",
    "Pill",
    "Fuel",
    "Plane",
    "Train",
    "Coffee",
    "Utensils",
    "Baby",
    "Dog",
    "HeartPulse",
}


def list_categories_for_user(user_id: str) -> list[dict[str, Any]]:
    """System categories plus the user's own, sorted by sort_order."""
    # user_id is interpolated into a filter string below; refuse anything
    # that isn't a plain uuid.
    if not is_uuid(user_id):
        raise ValueError("Invalid user id")
    res = (
        get_supabase()
        .table("categories")
        .select("*")
        .or_(f"user_id.is.null,user_id.eq.{user_id}")
        .order("sort_order")
        .execute()
    )
    return rows(res)


def create_category(
    user_id: str,
    name: str,
    icon: str | None = None,
    tone: str = "neutral",
    sort_order: int = 100,
) -> dict[str, Any]:
    """Creates a category owned by the user. Raises on a duplicate name."""
    res = (
        get_supabase()
        .table("categories")
        .insert(
            {
                "user_id": user_id,
                "parent_id": None,
                "name": name,
                "icon": icon,
                "color": None,
                "tone": tone,
                "sort_order": sort_order,
            }
        )
        .execute()
    )
    return rows(res)[0]


def update_category(user_id: str, category_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    """Updates a user-owned category. None if it isn't found or owned."""
    res = (
        get_supabase()
        .table("categories")
        .update(patch)
        .eq("id", category_id)
        .eq("user_id", user_id)
        .execute()
    )
    return first(res)


def delete_category(user_id: str, category_id: str) -> bool:
    """Deletes a user-owned category. Raises if transactions still use it."""
    res = (
        get_supabase()
        .table("categories")
        .delete()
        .eq("id", category_id)
        .eq("user_id", user_id)
        .execute()
    )
    return len(rows(res)) > 0
