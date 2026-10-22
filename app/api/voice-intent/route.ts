/**
 * @file route.ts
 * @description Voice intent orchestrator.
 * This is the core of the "Voice-to-Action" pipeline. It takes a transcript,
 * uses the LLM to parse it into an intent (Create, Update, Delete, Query),
 * and then executes the corresponding database operation.
 *
 * Everything the LLM returns is treated as untrusted input: ids must be
 * uuids owned by the caller, amounts and dates are re-validated, and every
 * query is scoped to the session's user.
 */

import { NextResponse } from "next/server.js";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
  type TransactionPatch,
} from "@/lib/server/transactions";
import {
  createCategory,
  listCategoriesForUser,
  type DbCategory,
} from "@/lib/server/categories";
import { resolveMerchant, upsertAlias } from "@/lib/server/merchant-aliases";
import { parseTranscript } from "@/lib/groq";
import type { ParseResult } from "@/lib/parse";
import { indexCategories, toUiTransaction } from "@/lib/transaction-shape";
import type { Transaction } from "@/lib/schema";
import { requireUserId } from "@/lib/server/user";
import { isUuid } from "@/lib/server/ids";
import { loadTxContext, parseAmount, parseDate } from "@/lib/server/transaction-input";
import { serverError } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

/** Longest transcript we will send to the LLM. */
const MAX_TRANSCRIPT = 1000;
/**
 * Creates at or above this confidence are saved immediately. Below it the
 * route only returns a draft, and the client saves once the user confirms
 * (matches the voice sheet's own threshold).
 */
const AUTO_SAVE_CONFIDENCE = 0.7;

interface IntentBody {
  transcript?: unknown;
}

interface IntentResponse {
  result: ParseResult;
  draft?: {
    amount: number;
    merchant: string;
    categoryId: string | null;
    direction: "expense" | "income";
    transactedAt: string;
    rawTranscript: string;
    confidence: number;
  };
  transaction?: Transaction;
  deletedId?: string;
  warning?: string;
}

/**
 * Matches a parsed category name against the list of available categories.
 * @param parsedCategory The category name extracted by the LLM.
 * @param categories The list of available category records.
 * @returns The category ID if a match is found, otherwise null.
 */
function pickCategoryId(
  parsedCategory: string | null,
  categories: Array<{ id: string; name: string }>,
): string | null {
  if (!parsedCategory) return null;
  const cat = categories.find(
    (c) => c.name.toLowerCase() === parsedCategory.toLowerCase(),
  );
  return cat?.id ?? null;
}

/**
 * Finds the user's category for an LLM-supplied name, creating a custom
 * category if none matches. Newly created categories are appended to
 * `categories` so later lookups in this request see them.
 */
async function resolveCategoryId(
  userId: string,
  name: string | null,
  categories: DbCategory[],
): Promise<string | null> {
  if (!name) return null;
  const existing = pickCategoryId(name, categories);
  if (existing) return existing;
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return null;
  try {
    const created = await createCategory(userId, { name: trimmed, tone: "neutral" });
    categories.push(created);
    return created.id;
  } catch (e) {
    console.error("[voice-intent] failed to auto-create category", e);
    return null;
  }
}

/**
 * POST /api/voice-intent
 * Processes a voice transcript to perform a financial action.
 * Flow: Transcript → Groq LLM Parse → DB Execution (Insert/Update/Delete).
 * Returns a detailed response including the resulting transaction if applicable.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "llm", 30, 60 * 1000);
  if (limited) return limited;

  let body: IntentBody;
  try {
    body = (await req.json()) as IntentBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const transcript =
    typeof body?.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    return NextResponse.json(
      { error: "Missing 'transcript' field" },
      { status: 400 },
    );
  }
  if (transcript.length > MAX_TRANSCRIPT) {
    return NextResponse.json({ error: "Transcript too long" }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Voice input isn't configured on this deployment." },
      { status: 503 },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }

  let userId: string;
  try {
    userId = await requireUserId();
  } catch (e) {
    return serverError(e, "voice-intent");
  }

  // Recent transactions for parser context (last 5).
  let recent: Array<{
    id: string;
    transactedAt: string;
    merchantRaw: string;
    amount: number;
  }> = [];
  try {
    const rows = await listTransactions(userId, 5);
    recent = rows.map((r) => ({
      id: r.id,
      transactedAt: r.transacted_at,
      merchantRaw: r.merchant_raw,
      amount: Number(r.amount_minor),
    }));
  } catch {
    recent = [];
  }

  let parsed: ParseResult;
  try {
    parsed = await parseTranscript(transcript, apiKey, { recent });
  } catch (e) {
    console.error("[voice-intent] parse failed", e);
    return NextResponse.json(
      { error: "Couldn't understand that. Please try again." },
      { status: 502 },
    );
  }

  const response: IntentResponse = { result: parsed };

  try {
    const categories = await listCategoriesForUser(userId);

    if (parsed.action === "update") {
      const id = parsed.matchId;
      if (!isUuid(id)) {
        response.warning =
          "I couldn't match that to a recent expense. Could you be more specific?";
        return NextResponse.json(response);
      }
      const target = await getTransaction(userId, id);
      if (!target) {
        response.warning = "That expense isn't on file anymore.";
        return NextResponse.json(response);
      }

      const patch: TransactionPatch = {};
      const newAmount = parseAmount(parsed.newAmount);
      if (newAmount !== null) patch.amount_minor = newAmount;
      if (parsed.newMerchant) {
        const newMerchant = parsed.newMerchant.slice(0, 200);
        const resolved = await resolveMerchant(userId, newMerchant);
        patch.merchant_raw = newMerchant;
        patch.merchant_canonical = resolved.canonical;
      }
      const newDate = parseDate(parsed.newTransactedAt);
      if (newDate) patch.transacted_at = newDate;
      if (parsed.direction) patch.direction = parsed.direction;
      const catId = await resolveCategoryId(userId, parsed.category, categories);
      if (catId) patch.category_id = catId;

      if (Object.keys(patch).length === 0) {
        response.warning = "I couldn't tell what to change. Could you say it again?";
        return NextResponse.json(response);
      }
      const updated = await updateTransaction(userId, id, patch);
      if (!updated) {
        response.warning = "Couldn't update that expense.";
        return NextResponse.json(response);
      }
      response.transaction = toUiTransaction(updated, indexCategories(categories));
      return NextResponse.json(response);
    }

    if (parsed.action === "delete") {
      const id = parsed.matchId;
      if (!isUuid(id)) {
        response.warning =
          "I couldn't match that to a recent expense. Which one did you mean?";
        return NextResponse.json(response);
      }
      if (!(await deleteTransaction(userId, id))) {
        response.warning = "That expense isn't on file anymore.";
        return NextResponse.json(response);
      }
      response.deletedId = id;
      return NextResponse.json(response);
    }

    // action === "create"
    const amount = parseAmount(parsed.amount);
    const merchant = parsed.merchant?.slice(0, 200) ?? null;
    if (amount === null || !merchant) {
      response.warning =
        "I couldn't pin down the amount or merchant. Please try again or type it in.";
      return NextResponse.json(response);
    }

    const resolved = await resolveMerchant(userId, merchant);
    const merchantCanonical = resolved.canonical;

    const autoSave = parsed.confidence >= AUTO_SAVE_CONFIDENCE;
    const categoryId =
      pickCategoryId(parsed.category, categories) ??
      resolved.alias?.category_id ??
      // Only invent a new category for rows we're actually saving.
      (autoSave
        ? await resolveCategoryId(userId, parsed.category, categories)
        : null);
    const transactedAt = parseDate(parsed.transactedAt) ?? new Date().toISOString();

    response.draft = {
      amount,
      merchant,
      categoryId,
      direction: parsed.direction ?? "expense",
      transactedAt,
      rawTranscript: transcript,
      confidence: parsed.confidence,
    };
    if (!autoSave) {
      return NextResponse.json(response);
    }

    // If we just discovered a new merchant, persist it as a fresh alias so
    // future utterances that mis-hear the same name will fuzzy-match it.
    if (resolved.createdNew) {
      await upsertAlias(userId, {
        alias: merchant,
        canonical: merchantCanonical,
        categoryId,
      }).catch(() => {
        // Best-effort; the transaction still saves.
      });
    }

    const ctx = await loadTxContext(userId);
    const row = await createTransaction(userId, {
      account_id: ctx.accountId,
      category_id: categoryId,
      amount_minor: amount,
      currency: ctx.homeCurrency,
      direction: parsed.direction ?? "expense",
      merchant_raw: merchant,
      merchant_canonical: merchantCanonical,
      note: null,
      source: "voice",
      confidence: parsed.confidence,
      raw_transcript: transcript,
      transacted_at: transactedAt,
      clarified: false,
    });

    response.transaction = toUiTransaction(row, indexCategories(categories));
    return NextResponse.json(response);
  } catch (e) {
    return serverError(e, "voice-intent");
  }
}
