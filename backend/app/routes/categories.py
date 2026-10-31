"""Categories: list system + custom, create, edit, delete."""

import math
from typing import Any

from fastapi import APIRouter, Body, Request, Response

from app import categories as cats
from app.db import is_supabase_configured
from app.http import ApiError, as_object, db_error_matches
from app.ids import is_uuid
from app.transaction_input import is_number
from app.user import get_current_user_id, require_user_id

router = APIRouter(prefix="/api/categories")

_DUPLICATE = "A category with that name already exists"


def _require_backend() -> None:
    if not is_supabase_configured():
        raise ApiError(503, "Backend not configured.")


def _is_duplicate(exc: Exception) -> bool:
    return getattr(exc, "code", None) == "23505" or db_error_matches(
        exc, "duplicate key", "unique constraint"
    )


def _valid_name(value: Any) -> str:
    name = value.strip() if isinstance(value, str) else ""
    if not 1 <= len(name) <= 40:
        raise ApiError(400, "Name must be 1–40 characters")
    return name


def _valid_icon(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or value not in cats.ICON_VOCAB:
        raise ApiError(400, "Unknown icon")
    return value


def _is_sort_order(value: Any) -> bool:
    return is_number(value) and math.isfinite(value)


@router.get("")
def list_all(request: Request):
    """System categories plus the user's own custom ones."""
    if not is_supabase_configured():
        return {"categories": [], "configured": False}
    user_id = get_current_user_id(request)
    if not user_id:
        return {"categories": [], "configured": True}
    return {"categories": cats.list_categories_for_user(user_id), "configured": True}


@router.post("", status_code=201)
def create(request: Request, body: Any = Body(None)):
    _require_backend()
    raw = as_object(body)
    name = _valid_name(raw.get("name"))
    icon = _valid_icon(raw.get("icon"))
    tone = raw.get("tone") if isinstance(raw.get("tone"), str) and raw["tone"] in cats.TONES else "neutral"
    sort_order = math.trunc(raw["sort_order"]) if _is_sort_order(raw.get("sort_order")) else 100

    user_id = require_user_id(request)
    try:
        category = cats.create_category(user_id, name, icon, tone, sort_order)
    except Exception as exc:
        if _is_duplicate(exc):
            raise ApiError(409, _DUPLICATE) from exc
        raise
    return {"category": category}


@router.patch("/{category_id}")
def update(category_id: str, request: Request, body: Any = Body(None)):
    _require_backend()
    user_id = get_current_user_id(request)
    if not user_id or not is_uuid(category_id):
        raise ApiError(404, "Not found")
    raw = as_object(body)

    patch: dict[str, Any] = {}
    if "name" in raw:
        patch["name"] = _valid_name(raw["name"])
    if "icon" in raw:
        patch["icon"] = _valid_icon(raw["icon"])
    if "tone" in raw:
        if not isinstance(raw["tone"], str) or raw["tone"] not in cats.TONES:
            raise ApiError(400, "Unknown tone")
        patch["tone"] = raw["tone"]
    if "sort_order" in raw:
        if not _is_sort_order(raw["sort_order"]):
            raise ApiError(400, "Invalid sort_order")
        patch["sort_order"] = math.trunc(raw["sort_order"])
    if not patch:
        raise ApiError(400, "Nothing to update")

    try:
        category = cats.update_category(user_id, category_id, patch)
    except Exception as exc:
        if _is_duplicate(exc):
            raise ApiError(409, _DUPLICATE) from exc
        raise
    if not category:
        raise ApiError(404, "Not found")
    return {"category": category}


@router.delete("/{category_id}", status_code=204)
def delete(category_id: str, request: Request):
    """Deletes a custom category; 409 while transactions or budgets use it."""
    _require_backend()
    user_id = get_current_user_id(request)
    if not user_id or not is_uuid(category_id):
        raise ApiError(404, "Not found")
    try:
        deleted = cats.delete_category(user_id, category_id)
    except Exception as exc:
        if getattr(exc, "code", None) == "23503" or db_error_matches(exc, "foreign key", "violates"):
            raise ApiError(409, "Category is in use; reassign its memories first") from exc
        raise
    if not deleted:
        raise ApiError(404, "Not found")
    return Response(status_code=204)
