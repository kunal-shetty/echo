"""LLM features built on LangChain + Groq.

- `parse_transcript`: classifies an utterance (create / update / delete /
  query) and extracts its fields into a validated Pydantic model.
- `generate_reasoned_response`: turns a query result into a short spoken answer.
- `generate_smart_insights`: produces a handful of coaching insights.

Each feature is an LCEL chain: prompt | chat model | output parser.
"""

import json
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal

from langchain_core.exceptions import OutputParserException
from langchain_core.language_models import BaseChatModel
from langchain_core.output_parsers import (
    JsonOutputParser,
    PydanticOutputParser,
    StrOutputParser,
)
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import Runnable
from langchain_groq import ChatGroq
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    ValidationError,
    ValidatorFunctionWrapHandler,
    WrapValidator,
)

from app.queries import QueryKind, QueryRange
from app.timeutil import format_human_date, iso
from app.transaction_input import js_round

MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")


def chat_model(api_key: str, *, temperature: float, json_mode: bool = False) -> Runnable:
    """The Groq chat model, optionally forced to emit a JSON object.

    Tests replace this with a fake model.
    """
    llm: BaseChatModel = ChatGroq(model=MODEL, api_key=api_key, temperature=temperature)
    return llm.bind(response_format={"type": "json_object"}) if json_mode else llm


# ---------------------------------------------------------------------------
# Intent parsing
# ---------------------------------------------------------------------------


def _or_none(value: Any, handler: ValidatorFunctionWrapHandler) -> Any:
    """Turns an invalid field into None instead of failing the whole parse."""
    try:
        return handler(value)
    except ValidationError:
        return None


def _clean_str(value: str | None) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _finite(value: float | None) -> float | None:
    return value if value is not None and math.isfinite(value) else None


# A field that is None when the model leaves it out or sends junk.
Lenient = WrapValidator(_or_none)
OptStr = Annotated[str | None, Lenient, AfterValidator(_clean_str)]
OptNum = Annotated[float | None, Lenient, AfterValidator(_finite)]
Dir = Annotated[Literal["expense", "income"] | None, Lenient]


class _Match(BaseModel):
    id: OptStr = None


class ParsedIntent(BaseModel):
    """The model's JSON reply, as described by the system prompt."""

    model_config = ConfigDict(extra="ignore")

    action: Annotated[Literal["create", "update", "delete", "query"] | None, Lenient] = None
    amount: OptNum = None
    merchant: OptStr = None
    direction: Dir = None
    category: OptStr = None
    transacted_at: OptStr = None
    match: Annotated[_Match | None, Lenient] = None
    newAmount: OptNum = None
    newMerchant: OptStr = None
    newTransactedAt: OptStr = None
    queryKind: Annotated[QueryKind | None, Lenient] = None
    queryRange: Annotated[QueryRange | None, Lenient] = None
    queryCategory: OptStr = None
    queryMerchant: OptStr = None
    queryLimit: OptNum = None
    queryDirection: Dir = None
    confidence: OptNum = None


def _build_system_prompt(now: datetime) -> str:
    today = format_human_date(iso(now))
    yesterday = format_human_date(iso(now - timedelta(days=1)))

    return f"""You are the parser for Echo, a voice-first finance tracker for INR.
You support English, Hindi, and Hinglish (a mix of Hindi and English).

## Language Support
- The user may speak in English, Hindi, or Hinglish.
- You must map meanings from any of these languages to the structured output.
- Examples: "Spent 100 on tea" = "100 chai pe kharch kiya" = "Tea ke liye 100 diye".

## Time context
- Today is: {today}
- Yesterday was: {yesterday}
- All "transacted_at" timestamps you emit must be ISO 8601 in UTC.
  * "today" / "aaj" → start of today in user's timezone, or "now" if the user didn't specify a time.
  * "yesterday" / "kal" → start of yesterday in user's timezone.
  * "the day before yesterday" / "parso" → 2 days back.
  * If no time hint, default to the current wall-clock time on the inferred day.
  * If the user says a clock time ("at 7pm" / "7 baje"), use that.

## What the user might say
The user dictates short utterances like:
  - English: "spent 150 on lunch", "paid twelve fifty at blue bottle coffee", "received 50,000 salary"
  - Hindi/Hinglish: "150 lunch pe kharch kiya", "blue bottle coffee ko barah sau pachas diye", "50,000 salary mili", "kal 200 petrol pe kharch huye"
  - Queries: "how much did I spend this month", "is mahine kitna kharch kiya", "kal kya kharch kiya", "show me my last 5 expenses", "mere aakhri 5 kharche dikhao"

## Intent classification
Every utterance is one of four actions. Pick exactly one:

- "create" — the user is recording a NEW expense or income.
  * Cues (EN): "spent", "paid", "bought", "received", "got", "earned", "credited", "salary of".
  * Cues (HI/Hinglish): "kharch kiya", "diye", "pay kiya", "bhara", "mila", "aaye", "credit hua", "salary aayi".
  * Required: amount, merchant.
  * Optional: category, transacted_at (default = today, current time).
  * Set direction to "income" when the verb is credit-shaped (received / mila / got / aaye / earned / credit hua / salary / refund / cashback), otherwise "expense".
- "update" — the user is correcting or amending an EXISTING memory.
  * Cues (EN): "update", "change", "fix", "correct", "it was X not Y".
  * Cues (HI/Hinglish): "update karo", "change karo", "galat hai", "X nahi Y tha".
  * Required: match (one entry from the recent list below, identified by its 'id'), and at least one of newAmount / newMerchant / newTransactedAt.
  * If the user wants to flip a memory from expense → income or back, also set direction.
- "delete" — the user is removing an existing memory.
  * Cues (EN): "delete", "remove", "cancel".
  * Cues (HI/Hinglish): "delete karo", "hata do", "cancel karo".
  * Required: match.id.
- "query" — the user is asking a question about their money.
  * Cues (EN): "how much", "what did I", "show me", "what was my biggest", "total", "list".
  * Cues (HI/Hinglish): "kitna", "kitne paise", "dikhao", "total kitna", "sabse bada kharcha".
  * NEVER has an amount-to-record.
  * Required: queryKind.
  * Optional: queryRange, queryCategory, queryMerchant, queryLimit, queryDirection.
  * For complex queries (e.g. "more than X", "between dates", "compared to"), provide an `nlqSpec`.

  ### NLQ Specification (`nlqSpec`)
  Use this for queries that exceed the basic filters.
  - aggregate: "sum" | "count" | "max" | "min" | "avg"
  - field: "amount_minor" | "id"
  - filters: array of {{ field, operator, value }}
    * fields: "category_id", "merchant_canonical", "merchant_raw", "direction", "transacted_at"
    * operators: "eq" (equals), "ilike" (fuzzy match), "gte" (>=), "lt" (<), "in" (list)
  - range: same as queryRange
  - limit: number

### Direction
- "expense" — money leaving (default for "spent/paid/bought" / "kharch/diye").
- "income" — money arriving. Cues: "received", "got", "earned", "salary", "credited" / "mila", "aaye", "credit hua".
- If unclear, default to "expense".

### Query kinds
- "sum" — totals. Cues: "how much", "total", "sum" / "kitna", "total kitna".
- "list" — show a list of memories. Cues: "show me", "what did I", "list my" / "dikhao", "list karo".
- "biggest" — single largest memory. Cues: "biggest", "largest", "most expensive" / "sabse bada".

### Query ranges (default: "all")
- "today" — same calendar day as today / "aaj".
- "yesterday" — same calendar day as yesterday / "kal".
- "this_week" — Monday to today / "is hafte".
- "this_month" — 1st of this month to today / "is mahine".
- "last_month" — entire previous calendar month / "pichle mahine".
- "all" — no time filter. Default if the user didn't specify a range.

### Query filters
- queryCategory: one of "Food & Drink", "Groceries", "Transport", "Entertainment", "Shopping", "Bills", "Other".
- queryMerchant: the merchant name they asked about. Examples: "on Zomato", "with Ayushi", "at BigBasket".
- queryLimit: number of items to list (default 5 for list queries; ignore for sum/biggest).
- queryDirection:
  * "expense" — when the user says "spent", "paid", "cost me", "how much on food" / "kharch", "diye".
  * "income" — when the user says "earned", "received", "got paid", "salary", "income", "made" / "mila", "aaye".
  * null — when the user explicitly asks for both, or the cue is ambiguous.

## Output schema
Respond with STRICT JSON only. No commentary, no markdown, no code fences.

{{
  "action": "create" | "update" | "delete" | "query",
  "amount": number | null,
  "merchant": string | null,
  "direction": "expense" | "income" | null,
  "category": string | null,
  "transacted_at": string | null,
  "match": {{ "id": string }} | null,
  "newAmount": number | null,
  "newMerchant": string | null,
  "newTransactedAt": string | null,
  "queryKind": "sum" | "list" | "biggest" | null,
  "queryRange": "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "all" | null,
  "queryCategory": string | null,
  "queryMerchant": string | null,
  "queryLimit": number | null,
  "queryDirection": "expense" | "income" | null,
  "nlqSpec": {{
    "aggregate": "sum" | "count" | "max" | "min" | "avg",
    "field": "amount_minor" | "id",
    "filters": Array<{{ "field": string, "operator": string, "value": any }}>,
    "range": "today" | "yesterday" | "this_week" | "this_month" | "last_month" | "all" | null,
    "limit": number | null
  }} | null,
  "confidence": number
}}

## Rules
- Currency is INR by default. "$", "dollars", "USD" → treat as rupees. Do NOT refuse the parse.
- amount / newAmount: numeric, positive, in major units (no ₹, no Rs). Convert words ("twelve fifty" → 12.5). Indian formats ("12k" → 12000, "1.2L" → 120000).
- merchant / newMerchant: short title-case ("lunch" → "Lunch", "blue bottle coffee" → "Blue Bottle Coffee", "salary" → "Salary", "freelance payment" → "Freelance Payment"). Strip filler words like "on", "at", "for" from the start.
- category (when set): one of "Food & Drink", "Groceries", "Transport", "Entertainment", "Shopping", "Bills", "Other". Pick the closest. For salary / freelance, "Other" is fine if nothing else fits.
- match.id: when the recent transactions list below contains the user's intended target, use its id. If nothing in the list matches with reasonable confidence, set match to null and confidence below 0.5.
- "how much have I spent on Ayushi" is a sum query filtered by merchant "Ayushi" (the model treats a person mentioned in spending context as a merchant).
- "biggest" always implies list=1 (limit not needed).
- Confidence guidance:
  * 0.0–0.3 → very low. UI shows manual entry form.
  * 0.3–0.7 → uncertain. UI shows a confirm card.
  * 0.7–1.0 → confident. UI auto-saves.
- Field Requirements:
  * If action is "create": amount and merchant are REQUIRED.
  * If action is "update": match.id and (newAmount or newMerchant or newTransactedAt) are REQUIRED.
  * If action is "delete": match.id is REQUIRED.
  * If action is "query": queryKind is REQUIRED.
  * All other fields should be null if not applicable.
"""


# The system prompt is passed in as a variable so its literal JSON braces
# are never read as template placeholders.
_PARSE_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", "{system}"),
        ("human", 'Transcript: "{transcript}"\n\nReturn JSON only.'),
    ]
)


def _recent_block(recent: list[dict[str, Any]] | None) -> str:
    if not recent:
        return "\n\n(No recent transactions — the user has no edit/delete targets available.)"
    lines = [
        f'{i}. id="{r["id"]}" · {format_human_date(r["transactedAt"])} · {r["merchantRaw"]} · {r["amount"]}'
        for i, r in enumerate(recent, start=1)
    ]
    return (
        "\n\n## Recent transactions (newest first)\nUse these to identify update/delete targets:\n"
        + "\n".join(lines)
    )


def parse_transcript(
    transcript: str, api_key: str, recent: list[dict[str, Any]] | None = None
) -> dict[str, Any]:
    """Extracts a structured intent from a voice transcript.

    `recent` holds the last few transactions ({id, transactedAt, merchantRaw,
    amount}) so the model can resolve "change the last one". Returns the
    camelCase ParseResult the frontend expects (see lib/parse.ts). Raises if
    the model call fails or its reply isn't JSON.
    """
    chain = (
        _PARSE_PROMPT
        | chat_model(api_key, temperature=0.1, json_mode=True)
        | PydanticOutputParser(pydantic_object=ParsedIntent)
    )
    system = _build_system_prompt(datetime.now(timezone.utc)) + _recent_block(recent)
    p: ParsedIntent = chain.invoke({"system": system, "transcript": transcript})

    limit = p.queryLimit
    return {
        "action": p.action or "create",
        "amount": p.amount,
        "merchant": p.merchant,
        "direction": p.direction,
        "category": p.category,
        "transactedAt": p.transacted_at,
        "matchId": p.match.id if p.match else None,
        "newAmount": p.newAmount,
        "newMerchant": p.newMerchant,
        "newTransactedAt": p.newTransactedAt,
        "queryKind": p.queryKind,
        "queryRange": p.queryRange,
        "queryCategory": p.queryCategory,
        "queryMerchant": p.queryMerchant,
        "queryLimit": js_round(limit) if limit is not None and 0 < limit <= 50 else None,
        "queryDirection": p.queryDirection,
        "confidence": max(0.0, min(1.0, p.confidence)) if p.confidence is not None else 0.5,
        "transcript": transcript,
    }


# ---------------------------------------------------------------------------
# Spoken answers
# ---------------------------------------------------------------------------

_REASONED_SYSTEM = """You are Echo, a concise and encouraging finance coach.
Today is {today}.
Your goal is to answer the user's query using the provided data, but add a "nugget" of intelligence or a helpful observation.

Rules:
- Be extremely concise (max 2 sentences) because this will be spoken via TTS.
- Be natural and conversational.
- Use the provided data accurately.
- Add a small insight: a comparison, a warning, or a compliment about their spending.
- If the result is empty, be encouraging but honest.

Example:
User: "How much did I spend on coffee?"
Data: {{ total: 1200, range: "this_month", rows: [...] }}
Response: "You've spent ₹1,200 on coffee this month. That's a bit more than usual—maybe try a few more home-brews?\""""

_REASONED_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", _REASONED_SYSTEM),
        (
            "human",
            'User said: "{transcript}"\nData: {data}\n\nWhat is the natural, reasoned response?',
        ),
    ]
)


def generate_reasoned_response(
    transcript: str, result: dict[str, Any], history: list[Any], api_key: str
) -> str:
    """A short, natural spoken answer to a query, with a small insight."""
    chain = _REASONED_PROMPT | chat_model(api_key, temperature=0.7) | StrOutputParser()
    data = json.dumps(
        {"transcript": transcript, "result": result, "history": history},
        ensure_ascii=False,
        default=str,
    )
    text = chain.invoke(
        {
            "today": format_human_date(iso(datetime.now(timezone.utc))),
            "transcript": transcript,
            "data": data,
        }
    ).strip()
    return text or "I'm not sure how to answer that right now."


# ---------------------------------------------------------------------------
# Smart insights
# ---------------------------------------------------------------------------

_INSIGHTS_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            """You are Echo's Insight Engine. You analyze financial transactions and provide 3-5 high-impact, reasoned insights.

Rules:
- Focus on patterns: anomalies, habits, or trends.
- Be concise but insightful.
- Format each insight as a JSON object with:
  - title: A catchy title (e.g., "Spending Spike", "Loyalty Alert").
  - text: The reasoned insight (e.g., "You spent ₹2,000 more on Food than last month").
  - hero_metric: The key number (e.g., "₹2,000").
  - cta: A call to action (e.g., "Review Food expenses").
  - kind: One of "anomaly", "spend_pattern", "trend".
- Respond with a JSON array of these objects. No markdown.""",
        ),
        ("human", "Transactions: {transactions}\n\nGenerate 3 smart insights."),
    ]
)

# Values of the `insight_kind` enum in schema.sql.
INSIGHT_KINDS = {"spend_pattern", "anomaly", "trend", "subscription_check", "budget_alert"}


def _text_or(value: Any, fallback: str, max_len: int) -> str:
    return value.strip()[:max_len] if isinstance(value, str) and value.strip() else fallback


def generate_smart_insights(
    transactions: list[dict[str, Any]], api_key: str
) -> list[dict[str, Any]]:
    """3-5 coaching insights as [{kind, payload}], ready to store."""
    chain = (
        _INSIGHTS_PROMPT
        | chat_model(api_key, temperature=0.7, json_mode=True)
        | JsonOutputParser()
    )
    compact = [
        {
            "merchant": t.get("merchant_raw"),
            "amount": t.get("amount_minor"),
            "category": t.get("category_id"),
            "date": t.get("transacted_at"),
        }
        for t in transactions
    ]
    try:
        parsed = chain.invoke({"transactions": json.dumps(compact, ensure_ascii=False)})
    except OutputParserException:
        parsed = None

    # The model may return {"insights": [...]}, a bare array, or an object
    # wrapping the array under some other key.
    if isinstance(parsed, list):
        insights = parsed
    elif isinstance(parsed, dict):
        insights = next((v for v in parsed.values() if isinstance(v, list)), [])
    else:
        insights = []

    return [
        {
            "kind": i.get("kind") if i.get("kind") in INSIGHT_KINDS else "trend",
            "payload": {
                "title": _text_or(i.get("title"), "Insight", 80),
                "text": _text_or(i.get("text"), "", 400),
                "hero_metric": _text_or(i.get("hero_metric"), "", 40),
                "cta": _text_or(i.get("cta"), "View details", 60),
            },
        }
        for i in insights
        if isinstance(i, dict)
    ][:5]
