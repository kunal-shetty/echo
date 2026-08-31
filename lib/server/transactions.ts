import { getSupabaseAdmin } from "@/lib/server/supabase";
import { getDeviceUserId } from "@/lib/server/user";

// DB row mirrors schema.sql `public.transactions`. We map it to the UI
// shape in `lib/transaction-shape.ts` before sending to the client.

export interface DbTransaction {
  id: string;
  user_id: string;
  account_id: string;
  category_id: string | null;
  amount_minor: number;
  currency: string;
  direction: "expense" | "income" | "transfer";
  merchant_raw: string;
  merchant_canonical: string | null;
  note: string | null;
  transacted_at: string;
  created_at: string;
  source: "voice" | "manual" | "import" | "recurring";
  confidence: number | null;
  raw_transcript: string | null;
  clarified: boolean;
}

export type TransactionInsert = Omit<DbTransaction, "id" | "user_id" | "created_at">;

export async function listTransactions(limit = 100): Promise<DbTransaction[]> {
  const userId = await getDeviceUserId();
  if (!userId) return [];
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("transacted_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as DbTransaction[];
}

export async function createTransaction(
  patch: TransactionInsert,
): Promise<DbTransaction> {
  const userId = await getDeviceUserId();
  if (!userId) throw new Error("No device identity; reload the page.");
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("transactions")
    .insert({ ...patch, user_id: userId })
    .select("*")
    .single();
  if (error) throw error;
  return data as DbTransaction;
}

export async function deleteTransaction(id: string): Promise<void> {
  const userId = await getDeviceUserId();
  if (!userId) return;
  const supabase = getSupabaseAdmin();
  await supabase
    .from("transactions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);
}

export async function updateTransaction(
  id: string,
  patch: Partial<
    Omit<
      DbTransaction,
      "id" | "user_id" | "created_at" | "deleted_at"
    >
  >,
): Promise<DbTransaction | null> {
  const userId = await getDeviceUserId();
  if (!userId) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("transactions")
    .update({ ...patch, clarified: true })
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as DbTransaction | null;
}

export async function getTransaction(
  id: string,
): Promise<DbTransaction | null> {
  const userId = await getDeviceUserId();
  if (!userId) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as DbTransaction | null;
}

export async function bulkCreateTransactions(
  userId: string,
  rows: TransactionInsert[],
): Promise<DbTransaction[]> {
  if (rows.length === 0) return [];
  const supabase = getSupabaseAdmin();
  const tagged = rows.map((r) => ({ ...r, user_id: userId }));
  const { data, error } = await supabase
    .from("transactions")
    .insert(tagged)
    .select("*");
  if (error) throw error;
  return (data ?? []) as DbTransaction[];
}
