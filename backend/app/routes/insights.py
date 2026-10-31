"""Stored smart insights, and regenerating them with the LLM."""

from datetime import datetime, timezone

from fastapi import APIRouter, Request

from app import llm
from app.config import groq_api_key
from app.db import get_supabase, is_supabase_configured, rows
from app.http import ApiError
from app.rate_limit import rate_limit
from app.timeutil import iso
from app.user import get_current_user_id

router = APIRouter(prefix="/api/insights")

# Most recent rows sent to the LLM; keeps prompt size (and cost) bounded.
MAX_TXS_FOR_INSIGHTS = 300

_NOTHING = {"message": "No transactions found to analyze."}


@router.get("")
def list_insights(request: Request):
    if not is_supabase_configured():
        return {"insights": []}
    user_id = get_current_user_id(request)
    if not user_id:
        return {"insights": []}
    res = (
        get_supabase()
        .table("insights")
        .select("*")
        .eq("user_id", user_id)
        .order("generated_at", desc=True)
        .execute()
    )
    return {"insights": rows(res)}


@router.post("/generate")
def generate(request: Request):
    rate_limit(request, "insights", 5, 10 * 60)
    if not is_supabase_configured():
        raise ApiError(503, "Backend not configured.")
    api_key = groq_api_key()
    if not api_key:
        raise ApiError(503, "Insights aren't configured on this deployment.")

    user_id = get_current_user_id(request)
    if not user_id:
        return _NOTHING
    supabase = get_supabase()

    txs = rows(
        supabase.table("transactions")
        .select("*")
        .eq("user_id", user_id)
        .is_("deleted_at", "null")
        .order("transacted_at", desc=True)
        .limit(MAX_TXS_FOR_INSIGHTS)
        .execute()
    )
    if not txs:
        return _NOTHING

    insights = llm.generate_smart_insights(txs, api_key)

    # Replace the user's previous insights with the fresh set.
    supabase.table("insights").delete().eq("user_id", user_id).execute()
    now = datetime.now(timezone.utc)
    period_start = now.astimezone().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if insights:
        supabase.table("insights").insert(
            [
                {
                    "user_id": user_id,
                    "kind": i["kind"],
                    "period_start": iso(period_start),
                    "period_end": iso(now),
                    "payload": i["payload"],
                    "generated_at": iso(now),
                }
                for i in insights
            ]
        ).execute()

    return {"message": f"Generated {len(insights)} smart insights.", "insights": insights}
