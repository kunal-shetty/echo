import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import {
  deleteTransaction,
  getTransaction,
  updateTransaction,
} from "@/lib/server/transactions";
import { listCategoriesForUser } from "@/lib/server/categories";
import { indexCategories, toUiTransaction } from "@/lib/transaction-shape";
import { getCurrentUserId } from "@/lib/server/user";

export const runtime = "nodejs";

/** Fields a client may edit. Everything else is immutable — source
 *  is intentionally excluded per product decision. Direction is
 *  editable so the user can flip a memory between expense/income. */
const ALLOWED_KEYS = new Set([
  "amount_minor",
  "currency",
  "merchant_raw",
  "merchant_canonical",
  "category_id",
  "note",
  "transacted_at",
  "direction",
]);

const FORBIDDEN_KEYS = new Set([
  "id",
  "user_id",
  "account_id",
  "created_at",
  "source",
  "confidence",
  "raw_transcript",
  "clarified",
  "deleted_at",
]);

interface PatchBody {
  amount_minor?: number;
  currency?: string;
  merchant_raw?: string;
  merchant_canonical?: string | null;
  category_id?: string | null;
  note?: string | null;
  transacted_at?: string;
  direction?: "expense" | "income";
}

function isUuid(s: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(s);
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await ctx.params;

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Whitelist check.
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_KEYS.has(key)) {
      return NextResponse.json(
        { error: `Field '${key}' is not editable` },
        { status: 400 },
      );
    }
    if (!ALLOWED_KEYS.has(key)) {
      return NextResponse.json(
        { error: `Unknown field '${key}'` },
        { status: 400 },
      );
    }
  }

  const body: PatchBody = {};
  if (raw.amount_minor !== undefined) {
    if (typeof raw.amount_minor !== "number" || !(raw.amount_minor > 0)) {
      return NextResponse.json(
        { error: "amount_minor must be a positive number" },
        { status: 400 },
      );
    }
    body.amount_minor = raw.amount_minor;
  }
  if (raw.currency !== undefined) {
    if (typeof raw.currency !== "string" || raw.currency.length !== 3) {
      return NextResponse.json(
        { error: "currency must be a 3-letter code" },
        { status: 400 },
      );
    }
    body.currency = raw.currency.toUpperCase();
  }
  if (raw.merchant_raw !== undefined) {
    const m = String(raw.merchant_raw ?? "").trim();
    if (m.length === 0) {
      return NextResponse.json(
        { error: "merchant_raw is required" },
        { status: 400 },
      );
    }
    body.merchant_raw = m;
  }
  if (raw.merchant_canonical !== undefined) {
    body.merchant_canonical =
      raw.merchant_canonical === null
        ? null
        : String(raw.merchant_canonical ?? "").trim() || null;
  }
  if (raw.category_id !== undefined) {
    if (raw.category_id === null) {
      body.category_id = null;
    } else if (typeof raw.category_id !== "string" || !isUuid(raw.category_id)) {
      return NextResponse.json(
        { error: "category_id must be a uuid or null" },
        { status: 400 },
      );
    } else {
      body.category_id = raw.category_id;
    }
  }
  if (raw.note !== undefined) {
    if (raw.note === null) {
      body.note = null;
    } else {
      const n = String(raw.note ?? "");
      if (n.length > 500) {
        return NextResponse.json(
          { error: "note must be 500 characters or fewer" },
          { status: 400 },
        );
      }
      body.note = n;
    }
  }
  if (raw.transacted_at !== undefined) {
    if (typeof raw.transacted_at !== "string") {
      return NextResponse.json(
        { error: "transacted_at must be a string" },
        { status: 400 },
      );
    }
    const d = new Date(raw.transacted_at);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { error: "transacted_at is not a valid date" },
        { status: 400 },
      );
    }
    body.transacted_at = d.toISOString();
  }
  if (raw.direction !== undefined) {
    if (raw.direction !== "expense" && raw.direction !== "income") {
      return NextResponse.json(
        { error: "direction must be 'expense' or 'income'" },
        { status: 400 },
      );
    }
    body.direction = raw.direction;
  }

  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Category must exist if provided.
  if (body.category_id) {
    try {
      const cats = await listCategoriesForUser(userId);
      const known = cats.some((c) => c.id === body.category_id);
      if (!known) {
        return NextResponse.json(
          { error: "Unknown category" },
          { status: 400 },
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  try {
    const updated = await updateTransaction(id, body);
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const cats = await listCategoriesForUser(userId);
    return NextResponse.json({
      transaction: toUiTransaction(updated, indexCategories(cats)),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const existing = await getTransaction(id);
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await deleteTransaction(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
