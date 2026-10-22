/**
 * @file transaction-input.ts
 * @description Validation for client-supplied transaction rows. Shared by
 * single create, bulk import, and legacy local-storage migration so every
 * write path enforces the same rules. The account is always resolved
 * server-side; clients can never choose it.
 */

import { getSupabaseAdmin } from "@/lib/server/supabase";
import { listCategoriesForUser } from "@/lib/server/categories";
import { ensureDefaultAccount, getUserRow } from "@/lib/server/user";
import type { DbTransaction, TransactionInsert } from "@/lib/server/transactions";

/** Upper bound on a single amount; anything larger is a typo or abuse. */
export const MAX_AMOUNT = 1_000_000_000_000;
const MAX_MERCHANT = 200;
const MAX_NOTE = 500;
const MAX_TRANSCRIPT = 2000;

type Source = DbTransaction["source"];
type Direction = DbTransaction["direction"];

/** Server-resolved facts needed to validate a user's rows. */
export interface TxContext {
  accountId: string;
  homeCurrency: string;
  categoryIds: Set<string>;
  categoryIdByName: Map<string, string>;
}

/** Loads the default account, home currency, and visible categories. */
export async function loadTxContext(userId: string): Promise<TxContext> {
  const supabase = getSupabaseAdmin();
  const findDefault = () =>
    supabase
      .from("accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("is_default", true)
      .maybeSingle();

  let { data: def } = await findDefault();
  if (!def) {
    await ensureDefaultAccount(userId);
    ({ data: def } = await findDefault());
  }
  if (!def) throw new Error(`No default account for user ${userId}`);

  const [user, cats] = await Promise.all([
    getUserRow(userId),
    listCategoriesForUser(userId),
  ]);
  return {
    accountId: def.id as string,
    homeCurrency: user?.home_currency ?? "INR",
    categoryIds: new Set(cats.map((c) => c.id)),
    categoryIdByName: new Map(
      cats.map((c) => [c.name.trim().toLowerCase(), c.id] as const),
    ),
  };
}

/**
 * Validates an amount. Amounts are stored as whole currency units, so
 * fractional input is rounded.
 */
export function parseAmount(value: unknown): number | null {
  const n = typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > MAX_AMOUNT) return null;
  const rounded = Math.round(n);
  return rounded > 0 ? rounded : null;
}

/**
 * Parses a date string into an ISO 8601 timestamp.
 * Accepts YYYY-MM-DD (normalized to midnight UTC) or any valid Date string.
 */
export function parseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00.000Z`)
    : new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === "" ? null : s.slice(0, max);
}

export type RowResult =
  | { ok: true; row: TransactionInsert }
  | { ok: false; error: string };

export interface ValidateOptions {
  /** Sources the caller may claim; anything else becomes `defaultSource`. */
  allowedSources: readonly Source[];
  defaultSource: Source;
}

/**
 * Validates one snake_case transaction row from the client.
 * Accepts `transacted_at` or `date`, and `category_id` or `category_name`.
 */
export function validateTransactionInput(
  raw: Record<string, unknown>,
  ctx: TxContext,
  opts: ValidateOptions,
): RowResult {
  const amount = parseAmount(raw.amount_minor);
  if (amount === null) return { ok: false, error: "Amount must be > 0" };

  const merchant = optionalText(raw.merchant_raw, MAX_MERCHANT);
  if (!merchant) return { ok: false, error: "Merchant is required" };

  let categoryId: string | null = null;
  if (raw.category_id !== undefined && raw.category_id !== null) {
    if (typeof raw.category_id !== "string" || !ctx.categoryIds.has(raw.category_id)) {
      return { ok: false, error: "Unknown category" };
    }
    categoryId = raw.category_id;
  } else if (typeof raw.category_name === "string") {
    categoryId =
      ctx.categoryIdByName.get(raw.category_name.trim().toLowerCase()) ?? null;
  }

  const currency =
    typeof raw.currency === "string" && /^[A-Za-z]{3}$/.test(raw.currency)
      ? raw.currency.toUpperCase()
      : ctx.homeCurrency;

  const direction: Direction =
    raw.direction === "income" || raw.direction === "transfer"
      ? raw.direction
      : "expense";

  const source: Source = opts.allowedSources.includes(raw.source as Source)
    ? (raw.source as Source)
    : opts.defaultSource;

  const confidence =
    typeof raw.confidence === "number" &&
    raw.confidence >= 0 &&
    raw.confidence <= 1
      ? Math.round(raw.confidence * 100) / 100
      : null;

  const transactedAt =
    parseDate(raw.transacted_at) ?? parseDate(raw.date) ?? new Date().toISOString();

  return {
    ok: true,
    row: {
      account_id: ctx.accountId,
      category_id: categoryId,
      amount_minor: amount,
      currency,
      direction,
      merchant_raw: merchant,
      merchant_canonical:
        raw.merchant_canonical === null
          ? null
          : (optionalText(raw.merchant_canonical, MAX_MERCHANT) ?? merchant),
      note: optionalText(raw.note, MAX_NOTE),
      transacted_at: transactedAt,
      source,
      confidence: source === "voice" ? confidence : null,
      raw_transcript:
        source === "voice" ? optionalText(raw.raw_transcript, MAX_TRANSCRIPT) : null,
      clarified: false,
    },
  };
}
