"""The LangChain chains, run against a fake chat model, and the insights route."""

import json
from unittest.mock import MagicMock

import pytest
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app import llm
from app.routes import insights as insights_routes


@pytest.fixture
def model_replies(monkeypatch):
    """Makes every chain's model reply with `content`."""

    def install(content: str):
        fake = FakeListChatModel(responses=[content])
        monkeypatch.setattr(llm, "chat_model", lambda *_a, **_kw: fake)

    return install


# --------------------------------------------------------------------------
# parse_transcript
# --------------------------------------------------------------------------


def test_parses_a_create_intent(model_replies):
    model_replies(
        json.dumps(
            {
                "action": "create",
                "amount": 150,
                "merchant": "  Lunch ",
                "direction": "expense",
                "category": "Food & Drink",
                "confidence": 0.92,
            }
        )
    )
    out = llm.parse_transcript("spent 150 on lunch", "key")
    assert out["action"] == "create"
    assert out["amount"] == 150
    assert out["merchant"] == "Lunch"
    assert out["category"] == "Food & Drink"
    assert out["confidence"] == 0.92
    assert out["transcript"] == "spent 150 on lunch"
    assert out["matchId"] is None


def test_junk_fields_become_null_instead_of_failing(model_replies):
    model_replies(
        json.dumps(
            {
                "action": "explode",
                "amount": "lots",
                "merchant": 42,
                "direction": "sideways",
                "match": "not-an-object",
                "queryKind": "sum",
                "queryRange": "next_year",
                "queryLimit": 500,
                "confidence": 7,
            }
        )
    )
    out = llm.parse_transcript("???", "key")
    assert out["action"] == "create"
    assert out["amount"] is None
    assert out["merchant"] is None
    assert out["direction"] is None
    assert out["matchId"] is None
    assert out["queryKind"] == "sum"
    assert out["queryRange"] is None
    assert out["queryLimit"] is None
    assert out["confidence"] == 1.0


def test_parses_an_update_against_recent_transactions(model_replies):
    model_replies(json.dumps({"action": "update", "match": {"id": "tx-1"}, "newAmount": 600}))
    out = llm.parse_transcript(
        "change the last one to 600",
        "key",
        recent=[
            {"id": "tx-1", "transactedAt": "2026-08-19T14:12:00Z", "merchantRaw": "Cafe", "amount": 500}
        ],
    )
    assert out["matchId"] == "tx-1"
    assert out["newAmount"] == 600
    assert out["confidence"] == 0.5


def test_non_json_replies_raise(model_replies):
    model_replies("sorry, I can't help with that")
    with pytest.raises(Exception):
        llm.parse_transcript("hello", "key")


def test_system_prompt_braces_reach_the_model_intact(monkeypatch):
    fake = FakeListChatModel(responses=["{}"])
    seen = []
    original = fake.invoke

    def spy(messages, *a, **kw):
        seen.append(messages)
        return original(messages, *a, **kw)

    monkeypatch.setattr(llm, "chat_model", lambda *_a, **_kw: fake)
    monkeypatch.setattr(type(fake), "invoke", lambda self, m, *a, **kw: spy(m, *a, **kw))
    llm.parse_transcript("hi", "key")
    system = seen[0].to_messages()[0].content
    assert '"match": { "id": string } | null' in system


# --------------------------------------------------------------------------
# generate_reasoned_response
# --------------------------------------------------------------------------


def test_reasoned_response_returns_the_model_text(model_replies):
    model_replies("  You spent ₹1,200 on coffee this month.  ")
    out = llm.generate_reasoned_response("coffee?", {"total": 1200}, [], "key")
    assert out == "You spent ₹1,200 on coffee this month."


# --------------------------------------------------------------------------
# generate_smart_insights
# --------------------------------------------------------------------------


def test_reads_insights_wrapped_in_an_object(model_replies):
    model_replies(
        json.dumps(
            {
                "insights": [
                    {"kind": "anomaly", "title": "Spike", "text": "Food doubled", "hero_metric": "₹2,000"}
                ]
            }
        )
    )
    assert llm.generate_smart_insights([], "key") == [
        {
            "kind": "anomaly",
            "payload": {
                "title": "Spike",
                "text": "Food doubled",
                "hero_metric": "₹2,000",
                "cta": "View details",
            },
        }
    ]


def test_maps_unknown_kinds_onto_a_valid_enum_value(model_replies):
    model_replies(json.dumps([{"kind": "loyalty", "title": "x"}]))
    [first] = llm.generate_smart_insights([], "key")
    assert first["kind"] == "trend"


def test_returns_nothing_for_unparseable_output(model_replies):
    model_replies("not json at all")
    assert llm.generate_smart_insights([], "key") == []


# --------------------------------------------------------------------------
# POST /api/insights/generate
# --------------------------------------------------------------------------


@pytest.fixture
def insight_mocks(monkeypatch):
    m = {
        "generate_smart_insights": MagicMock(),
        "get_current_user_id": MagicMock(return_value="user-123"),
    }
    monkeypatch.setattr(llm, "generate_smart_insights", m["generate_smart_insights"])
    monkeypatch.setattr(insights_routes, "get_current_user_id", m["get_current_user_id"])
    return m


def test_generate_without_a_session_is_a_friendly_message(client, use_db, insight_mocks):
    use_db()
    insight_mocks["get_current_user_id"].return_value = None
    res = client.post("/api/insights/generate")
    assert res.status_code == 200
    assert res.json()["message"] == "No transactions found to analyze."
    insight_mocks["generate_smart_insights"].assert_not_called()


def test_generate_stores_insights_from_the_users_transactions(client, use_db, insight_mocks):
    insights = [
        {"kind": "anomaly", "payload": {"title": "Biggest Memory", "hero_metric": "₹50"}},
        {"kind": "trend", "payload": {"text": "You visited Coffee Shop 2 times", "hero_metric": "2x"}},
    ]
    insight_mocks["generate_smart_insights"].return_value = insights
    db = use_db({"transactions": [{"data": [{"amount_minor": 1000, "merchant_raw": "Coffee"}]}]})

    res = client.post("/api/insights/generate")
    assert res.status_code == 200
    assert res.json()["insights"] == insights
    assert db.called("transactions", "eq", "user_id", "user-123")
    assert db.called("transactions", "limit")
    assert db.called("insights", "delete")
    assert db.called("insights", "insert")


def test_generate_with_no_transactions(client, use_db, insight_mocks):
    use_db({"transactions": [{"data": []}]})
    res = client.post("/api/insights/generate")
    assert res.json()["message"] == "No transactions found to analyze."


def test_generate_is_rate_limited(client, use_db, insight_mocks):
    use_db({"transactions": [{"data": []}] * 10})
    for _ in range(5):
        assert client.post("/api/insights/generate").status_code == 200
    assert client.post("/api/insights/generate").status_code == 429
