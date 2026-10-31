import os

# Never read the developer's real .env files during tests.
os.environ["ECHO_SKIP_DOTENV"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.requests import Request  # noqa: E402

from app import db as db_module  # noqa: E402
from app.main import app  # noqa: E402
from app.rate_limit import reset_rate_limits  # noqa: E402

from .fake_supabase import FakeSupabase  # noqa: E402


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://supabase.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-key")
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.delenv("APP_ENV", raising=False)
    monkeypatch.delenv("OTP_PEPPER", raising=False)
    reset_rate_limits()
    yield
    db_module._admin = None


@pytest.fixture
def use_db():
    """Installs a FakeSupabase as the admin client: `db = use_db(tables, rpcs)`."""

    def install(tables=None, rpcs=None) -> FakeSupabase:
        fake = FakeSupabase(tables, rpcs)
        db_module._admin = fake
        return fake

    return install


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def make_request(cookies: dict[str, str] | None = None, ip: str = "203.0.113.7") -> Request:
    """A bare request carrying `cookies`, for testing session helpers."""
    headers = [(b"x-forwarded-for", ip.encode())]
    if cookies:
        cookie = "; ".join(f"{k}={v}" for k, v in cookies.items())
        headers.append((b"cookie", cookie.encode()))
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers})
