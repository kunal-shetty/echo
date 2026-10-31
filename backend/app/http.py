"""Shared error type and response helpers for API routes.

Every error response has the shape `{"error": "...", ...extra}`, matching
what the frontend already expects.
"""

import logging
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger("echo")

TOO_MANY = "Too many requests. Please slow down and try again shortly."


class ApiError(Exception):
    """An expected failure with a client-safe message."""

    def __init__(
        self,
        status: int,
        error: str,
        *,
        headers: dict[str, str] | None = None,
        **extra: Any,
    ):
        super().__init__(error)
        self.status = status
        self.error = error
        self.headers = headers
        self.extra = extra


class TooManyRequests(Exception):
    """Raised by helpers (e.g. guest creation) when a limit is hit."""

    status = 429


async def api_error_handler(_req: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        {"error": exc.error, **exc.extra}, status_code=exc.status, headers=exc.headers
    )


async def invalid_body_handler(_req: Request, exc: RequestValidationError) -> JSONResponse:
    # Routes take the raw JSON body and validate it themselves, so the only
    # validation error FastAPI raises is for a body that isn't JSON.
    return JSONResponse({"error": "Invalid JSON body"}, status_code=400)


async def server_error_handler(req: Request, exc: Exception) -> JSONResponse:
    """Logs an unexpected error and returns a generic response.

    Raw database / upstream messages are never sent to the client. Errors
    carrying a numeric `status` (e.g. 429 from guest creation) keep it.
    """
    status = getattr(exc, "status", None)
    status = status if isinstance(status, int) else 500
    if status == 429:
        return JSONResponse({"error": TOO_MANY}, status_code=429)
    log.exception("[%s] %s", req.url.path, exc)
    return JSONResponse(
        {"error": "Something went wrong. Please try again."}, status_code=status
    )


def as_object(body: Any) -> dict[str, Any]:
    """Returns `body` if it is a JSON object, else raises a 400."""
    if not isinstance(body, dict):
        raise ApiError(400, "Invalid JSON body")
    return body


def db_error_matches(exc: Exception, *needles: str) -> bool:
    """True if a database error's message mentions any of `needles`."""
    text = " ".join(
        str(getattr(exc, attr, "") or "") for attr in ("message", "details")
    ) or str(exc)
    text = text.lower()
    return any(n in text for n in needles)
