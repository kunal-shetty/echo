/**
 * @file supabase.ts
 * @description Centralized Supabase client management.
 * Provides access to a server-side admin client that bypasses Row Level Security (RLS).
 * All authorization logic MUST be implemented in the calling route.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Singleton instance of the Supabase Admin client. */
let _admin: SupabaseClient | null = null;

/**
 * Returns the Supabase Admin client. Initializes it if it doesn't exist.
 * @throws Error if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY are missing.
 * @returns An initialized Supabase client with service-role privileges.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }
  _admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _admin;
}

/**
 * Checks if the necessary Supabase environment variables are configured.
 * @returns True if both URL and service-role key are present.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}
