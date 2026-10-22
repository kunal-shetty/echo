/**
 * @file use-transactions.tsx
 * @description Shared transaction state for the whole app.
 * `TransactionsProvider` owns one list (mounted once in the root layout);
 * `useTransactions()` reads it, so a change made anywhere — voice sheet,
 * manual add, bulk import — shows up everywhere.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Transaction } from "@/lib/schema";
import {
  ApiStorageProvider,
  clearLegacyLocalTransactions,
  readLegacyLocalTransactions,
} from "@/lib/storage-providers";

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

/** Fields a caller supplies to create a transaction. */
export type NewTransaction = Omit<
  Transaction,
  "id" | "userId" | "createdAt" | "date" | "icon" | "tone" | "categoryName"
>;

/** State and actions provided by useTransactions. */
export type TransactionsState = {
  /** List of transactions sorted by date. */
  transactions: Transaction[];
  /** True while fetching transactions. */
  loading: boolean;
  /** Error message from the last operation, if any. */
  error: string | null;
  /** False when the deployment has no backend configured. */
  configured: boolean;
  /** Re-fetches the transaction list from the server. */
  refresh: () => Promise<void>;
  /** Creates a single new transaction. */
  add: (patch: NewTransaction) => Promise<Transaction | null>;
  /** Adds (or replaces) a transaction the server already saved. */
  ingest: (tx: Transaction) => void;
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

const TransactionsContext = createContext<TransactionsState | null>(null);

/**
 * The in-flight legacy migration, shared so that effects running twice
 * (React Strict Mode) can't upload the same rows twice.
 */
let legacyMigration: Promise<void> | null = null;

function migrateLegacyOnce(api: ApiStorageProvider): Promise<void> {
  legacyMigration ??= (async () => {
    const legacy = readLegacyLocalTransactions();
    if (legacy.length === 0) return;
    try {
      await api.migrate(legacy);
      clearLegacyLocalTransactions();
    } catch (e) {
      // Keep the local copy so the next page load can retry.
      console.error("Migrating local transactions failed", e);
      legacyMigration = null;
    }
  })();
  return legacyMigration;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Network error";
}

function byDateDesc(a: Transaction, b: Transaction): number {
  return b.transactedAt.localeCompare(a.transactedAt);
}

function useTransactionsState(): TransactionsState {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const api = useMemo(() => new ApiStorageProvider(), []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const result = await api.list();
      setTransactions(result.transactions);
      setConfigured(result.configured);
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  const ingest = useCallback((tx: Transaction) => {
    setTransactions((prev) =>
      [tx, ...prev.filter((t) => t.id !== tx.id)].sort(byDateDesc),
    );
  }, []);

  const add = useCallback(
    async (patch: NewTransaction): Promise<Transaction | null> => {
      try {
        const transaction = await api.add(patch);
        ingest(transaction);
        setError(null);
        return transaction;
      } catch (e) {
        setError(messageOf(e));
        return null;
      }
    },
    [api, ingest],
  );

  const update = useCallback(
    async (
      id: string,
      patch: EditTransactionPatch,
    ): Promise<Transaction | null> => {
      try {
        const transaction = await api.update(id, patch);
        ingest(transaction);
        setError(null);
        return transaction;
      } catch (e) {
        setError(messageOf(e));
        return null;
      }
    },
    [api, ingest],
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await api.remove(id);
        setTransactions((prev) => prev.filter((t) => t.id !== id));
        setError(null);
        return true;
      } catch (e) {
        setError(messageOf(e));
        return false;
      }
    },
    [api],
  );

  const bulkAdd = useCallback(
    async (rows: BulkRowInput[]): Promise<BulkAddResult> => {
      try {
        const result = await api.bulkAdd(rows);
        if (result.transactions.length > 0) {
          setTransactions((prev) =>
            [...result.transactions, ...prev].sort(byDateDesc),
          );
        }
        setError(null);
        return result;
      } catch (e) {
        setError(messageOf(e));
        return { transactions: [], failures: [] };
      }
    },
    [api],
  );

  // On first load, move any transactions an older browser-only version of
  // Echo left in localStorage up to the server, then fetch the list.
  useEffect(() => {
    let cancelled = false;
    void migrateLegacyOnce(api).then(() => {
      if (!cancelled) void refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [api, refresh]);

  return {
    transactions,
    loading,
    error,
    configured,
    refresh,
    add,
    ingest,
    update,
    remove,
    bulkAdd,
  };
}

/** Provides the shared transaction list. Mount once, near the root. */
export function TransactionsProvider({ children }: { children: ReactNode }) {
  const state = useTransactionsState();
  return (
    <TransactionsContext.Provider value={state}>
      {children}
    </TransactionsContext.Provider>
  );
}

/**
 * Returns the shared transaction state and actions.
 * Must be used inside a TransactionsProvider.
 */
export function useTransactions(): TransactionsState {
  const ctx = useContext(TransactionsContext);
  if (!ctx) {
    throw new Error("useTransactions must be used within a TransactionsProvider");
  }
  return ctx;
}
