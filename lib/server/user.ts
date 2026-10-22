/**
 * @file user.ts
 * @description Manages user identity, sessions, and profile records.
 *
 * Identity comes from exactly one place: the opaque `echo_session` cookie,
 * looked up in the `sessions` table. Nothing the client sends (user ids,
 * device ids, other cookies) is ever trusted as an identity.
 *
 * A guest is a `users` row with no verified email. Guests are created
 * lazily the first time they write something (see `requireUserId`).
 */

import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { isSupabaseConfigured, getSupabaseAdmin } from "@/lib/server/supabase";
import { clientIpFrom, takeToken } from "@/lib/server/rate-limit";
import { isUuid } from "@/lib/server/ids";

// The cookie used to store the session ID.
const SESSION_COOKIE = "echo_session";
// Verified sessions last 30 days; guest sessions last a year, since losing
// the cookie means losing a guest's data.
const VERIFIED_SESSION_TTL_S = 60 * 60 * 24 * 30;
const GUEST_SESSION_TTL_S = 60 * 60 * 24 * 365;
// Guest accounts a single IP may create per hour.
const GUEST_CREATES_PER_HOUR = 20;

/** The user behind the current request's session. */
export interface SessionUser {
  userId: string;
  sessionId: string;
  /** True once the user has verified an email address. */
  verified: boolean;
}

/**
 * Resolves the current request's session, or null if there is no valid,
 * unexpired session.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!isSupabaseConfigured()) return null;
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (!isUuid(sessionId)) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("sessions")
    .select("user_id, users(email_verified_at)")
    .eq("id", sessionId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;

  const row = data as unknown as {
    user_id: string;
    users: { email_verified_at: string | null } | null;
  };
  return {
    userId: row.user_id,
    sessionId,
    verified: Boolean(row.users?.email_verified_at),
  };
}

/**
 * Returns the current user's id, or null when the request has no valid
 * session. Use for reads, where "no session" simply means "no data".
 */
export async function getCurrentUserId(): Promise<string | null> {
  return (await getSessionUser())?.userId ?? null;
}

/**
 * Returns the current user's id, creating a guest account and session if
 * the request has none. Use for writes.
 * @throws Error with `status` 429 if this IP is creating guests too fast.
 */
export async function requireUserId(): Promise<string> {
  const existing = await getSessionUser();
  if (existing) return existing.userId;

  const ip = clientIpFrom(await headers());
  if (!takeToken(`guest:${ip}`, GUEST_CREATES_PER_HOUR, 60 * 60 * 1000)) {
    throw Object.assign(new Error("Too many requests"), { status: 429 });
  }

  const supabase = getSupabaseAdmin();
  const userId = randomUUID();
  const { error } = await supabase.from("users").insert({ id: userId });
  if (error) throw error;
  await ensureDefaultAccount(userId);
  await startSession(userId, false);
  return userId;
}

/** Idempotently creates the user's default "Cash" account. */
export async function ensureDefaultAccount(userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc("ensure_default_account", {
    uid: userId,
  });
  if (error) throw error;
}

/**
 * Creates a new session for `userId` and sets the session cookie.
 * Any session currently attached to this request is revoked first, so a
 * login always rotates the session id (prevents session fixation).
 */
export async function startSession(
  userId: string,
  verified: boolean,
): Promise<void> {
  const store = await cookies();
  const supabase = getSupabaseAdmin();

  const previous = store.get(SESSION_COOKIE)?.value;
  if (isUuid(previous)) {
    await supabase.from("sessions").delete().eq("id", previous);
  }

  const ttl = verified ? VERIFIED_SESSION_TTL_S : GUEST_SESSION_TTL_S;
  const sessionId = randomUUID();
  const { error } = await supabase.from("sessions").insert({
    id: sessionId,
    user_id: userId,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
  });
  if (error) throw error;

  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ttl,
  });
}

/** Revokes the current session (if any) and clears the cookie. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;
  if (isUuid(sessionId) && isSupabaseConfigured()) {
    await getSupabaseAdmin().from("sessions").delete().eq("id", sessionId);
  }
  store.delete(SESSION_COOKIE);
}

/**
 * Fetches the profile row for a user.
 * @returns The user profile row, or null if not found or not configured.
 */
export async function getUserRow(userId: string): Promise<UserRow | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  return (data ?? null) as UserRow | null;
}

/** Profile fields a user may change about themselves. */
export type UserProfilePatch = Partial<
  Pick<UserRow, "display_name" | "home_currency" | "reminder_time">
>;

/**
 * Updates profile fields for a user.
 * @returns The updated user profile row, or null if not configured.
 */
export async function updateUserRow(
  userId: string,
  patch: UserProfilePatch,
): Promise<UserRow | null> {
  if (!isSupabaseConfigured()) return null;
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

/** The subset of a user row that is safe to send to the client. */
export function toPublicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    email_verified_at: row.email_verified_at,
    display_name: row.display_name,
    home_currency: row.home_currency,
    reminder_time: row.reminder_time,
  };
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
