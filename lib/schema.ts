/**
 * @file schema.ts
 * @description Domain types for the Echo data model.
 * These types mirror the PostgreSQL schema but are adapted for frontend usage
 * (e.g., converting bigint minor units to number).
 */

export type Screen = "home" | "activity" | "insights" | "profile";

/** Visual tones used for category coloring. */
export type Tone =
  | "violet"
  | "orange"
  | "blue"
  | "green"
  | "pink"
  | "red"
  | "neutral";

/** Direction of a financial transaction. */
export type Direction = "expense" | "income" | "transfer";
/** How the transaction was recorded. */
export type Source = "voice" | "manual" | "import" | "recurring";

/** Types of accounts supported by Echo. */
export type AccountType = "cash" | "bank" | "card" | "wallet" | "investment";

/** User profile information. */
export interface User {
  id: string;
  email: string;
  displayName: string;
  initials: string;
  avatarUrl?: string;
  timezone: string;
  homeCurrency: string;
  plan: "Echo Free" | "Echo Plus";
}

/** A financial account (bank, wallet, etc.) holding a balance. */
export interface Account {
  id: string;
  userId: string;
  name: string;
  type: AccountType;
  currency: string;
  balanceMinor: number;
  isDefault: boolean;
}

/** A spending or income category. */
export interface Category {
  id: string;
  userId: string | null; // null = system row
  parentId: string | null;
  name: string;
  icon: string;
  tone: Tone;
  sortOrder: number;
}

/** A single financial transaction. */
export interface Transaction {
  id: string;
  userId: string;
  accountId: string;
  categoryId: string | null;
  amountMinor: number; // Always positive; sign is implied by 'direction'
  currency: string;
  direction: Direction;
  merchantRaw: string;
  merchantCanonical: string | null;
  note?: string;
  transactedAt: string; // ISO 8601
  createdAt: string; // ISO 8601
  source: Source;
  confidence: number | null; // 0–1, provided by STT/Parser
  rawTranscript: string | null;
  clarified: boolean;
  // UI-only convenience fields (not persisted in DB)
  icon: string;
  tone: Tone;
  /** Pre-formatted relative date label (e.g., "Today, 9:42 AM"). */
  date: string;
  /** Resolved category display name. */
  categoryName: string | null;
}

/** A voice interaction session for debugging and audit. */
export interface VoiceSession {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  transcript: string | null;
  parsedIntent: {
    amount?: number;
    merchant?: string;
    categoryId?: string;
    confidence?: number;
  } | null;
  outcome: "created" | "clarified" | "cancelled" | "failed";
  device?: string;
  audioPath?: string;
}

/** A per-category spending cap. */
export interface Budget {
  id: string;
  userId: string;
  categoryId: string;
  periodStart: string;
  periodEnd: string;
  capMinor: number;
}

/** A generated financial insight. */
export interface Insight {
  id: string;
  userId: string;
  kind:
    | "spend_pattern"
    | "anomaly"
    | "trend"
    | "subscription_check"
    | "budget_alert";
  periodStart: string;
  periodEnd: string;
  payload: {
    title: string;
    text: string;
    tag?: string;
    tone: Tone;
    heroMetric?: string;
  };
  generatedAt: string;
  dismissedAt: string | null;
}

/**
 * Returns the absolute amount of a transaction.
 * Echo stores all amounts as positive minor units.
 */
export function amount(transaction: Transaction): number {
  return transaction.amountMinor;
}

/**
 * Returns the numeric sign based on transaction direction.
 * Income is positive (+1), Expenses are negative (-1).
 */
export function directionSign(d: Direction): -1 | 1 {
  return d === "income" ? 1 : -1;
}
