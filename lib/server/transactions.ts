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
  patch: Omit<DbTransaction, "id" | "user_id" | "created_at">,
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
