import { getSupabaseAdmin } from "@/lib/server/supabase";

export interface DbCategory {
  id: string;
  user_id: string | null;
  parent_id: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  tone: "violet" | "orange" | "blue" | "green" | "pink" | "red" | "neutral";
  sort_order: number;
}

/** Returns system categories only (user_id IS NULL). These are seeded
 *  in `schema.sql` and visible to all users. */
export async function listSystemCategories(): Promise<DbCategory[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .is("user_id", null)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DbCategory[];
}
