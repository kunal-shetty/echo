import type { Transaction } from "@/lib/schema";
import type { BulkRowInput, EditTransactionPatch } from "@/lib/use-transactions";

/** Key older versions of Echo used to keep guest transactions in the browser. */
const LEGACY_LOCAL_KEY = "echo-tx-local-v1";

/** Reads transactions left in localStorage by older versions of Echo. */
export function readLegacyLocalTransactions(): Transaction[] {
  try {
    const data = window.localStorage.getItem(LEGACY_LOCAL_KEY);
    const parsed: unknown = data ? JSON.parse(data) : [];
    return Array.isArray(parsed) ? (parsed as Transaction[]) : [];
  } catch {
    return [];
  }
}

export function clearLegacyLocalTransactions(): void {
  try {
    window.localStorage.removeItem(LEGACY_LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

/** Reads `{ error }` from a failed response, falling back to the status. */
async function errorFrom(res: Response, action: string): Promise<Error> {
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(json.error ?? `${action} failed (${res.status})`);
}

function patchToBody(patch: EditTransactionPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.amountMinor !== undefined) body.amount_minor = patch.amountMinor;
  if (patch.currency !== undefined) body.currency = patch.currency;
  if (patch.merchantRaw !== undefined) body.merchant_raw = patch.merchantRaw;
  if (patch.merchantCanonical !== undefined) {
    body.merchant_canonical = patch.merchantCanonical;
  }
  if (patch.categoryId !== undefined) body.category_id = patch.categoryId;
  if (patch.note !== undefined) body.note = patch.note;
  if (patch.transactedAt !== undefined) body.transacted_at = patch.transactedAt;
  if (patch.direction !== undefined) body.direction = patch.direction;
  return body;
}

/** Client for the /api/transactions endpoints. Throws on failure. */
export class ApiStorageProvider {
  async list(): Promise<{ transactions: Transaction[]; configured: boolean }> {
    const res = await fetch("/api/transactions", { cache: "no-store" });
    if (!res.ok) throw await errorFrom(res, "Load");
    const json = (await res.json()) as {
      transactions?: Transaction[];
      configured?: boolean;
    };
    return {
      transactions: json.transactions ?? [],
      configured: json.configured !== false,
    };
  }

  async add(patch: Partial<Transaction>): Promise<Transaction> {
    const res = await fetch("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount_minor: patch.amountMinor,
        currency: patch.currency,
        direction: patch.direction,
        merchant_raw: patch.merchantRaw,
        merchant_canonical: patch.merchantCanonical ?? patch.merchantRaw,
        category_id: patch.categoryId,
        source: patch.source,
        confidence: patch.confidence,
        raw_transcript: patch.rawTranscript,
        transacted_at: patch.transactedAt,
        note: patch.note ?? null,
      }),
    });
    if (!res.ok) throw await errorFrom(res, "Save");
    const json = (await res.json()) as { transaction: Transaction };
    return json.transaction;
  }

  async update(id: string, patch: EditTransactionPatch): Promise<Transaction> {
    const res = await fetch(`/api/transactions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchToBody(patch)),
    });
    if (!res.ok) throw await errorFrom(res, "Update");
    const json = (await res.json()) as { transaction: Transaction };
    return json.transaction;
  }

  /** @returns True once the transaction is gone (including "already gone"). */
  async remove(id: string): Promise<boolean> {
    const res = await fetch(`/api/transactions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.status === 204 || res.status === 404) return true;
    throw await errorFrom(res, "Delete");
  }

  async bulkAdd(rows: BulkRowInput[]): Promise<{
    transactions: Transaction[];
    failures: Array<{ rowIndex: number; error: string }>;
  }> {
    const res = await fetch("/api/transactions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rows: rows.map((r) => ({
          date: r.date ?? null,
          amount_minor: r.amountMinor,
          currency: r.currency,
          merchant_raw: r.merchantRaw,
          merchant_canonical: r.merchantCanonical,
          category_id: r.categoryId ?? null,
          category_name: r.categoryName ?? null,
          note: r.note ?? null,
          direction: r.direction,
        })),
      }),
    });
    if (!res.ok) throw await errorFrom(res, "Import");
    const json = (await res.json()) as {
      transactions?: Transaction[];
      failures?: Array<{ rowIndex: number; error: string }>;
    };
    return {
      transactions: json.transactions ?? [],
      failures: json.failures ?? [],
    };
  }

  /** Uploads transactions from older, browser-only versions of Echo. */
  async migrate(transactions: Transaction[]): Promise<void> {
    const res = await fetch("/api/transactions/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions }),
    });
    if (!res.ok) throw await errorFrom(res, "Migration");
  }
}
