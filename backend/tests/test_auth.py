from unittest.mock import MagicMock

import pytest

from app import otp, user

GUEST = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"


# --------------------------------------------------------------------------
# POST /api/auth/start
# --------------------------------------------------------------------------


@pytest.fixture
def otp_mocks(monkeypatch):
    mocks = {
        "count_recent_otps": MagicMock(return_value=0),
        "generate_code": MagicMock(return_value="123456"),
        "is_resend_configured": MagicMock(return_value=True),
        "send_otp_email": MagicMock(),
        "store_otp": MagicMock(),
    }
    for name, mock in mocks.items():
        monkeypatch.setattr(otp, name, mock)
    return mocks


def start(client, email, ip="198.51.100.1"):
    return client.post("/api/auth/start", json={"email": email}, headers={"x-forwarded-for": ip})


def test_start_rejects_invalid_emails(client, otp_mocks):
    for email in ["", "not-an-email", "test@test", 42]:
        res = start(client, email)
        assert res.status_code == 400
        assert res.json()["error"] == "Please enter a valid email address."


def test_start_needs_resend(client, otp_mocks):
    otp_mocks["is_resend_configured"].return_value = False
    res = start(client, "test@example.com")
    assert res.status_code == 503
    assert res.json()["code"] == "resend_not_configured"


def test_start_sends_a_code_without_exposing_a_user_id(client, otp_mocks):
    res = start(client, "Test@Example.com ")
    assert res.status_code == 200
    assert res.json() == {"sent": True}
    otp_mocks["store_otp"].assert_called_once_with("test@example.com", "123456")
    otp_mocks["send_otp_email"].assert_called_once_with("test@example.com", "123456")


def test_start_throttles_codes_per_email(client, otp_mocks):
    otp_mocks["count_recent_otps"].return_value = 5
    res = start(client, "test@example.com")
    assert res.status_code == 429
    otp_mocks["store_otp"].assert_not_called()
    otp_mocks["send_otp_email"].assert_not_called()


def test_start_rate_limits_per_ip(client, otp_mocks):
    for i in range(10):
        assert start(client, f"user{i}@example.com").status_code == 200
    assert start(client, "another@example.com").status_code == 429
    assert start(client, "another@example.com", "198.51.100.2").status_code == 200


def test_start_hides_email_provider_errors(client, otp_mocks):
    otp_mocks["send_otp_email"].side_effect = RuntimeError("Resend API key invalid: re_123")
    res = start(client, "test@example.com")
    assert res.status_code == 500
    assert "re_123" not in res.text


# --------------------------------------------------------------------------
# POST /api/auth/verify
# --------------------------------------------------------------------------


@pytest.fixture
def verify_mocks(monkeypatch):
    mocks = {
        "find_active_otp": MagicMock(return_value={"id": "otp-1", "code_hash": "h"}),
        "bump_otp_attempts": MagicMock(return_value=1),
        "verify_code_hash": MagicMock(return_value=True),
        "consume_otp": MagicMock(return_value=True),
    }
    for name, mock in mocks.items():
        monkeypatch.setattr(otp, name, mock)
    for name in ("get_session_user", "start_session", "ensure_default_account"):
        mock = MagicMock(return_value=None)
        monkeypatch.setattr(user, name, mock)
        mocks[name] = mock
    return mocks


def verify(client, body):
    return client.post("/api/auth/verify", json=body)


def test_verify_requires_email_and_code(client, verify_mocks):
    res = verify(client, {"email": "test@example.com"})
    assert res.status_code == 400
    assert res.json()["error"] == "Email and code are required."


def test_verify_rejects_malformed_codes_without_touching_the_otp(client, verify_mocks):
    res = verify(client, {"email": "test@example.com", "code": "abc"})
    assert res.status_code == 400
    verify_mocks["find_active_otp"].assert_not_called()


def test_verify_without_an_active_code(client, verify_mocks):
    verify_mocks["find_active_otp"].return_value = None
    res = verify(client, {"email": "test@example.com", "code": "123456"})
    assert res.status_code == 400
    assert "Code expired" in res.json()["error"]


def test_verify_counts_the_attempt_before_checking_the_code(client, verify_mocks):
    verify_mocks["verify_code_hash"].return_value = False
    res = verify(client, {"email": "test@example.com", "code": "000000"})
    assert res.status_code == 400
    assert res.json()["error"] == "Wrong code."
    verify_mocks["bump_otp_attempts"].assert_called_once_with("otp-1")
    verify_mocks["start_session"].assert_not_called()


def test_verify_locks_after_too_many_attempts(client, verify_mocks):
    verify_mocks["bump_otp_attempts"].return_value = 6
    res = verify(client, {"email": "test@example.com", "code": "123456"})
    assert res.status_code == 429
    verify_mocks["verify_code_hash"].assert_not_called()
    verify_mocks["start_session"].assert_not_called()


def test_verify_refuses_a_concurrently_consumed_code(client, verify_mocks):
    verify_mocks["consume_otp"].return_value = False
    res = verify(client, {"email": "test@example.com", "code": "123456"})
    assert res.status_code == 400
    verify_mocks["start_session"].assert_not_called()


def test_guest_claims_an_unused_email(client, use_db, verify_mocks):
    verify_mocks["get_session_user"].return_value = user.SessionUser(GUEST, "s", False)
    db = use_db(
        {
            "users": [
                {"data": []},  # no owner for this email
                {"data": []},  # update guest row
                {"data": [{"id": GUEST, "email": "test@example.com"}]},  # final read
            ]
        }
    )
    res = verify(client, {"email": "test@example.com", "code": "123456"})
    assert res.status_code == 200
    assert res.json()["verified"] is True
    assert res.json()["migrated"] is False
    assert db.rpc_calls == []
    assert verify_mocks["start_session"].call_args.args[1:] == (GUEST,)
    assert verify_mocks["start_session"].call_args.kwargs == {"verified": True}


def test_guest_data_merges_into_the_email_owner(client, use_db, verify_mocks):
    verify_mocks["get_session_user"].return_value = user.SessionUser(GUEST, "s", False)
    db = use_db(
        {
            "users": [
                {"data": [{"id": OWNER, "email_verified_at": "2026-01-01T00:00:00Z"}]},
                {"data": [{"id": OWNER, "email": "test@example.com"}]},
            ]
        }
    )
    res = verify(client, {"email": "test@example.com", "code": "123456"})
    assert res.status_code == 200
    assert res.json()["migrated"] is True
    # Data flows guest → owner, never the other way.
    assert db.rpc_calls == [("merge_user_data", {"from_uid": GUEST, "to_uid": OWNER})]
    assert verify_mocks["start_session"].call_args.args[1] == OWNER
    # The owner's account is never deleted or repointed.
    assert not db.called("users", "delete")


def test_verified_accounts_are_never_merged(client, use_db, verify_mocks):
    verify_mocks["get_session_user"].return_value = user.SessionUser(OTHER, "s", True)
    db = use_db(
        {
            "users": [
                {"data": [{"id": OWNER, "email_verified_at": "2026-01-01T00:00:00Z"}]},
                {"data": [{"id": OWNER, "email": "test@example.com"}]},
            ]
        }
    )
    res = verify(client, {"email": "test@example.com", "code": "123456"})
    assert res.status_code == 200
    assert res.json()["migrated"] is False
    assert db.rpc_calls == []
    assert verify_mocks["start_session"].call_args.args[1] == OWNER


def test_creates_a_fresh_account_without_session_or_owner(client, use_db, verify_mocks):
    db = use_db(
        {"users": [{"data": []}, {"data": []}, {"data": [{"id": "new", "email": "test@example.com"}]}]}
    )
    res = verify(client, {"email": "test@example.com", "code": "123456"})
    assert res.status_code == 200
    verify_mocks["ensure_default_account"].assert_called_once()
    assert verify_mocks["start_session"].call_args.args[1] != GUEST
    assert db.called("users", "insert")


def test_verify_does_not_leak_database_errors(client, use_db, verify_mocks):
    use_db({"users": [{"error": {"message": 'relation "users" secret detail'}}]})
    res = verify(client, {"email": "test@example.com", "code": "123456"})
    assert res.status_code == 500
    assert "secret detail" not in res.text


def test_logout_without_a_session_is_harmless(client, use_db):
    use_db()
    assert client.post("/api/auth/logout").status_code == 200


def test_removed_endpoints_are_gone(client):
    for path in ["/api/auth/login", "/api/admin/setup-schema", "/api/auth/callback"]:
        assert client.post(path, json={"email": "victim@example.com"}).status_code == 404
