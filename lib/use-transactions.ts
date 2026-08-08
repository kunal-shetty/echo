"use client";

import { useCallback, useEffect, useState } from "react";
import type { Transaction } from "@/lib/schema";

export type TransactionsState = {
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
  configured: boolean;
  refresh: () => Promise<void>;
  add: (
    patch: Omit<
      Transaction,
      "id" | "userId" | "createdAt" | "date" | "icon" | "tone"
    > & {
      category_id?: string | null;
    },
  ) => Promise<Transaction | null>;
};

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
        "id" | "userId" | "createdAt" | "date" | "icon" | "tone"
      > & { category_id?: string | null },
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { transactions, loading, error, configured, refresh, add };
}