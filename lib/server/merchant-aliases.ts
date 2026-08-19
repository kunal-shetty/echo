import { getSupabaseAdmin } from "@/lib/server/supabase";
import { getDeviceUserId } from "@/lib/server/user";

export interface DbMerchantAlias {
  id: string;
  user_id: string;
  alias: string;
  canonical: string;
  category_id: string | null;
  use_count: number;
  last_used_at: string;
}

// Normalized Levenshtein. Returns 0 (identical) .. 1 (no shared characters).
// Small and dependency-free; fine for the dozens of aliases a single user
// accumulates, not for full-text search.
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

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

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

/** Pick the closest existing alias whose canonical name is within the
 *  threshold. Returns null if nothing is close enough.
 *  Threshold of 0.30 lets "blinket" match "blinkit" but not "amazon". */
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

/** Resolve a spoken merchant to a canonical name. Tries the spoken phrase
 *  first, then each token (so "spent 200 on zomato order" matches "zomato").
 *  If nothing matches, returns the spoken phrase unchanged so callers can
 *  create a new alias from it. */
export async function resolveMerchant(
  spoken: string,
): Promise<{ canonical: string; alias: DbMerchantAlias | null; createdNew: boolean }> {
  const trimmed = spoken.trim();
  if (!trimmed) return { canonical: "", alias: null, createdNew: false };

  // Whole-phrase match wins.
  const whole = await matchAlias(trimmed);
  if (whole) return { canonical: whole.alias.canonical, alias: whole.alias, createdNew: false };

  // Token-level: longest first so "blue bottle coffee" wins over "coffee".
  const tokens = trimmed.split(/\s+/).filter((t) => t.length >= 3);
  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    const m = await matchAlias(token);
    if (m) return { canonical: m.alias.canonical, alias: m.alias, createdNew: false };
  }

  // No match — caller decides whether to create a new alias.
  return { canonical: trimmed, alias: null, createdNew: true };
}
