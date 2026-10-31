"""The current user's profile."""

import re
from typing import Any

from fastapi import APIRouter, Body, Request

from app import user
from app.db import is_supabase_configured
from app.http import ApiError, as_object

router = APIRouter(prefix="/api/me")

REMINDER_TIMES = {"morning", "evening", "off"}


@router.get("")
def get_me(request: Request):
    session = user.get_session_user(request)
    row = user.get_user_row(session.user_id) if session else None
    if not session or not row:
        return {"authenticated": False, "guest": False, "user": None}
    return {
        "authenticated": session.verified,
        "guest": not session.verified,
        "user": user.to_public_user(row),
    }


@router.patch("")
def patch_me(request: Request, body: Any = Body(None)):
    """Updates profile fields, creating a guest account on first use."""
    if not is_supabase_configured():
        raise ApiError(503, "Backend not configured.")
    raw = as_object(body)

    patch: dict[str, Any] = {}
    if "display_name" in raw:
        name = raw["display_name"]
        if name is not None and not isinstance(name, str):
            raise ApiError(400, "Invalid display_name")
        patch["display_name"] = (name or "").strip()[:60] or None
    if "home_currency" in raw:
        currency = raw["home_currency"]
        if not isinstance(currency, str) or not re.fullmatch(r"[A-Za-z]{3}", currency):
            raise ApiError(400, "Invalid home_currency")
        patch["home_currency"] = currency.upper()
    if "reminder_time" in raw:
        if not isinstance(raw["reminder_time"], str) or raw["reminder_time"] not in REMINDER_TIMES:
            raise ApiError(400, "Invalid reminder_time")
        patch["reminder_time"] = raw["reminder_time"]
    if not patch:
        raise ApiError(400, "Nothing to update")

    user_id = user.require_user_id(request)
    row = user.update_user_row(user_id, patch)
    return {"user": user.to_public_user(row) if row else None}
