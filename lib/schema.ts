// TypeScript types for the Echo data model.
// These mirror the Postgres schema in `docs/DATA_MODEL.md` but are designed
// for the frontend, so:
//
//  - `bigint` is represented as `number` (safe up to 2^53, which is fine for
//    display; we never use integer math on the client)
//  - timestamps are ISO strings (matches JSON over the wire)
//  - enum-like strings are union types

export type Screen = "home" | "activity" | "insights" | "profile";

export type Tone =
  | "violet"
  | "orange"
  | "blue"
  | "green"
  | "pink"
  | "red"
  | "neutral";

export type Direction = "expense" | "income" | "transfer";
export type Source = "voice" | "manual" | "import" | "recurring";

export type AccountType = "cash" | "bank" | "card" | "wallet" | "investment";

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

export interface Account {
  id: string;
  userId: string;
  name: string;
  type: AccountType;
  currency: string;
  balanceMinor: number;
  isDefault: boolean;
}

export interface Category {
  id: string;
  userId: string | null; // null = system row
  parentId: string | null;
  name: string;
  icon: string;
  tone: Tone;
  sortOrder: number;
}

export interface Transaction {
  id: string;
  userId: string;
  accountId: string;
  categoryId: string | null;
  amountMinor: number; // positive; direction is implicit
  currency: string;
  direction: Direction;
  merchantRaw: string;
  merchantCanonical: string | null;
  note?: string;
  transactedAt: string; // ISO
  createdAt: string; // ISO
  source: Source;
  confidence: number | null; // 0–1, STT
  rawTranscript: string | null;
  clarified: boolean;
  // Convenience fields for the UI (not in DB):
  icon: string;
  tone: Tone;
  /** Pre-formatted relative date label ("Today, 9:42 AM") */
  date: string;
  /** Resolved category display name (from joined categories table). */
  categoryName: string | null;
}

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

export interface Budget {
  id: string;
  userId: string;
  categoryId: string;
  periodStart: string;
  periodEnd: string;
  capMinor: number;
}

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

// Domain helpers
export function amount(transaction: Transaction): number {
  // Echo's UI shows all numbers as positive currencies, with a sign derived
  // from direction. The DB stores amount as positive always.
  return transaction.amountMinor; // Echo stores all amounts as positive minor units
}

export function directionSign(d: Direction): -1 | 1 {
  return d === "income" ? 1 : -1;
}
