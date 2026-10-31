"""POST /api/agent/turn: the phone's wake-word agent."""

from unittest.mock import MagicMock

import pytest

from app.routes import agent

TX = {"id": "tx-1", "amountMinor": 200, "merchantRaw": "Petrol", "direction": "expense"}


@pytest.fixture
def mocks(monkeypatch):
    m = {
        "get_current_user_id": MagicMock(return_value="user-1"),
        "whisper": MagicMock(return_value="Hey Nova, spent 200 on petrol"),
        "act_on_transcript": MagicMock(
            return_value={"result": {"action": "create"}, "transaction": TX}
        ),
        "answer_question": MagicMock(
            return_value={"query": {"spoken": "You spent ₹500 this week.", "headline": "₹500"}}
        ),
    }
    for name, mock in m.items():
        monkeypatch.setattr(agent, name, mock)
    return m


def turn(client, name="Nova", audio=b"RIFF....WAVE"):
    return client.post(
        "/api/agent/turn",
        files={"file": ("command.wav", audio, "audio/wav")},
        data={"language": "en", "name": name},
    )


def test_requires_an_existing_session(client, mocks):
    mocks["get_current_user_id"].return_value = None
    res = turn(client)
    assert res.status_code == 401
    mocks["whisper"].assert_not_called()


def test_saves_a_spoken_expense_and_strips_the_wake_word(client, mocks):
    res = turn(client)
    assert res.status_code == 200
    body = res.json()
    mocks["act_on_transcript"].assert_called_once_with("spent 200 on petrol", "test-key", "user-1")
    assert body["action"] == "create"
    assert body["haptic"] == "success"
    assert body["spoken"] == "Saved ₹200 for Petrol."
    assert body["notification"] == {"title": "Nova saved a memory", "body": "Saved ₹200 for Petrol."}
    assert body["transaction"] == TX


def test_questions_go_straight_to_the_answer(client, mocks):
    mocks["whisper"].return_value = "how much did I spend this week"
    body = turn(client).json()
    mocks["act_on_transcript"].assert_not_called()
    assert body["action"] == "query"
    assert body["spoken"] == "You spent ₹500 this week."
    assert mocks["answer_question"].call_args.args[2]() == "user-1"


def test_parser_detected_queries_are_answered(client, mocks):
    mocks["whisper"].return_value = "kitna kharcha hua"
    mocks["act_on_transcript"].return_value = {"result": {"action": "query"}}
    assert turn(client).json()["action"] == "query"


def test_low_confidence_creates_ask_for_confirmation(client, mocks):
    mocks["act_on_transcript"].return_value = {
        "result": {"action": "create"},
        "draft": {"amount": 200, "merchant": "Petrol"},
    }
    body = turn(client).json()
    assert body["action"] == "draft"
    assert body["haptic"] == "warning"
    assert "Open Echo to confirm" in body["spoken"]


def test_silence_is_a_gentle_warning(client, mocks):
    mocks["whisper"].return_value = "Hey Nova."
    body = turn(client).json()
    assert body["action"] == "none"
    assert body["haptic"] == "warning"
    mocks["act_on_transcript"].assert_not_called()


def test_transcription_failures_are_502(client, mocks):
    mocks["whisper"].side_effect = RuntimeError("groq down: key sk-123")
    res = turn(client)
    assert res.status_code == 502
    assert "sk-123" not in res.text


def test_missing_audio_is_400(client, mocks):
    res = client.post("/api/agent/turn", data={"name": "Nova"})
    assert res.status_code == 400


@pytest.mark.parametrize(
    "raw, expected",
    [("Nova", "Nova"), ("  Mr.  Penny!! ", "Mr Penny"), ("", "Echo"), (None, "Echo"), ("x" * 40, "x" * 24)],
)
def test_agent_names_are_sanitised(raw, expected):
    assert agent.agent_name(raw) == expected


@pytest.mark.parametrize(
    "heard, expected",
    [
        ("Hey Nova, spent 200", "spent 200"),
        ("nova spent 200", "spent 200"),
        ("Okay Nova! how much", "how much"),
        ("spent 200 at Nova cafe", "spent 200 at Nova cafe"),
        ("Novak paid 50", "Novak paid 50"),
    ],
)
def test_strip_wake_word(heard, expected):
    assert agent.strip_wake_word(heard, "Nova") == expected
