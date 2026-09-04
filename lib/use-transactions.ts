/**
 * @file use-transactions.ts
 * @description Custom hook for managing the user's financial transactions.
 * Provides stateful access to the transaction list and operations to
 * create, update, remove, and bulk-import transactions.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import type { Transaction } from "@/lib/schema";
import { LocalStorageProvider, ApiStorageProvider, type StorageProvider } from "@/lib/storage-providers";

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
 * Switches between LocalStorage and API based on authentication status.
 * @returns A state object with transactions and management functions.
 */
export function useTransactions(): TransactionsState {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [provider, setProvider] = useState<StorageProvider | null>(null);

  const checkAuthAndSetProvider = useCallback(async () => {
    try {
      const res = await fetch("/api/me");
      const json = await res.json();
      if (json.authenticated) {
        setProvider(new ApiStorageProvider());
      } else {
        setProvider(new LocalStorageProvider());
      }
    } catch (e) {
      setProvider(new LocalStorageProvider());
    }
  }, []);

  const migrateLocalData = useCallback(async () => {
    const local = new LocalStorageProvider();
    const localTxs = await local.list();
    if (localTxs.length === 0) return;

    try {
      const res = await fetch("/api/transactions/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactions: localTxs }),
      });
      if (res.ok) {
        // Clear local storage after successful migration
        window.localStorage.removeItem("echo-tx-local-v1");
      }
    } catch (e) {
      console.error("Migration failed", e);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!provider) {
      await checkAuthAndSetProvider();
    }

    const activeProvider = provider ?? new LocalStorageProvider();

    try {
      setLoading(true);
      const txs = await activeProvider.list();
      setTransactions(txs);
      setConfigured(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [provider, checkAuthAndSetProvider]);

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
      const activeProvider = provider ?? new LocalStorageProvider();
      try {
        const transaction = await activeProvider.add(patch);
        if (transaction) {
          setTransactions((prev) => [transaction, ...prev]);
        }
        return transaction;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
        return null;
      }
    },
    [provider],
  );

  const update = useCallback(
    async (
      id: string,
      patch: EditTransactionPatch,
    ): Promise<Transaction | null> => {
      const activeProvider = provider ?? new LocalStorageProvider();
      try {
        const transaction = await activeProvider.update(id, patch);
        if (transaction) {
          setTransactions((prev) =>
            prev.map((t) => (t.id === id ? transaction : t)),
          );
        }
        return transaction;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
        return null;
      }
    },
    [provider],
  );

  const remove = useCallback(async (id: string): Promise<boolean> => {
    const activeProvider = provider ?? new LocalStorageProvider();
    try {
      const success = await activeProvider.remove(id);
      if (success) {
        setTransactions((prev) => prev.filter((t) => t.id !== id));
      }
      return success;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      return false;
    }
  }, [provider]);

  const bulkAdd = useCallback(
    async (rows: BulkRowInput[]): Promise<BulkAddResult> => {
      const activeProvider = provider ?? new LocalStorageProvider();
      try {
        const result = await activeProvider.bulkAdd(rows);
        if (result.transactions.length > 0) {
          setTransactions((prev) => [...result.transactions, ...prev]);
        }
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
        return { transactions: [], failures: [] };
      }
    },
    [provider],
  );

  useEffect(() => {
    void checkAuthAndSetProvider();
  }, [checkAuthAndSetProvider]);

  useEffect(() => {
    if (provider instanceof ApiStorageProvider) {
      void migrateLocalData();
    }
  }, [provider, migrateLocalData]);

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
