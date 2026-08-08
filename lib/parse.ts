// Narrow types for the Groq parser endpoint.

export type ParseResult = {
  amount: number | null;
  merchant: string | null;
  category: string | null;
  /** 0–1 confidence in the parse */
  confidence: number;
  /** The raw transcript Echo heard (handy for debugging). */
  transcript: string;
};

export type ParseError = {
  error: string;
};
