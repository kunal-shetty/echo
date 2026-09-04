/**
 * @file user.ts
 * @description Manages user identity and profile records. Echo uses a session-based
 * identifier for authenticated users and falls back to guest mode.
 */

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { isSupabaseConfigured, getSupabaseAdmin } from "@/lib/server/supabase";

// The cookie used to store the session ID.
const SESSION_COOKIE = "echo_session";
// Cookie expiration: 30 days.
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Retrieves the current authenticated user ID from the session.
 * @returns The authenticated user identifier, or null if no valid session is found.
 */
export async function getSessionUserId(): Promise<string | null> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!sessionId) return null;

  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseAdmin();
  const { data: session } = await supabase
    .from("sessions")
    .select("user_id")
    .eq("id", sessionId)
    .maybeSingle();

  return session?.user_id ?? null;
}

/**
 * Ensures a corresponding row exists in the `public.users` table.
 * This is now used during OAuth account creation.
 * @returns The user profile row, or null if Supabase is not configured.
 */
export async function getOrCreateUserRow(userId?: string): Promise<UserRow | null> {
  if (!isSupabaseConfigured()) return null;

  const id = userId ?? await getSessionUserId() ?? randomUUID();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .upsert(
      { id },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  // Initialize a default "Cash" account via Postgres RPC.
  await supabase.rpc("ensure_default_account", { uid: id });
  return (data ?? null) as UserRow | null;
}

/**
 * Fetches the profile row for the current authenticated user from the database.
 * @returns The user profile row, or null if not found or not configured.
 */
export async function getUserRow(): Promise<UserRow | null> {
  if (!isSupabaseConfigured()) return null;
  const userId = await getSessionUserId();
  if (!userId) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  return (data ?? null) as UserRow | null;
}

/**
 * Updates fields in the user profile row for the current authenticated user.
 * @param patch Partial update object containing fields to change.
 * @returns The updated user profile row, or null if not configured.
 */
export async function updateUserRow(
  patch: Partial<UserRow>,
): Promise<UserRow | null> {
  if (!isSupabaseConfigured()) return null;
  const userId = await getSessionUserId();
  if (!userId) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .update(patch)
    .eq("id", userId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as UserRow | null;
}

/**
 * Database representation of a user profile in the `public.users` table.
 */
export type UserRow = {
  id: string;
  email: string | null;
  email_verified_at: string | null;
  display_name: string | null;
  avatar_url: string | null;
  timezone: string;
  home_currency: string;
  reminder_time: "morning" | "evening" | "off";
  created_at: string;
  updated_at: string;
};
