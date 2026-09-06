/**
 * @file parse.ts
 * @description Types and lightweight heuristics for parsing voice intents.
 * Defines the structured output of the LLM parser and provides default
 * fallback logic for query kinds and directions.
 */

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

export type NLQOperator = "eq" | "ilike" | "gte" | "lt" | "in";

export interface NLQFilter {
  field: "category_id" | "merchant_canonical" | "merchant_raw" | "direction" | "transacted_at";
  operator: NLQOperator;
  value: any;
}

export interface NLQSpecification {
  aggregate: "sum" | "count" | "max" | "min" | "avg";
  field: "amount_minor" | "id";
  filters: NLQFilter[];
  range: QueryRange | null;
  limit?: number;
}

/**
 * Determines the default query kind based on keywords in the transcript.
 * Used as a fallback when the LLM does not explicitly specify a query kind.
 * @param transcript The raw user utterance.
 * @returns The inferred QueryKind ("sum", "list", or "biggest").
 */
export function defaultKindForQuery(transcript: string): QueryKind {
  const t = transcript.toLowerCase();
  if (/(biggest|largest|most expensive)/.test(t)) return "biggest";
  if (/(list|show me|what did i|recent)/.test(t)) return "list";
  return "sum";
}

/**
 * Guesses whether a query is about income or expenses based on keywords.
 * Used as a fallback when the LLM does not explicitly specify a direction.
 * @param transcript The raw user utterance.
 * @returns The inferred direction ("expense" or "income").
 */
export function defaultDirectionForQuery(transcript: string): "expense" | "income" {
  const t = transcript.toLowerCase();
  if (/(earn|earned|income|salary|received|got paid|credit|cashback|refund|deposit)/.test(t)) {
    return "income";
  }
  return "expense";
}

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
  /** Advanced NLQ specification for complex queries. */
  nlqSpec?: NLQSpecification;
  /** 0–1 confidence in the parse. */
  confidence: number;

  /** The raw transcript Echo heard. */
  transcript: string;
};

export type ParseError = {
  error: string;
};
