import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { isSupabaseConfigured, getSupabaseAdmin } from "@/lib/server/supabase";

// Per-device uuid, persisted in an httpOnly cookie. Echo has no auth,
// so this IS the user identity.
const COOKIE = "echo_uid";
const ONE_YEAR = 60 * 60 * 24 * 365;

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

export async function getDeviceUserId(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}

/** Look up the public.users row for the current device, creating it if needed.
 *  Always issues a device cookie even if Supabase isn't configured, so the
 *  identity is stable across routes that don't touch the DB. */
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
  // Ensure they have a default Cash account.
  await supabase.rpc("ensure_default_account", { uid: id });
  return (data ?? null) as UserRow | null;
}

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
