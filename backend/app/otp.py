"""The 6-digit email one-time-password flow.

Codes are stored only as peppered SHA-256 hashes.
"""

import hashlib
import hmac
import math
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import resend

from app.config import is_production
from app.db import first, get_supabase, rows
from app.timeutil import iso

CODE_TTL_S = 10 * 60
# Verification attempts per code before it is locked.
MAX_ATTEMPTS = 5
# Codes that may be sent to one email address per hour.
MAX_SENDS_PER_HOUR = 5


def _pepper() -> str:
    """Secret mixed into code hashes so a leaked table can't be brute-forced
    offline. Required in production; a fixed value is fine in dev and tests."""
    p = os.getenv("OTP_PEPPER")
    if p:
        return p
    if is_production():
        raise RuntimeError("OTP_PEPPER must be set in production.")
    return "echo-dev-pepper"


def is_resend_configured() -> bool:
    return bool(os.getenv("RESEND_API_KEY") and os.getenv("RESEND_FROM"))


def generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_code(code: str) -> str:
    return hashlib.sha256(f"{_pepper()}:{code}".encode()).hexdigest()


def verify_code_hash(code: str, code_hash: str) -> bool:
    return hmac.compare_digest(hash_code(code), code_hash)


def count_recent_otps(email: str) -> int:
    """Codes sent to `email` in the last hour, for send throttling."""
    since = iso(datetime.now(timezone.utc) - timedelta(hours=1))
    res = (
        get_supabase()
        .table("email_otps")
        .select("id", count="exact")
        .eq("email", email)
        .gte("created_at", since)
        .execute()
    )
    return res.count or 0


def store_otp(email: str, code: str) -> dict[str, Any]:
    expires_at = iso(datetime.now(timezone.utc) + timedelta(seconds=CODE_TTL_S))
    res = (
        get_supabase()
        .table("email_otps")
        .insert({"email": email, "code_hash": hash_code(code), "expires_at": expires_at})
        .execute()
    )
    return rows(res)[0]


def find_active_otp(email: str) -> dict[str, Any] | None:
    """The most recent unconsumed, unexpired code for `email`."""
    res = (
        get_supabase()
        .table("email_otps")
        .select("*")
        .eq("email", email)
        .is_("consumed_at", "null")
        .gt("expires_at", iso(datetime.now(timezone.utc)))
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return first(res)


def consume_otp(otp_id: str) -> bool:
    """Marks a code consumed. Only the first caller wins, so concurrent
    verifications of the same code can't both succeed."""
    res = (
        get_supabase()
        .table("email_otps")
        .update({"consumed_at": iso(datetime.now(timezone.utc))})
        .eq("id", otp_id)
        .is_("consumed_at", "null")
        .execute()
    )
    return len(rows(res)) > 0


def bump_otp_attempts(otp_id: str) -> float:
    """Atomically increments a code's attempt counter and returns the new
    count. Call this BEFORE checking the code, so concurrent guesses count."""
    res = get_supabase().rpc("increment_otp_attempts", {"otp_id": otp_id}).execute()
    data = getattr(res, "data", None)
    # Fail closed: if the RPC returned nothing usable (e.g. the row is gone),
    # treat the code as exhausted.
    if isinstance(data, (int, float)) and not isinstance(data, bool) and math.isfinite(data):
        return data
    return math.inf


def send_otp_email(email: str, code: str) -> dict[str, str] | None:
    """Sends the code via Resend. Returns None if Resend isn't configured."""
    if not is_resend_configured():
        return None
    resend.api_key = os.environ["RESEND_API_KEY"]
    result = resend.Emails.send(
        {
            "from": os.environ["RESEND_FROM"],
            "to": email,
            "subject": "Your Echo verification code",
            "text": f"Your Echo code is {code}. It expires in 10 minutes.",
            "html": (
                f'<p>Your Echo verification code is <strong style="font-size:20px;'
                f'letter-spacing:4px">{code}</strong>.</p><p>It expires in 10 minutes. '
                "If you didn't request this, you can ignore the email.</p>"
            ),
        }
    )
    return {"id": (result or {}).get("id", "unknown")}
