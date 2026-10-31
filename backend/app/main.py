"""Echo API.

Serves every `/api/*` route. In development and production the Next.js app
proxies `/api/*` here (see next.config.ts), so the browser only ever talks
to one origin and the `echo_session` cookie stays first-party.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError

from app import config  # noqa: F401  (loads .env before anything reads it)
from app.http import ApiError, api_error_handler, invalid_body_handler, server_error_handler
from app.routes import auth, categories, insights, me, transactions, voice
from app.user import cookie_ops

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Echo API", docs_url="/api/docs", openapi_url="/api/openapi.json")

app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(RequestValidationError, invalid_body_handler)
app.add_exception_handler(Exception, server_error_handler)


@app.middleware("http")
async def apply_cookie_changes(request: Request, call_next):
    """Writes session cookie changes queued during the request onto the
    response, whichever response the route ended up returning."""
    request.state.cookie_ops = []
    response = await call_next(request)
    for op, kwargs in request.state.cookie_ops:
        if op == "set":
            response.set_cookie(**kwargs)
        else:
            response.delete_cookie(**kwargs)
    return response


for module in (auth, me, transactions, categories, insights, voice):
    app.include_router(module.router)


@app.get("/api/health")
def health():
    return {"ok": True}
