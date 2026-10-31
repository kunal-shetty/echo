import re

import pytest

from app import user
from app.http import TooManyRequests

from .conftest import make_request

SESSION = "11111111-1111-4111-8111-111111111111"
VICTIM = "22222222-2222-4222-8222-222222222222"
USER = "33333333-3333-4333-8333-333333333333"


def test_no_user_without_a_session_cookie(use_db):
    db = use_db()
    assert user.get_current_user_id(make_request()) is None
    assert db.queries == []


def test_never_trusts_a_client_supplied_guest_id_cookie(use_db):
    db = use_db()
    assert user.get_current_user_id(make_request({"echo_guest_id": VICTIM})) is None
    assert db.queries == []


def test_rejects_a_malformed_session_cookie_without_querying(use_db):
    db = use_db()
    assert user.get_session_user(make_request({"echo_session": "x' or 1=1 --"})) is None
    assert db.queries == []


def test_only_accepts_unexpired_sessions(use_db):
    db = use_db({"sessions": [{"data": []}]})
    assert user.get_session_user(make_request({"echo_session": SESSION})) is None
    [q] = db.on("sessions")
    assert any(m == "gt" and a[0] == "expires_at" for m, a, _ in q.ops)


def test_resolves_the_user_behind_a_valid_session(use_db):
    use_db(
        {
            "sessions": [
                {
                    "data": [
                        {"user_id": USER, "users": {"email_verified_at": "2026-01-01T00:00:00Z"}}
                    ]
                }
            ]
        }
    )
    assert user.get_session_user(make_request({"echo_session": SESSION})) == user.SessionUser(
        user_id=USER, session_id=SESSION, verified=True
    )


def test_creates_a_guest_account_and_session_on_first_write(use_db):
    db = use_db()
    request = make_request()
    user_id = user.require_user_id(request)
    assert re.fullmatch(r"[0-9a-f-]{36}", user_id)
    assert db.called("users", "insert", {"id": user_id})
    assert ("ensure_default_account", {"uid": user_id}) in db.rpc_calls
    assert any(m == "insert" for q in db.on("sessions") for m, _, _ in q.ops)

    [(op, cookie)] = request.state.cookie_ops
    assert op == "set"
    assert cookie["key"] == "echo_session"
    assert cookie["httponly"] is True
    assert cookie["samesite"] == "lax"
    assert cookie["path"] == "/"


def test_limits_how_many_guests_one_ip_can_create(use_db):
    use_db()
    for _ in range(20):
        user.require_user_id(make_request())
    with pytest.raises(TooManyRequests):
        user.require_user_id(make_request())


def test_rotates_the_session_id_when_starting_a_session(use_db):
    db = use_db()
    request = make_request({"echo_session": SESSION})
    user.start_session(request, USER, verified=True)
    assert db.called("sessions", "delete")
    assert db.called("sessions", "eq", "id", SESSION)
    [(_, cookie)] = request.state.cookie_ops
    assert cookie["value"] != SESSION


def test_session_cookie_is_set_on_the_http_response(client, use_db):
    use_db()
    res = client.patch("/api/me", json={"display_name": "Asha"})
    assert res.status_code == 200
    assert "echo_session=" in res.headers["set-cookie"]
    assert "HttpOnly" in res.headers["set-cookie"]


def test_forged_session_cookie_grants_no_identity(client, use_db):
    use_db()
    client.cookies.set("echo_session", "not-a-real-session")
    assert client.get("/api/me").json() == {"authenticated": False, "guest": False, "user": None}
