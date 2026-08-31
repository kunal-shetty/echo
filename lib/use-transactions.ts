/**
 * @file use-transactions.ts
 * @description Custom hook for managing the user's financial transactions.
 * Provides stateful access to the transaction list and operations to
 * create, update, remove, and bulk-import transactions.
 */

"use client";


import { useCallback, useEffect, useState } from "react";
import type { Transaction } from "@/lib/schema";

/** Fields the UI is allowed to edit. id / userId / source
 *  are intentionally excluded — the server enforces the same whitelist.
 *  Direction is editable so the user can flip a memory between
 *  expense and income after the fact. */
export type EditTransactionPatch = {
  /** Updated amount in minor units. */
  amountMinor?: number;
  /** Updated currency code. */
  currency?: string;
  /** Updated raw merchant name. */
  merchantRaw?: string;
  /** Updated canonical merchant identifier. */
  merchantCanonical?: string | null;
  /** Updated category ID. */
  categoryId?: string | null;
  /** Updated note. */
  note?: string | null;
  /** Updated transaction timestamp (ISO 8601). */
  transactedAt?: string;
  /** Updated transaction direction. */
  direction?: "expense" | "income";
};

/** Input for bulk-add. Matches the shape produced by the bulk parser:
 *  human-friendly fields, with categoryId OR categoryName (the server
 *  resolves names to ids). */
export interface BulkRowInput {
  /** Transaction date (ISO 8601). */
  date?: string | null;
  /** Amount in minor units. */
  amountMinor: number;
  /** Currency code. */
  currency?: string;
  /** Raw merchant name. */
  merchantRaw: string;
  /** Canonical merchant identifier. */
  merchantCanonical?: string | null;
  /** Resolved category ID. */
  categoryId?: string | null;
  /** Category name to be resolved by the server. */
  categoryName?: string | null;
  /** Transaction note. */
  note?: string | null;
  /** Transaction direction. */
  direction?: "expense" | "income";
}

/** Result of a bulk transaction import operation. */
export interface BulkAddResult {
  /** Successfully created transactions. */
  transactions: Transaction[];
  /** List of rows that failed to import. */
  failures: Array<{ rowIndex: number; error: string }>;
}

/** State and actions provided by the useTransactions hook. */
export type TransactionsState = {
  /** List of transactions sorted by date. */
  transactions: Transaction[];
  /** True while fetching transactions. */
  loading: boolean;
  /** Error message from the last operation, if any. */
  error: string | null;
  /** True if the account system is configured for the user. */
  configured: boolean;
  /** Re-fetches the transaction list from the server. */
  refresh: () => Promise<void>;
  /** Creates a single new transaction. */
  add: (
    patch: Omit<
      Transaction,
      "id" | "userId" | "createdAt" | "date" | "icon" | "tone" | "categoryName"
    >,
  ) => Promise<Transaction | null>;
  /** Updates an existing transaction. */
  update: (
    id: string,
    patch: EditTransactionPatch,
  ) => Promise<Transaction | null>;
  /** Removes a transaction. */
  remove: (id: string) => Promise<boolean>;
  /** Performs a bulk import of transactions. */
  bulkAdd: (rows: BulkRowInput[]) => Promise<BulkAddResult>;
};

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

/**
 * Hook for managing the application's transactions.
 * Handles fetching, creating, updating, deleting, and bulk-importing transactions.
 * @returns A state object with transactions and management functions.
 */
export function useTransactions(): TransactionsState {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/transactions", { cache: "no-store" });
      if (!res.ok) {
        setError(`Failed to load (${res.status})`);
        return;
      }
      const json = (await res.json()) as {
        transactions: Transaction[];
        configured: boolean;
        error?: string;
      };
      setTransactions(json.transactions ?? []);
      setConfigured(Boolean(json.configured));
      setError(json.error ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  const add = useCallback(
    async (
      patch: Omit<
        Transaction,
        | "id"
        | "userId"
        | "createdAt"
        | "date"
        | "icon"
        | "tone"
        | "categoryName"
      >,
    ): Promise<Transaction | null> => {
      try {
        const body = {
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
        };
        const res = await fetch("/api/transactions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? `Save failed (${res.status})`);
          return null;
        }
        const json = (await res.json()) as { transaction: Transaction };
        setTransactions((prev) => [json.transaction, ...prev]);
        return json.transaction;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
        return null;
      }
    },
    [],
  );

  const update = useCallback(
    async (
      id: string,
      patch: EditTransactionPatch,
    ): Promise<Transaction | null> => {
      const body = patchToBody(patch);
      if (Object.keys(body).length === 0) return null;
      try {
        const res = await fetch(`/api/transactions/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => ({}))) as {
          transaction?: Transaction;
          error?: string;
        };
        if (!res.ok || !json.transaction) {
          setError(json.error ?? `Update failed (${res.status})`);
          return null;
        }
        setTransactions((prev) =>
          prev.map((t) => (t.id === id ? json.transaction! : t)),
        );
        return json.transaction;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
        return null;
      }
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
      if (res.status === 204 || res.status === 404) {
        setTransactions((prev) => prev.filter((t) => t.id !== id));
        return true;
      }
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? `Delete failed (${res.status})`);
      return false;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      return false;
    }
  }, []);

  const bulkAdd = useCallback(
    async (rows: BulkRowInput[]): Promise<BulkAddResult> => {
      const body = {
        rows: rows.map((r) => ({
          date: r.date ?? null,
          amount_minor: r.amountMinor,
          currency: r.currency,
          merchant_raw: r.merchantRaw,
          merchant_canonical: r.merchantCanonical ?? null,
          category_id: r.categoryId ?? null,
          category_name: r.categoryName ?? null,
          note: r.note ?? null,
          direction: r.direction ?? null,
        })),
      };
      try {
        const res = await fetch("/api/transactions/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => ({}))) as {
          transactions?: Transaction[];
          failures?: Array<{ rowIndex: number; error: string }>;
          error?: string;
        };
        if (!res.ok) {
          setError(json.error ?? `Bulk import failed (${res.status})`);
          return { transactions: [], failures: [] };
        }
        const inserted = json.transactions ?? [];
        if (inserted.length > 0) {
          setTransactions((prev) => [...inserted, ...prev]);
        }
        return {
          transactions: inserted,
          failures: json.failures ?? [],
        };
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
        return { transactions: [], failures: [] };
      }
    },
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    transactions,
    loading,
    error,
    configured,
    refresh,
    add,
    update,
    remove,
    bulkAdd,
  };
}