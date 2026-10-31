"""The always-on voice agent on the phone.

After the wake word, the Android service records one command and posts it
here. A single round trip transcribes it, acts on it (or answers it) and
returns what the agent should say, how the phone should vibrate, and a
notification to post. The service runs in the background, so it can't show
a confirmation screen: low-confidence creates are left as drafts and the
user is asked to confirm in the app.
"""

import logging
import re
from typing import Any

from fastapi import APIRouter, Request
from starlette.concurrency import run_in_threadpool

from app.db import is_supabase_configured
from app.http import ApiError
from app.rate_limit import rate_limit
from app.routes.voice import (
    MAX_TRANSCRIPT,
    _require_api_key,
    act_on_transcript,
    answer_question,
    read_audio_upload,
    whisper,
)
from app.shape import money
from app.user import get_current_user_id

log = logging.getLogger("echo")
router = APIRouter(prefix="/api/agent")

DEFAULT_AGENT_NAME = "Echo"
MAX_AGENT_NAME = 24

# Same phrasing check the in-app voice sheet uses to send speech to /api/ask.
_QUESTION_RE = re.compile(
    r"^(how much|what (did|was|have)|show me|total|sum|biggest|largest|most|list)", re.I
)


def agent_name(value: Any) -> str:
    """A display-safe agent name: letters, spaces and a few marks."""
    text = re.sub(r"[^\w '\-]", "", value if isinstance(value, str) else "", flags=re.UNICODE)
    text = " ".join(text.split())[:MAX_AGENT_NAME]
    return text or DEFAULT_AGENT_NAME


def strip_wake_word(transcript: str, name: str) -> str:
    """Drops a leading "hey <name>" that Whisper may have caught at the start
    of the recording."""
    pattern = r"^\s*(?:(?:hey|hi|ok|okay)\s+)?" + re.escape(name) + r"\b[\s,.!?]*"
    return re.sub(pattern, "", transcript, count=1, flags=re.I).strip()


def looks_like_question(transcript: str) -> bool:
    return bool(_QUESTION_RE.match(transcript.strip()))


def reply(
    action: str,
    spoken: str,
    *,
    haptic: str,
    title: str,
    transcript: str = "",
    **extra: Any,
) -> dict[str, Any]:
    """The agent's answer. `haptic` is one of success | warning | error, and
    `title` + `spoken` become the notification."""
    return {
        "action": action,
        "transcript": transcript,
        "spoken": spoken,
        "haptic": haptic,
        "notification": {"title": title, "body": spoken},
        **extra,
    }


def _describe(tx: dict[str, Any]) -> str:
    amount = money(tx["amountMinor"]).replace(".00", "")
    if tx.get("direction") == "income":
        return f"{amount} from {tx['merchantRaw']}"
    return f"{amount} for {tx['merchantRaw']}"


def _from_action(result: dict[str, Any], transcript: str, name: str) -> dict[str, Any]:
    """Turns an act_on_transcript response into the agent's reply."""
    action = result["result"]["action"]
    tx = result.get("transaction")

    if action == "delete" and result.get("deletedId"):
        return reply(
            "delete", "Done, I deleted it.", haptic="success", title=f"{name} deleted a memory",
            transcript=transcript, deletedId=result["deletedId"],
        )
    if action == "update" and tx:
        return reply(
            "update", f"Updated. It's now {_describe(tx)}.", haptic="success",
            title=f"{name} updated a memory", transcript=transcript, transaction=tx,
        )
    if tx:
        verb = "Added income of" if tx.get("direction") == "income" else "Saved"
        return reply(
            "create", f"{verb} {_describe(tx)}.", haptic="success",
            title=f"{name} saved a memory", transcript=transcript, transaction=tx,
        )

    draft = result.get("draft")
    if draft:
        amount = money(draft["amount"]).replace(".00", "")
        return reply(
            "draft",
            f"I think you said {amount} for {draft['merchant']}. Open Echo to confirm it.",
            haptic="warning", title=f"{name} needs a quick check",
            transcript=transcript, draft=draft,
        )

    return reply(
        "none",
        result.get("warning") or "Sorry, I didn't get that. Try again?",
        haptic="warning", title=name, transcript=transcript,
    )


@router.post("/turn")
async def turn(request: Request):
    """One spoken command: multipart `file` (audio), `language`, and `name`
    (the agent's name, so it can be stripped and used in replies)."""
    rate_limit(request, "llm", 30, 60)

    # The service can't receive a new session cookie, so it must not create
    # a guest here. The user signs in (or becomes a guest) by opening the app.
    user_id = get_current_user_id(request)
    if not user_id:
        raise ApiError(401, "Open Echo once so I know who you are.")

    filename, audio, language = await read_audio_upload(request)
    form = await request.form()
    name = agent_name(form.get("name"))

    api_key = _require_api_key("Voice input isn't configured on this deployment.")
    if not is_supabase_configured():
        raise ApiError(503, "Backend not configured.")

    try:
        heard = await run_in_threadpool(whisper, api_key, filename, audio, language)
    except Exception as exc:
        log.exception("[agent] transcription failed")
        raise ApiError(502, "Transcription failed") from exc

    transcript = strip_wake_word(heard, name)[:MAX_TRANSCRIPT]
    if not transcript:
        return reply("none", "I'm listening, but I didn't catch that.", haptic="warning", title=name)

    def run() -> dict[str, Any]:
        if not looks_like_question(transcript):
            acted = act_on_transcript(transcript, api_key, user_id)
            if acted["result"]["action"] != "query":
                return _from_action(acted, transcript, name)
        answered = answer_question(transcript, api_key, lambda: user_id)
        query = answered["query"]
        return reply(
            "query", query["spoken"] or query["headline"], haptic="success",
            title=query["headline"] or name, transcript=transcript, query=query,
        )

    return await run_in_threadpool(run)
