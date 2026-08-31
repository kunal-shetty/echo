/**
 * @file merchant-aliases.ts
 * @description Manages merchant aliases to map varied user utterances
 * (e.g., "the corner cafe") to a single canonical name ("Corner Cafe").
 * Uses Levenshtein distance for fuzzy matching of spoken names.
 */

import { getSupabaseAdmin } from "@/lib/server/supabase";
import { getDeviceUserId } from "@/lib/server/user";

/** Database representation of a merchant alias. */
export interface DbMerchantAlias {
  id: string;
  user_id: string;
  alias: string;
  canonical: string;
  category_id: string | null;
  use_count: number;
  last_used_at: string;
}

/**
 * Normalized Levenshtein distance implementation.
 * Returns 0 for identical strings and 1 for completely different ones.
 * Optimized for short strings (merchant names).
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n === 0 ? 0 : 1;
  if (n === 0) return 1;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[m] / Math.max(m, n);
}

/** Strips non-alphanumeric characters and lowercases text for matching. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Retrieves all aliases for the current user, sorted by frequency of use.
 * @returns List of merchant aliases.
 */
export async function listAliases(): Promise<DbMerchantAlias[]> {
  const userId = await getDeviceUserId();
  if (!userId) return [];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("merchant_aliases")
    .select("*")
    .eq("user_id", userId)
    .order("use_count", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DbMerchantAlias[];
}

export interface MatchedAlias {
  alias: DbMerchantAlias;
  /** Distance 0..1, lower = closer. */
  distance: number;
}

/**
 * Finds the closest existing alias within a given distance threshold.
 * @param spoken The user's spoken phrase.
 * @param threshold Max distance to be considered a match (default 0.3).
 * @returns The best match, or null if no suitable alias is found.
 */
export async function matchAlias(
  spoken: string,
  threshold = 0.3,
): Promise<MatchedAlias | null> {
  const aliases = await listAliases();
  if (aliases.length === 0) return null;
  const target = normalize(spoken);
  if (!target) return null;

  let best: MatchedAlias | null = null;
  for (const a of aliases) {
    const d = levenshtein(target, normalize(a.canonical));
    if (d <= threshold && (!best || d < best.distance)) {
      best = { alias: a, distance: d };
    }
  }
  return best;
}

/**
 * Creates or updates a merchant alias.
 * @param input The alias, canonical name, and associated category.
 * @returns The upserted alias record.
 */
export async function upsertAlias(input: {
  alias: string;
  canonical: string;
  categoryId: string | null;
}): Promise<DbMerchantAlias | null> {
  const userId = await getDeviceUserId();
  if (!userId) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("merchant_aliases")
    .upsert(
      {
        user_id: userId,
        alias: input.alias.toLowerCase().trim(),
        canonical: input.canonical.trim(),
        category_id: input.categoryId,
        use_count: 1,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "user_id,alias" },
    )
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as DbMerchantAlias | null;
}

/**
 * Resolves a spoken merchant phrase to a canonical name.
 * Tries full-phrase match first, then falls back to token-by-token matching.
 * @param spoken The raw utterance containing the merchant name.
 * @returns The resolved canonical name and associated alias record.
 */
export async function resolveMerchant(
  spoken: string,
): Promise<{ canonical: string; alias: DbMerchantAlias | null; createdNew: boolean }> {
  const trimmed = spoken.trim();
  if (!trimmed) return { canonical: "", alias: null, createdNew: false };

  // Attempt a full-phrase match first.
  const whole = await matchAlias(trimmed);
  if (whole) return { canonical: whole.alias.canonical, alias: whole.alias, createdNew: false };

  // Token-level fallback: match the longest tokens first.
  const tokens = trimmed.split(/\s+/).filter((t) => t.length >= 3);
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    const m = await matchAlias(token);
    if (m) return { canonical: m.alias.canonical, alias: m.alias, createdNew: false };
  }

  // No match found — let the caller handle creating a new alias.
  return { canonical: trimmed, alias: null, createdNew: true };
}
