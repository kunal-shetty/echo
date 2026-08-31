/**
 * @file use-remote-user.ts
 * @description Client-side hook for fetching and syncing the current user's
 * profile from the server.
 */

"use client";

import { useEffect, useState } from "react";

/** Shape of the user profile returned by the server. */
export type RemoteUser = {
  id: string;
  email: string | null;
  email_verified_at: string | null;
  display_name: string | null;
  home_currency: string;
  reminder_time: "morning" | "evening" | "off";
} | null;

/**
 * Hook to manage the remote user's profile state.
 * Fetches the user profile from `/api/me` on mount.
 * @returns Current user profile, loading state, error message, and a refresh function.
 */
export function useRemoteUser(): {
  user: RemoteUser;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [user, setUser] = useState<RemoteUser>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fetches the user profile from the backend. */
  const refresh = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/me", { cache: "no-store" });
      if (!res.ok) {
        setError(`Failed to load user (${res.status})`);
        return;
      }
      const json = (await res.json()) as { user: RemoteUser };
      setUser(json.user);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return { user, loading, error, refresh };
}
