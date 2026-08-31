/**
 * @file categories.ts
 * @description Server-side logic for managing financial categories.
 * Handles the coexistence of system-seeded categories (global) and
 * user-defined custom categories.
 */

import { getSupabaseAdmin } from "@/lib/server/supabase";

/** Database representation of a category. */
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

/**
 * Returns system categories only (where user_id is NULL).
 * These are seeded in `schema.sql` and are visible to all users.
 * @returns List of system categories sorted by sort_order.
 */
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

/**
 * Returns a merged list of system categories and the user's custom categories.
 * Used by the categories API to populate the selection UI.
 * @param userId The UUID of the user.
 * @returns Combined list of categories sorted by sort_order.
 */
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

/**
 * Creates a new category owned by the specified user.
 * Throws if the category name already exists for that user (Unique Constraint).
 * @param userId The UUID of the user.
 * @param patch Fields to populate for the new category.
 * @returns The created category record.
 */
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

/**
 * Updates an existing category owned by the user.
 * @param userId The UUID of the user.
 * @param id The UUID of the category to update.
 * @param patch Fields to update.
 * @returns The updated category record, or null if not found/owned.
 */
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

/**
 * Deletes a user-owned category.
 * @param userId The UUID of the user.
 * @param id The UUID of the category to delete.
 * @returns True if the category was deleted, false otherwise.
 * @throws If the category is referenced by transactions (FK violation).
 */
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
