import { NextResponse } from "next/server";
import {
  isSupabaseConfigured,
  getSupabaseAdmin,
} from "@/lib/server/supabase";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  updateTransaction,
} from "@/lib/server/transactions";
import { listSystemCategories } from "@/lib/server/categories";
import { resolveMerchant } from "@/lib/server/merchant-aliases";
import { parseTranscript } from "@/lib/groq";
import type { ParseResult } from "@/lib/parse";
import { indexCategories, toUiTransaction } from "@/lib/transaction-shape";
import type { Transaction } from "@/lib/schema";
import { getDeviceUserId } from "@/lib/server/user";
import { upsertAlias } from "@/lib/server/merchant-aliases";

export const runtime = "nodejs";

interface IntentBody {
  transcript?: string;
}

interface IntentResponse {
  result: ParseResult;
  draft?: {
    amount: number;
    merchant: string;
    categoryId: string | null;
    transactedAt: string;
    rawTranscript: string;
    confidence: number;
  };
  transaction?: Transaction;
  deletedId?: string;
  warning?: string;
}

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

async function defaultAccountId(userId: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function POST(req: Request) {
  let body: IntentBody;
  try {
    body = (await req.json()) as IntentBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const transcript = body.transcript?.trim();
  if (!transcript) {
    return NextResponse.json(
      { error: "Missing 'transcript' field" },
      { status: 400 },
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "GROQ_API_KEY is not set. Add it to your .env to enable voice intent.",
      },
      { status: 503 },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }

  const userId = await getDeviceUserId();
  if (!userId) {
    return NextResponse.json(
      { error: "No device identity." },
      { status: 400 },
    );
  }

  // Recent transactions for parser context (last 5).
  let recent: Array<{
    id: string;
    transactedAt: string;
    merchantRaw: string;
    amount: number;
  }> = [];
  try {
    const rows = await listTransactions(5);
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
    const message = e instanceof Error ? e.message : "Parse failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const sysCats = await listSystemCategories().catch(() => []);
  const indexed = indexCategories(sysCats);

  const response: IntentResponse = { result: parsed };

  try {
    if (parsed.action === "update") {
      const id = parsed.matchId;
      if (!id) {
        response.warning =
          "I couldn't match that to a recent expense. Could you be more specific?";
        return NextResponse.json(response);
      }
      const target = await getTransaction(id);
      if (!target) {
        response.warning = "That expense isn't on file anymore.";
        return NextResponse.json(response);
      }

      const patch: Parameters<typeof updateTransaction>[1] = {};
      if (parsed.newAmount != null) patch.amount_minor = parsed.newAmount;
      if (parsed.newMerchant) {
        const resolved = await resolveMerchant(parsed.newMerchant);
        patch.merchant_raw = parsed.newMerchant;
        patch.merchant_canonical = resolved.canonical;
      }
      if (parsed.newTransactedAt) patch.transacted_at = parsed.newTransactedAt;
      if (parsed.category) {
        const catId = pickCategoryId(parsed.category, sysCats);
        if (catId) patch.category_id = catId;
      }

      const updated = await updateTransaction(id, patch);
      if (!updated) {
        response.warning = "Couldn't update that expense.";
        return NextResponse.json(response);
      }
      response.transaction = toUiTransaction(updated, indexed);
      return NextResponse.json(response);
    }

    if (parsed.action === "delete") {
      const id = parsed.matchId;
      if (!id) {
        response.warning =
          "I couldn't match that to a recent expense. Which one did you mean?";
        return NextResponse.json(response);
      }
      const target = await getTransaction(id);
      if (!target) {
        response.warning = "That expense isn't on file anymore.";
        return NextResponse.json(response);
      }
      await deleteTransaction(id);
      response.deletedId = id;
      return NextResponse.json(response);
    }

    // action === "create"
    if (parsed.amount == null || !parsed.merchant) {
      response.warning =
        "I couldn't pin down the amount or merchant. Please try again or type it in.";
      return NextResponse.json(response);
    }

    const accountId = await defaultAccountId(userId);
    if (!accountId) {
      return NextResponse.json(
        { error: "No default account for this user." },
        { status: 500 },
      );
    }

    const resolved = await resolveMerchant(parsed.merchant);
    const merchantCanonical = resolved.canonical;

    const categoryId =
      pickCategoryId(parsed.category, sysCats) ??
      (resolved.alias?.category_id ?? null);

    // If we just discovered a new merchant, persist it as a fresh alias so
    // future utterances that mis-hear the same name will fuzzy-match it.
    if (resolved.createdNew) {
      await upsertAlias({
        alias: parsed.merchant,
        canonical: merchantCanonical,
        categoryId,
      }).catch(() => {
        // Best-effort; the transaction still saves.
      });
    }

    const transactedAt = parsed.transactedAt ?? new Date().toISOString();

    const row = await createTransaction({
      account_id: accountId,
      category_id: categoryId,
      amount_minor: parsed.amount,
      currency: "INR",
      direction: "expense",
      merchant_raw: parsed.merchant,
      merchant_canonical: merchantCanonical,
      note: null,
      source: "voice",
      confidence: parsed.confidence,
      raw_transcript: transcript,
      transacted_at: transactedAt,
      clarified: false,
    });

    response.draft = {
      amount: parsed.amount,
      merchant: parsed.merchant,
      categoryId,
      transactedAt,
      rawTranscript: transcript,
      confidence: parsed.confidence,
    };
    response.transaction = toUiTransaction(row, indexed);
    return NextResponse.json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Intent failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
