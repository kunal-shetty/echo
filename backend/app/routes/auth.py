"""Email OTP sign-in.

Outcomes of `/verify`, given a valid code for `email`:
 - An account already owns the email → sign in to that account. If the
   caller is currently a guest, the guest's own data is merged into it
   first (the caller proves ownership of both: a live guest session and
   the email code). Data never flows the other way.
 - No account owns the email and the caller is a guest → the guest account
   claims the email.
 - Otherwise → a fresh verified account is created.
The session id is always rotated on success.
"""

import re
import uuid
from typing import Any

from fastapi import APIRouter, Body, Request

from app import otp, user
from app.db import first, get_supabase, is_supabase_configured
from app.http import ApiError
from app.rate_limit import rate_limit
from app.timeutil import now_iso

router = APIRouter(prefix="/api/auth")

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


@router.post("/start")
def start(request: Request, body: Any = Body(None)):
    rate_limit(request, "auth-start", 10, 10 * 60)
    body = body if isinstance(body, dict) else {}
    email = body.get("email")
    email = email.strip().lower() if isinstance(email, str) else ""
    if not email or len(email) > 254 or not _EMAIL_RE.match(email):
        raise ApiError(400, "Please enter a valid email address.")

    if not is_supabase_configured() or not otp.is_resend_configured():
        raise ApiError(
            503,
            "Email sync isn't configured on this deployment.",
            code="resend_not_configured",
        )

    if otp.count_recent_otps(email) >= otp.MAX_SENDS_PER_HOUR:
        raise ApiError(429, "Too many codes requested. Try again in an hour.")

    code = otp.generate_code()
    otp.store_otp(email, code)
    otp.send_otp_email(email, code)
    return {"sent": True}


@router.post("/verify")
def verify(request: Request, body: Any = Body(None)):
    rate_limit(request, "auth-verify", 30, 10 * 60)
    if not is_supabase_configured():
        raise ApiError(503, "Backend not configured.", code="supabase_not_configured")

    body = body if isinstance(body, dict) else {}
    email = body.get("email")
    email = email.strip().lower() if isinstance(email, str) else ""
    code = body.get("code")
    code = code.strip() if isinstance(code, str) else ""
    if not email or not code:
        raise ApiError(400, "Email and code are required.")
    if not re.fullmatch(r"\d{6}", code):
        raise ApiError(400, "Wrong code.")

    active = otp.find_active_otp(email)
    if not active:
        raise ApiError(400, "Code expired. Tap 'Resend code' to try again.")
    # Count the attempt before checking it, so parallel guesses can't
    # exceed the limit.
    if otp.bump_otp_attempts(active["id"]) > otp.MAX_ATTEMPTS:
        raise ApiError(429, "Too many attempts. Tap 'Resend code' to try again.")
    if not otp.verify_code_hash(code, active["code_hash"]):
        raise ApiError(400, "Wrong code.")
    if not otp.consume_otp(active["id"]):
        raise ApiError(400, "Code expired. Tap 'Resend code' to try again.")

    supabase = get_supabase()
    current = user.get_session_user(request)
    now = now_iso()

    owner = first(
        supabase.table("users")
        .select("id, email_verified_at")
        .eq("email", email)
        .limit(1)
        .execute()
    )

    migrated = False
    if owner:
        user_id = owner["id"]
        if current and not current.verified and current.user_id != user_id:
            supabase.rpc(
                "merge_user_data", {"from_uid": current.user_id, "to_uid": user_id}
            ).execute()
            migrated = True
        if not owner.get("email_verified_at"):
            supabase.table("users").update({"email_verified_at": now}).eq(
                "id", user_id
            ).execute()
    elif current and not current.verified:
        user_id = current.user_id
        supabase.table("users").update({"email": email, "email_verified_at": now}).eq(
            "id", user_id
        ).execute()
    else:
        user_id = str(uuid.uuid4())
        supabase.table("users").insert(
            {"id": user_id, "email": email, "email_verified_at": now}
        ).execute()
        user.ensure_default_account(user_id)

    user.start_session(request, user_id, verified=True)

    row = first(supabase.table("users").select("*").eq("id", user_id).limit(1).execute())
    if not row:
        raise RuntimeError(f"User {user_id} vanished after verification")
    return {"verified": True, "migrated": migrated, "user": user.to_public_user(row)}


@router.post("/logout")
def logout(request: Request):
    user.end_session(request)
    return {"success": True}
