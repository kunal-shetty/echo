// CSV / TSV paste parser for bulk-add.
//
// Detection order:
//   1. Delimiter: if any line contains a tab → TSV, else comma.
//   2. Header row: if row 0 cells (lower-cased, trimmed) overlap with
//      the known header vocabulary AND at least one required field
//      maps to a known column → treat as headers; user can re-map.
//   3. Otherwise assume fixed order: [date, amount, merchant, category, note].

import type { BulkRowInput } from "@/lib/use-transactions";

export type BulkField =
  | "date"
  | "amount"
  | "merchant"
  | "category"
  | "note"
  | "direction";

export const BULK_FIELDS: BulkField[] = [
  "date",
  "amount",
  "merchant",
  "category",
  "note",
  "direction",
];

export interface ParsedBulkRow {
  rowIndex: number;          // 1-based data-row index (header is row 0)
  originalIndex: number;     // 0-based index in `rows` (pre-validation)
  cells: string[];
  values: Partial<Record<BulkField, string>>;
  error?: string;
}

export interface BulkParseResult {
  rows: ParsedBulkRow[];
  detectedDelimiter: "," | "\t";
  detectedHeaders: boolean;
  /** Column index → mapped field. Only set when detectedHeaders is true. */
  mapping: Map<number, BulkField | "ignore">;
}

/** Tokenize one CSV/TSV line, respecting double-quoted fields. */
function tokenize(line: string, delim: "," | "\t"): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        cells.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  cells.push(cur);
  return cells;
}

const HEADER_HINTS: Record<BulkField, string[]> = {
  date: ["date", "when", "day"],
  amount: ["amount", "cost", "total", "price", "value"],
  merchant: ["merchant", "where", "what", "name", "item", "title", "source"],
  category: ["category", "tag", "group"],
  note: ["note", "notes", "memo", "comment", "description"],
  direction: ["direction", "type", "kind", "flow", "txn type"],
};

function mapHeader(header: string): BulkField | "ignore" {
  const h = header.trim().toLowerCase();
  if (!h) return "ignore";
  for (const field of BULK_FIELDS) {
    for (const hint of HEADER_HINTS[field]) {
      if (h === hint || h.startsWith(`${hint} `) || h.includes(` ${hint}`)) {
        return field;
      }
    }
  }
  return "ignore";
}

function detectDelimiter(lines: string[]): "," | "\t" {
  if (lines.some((l) => l.includes("\t"))) return "\t";
  return ",";
}

export function parseBulkPaste(
  paste: string,
  /** Manual mapping overrides detected header. Map is column-index → field. */
  manualMapping?: Map<number, BulkField | "ignore">,
): BulkParseResult {
  const rawLines = paste
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (rawLines.length === 0) {
    return {
      rows: [],
      detectedDelimiter: ",",
      detectedHeaders: false,
      mapping: new Map(),
    };
  }

  const delim = detectDelimiter(rawLines);
  const tokenized = rawLines.map((l) => tokenize(l, delim));
  if (tokenized.length === 0) {
    return {
      rows: [],
      detectedDelimiter: delim,
      detectedHeaders: false,
      mapping: new Map(),
    };
  }

  let mapping = new Map<number, BulkField | "ignore">();
  let detectedHeaders = false;
  let dataStart = 0;

  if (manualMapping && manualMapping.size > 0) {
    mapping = manualMapping;
    detectedHeaders = true;
    dataStart = 0;
  } else {
    // Try header detection.
    const firstRow = tokenized[0];
    const inferred = new Map<number, BulkField | "ignore">();
    firstRow.forEach((cell, idx) => {
      inferred.set(idx, mapHeader(cell));
    });
    const hits = Array.from(inferred.values()).filter(
      (v) => v !== "ignore",
    ).length;
    const requiredMapped =
      inferred.has(inferred.size - 1) && // at least one column
      Array.from(inferred.entries()).some(
        ([, v]) => v === "amount" || v === "merchant",
      );
    if (hits >= 2 && requiredMapped) {
      mapping = inferred;
      detectedHeaders = true;
      dataStart = 1;
    } else {
      // Fixed-schema fallback.
      const fixed = new Map<number, BulkField | "ignore">([
        [0, "date"],
        [1, "amount"],
        [2, "merchant"],
        [3, "category"],
        [4, "note"],
        [5, "direction"],
      ]);
      mapping = fixed;
      detectedHeaders = false;
      dataStart = 0;
    }
  }

  const out: ParsedBulkRow[] = [];
  for (let i = dataStart; i < tokenized.length; i++) {
    const cells = tokenized[i];
    const values: Partial<Record<BulkField, string>> = {};
    for (const [col, field] of mapping) {
      if (field === "ignore") continue;
      const raw = cells[col] ?? "";
      values[field] = raw.trim();
    }
    out.push({
      rowIndex: i - dataStart + 1,
      originalIndex: i,
      cells,
      values,
    });
  }

  return {
    rows: out,
    detectedDelimiter: delim,
    detectedHeaders,
    mapping,
  };
}

/** Validate a parsed row and produce a BulkRowInput (or an error). */
export function validateRow(
  parsed: ParsedBulkRow,
): { ok: true; row: BulkRowInput } | { ok: false; error: string } {
  const merchant = parsed.values.merchant ?? "";
  if (merchant.length === 0) {
    return { ok: false, error: "Merchant is required" };
  }
  const amountRaw = parsed.values.amount ?? "";
  // Accept "1,234.56" / "1234" / "12.50".
  const clean = amountRaw.replace(/,/g, "").trim();
  const amount = Number(clean);
  if (!(amount > 0) || !Number.isFinite(amount)) {
    return { ok: false, error: "Amount must be > 0" };
  }
  // Round to nearest minor unit (paise = 1).
  const amountMinor = Math.round(amount);

  let date: string | null = parsed.values.date ?? null;
  if (date && date.length > 0) {
    // Accept YYYY-MM-DD or anything Date can parse; the server normalizes.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) {
        return { ok: false, error: "Date is not a valid date" };
      }
      date = d.toISOString().slice(0, 10);
    }
  } else {
    date = null;
  }

  return {
    ok: true,
    row: {
      date,
      amountMinor,
      merchantRaw: merchant,
      categoryName: parsed.values.category ?? null,
      note: parsed.values.note ?? null,
      direction: parseDirection(parsed.values.direction ?? null),
    },
  };
}

const INCOME_TOKENS = new Set([
  "income",
  "in",
  "credit",
  "credited",
  "received",
  "earn",
  "earned",
  "salary",
  "deposit",
  "incoming",
]);

function parseDirection(raw: string | null): "expense" | "income" {
  if (!raw) return "expense";
  const v = raw.trim().toLowerCase();
  if (INCOME_TOKENS.has(v)) return "income";
  // Treat values starting with "in" or "credit" as income (covers
  // "inflow", "credit card cashback", "income_aug").
  if (v.startsWith("in") || v.startsWith("credit")) return "income";
  return "expense";
}
