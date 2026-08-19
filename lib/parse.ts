// Narrow types for the Groq parser endpoint.

export type VoiceAction = "create" | "update" | "delete" | "query";

export type QueryKind = "sum" | "list" | "biggest";
export type QueryRange =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "last_month"
  | "all";

export interface RecentTransactionContext {
  id: string;
  transactedAt: string;
  merchantRaw: string;
  amount: number;
}

export type ParseResult = {
  /** What the user meant to do with this utterance. */
  action: VoiceAction;
  amount: number | null;
  merchant: string | null;
  category: string | null;
  /** Whether the utterance is spending or receiving money. */
  direction: "expense" | "income" | null;
  /** ISO timestamp; defaults to "now" if the user didn't specify. */
  transactedAt: string | null;
  /** id of the transaction being updated/deleted, if applicable. */
  matchId: string | null;
  /** update-only fields. */
  newAmount: number | null;
  newMerchant: string | null;
  newTransactedAt: string | null;
  /** query-only fields. */
  queryKind: QueryKind | null;
  queryRange: QueryRange | null;
  queryCategory: string | null;
  queryMerchant: string | null;
  queryLimit: number | null;
  /** Whether the query is about spend or income. Null = both. */
  queryDirection: "expense" | "income" | null;
  /** 0–1 confidence in the parse. */
  confidence: number;
  /** The raw transcript Echo heard. */
  transcript: string;
};

export type ParseError = {
  error: string;
};
