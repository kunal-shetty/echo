"use client";

import { useCallback, useEffect, useState } from "react";
import type { Category } from "@/lib/schema";
import type { DbCategory } from "@/lib/server/categories";

export function useCategories(): {
  categories: DbCategory[];
  configured: boolean;
  loading: boolean;
  error: string | null;
} {
  const [categories, setCategories] = useState<DbCategory[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/categories", { cache: "no-store" });
      if (!res.ok) {
        setError(`Failed to load (${res.status})`);
        return;
      }
      const json = (await res.json()) as {
        categories: DbCategory[];
        configured: boolean;
        error?: string;
      };
      setCategories(json.categories ?? []);
      setConfigured(Boolean(json.configured));
      setError(json.error ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { categories, configured, loading, error };
}

/** Project DB category rows into the UI Category shape used by the
 *  rest of the app. UI fields that aren't in DB (initials/avatar) are
 *  derived. */
export function toUiCategory(row: DbCategory): Category {
  return {
    id: row.id,
    userId: row.user_id,
    parentId: row.parent_id,
    name: row.name,
    icon: row.icon ?? "Package",
    tone: row.tone,
    sortOrder: row.sort_order,
  };
}