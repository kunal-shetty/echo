"""User identity, sessions, and profile records.

Identity comes from exactly one place: the opaque `echo_session` cookie,
looked up in the `sessions` table. Nothing the client sends (user ids,
device ids, other cookies) is ever trusted as an identity.

A guest is a `users` row with no verified email. Guests are created lazily
the first time they write something (see `require_user_id`).

Cookie changes are queued on `request.state` and written onto the outgoing
response by the middleware in `main.py`, whatever response the route returns.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Request

from app.config import is_production
from app.db import first, get_supabase, is_supabase_configured
from app.http import TooManyRequests
from app.ids import is_uuid
from app.rate_limit import client_ip, take_token
from app.timeutil import iso

SESSION_COOKIE = "echo_session"
# Verified sessions last 30 days; guest sessions last a year, since losing
# the cookie means losing a guest's data.
VERIFIED_SESSION_TTL_S = 60 * 60 * 24 * 30
GUEST_SESSION_TTL_S = 60 * 60 * 24 * 365
# Guest accounts a single IP may create per hour.
GUEST_CREATES_PER_HOUR = 20


@dataclass
class SessionUser:
    user_id: str
    session_id: str
    # True once the user has verified an email address.
    verified: bool


def cookie_ops(request: Request) -> list[tuple[str, dict[str, Any]]]:
    """Pending cookie changes for this request: ("set", kwargs) or ("delete", kwargs)."""
    ops = getattr(request.state, "cookie_ops", None)
    if ops is None:
        ops = []
        request.state.cookie_ops = ops
    return ops


def get_session_user(request: Request) -> SessionUser | None:
    """The current request's session, or None if there is no valid, unexpired one."""
    if not is_supabase_configured():
        return None
    session_id = request.cookies.get(SESSION_COOKIE)
    if not is_uuid(session_id):
        return None

    res = (
        get_supabase()
        .table("sessions")
        .select("user_id, users(email_verified_at)")
        .eq("id", session_id)
        .gt("expires_at", iso(datetime.now(timezone.utc)))
        .limit(1)
        .execute()
    )
    row = first(res)
    if not row:
        return None
    users = row.get("users") or {}
    return SessionUser(
        user_id=row["user_id"],
        session_id=session_id,
        verified=bool(users.get("email_verified_at")),
    )


def get_current_user_id(request: Request) -> str | None:
    """The current user's id, or None without a session. Use for reads."""
    session = get_session_user(request)
    return session.user_id if session else None


def require_user_id(request: Request) -> str:
    """The current user's id, creating a guest account and session if needed.

    Use for writes. Raises TooManyRequests if this IP creates guests too fast.
    """
    existing = get_session_user(request)
    if existing:
        return existing.user_id

    if not take_token(f"guest:{client_ip(request)}", GUEST_CREATES_PER_HOUR, 60 * 60):
        raise TooManyRequests("Too many requests")

    user_id = str(uuid.uuid4())
    get_supabase().table("users").insert({"id": user_id}).execute()
    ensure_default_account(user_id)
    start_session(request, user_id, verified=False)
    return user_id


def ensure_default_account(user_id: str) -> None:
    """Idempotently creates the user's default "Cash" account."""
    get_supabase().rpc("ensure_default_account", {"uid": user_id}).execute()


def start_session(request: Request, user_id: str, verified: bool) -> None:
    """Creates a session for `user_id` and sets the session cookie.

    Any session currently attached to this request is revoked first, so a
    login always rotates the session id (prevents session fixation).
    """
    supabase = get_supabase()
    previous = request.cookies.get(SESSION_COOKIE)
    if is_uuid(previous):
        supabase.table("sessions").delete().eq("id", previous).execute()

    ttl = VERIFIED_SESSION_TTL_S if verified else GUEST_SESSION_TTL_S
    session_id = str(uuid.uuid4())
    supabase.table("sessions").insert(
        {
            "id": session_id,
            "user_id": user_id,
            "expires_at": iso(datetime.now(timezone.utc) + timedelta(seconds=ttl)),
        }
    ).execute()

    cookie_ops(request).append(
        (
            "set",
            {
                "key": SESSION_COOKIE,
                "value": session_id,
                "httponly": True,
                "secure": is_production(),
                "samesite": "lax",
                "path": "/",
                "max_age": ttl,
            },
        )
    )


def end_session(request: Request) -> None:
    """Revokes the current session (if any) and clears the cookie."""
    session_id = request.cookies.get(SESSION_COOKIE)
    if is_uuid(session_id) and is_supabase_configured():
        get_supabase().table("sessions").delete().eq("id", session_id).execute()
    cookie_ops(request).append(("delete", {"key": SESSION_COOKIE, "path": "/"}))


def get_user_row(user_id: str) -> dict[str, Any] | None:
    if not is_supabase_configured():
        return None
    res = get_supabase().table("users").select("*").eq("id", user_id).limit(1).execute()
    return first(res)


def update_user_row(user_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    if not is_supabase_configured():
        return None
    res = get_supabase().table("users").update(patch).eq("id", user_id).execute()
    return first(res)


def to_public_user(row: dict[str, Any]) -> dict[str, Any]:
    """The subset of a user row that is safe to send to the client."""
    return {
        key: row.get(key)
        for key in (
            "id",
            "email",
            "email_verified_at",
            "display_name",
            "home_currency",
            "reminder_time",
        )
    }
