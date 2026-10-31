"""The voice pipeline: transcription, intent parsing, actions, and questions.

Everything the LLM returns is treated as untrusted input: ids must be uuids
owned by the caller, amounts and dates are re-validated, and every query is
scoped to the session's user.
"""

import logging
import os
import re
from typing import Any

from fastapi import APIRouter, Body, Request
from groq import Groq
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from app import llm
from app.categories import create_category, list_categories_for_user
from app.config import groq_api_key
from app.db import get_supabase, is_supabase_configured, rows
from app.http import ApiError
from app.ids import is_uuid
from app.merchant_aliases import resolve_merchant, upsert_alias
from app.queries import QueryFilters, run_query
from app.rate_limit import rate_limit
from app.shape import index_categories, to_number, to_ui_transaction
from app.timeutil import now_iso
from app.transaction_input import load_tx_context, parse_amount, parse_date
from app.transactions import (
    create_transaction,
    delete_transaction,
    get_transaction,
    list_transactions,
    update_transaction,
)
from app.user import require_user_id

log = logging.getLogger("echo")
router = APIRouter(prefix="/api")

# Longest transcript we will send to the LLM.
MAX_TRANSCRIPT = 1000
# Creates at or above this confidence are saved immediately. Below it the
# route only returns a draft and the client saves once the user confirms
# (matches the voice sheet's own threshold).
AUTO_SAVE_CONFIDENCE = 0.7
# Voice notes are short; anything bigger is not a voice note.
MAX_AUDIO_BYTES = 10 * 1024 * 1024
WHISPER_MODEL = os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo")

_UNDERSTAND_FAILED = "Couldn't understand that. Please try again."


def _transcript(body: Any) -> str:
    value = body.get("transcript") if isinstance(body, dict) else None
    transcript = value.strip() if isinstance(value, str) else ""
    if not transcript:
        raise ApiError(400, "Missing 'transcript' field")
    if len(transcript) > MAX_TRANSCRIPT:
        raise ApiError(400, "Transcript too long")
    return transcript


def _require_api_key(message: str) -> str:
    api_key = groq_api_key()
    if not api_key:
        raise ApiError(503, message)
    return api_key


def _parse(transcript: str, api_key: str, context: str, recent=None) -> dict[str, Any]:
    try:
        return llm.parse_transcript(transcript, api_key, recent)
    except Exception as exc:
        log.exception("[%s] parse failed", context)
        raise ApiError(502, _UNDERSTAND_FAILED) from exc


# ---------------------------------------------------------------------------
# Transcription
# ---------------------------------------------------------------------------


@router.post("/transcribe")
async def transcribe(request: Request):
    """Transcribes a multipart `file` upload with Groq Whisper."""
    rate_limit(request, "llm", 30, 60)

    declared = int(request.headers.get("content-length") or 0)
    if declared > MAX_AUDIO_BYTES + 64 * 1024:
        raise ApiError(413, "Audio too large")

    try:
        form = await request.form()
    except Exception as exc:
        raise ApiError(400, "Expected multipart/form-data with an audio file") from exc

    file = form.get("file")
    if not isinstance(file, UploadFile):
        raise ApiError(400, "Missing 'file' field in form data")
    audio = await file.read()
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        raise ApiError(413, "Audio too large")
    content_type = file.content_type or ""
    if content_type and not content_type.startswith("audio/") and content_type != "video/webm":
        raise ApiError(415, "Expected an audio file")

    api_key = _require_api_key("Transcription isn't configured on this deployment.")

    # Whisper accepts webm/opus, mp4, wav, m4a, etc. A language hint improves
    # accuracy for en-IN users on short utterances.
    requested = str(form.get("language") or "en")
    language = requested if re.fullmatch(r"[a-z]{2}", requested) else "en"

    def call_whisper() -> str:
        result = Groq(api_key=api_key).audio.transcriptions.create(
            file=(file.filename or "audio.webm", audio),
            model=WHISPER_MODEL,
            language=language,
            response_format="json",
            temperature=0,
        )
        return (getattr(result, "text", "") or "").strip()

    try:
        text = await run_in_threadpool(call_whisper)
    except Exception as exc:
        log.exception("[transcribe] Groq request failed")
        raise ApiError(502, "Transcription failed") from exc
    return {"text": text}


# ---------------------------------------------------------------------------
# Parsing only (onboarding demo)
# ---------------------------------------------------------------------------


@router.post("/parse-transcript")
def parse_transcript(request: Request, body: Any = Body(None)):
    rate_limit(request, "llm", 30, 60)
    transcript = _transcript(body)
    api_key = _require_api_key("Voice parsing isn't configured on this deployment.")
    return _parse(transcript, api_key, "parse-transcript")


# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------

_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")


def default_kind_for_query(transcript: str) -> str:
    """Keyword fallback when the LLM doesn't give a query kind."""
    t = transcript.lower()
    if re.search(r"biggest|largest|most expensive", t):
        return "biggest"
    if re.search(r"list|show me|what did i|recent", t):
        return "list"
    return "sum"


def default_direction_for_query(transcript: str) -> str:
    """Keyword fallback when the LLM doesn't say income vs expense."""
    t = transcript.lower()
    if re.search(r"earn|earned|income|salary|received|got paid|credit|cashback|refund|deposit", t):
        return "income"
    return "expense"


@router.post("/ask")
def ask(request: Request, body: Any = Body(None)):
    """Answers a spoken question about the user's money."""
    rate_limit(request, "llm", 30, 60)
    api_key = _require_api_key("Voice queries aren't configured on this deployment.")
    transcript = _transcript(body)
    session_id = body.get("sessionId")
    voice_session_id = (
        session_id if isinstance(session_id, str) and _SESSION_ID_RE.match(session_id) else None
    )
    if not is_supabase_configured():
        raise ApiError(503, "Backend not configured.")

    parsed = _parse(transcript, api_key, "ask")

    # If the parser heard something else (e.g. "create"), still answer it as
    # a question.
    kind = (
        parsed["queryKind"]
        if parsed["action"] == "query" and parsed["queryKind"]
        else default_kind_for_query(transcript)
    )
    filters = QueryFilters(
        kind=kind,
        range=parsed["queryRange"],
        category_name=parsed["queryCategory"],
        merchant=parsed["queryMerchant"],
        limit=parsed["queryLimit"],
        direction=parsed["queryDirection"] or default_direction_for_query(transcript),
    )

    user_id = require_user_id(request)
    result = run_query(user_id, filters)
    supabase = get_supabase()

    # Earlier turns of this voice conversation give the LLM context.
    history: list[Any] = []
    if voice_session_id:
        history = rows(
            supabase.table("voice_sessions")
            .select("transcript, parsed_intent")
            .eq("user_id", user_id)
            .eq("device", voice_session_id)
            .order("started_at", desc=True)
            .limit(5)
            .execute()
        )[::-1]

    try:
        spoken = llm.generate_reasoned_response(transcript, result, history, api_key)
    except Exception:
        log.exception("[ask] reasoned response failed")
        spoken = result["spoken"]

    response: dict[str, Any] = {
        "result": {**parsed, "action": "query", "queryKind": kind},
        "query": {**result, "spoken": spoken},
    }

    if voice_session_id:
        supabase.table("voice_sessions").insert(
            {
                "user_id": user_id,
                "started_at": now_iso(),
                "transcript": transcript,
                "parsed_intent": parsed,
                "outcome": "created",
                "device": voice_session_id,
            }
        ).execute()

    if parsed["action"] != "query":
        response["warning"] = "I heard that as a question, but I wasn't sure. Here's my best answer."
    return response


# ---------------------------------------------------------------------------
# Voice actions
# ---------------------------------------------------------------------------


def _pick_category_id(name: str | None, categories: list[dict[str, Any]]) -> str | None:
    if not name:
        return None
    wanted = name.lower()
    return next((c["id"] for c in categories if c["name"].lower() == wanted), None)


def _resolve_category_id(
    user_id: str, name: str | None, categories: list[dict[str, Any]]
) -> str | None:
    """The user's category for an LLM-supplied name, creating a custom one if
    none matches. New categories are appended to `categories` so later
    lookups in this request see them."""
    if not name:
        return None
    existing = _pick_category_id(name, categories)
    if existing:
        return existing
    trimmed = name.strip()[:40]
    if not trimmed:
        return None
    try:
        created = create_category(user_id, trimmed, tone="neutral")
    except Exception:
        log.exception("[voice-intent] failed to auto-create category")
        return None
    categories.append(created)
    return created["id"]


@router.post("/voice-intent")
def voice_intent(request: Request, body: Any = Body(None)):
    """Transcript → LLM parse → create / update / delete a transaction."""
    rate_limit(request, "llm", 30, 60)
    transcript = _transcript(body)
    api_key = _require_api_key("Voice input isn't configured on this deployment.")
    if not is_supabase_configured():
        raise ApiError(503, "Backend not configured.")

    user_id = require_user_id(request)

    # The last few transactions let the parser resolve "change the last one".
    try:
        recent = [
            {
                "id": r["id"],
                "transactedAt": r["transacted_at"],
                "merchantRaw": r["merchant_raw"],
                "amount": to_number(r["amount_minor"]),
            }
            for r in list_transactions(user_id, 5)
        ]
    except Exception:
        recent = []

    parsed = _parse(transcript, api_key, "voice-intent", recent)
    response: dict[str, Any] = {"result": parsed}
    categories = list_categories_for_user(user_id)

    if parsed["action"] == "update":
        tx_id = parsed["matchId"]
        if not is_uuid(tx_id):
            response["warning"] = (
                "I couldn't match that to a recent expense. Could you be more specific?"
            )
            return response
        if not get_transaction(user_id, tx_id):
            response["warning"] = "That expense isn't on file anymore."
            return response

        patch: dict[str, Any] = {}
        new_amount = parse_amount(parsed["newAmount"])
        if new_amount is not None:
            patch["amount_minor"] = new_amount
        if parsed["newMerchant"]:
            new_merchant = parsed["newMerchant"][:200]
            patch["merchant_raw"] = new_merchant
            patch["merchant_canonical"] = resolve_merchant(user_id, new_merchant).canonical
        new_date = parse_date(parsed["newTransactedAt"])
        if new_date:
            patch["transacted_at"] = new_date
        if parsed["direction"]:
            patch["direction"] = parsed["direction"]
        cat_id = _resolve_category_id(user_id, parsed["category"], categories)
        if cat_id:
            patch["category_id"] = cat_id

        if not patch:
            response["warning"] = "I couldn't tell what to change. Could you say it again?"
            return response
        updated = update_transaction(user_id, tx_id, patch)
        if not updated:
            response["warning"] = "Couldn't update that expense."
            return response
        response["transaction"] = to_ui_transaction(updated, index_categories(categories))
        return response

    if parsed["action"] == "delete":
        tx_id = parsed["matchId"]
        if not is_uuid(tx_id):
            response["warning"] = (
                "I couldn't match that to a recent expense. Which one did you mean?"
            )
            return response
        if not delete_transaction(user_id, tx_id):
            response["warning"] = "That expense isn't on file anymore."
            return response
        response["deletedId"] = tx_id
        return response

    # create (queries are answered by /api/ask)
    amount = parse_amount(parsed["amount"])
    merchant = parsed["merchant"][:200] if parsed["merchant"] else None
    if amount is None or not merchant:
        response["warning"] = (
            "I couldn't pin down the amount or merchant. Please try again or type it in."
        )
        return response

    resolved = resolve_merchant(user_id, merchant)
    auto_save = parsed["confidence"] >= AUTO_SAVE_CONFIDENCE
    category_id = (
        _pick_category_id(parsed["category"], categories)
        or (resolved.alias or {}).get("category_id")
        # Only invent a new category for rows we're actually saving.
        or (_resolve_category_id(user_id, parsed["category"], categories) if auto_save else None)
    )
    transacted_at = parse_date(parsed["transactedAt"]) or now_iso()
    direction = parsed["direction"] or "expense"

    response["draft"] = {
        "amount": amount,
        "merchant": merchant,
        "categoryId": category_id,
        "direction": direction,
        "transactedAt": transacted_at,
        "rawTranscript": transcript,
        "confidence": parsed["confidence"],
    }
    if not auto_save:
        return response

    # Remember a newly heard merchant so future mis-hearings of the same
    # name fuzzy-match it.
    if resolved.created_new:
        try:
            upsert_alias(user_id, merchant, resolved.canonical, category_id)
        except Exception:
            pass  # Best-effort; the transaction still saves.

    ctx = load_tx_context(user_id)
    row = create_transaction(
        user_id,
        {
            "account_id": ctx.account_id,
            "category_id": category_id,
            "amount_minor": amount,
            "currency": ctx.home_currency,
            "direction": direction,
            "merchant_raw": merchant,
            "merchant_canonical": resolved.canonical,
            "note": None,
            "source": "voice",
            "confidence": parsed["confidence"],
            "raw_transcript": transcript,
            "transacted_at": transacted_at,
            "clarified": False,
        },
    )
    response["transaction"] = to_ui_transaction(row, index_categories(categories))
    return response
