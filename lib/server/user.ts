/**
 * @file user.ts
 * @description Manages user identity and profile records. Echo uses a cookie-based
 * "device identity" as the primary user identifier, mapping it to a record in the
 * `public.users` table. This allows for a seamless, auth-less experience.
 */

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { isSupabaseConfigured, getSupabaseAdmin } from "@/lib/server/supabase";

// The cookie used to store the stable device UUID.
const COOKIE = "echo_uid";
// Cookie expiration: 1 year.
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Retrieves the current device UUID from cookies.
 * If none exists, generates a new UUID and persists it in an httpOnly cookie.
 * @returns The stable device identifier.
 */
export async function getOrCreateDeviceUserId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE)?.value;
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) return existing;

  const id = randomUUID();
  store.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
  return id;
}

/**
 * Retrieves the current device UUID from cookies without creating one.
 * @returns The device identifier, or null if no identity is found.
 */
export async function getDeviceUserId(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}

/**
 * Ensures a corresponding row exists in the `public.users` table for the current device.
 * Also ensures the user has a default account for transactions.
 * @returns The user profile row, or null if Supabase is not configured.
 */
export async function getOrCreateUserRow(): Promise<UserRow | null> {
  const id = await getOrCreateDeviceUserId();
  if (!isSupabaseConfigured()) return null;
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
 * Fetches the profile row for the current device from the database.
 * @returns The user profile row, or null if not found or not configured.
 */
export async function getUserRow(): Promise<UserRow | null> {
  if (!isSupabaseConfigured()) return null;
  const id = await getDeviceUserId();
  if (!id) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as UserRow | null;
}

/**
 * Updates fields in the user profile row for the current device.
 * @param patch Partial update object containing fields to change.
 * @returns The updated user profile row, or null if not configured.
 */
export async function updateUserRow(
  patch: Partial<UserRow>,
): Promise<UserRow | null> {
  if (!isSupabaseConfigured()) return null;
  const id = await getDeviceUserId();
  if (!id) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .update(patch)
    .eq("id", id)
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
