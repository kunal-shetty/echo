"""Fixed-window, in-memory rate limiting for API routes.

Counters live in this process's memory, so with several workers or
instances each enforces its own limit. That is enough to stop casual abuse
of the paid Groq/Resend endpoints; anything security-critical (OTP sends)
is additionally limited in the database.
"""

import hmac
import math
import os
import threading
import time
from dataclasses import dataclass

from fastapi import Request

from app.http import TOO_MANY, ApiError

MAX_KEYS = 10_000


@dataclass
class _Window:
    count: int
    reset_at: float


_windows: dict[str, _Window] = {}
_lock = threading.Lock()


def _prune(now: float) -> None:
    if len(_windows) < MAX_KEYS:
        return
    for key in [k for k, w in _windows.items() if w.reset_at <= now]:
        del _windows[key]
    # Still full of live windows: drop the oldest rather than grow forever.
    if len(_windows) >= MAX_KEYS:
        del _windows[next(iter(_windows))]


def take_token(key: str, limit: int, window_s: float) -> bool:
    """Consumes one request from `key`'s budget. False once the limit is reached."""
    now = time.monotonic()
    with _lock:
        w = _windows.get(key)
        if w is None or w.reset_at <= now:
            _prune(now)
            _windows[key] = _Window(count=1, reset_at=now + window_s)
            return True
        if w.count >= limit:
            return False
        w.count += 1
        return True


def client_ip(request: Request) -> str:
    """Best-effort client IP from proxy headers.

    When the frontend runs on a separate Vercel project, Vercel replaces
    x-forwarded-for with the frontend's own address, so the frontend's
    proxy.ts passes the visitor's IP in x-echo-client-ip. It's only trusted
    alongside the shared ECHO_PROXY_SECRET, so callers can't spoof it.
    """
    secret = os.getenv("ECHO_PROXY_SECRET")
    relayed = request.headers.get("x-echo-client-ip")
    if secret and relayed:
        given = request.headers.get("x-echo-proxy-secret", "")
        if hmac.compare_digest(given.encode(), secret.encode()):
            return relayed.split(",")[0].strip()

    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.headers.get("x-real-ip") or "unknown"


def rate_limit(request: Request, bucket: str, limit: int, window_s: float) -> None:
    """Applies a per-IP limit for a named bucket; raises a 429 when exceeded."""
    if take_token(f"{bucket}:{client_ip(request)}", limit, window_s):
        return
    raise ApiError(429, TOO_MANY, headers={"Retry-After": str(math.ceil(window_s))})


def reset_rate_limits() -> None:
    """Test-only: clears all counters."""
    with _lock:
        _windows.clear()
