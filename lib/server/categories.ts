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

/** Returns system categories + this user's own categories, ordered by
 *  sort_order. Used by the categories API so the UI can offer both
 *  the seeded vocabulary and the user's custom additions. */
export async function listCategoriesForUser(
  userId: string,
): Promise<DbCategory[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .or(`user_id.is.null,user_id.eq.${userId}`)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DbCategory[];
}

export interface CreateCategoryPatch {
  name: string;
  icon?: string | null;
  tone?: DbCategory["tone"];
  sort_order?: number;
}

/** Inserts a new category owned by `userId`. Throws on the unique
 *  (user_id, name) violation; routes map that to a 409. */
export async function createCategory(
  userId: string,
  patch: CreateCategoryPatch,
): Promise<DbCategory> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("categories")
    .insert({
      user_id: userId,
      parent_id: null,
      name: patch.name,
      icon: patch.icon ?? null,
      color: null,
      tone: patch.tone ?? "neutral",
      sort_order: patch.sort_order ?? 100,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as DbCategory;
}

export interface UpdateCategoryPatch {
  name?: string;
  icon?: string | null;
  tone?: DbCategory["tone"];
  sort_order?: number;
}

/** Updates a category owned by `userId`. Returns null if not found or
 *  not owned. Throws on a unique-constraint violation (route → 409). */
export async function updateCategory(
  userId: string,
  id: string,
  patch: UpdateCategoryPatch,
): Promise<DbCategory | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("categories")
    .update(patch)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as DbCategory | null;
}

/** Deletes a user-owned category. Returns true on success, false if
 *  the row didn't exist (or wasn't owned). Throws on FK violation —
 *  callers should pre-check or catch + map to 409. */
export async function deleteCategory(
  userId: string,
  id: string,
): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { error, count } = await supabase
    .from("categories")
    .delete({ count: "exact" })
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw error;
  return (count ?? 0) > 0;
}
