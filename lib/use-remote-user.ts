"use client";

import { useEffect, useState } from "react";

export type RemoteUser = {
  id: string;
  email: string | null;
  email_verified_at: string | null;
  display_name: string | null;
  home_currency: string;
  reminder_time: "morning" | "evening" | "off";
} | null;

export function useRemoteUser(): {
  user: RemoteUser;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [user, setUser] = useState<RemoteUser>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
