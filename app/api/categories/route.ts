/**
 * @file route.ts
 * @description Categories API.
 * Handles listing available categories and creating new user-defined categories.
 */

import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/server/supabase";
import {
  createCategory,
  listCategoriesForUser,
} from "@/lib/server/categories";
import { isIconName } from "@/lib/icon-vocab";
import { getCurrentUserId } from "@/lib/server/user";

export const runtime = "nodejs";

/**
 * GET /api/categories
 * Returns a list of system categories and any custom categories created by the user.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ categories: [], configured: false });
  }
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ categories: [], configured: true });
    }
    const cats = await listCategoriesForUser(userId);
    return NextResponse.json({ categories: cats, configured: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface CreateCategoryBody {
  name?: string;
  icon?: string | null;
  tone?: string;
  sort_order?: number;
}

const TONES = new Set([
  "violet",
  "orange",
  "blue",
  "green",
  "pink",
  "red",
  "neutral",
]);

/**
 * POST /api/categories
 * Creates a new custom category for the current user.
 * Validates the category name, icon, and tone before insertion.
 */
export async function POST(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Backend not configured." },
      { status: 503 },
    );
  }
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: CreateCategoryBody;
  try {
    body = (await req.json()) as CreateCategoryBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (name.length < 1 || name.length > 40) {
    return NextResponse.json(
      { error: "Name must be 1–40 characters" },
      { status: 400 },
    );
  }

  let icon: string | null;
  if (body.icon === undefined || body.icon === null || body.icon === "") {
    icon = null;
  } else if (typeof body.icon !== "string" || !isIconName(body.icon)) {
    return NextResponse.json(
      { error: "Unknown icon" },
      { status: 400 },
    );
  } else {
    icon = body.icon;
  }

  const tone =
    body.tone && TONES.has(body.tone)
      ? (body.tone as Parameters<typeof createCategory>[1]["tone"])
      : "neutral";

  const sort_order =
    typeof body.sort_order === "number" && Number.isFinite(body.sort_order)
      ? Math.trunc(body.sort_order)
      : 100;

  try {
    const cat = await createCategory(userId, { name, icon, tone, sort_order });
    return NextResponse.json({ category: cat }, { status: 201 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    // Postgres unique-constraint violation.
    if (/duplicate key|unique constraint/i.test(message)) {
      return NextResponse.json(
        { error: "A category with that name already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}