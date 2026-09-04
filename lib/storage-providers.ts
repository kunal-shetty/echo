import type { Transaction } from "@/lib/schema";

export interface StorageProvider {
  list: () => Promise<Transaction[]>;
  add: (tx: Partial<Transaction>) => Promise<Transaction | null>;
  update: (id: string, patch: any) => Promise<Transaction | null>;
  remove: (id: string) => Promise<boolean>;
  bulkAdd: (rows: any[]) => Promise<{ transactions: Transaction[]; failures: any[] }>;
}

export class LocalStorageProvider implements StorageProvider {
  private readonly KEY = "echo-tx-local-v1";

  private getLocalTxs(): Transaction[] {
    try {
      const data = window.localStorage.getItem(this.KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private setLocalTxs(txs: Transaction[]): void {
    try {
      window.localStorage.setItem(this.KEY, JSON.stringify(txs));
    } catch {
      console.error("Failed to save transactions to localStorage");
    }
  }

  async list(): Promise<Transaction[]> {
    return this.getLocalTxs();
  }

  async add(patch: Partial<Transaction>): Promise<Transaction | null> {
    const txs = this.getLocalTxs();
    const newTx: Transaction = {
      id: crypto.randomUUID(),
      userId: "guest",
      amountMinor: patch.amountMinor ?? 0,
      currency: patch.currency ?? "INR",
      direction: patch.direction ?? "expense",
      merchantRaw: patch.merchantRaw ?? "Unknown",
      merchantCanonical: patch.merchantCanonical ?? patch.merchantRaw,
      categoryId: patch.categoryId ?? null,
      source: patch.source ?? "manual",
      confidence: patch.confidence ?? null,
      rawTranscript: patch.rawTranscript ?? null,
      transactedAt: patch.transactedAt ?? new Date().toISOString(),
      note: patch.note ?? null,
      clarified: patch.clarified ?? false,
      createdAt: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0],
      icon: 'CircleDollarSign',
      tone: 'neutral',
      categoryName: 'Uncategorized'
    } as Transaction;

    this.setLocalTxs([newTx, ...txs]);
    return newTx;
  }

  async update(id: string, patch: any): Promise<Transaction | null> {
    const txs = this.getLocalTxs();
    const index = txs.findIndex(t => t.id === id);
    if (index === -1) return null;

    const updated = { ...txs[index], ...patch };
    txs[index] = updated;
    this.setLocalTxs(txs);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const txs = this.getLocalTxs();
    const filtered = txs.filter(t => t.id !== id);
    if (txs.length === filtered.length) return false;
    this.setLocalTxs(filtered);
    return true;
  }

  async bulkAdd(rows: any[]): Promise<{ transactions: Transaction[]; failures: any[] }> {
    const txs = this.getLocalTxs();
    const inserted: Transaction[] = [];
    const failures: any[] = [];

    rows.forEach((row, idx) => {
      try {
        const newTx: Transaction = {
          id: crypto.randomUUID(),
          userId: "guest",
          amountMinor: row.amountMinor,
          currency: row.currency ?? "INR",
          direction: row.direction ?? "expense",
          merchantRaw: row.merchantRaw,
          merchantCanonical: row.merchantCanonical ?? row.merchantRaw,
          categoryId: row.categoryId ?? null,
          source: "import",
          confidence: null,
          rawTranscript: null,
          transactedAt: row.date ?? new Date().toISOString(),
          note: row.note ?? null,
          clarified: false,
          createdAt: new Date().toISOString(),
          date: row.date ?? new Date().toISOString().split('T')[0],
          icon: 'CircleDollarSign',
          tone: 'neutral',
          categoryName: row.categoryName ?? 'Uncategorized'
        } as Transaction;
        inserted.push(newTx);
      } catch (e: any) {
        failures.push({ rowIndex: idx, error: e.message });
      }
    });

    this.setLocalTxs([...inserted, ...txs]);
    return { transactions: inserted, failures };
  }
}

export class ApiStorageProvider implements StorageProvider {
  async list(): Promise<Transaction[]> {
    const res = await fetch("/api/transactions", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load (${res.status})`);
    const json = await res.json();
    return json.transactions ?? [];
  }

  async add(patch: Partial<Transaction>): Promise<Transaction | null> {
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
    if (!res.ok) return null;
    const json = await res.json();
    return json.transaction;
  }

  async update(id: string, patch: any): Promise<Transaction | null> {
    const res = await fetch(`/api/transactions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.transaction;
  }

  async remove(id: string): Promise<boolean> {
    const res = await fetch(`/api/transactions/${id}`, { method: "DELETE" });
    return res.status === 204 || res.status === 404;
  }

  async bulkAdd(rows: any[]): Promise<{ transactions: Transaction[]; failures: any[] }> {
    const res = await fetch("/api/transactions/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    if (!res.ok) return { transactions: [], failures: [] };
    const json = await res.json();
    return {
      transactions: json.transactions ?? [],
      failures: json.failures ?? [],
    };
  }
}
