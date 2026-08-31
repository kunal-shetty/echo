/**
 * @file use-categories.ts
 * @description Custom hook for managing spending categories.
 * Provides stateful access to category lists and operations to create,
 * update, and remove categories via the Categories API.
 */

"use client";


import { useCallback, useEffect, useState } from "react";
import type { Category, Tone } from "@/lib/schema";
import type { DbCategory } from "@/lib/server/categories";
import type { IconName } from "@/lib/icon-vocab";

export interface CreateCategoryInput {
  /** The display name of the category. */
  name: string;
  /** The Lucide icon identifier. */
  icon?: IconName | null;
  /** The visual color theme. */
  tone?: Tone;
  /** The display order (lower numbers appear first). */
  sort_order?: number;
}

export interface UpdateCategoryInput {
  /** Updated display name. */
  name?: string;
  /** Updated icon identifier. */
  icon?: IconName | null;
  /** Updated color theme. */
  tone?: Tone;
  /** Updated display order. */
  sort_order?: number;
}

/** State and actions provided by the useCategories hook. */
export type CategoriesState = {
  /** The list of all available categories (system + user). */
  categories: DbCategory[];
  /** True if the categories have been initialized for the user. */
  configured: boolean;
  /** True while fetching category data. */
  loading: boolean;
  /** Error message from the last operation, if any. */
  error: string | null;
  /** Re-fetches the category list from the server. */
  refresh: () => Promise<void>;
  /** Creates a new custom category. */
  create: (patch: CreateCategoryInput) => Promise<DbCategory | null>;
  /** Updates an existing custom category. */
  update: (id: string, patch: UpdateCategoryInput) => Promise<DbCategory | null>;
  /**
   * Removes a custom category.
   * @returns False if the category is still referenced by transactions/budgets (409 Conflict).
   */
  remove: (id: string) => Promise<boolean>;
};

/**
 * Hook for managing the application's category system.
 * Handles fetching, creating, updating, and deleting categories.
 * @returns A state object with categories and management functions.
 */
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

/**
 * Projects a database category record into the UI-specific Category shape.
 * This ensures that the UI layer interacts with a consistent interface
 * regardless of database column naming conventions.
 * @param row The raw database category row.
 * @returns A UI-ready Category object.
 */
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