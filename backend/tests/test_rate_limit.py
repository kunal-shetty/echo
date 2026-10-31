"""Client IP detection behind the frontend's proxy."""

from starlette.requests import Request

from app.rate_limit import client_ip


def request(headers: dict[str, str]) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": raw})


def test_uses_x_forwarded_for_without_a_proxy_secret(monkeypatch):
    monkeypatch.delenv("ECHO_PROXY_SECRET", raising=False)
    req = request({"x-forwarded-for": "198.51.100.1, 10.0.0.1", "x-echo-client-ip": "203.0.113.9"})
    assert client_ip(req) == "198.51.100.1"


def test_trusts_the_relayed_ip_with_the_right_secret(monkeypatch):
    monkeypatch.setenv("ECHO_PROXY_SECRET", "s3cret")
    req = request(
        {
            "x-forwarded-for": "76.76.21.21",  # the frontend's server
            "x-echo-client-ip": "203.0.113.9",
            "x-echo-proxy-secret": "s3cret",
        }
    )
    assert client_ip(req) == "203.0.113.9"


def test_ignores_a_relayed_ip_with_a_wrong_or_missing_secret(monkeypatch):
    monkeypatch.setenv("ECHO_PROXY_SECRET", "s3cret")
    forged = {"x-forwarded-for": "198.51.100.1", "x-echo-client-ip": "203.0.113.9"}
    assert client_ip(request(forged)) == "198.51.100.1"
    assert client_ip(request({**forged, "x-echo-proxy-secret": "guess"})) == "198.51.100.1"
