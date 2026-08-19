"use client";

import { useCallback, useEffect, useState } from "react";
import type { Category, Tone } from "@/lib/schema";
import type { DbCategory } from "@/lib/server/categories";
import type { IconName } from "@/lib/icon-vocab";

export interface CreateCategoryInput {
  name: string;
  icon?: IconName | null;
  tone?: Tone;
  sort_order?: number;
}

export interface UpdateCategoryInput {
  name?: string;
  icon?: IconName | null;
  tone?: Tone;
  sort_order?: number;
}

export type CategoriesState = {
  categories: DbCategory[];
  configured: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (patch: CreateCategoryInput) => Promise<DbCategory | null>;
  update: (id: string, patch: UpdateCategoryInput) => Promise<DbCategory | null>;
  /** Returns false on a 409 (category still referenced by transactions/budgets). */
  remove: (id: string) => Promise<boolean>;
};

export function useCategories(): CategoriesState {
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

  const create = useCallback(
    async (patch: CreateCategoryInput): Promise<DbCategory | null> => {
      try {
        const res = await fetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const json = (await res.json().catch(() => ({}))) as {
          category?: DbCategory;
          error?: string;
        };
        if (!res.ok || !json.category) {
          setError(json.error ?? `Create failed (${res.status})`);
          return null;
        }
        setCategories((prev) => [...json.category!, ...prev]);
        return json.category;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
        return null;
      }
    },
    [],
  );

  const update = useCallback(
    async (
      id: string,
      patch: UpdateCategoryInput,
    ): Promise<DbCategory | null> => {
      try {
        const res = await fetch(`/api/categories/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const json = (await res.json().catch(() => ({}))) as {
          category?: DbCategory;
          error?: string;
        };
        if (!res.ok || !json.category) {
          setError(json.error ?? `Update failed (${res.status})`);
          return null;
        }
        setCategories((prev) =>
          prev.map((c) => (c.id === id ? json.category! : c)),
        );
        return json.category;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
        return null;
      }
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
      if (res.status === 204) {
        setCategories((prev) => prev.filter((c) => c.id !== id));
        return true;
      }
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      // 404 is "already gone" — treat as success locally.
      if (res.status === 404) {
        setCategories((prev) => prev.filter((c) => c.id !== id));
        return true;
      }
      setError(json.error ?? `Delete failed (${res.status})`);
      return false;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      return false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    categories,
    configured,
    loading,
    error,
    refresh,
    create,
    update,
    remove,
  };
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