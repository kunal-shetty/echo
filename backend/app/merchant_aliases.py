"""Merchant aliases: map varied spoken names ("the corner cafe") to one
canonical name ("Corner Cafe") using normalized Levenshtein distance."""

import re
from dataclasses import dataclass
from typing import Any

from app.db import first, get_supabase, rows
from app.timeutil import now_iso


def _levenshtein(a: str, b: str) -> float:
    """Normalized edit distance: 0 for identical strings, 1 for unrelated."""
    m, n = len(a), len(b)
    if m == 0:
        return 0 if n == 0 else 1
    if n == 0:
        return 1
    dp = list(range(m + 1))
    for j in range(1, n + 1):
        prev = dp[0]
        dp[0] = j
        for i in range(1, m + 1):
            tmp = dp[i]
            dp[i] = prev if a[i - 1] == b[j - 1] else 1 + min(prev, dp[i], dp[i - 1])
            prev = tmp
    return dp[m] / max(m, n)


def _normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def list_aliases(user_id: str) -> list[dict[str, Any]]:
    res = (
        get_supabase()
        .table("merchant_aliases")
        .select("*")
        .eq("user_id", user_id)
        .order("use_count", desc=True)
        .execute()
    )
    return rows(res)


@dataclass
class MatchedAlias:
    alias: dict[str, Any]
    # Distance 0..1, lower = closer.
    distance: float


def match_alias(
    aliases: list[dict[str, Any]], spoken: str, threshold: float = 0.3
) -> MatchedAlias | None:
    """The closest alias within `threshold`, or None."""
    target = _normalize(spoken)
    if not aliases or not target:
        return None
    best: MatchedAlias | None = None
    for a in aliases:
        d = _levenshtein(target, _normalize(a["canonical"]))
        if d <= threshold and (best is None or d < best.distance):
            best = MatchedAlias(alias=a, distance=d)
    return best


def upsert_alias(
    user_id: str, alias: str, canonical: str, category_id: str | None
) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("merchant_aliases")
        .upsert(
            {
                "user_id": user_id,
                "alias": alias.lower().strip(),
                "canonical": canonical.strip(),
                "category_id": category_id,
                "use_count": 1,
                "last_used_at": now_iso(),
            },
            on_conflict="user_id,alias",
        )
        .execute()
    )
    return first(res)


@dataclass
class ResolvedMerchant:
    canonical: str
    alias: dict[str, Any] | None
    created_new: bool


def resolve_merchant(user_id: str, spoken: str) -> ResolvedMerchant:
    """Resolves a spoken merchant phrase to a canonical name: whole-phrase
    match first, then the longest individual words."""
    trimmed = spoken.strip()
    if not trimmed:
        return ResolvedMerchant("", None, False)

    # Load once; every match below runs against the same list.
    aliases = list_aliases(user_id)

    whole = match_alias(aliases, trimmed)
    if whole:
        return ResolvedMerchant(whole.alias["canonical"], whole.alias, False)

    tokens = [t for t in trimmed.split() if len(t) >= 3]
    for token in sorted(tokens, key=len, reverse=True):
        m = match_alias(aliases, token)
        if m:
            return ResolvedMerchant(m.alias["canonical"], m.alias, False)

    # No match: the caller decides whether to create a new alias.
    return ResolvedMerchant(trimmed, None, True)
