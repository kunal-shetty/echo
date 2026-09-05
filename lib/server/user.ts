/**
 * @file user.ts
 * @description Manages user identity and profile records.
 */

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { isSupabaseConfigured, getSupabaseAdmin } from "@/lib/server/supabase";

// The cookie used to store the session ID.
const SESSION_COOKIE = "echo_session";
// Cookie expiration: 30 days.
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Retrieves the current user ID.
 * Priority: Session Cookie -> Guest ID (fallback).
 */
export async function getCurrentUserId(): Promise<string> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;

  if (sessionId && isSupabaseConfigured()) {
    const supabase = getSupabaseAdmin();
    const { data: session } = await supabase
      .from("sessions")
      .select("user_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (session) return session.user_id;
  }

  return store.get("echo_guest_id")?.value || randomUUID();
}

/**
 * Log in a user via email.
 * Finds or creates the user, creates a session, and returns the user ID.
 */
export async function loginWithEmail(email: string): Promise<{ userId: string; sessionId: string }> {
  if (!isSupabaseConfigured()) throw new Error("Backend not configured");
  const supabase = getSupabaseAdmin();

  // 1. Find or create user
  const { data: user, error: userErr } = await supabase
    .from("users")
    .upsert(
      { email: email.toLowerCase() },
      { onConflict: "email" }
    )
    .select("*")
    .single();

  if (userErr) throw userErr;

  // 2. Create session
  const sessionId = randomUUID();
  const { error: sessionErr } = await supabase
    .from("sessions")
    .insert({
      id: sessionId,
      user_id: user.id,
      created_at: new Date().toISOString(),
    });

  if (sessionErr) throw sessionErr;

  return { userId: user.id, sessionId };
}

/**
 * Ensures a corresponding row exists in the `public.users` table.
 * @returns The user profile row, or null if Supabase is not configured.
 */
export async function getOrCreateUserRow(userId?: string): Promise<UserRow | null> {
  if (!isSupabaseConfigured()) return null;

  const id = userId ?? await getCurrentUserId();
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
  const userId = await getCurrentUserId();
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
  const userId = await getCurrentUserId();
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
