import math

import pytest

from app import otp


def test_increments_attempts_atomically_via_rpc(use_db):
    db = use_db(rpcs={"increment_otp_attempts": [{"data": 3}]})
    assert otp.bump_otp_attempts("otp-1") == 3
    assert db.rpc_calls == [("increment_otp_attempts", {"otp_id": "otp-1"})]
    # No racy read-modify-write fallback.
    assert db.queries == []


def test_raises_if_the_attempt_counter_cant_be_incremented(use_db):
    use_db(rpcs={"increment_otp_attempts": [{"error": {"message": "boom"}}]})
    with pytest.raises(Exception):
        otp.bump_otp_attempts("otp-1")


def test_fails_closed_when_the_rpc_returns_no_count(use_db):
    use_db(rpcs={"increment_otp_attempts": [{"data": None}]})
    assert otp.bump_otp_attempts("otp-1") == math.inf


def test_lets_only_one_caller_consume_a_code(use_db):
    db = use_db({"email_otps": [{"data": [{"id": "otp-1"}]}, {"data": []}]})
    assert otp.consume_otp("otp-1") is True
    assert otp.consume_otp("otp-1") is False
    assert db.called("email_otps", "is_", "consumed_at", "null")


def test_verifies_codes_against_their_hash():
    code_hash = otp.hash_code("123456")
    assert otp.verify_code_hash("123456", code_hash)
    assert not otp.verify_code_hash("654321", code_hash)


def test_refuses_to_hash_without_a_pepper_in_production(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(RuntimeError, match="OTP_PEPPER"):
        otp.hash_code("123456")


def test_codes_are_six_digits():
    for _ in range(50):
        code = otp.generate_code()
        assert len(code) == 6 and code.isdigit()
