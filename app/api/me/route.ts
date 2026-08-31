/**
 * @file route.ts
 * @description User profile API.
 * Handles retrieving and updating the current user's profile information,
 * such as display name, home currency, and preferences.
 */

import { NextResponse } from "next/server";
import {
  getOrCreateUserRow,
  updateUserRow,
  type UserRow,
} from "@/lib/server/user";

export const runtime = "nodejs";

/**
 * GET /api/me
 * Retrieves the current user's profile. If the user doesn't exist in the
 * DB yet (but has a valid device ID), a default row is created.
 */
export async function GET() {
  try {
    const row = await getOrCreateUserRow();
    return NextResponse.json({ user: row });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface PatchBody {
  display_name?: string;
  home_currency?: string;
  reminder_time?: "morning" | "evening" | "off";
  timezone?: string;
}

const CURRENCY_RE = /^[A-Z]{3}$/;
const REMINDER_OK = new Set(["morning", "evening", "off"]);

/**
 * PATCH /api/me
 * Updates the current user's profile. Validates currency codes (ISO 4217)
 * and reminder settings before persisting to the database.
 */
export async function PATCH(req: Request) {
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Partial<UserRow> = {};
  if (typeof body.display_name === "string") {
    const name = body.display_name.trim().slice(0, 64);
    if (name) patch.display_name = name;
  }
  if (typeof body.home_currency === "string") {
    const cur = body.home_currency.toUpperCase();
    if (CURRENCY_RE.test(cur)) patch.home_currency = cur;
  }
  if (
    typeof body.reminder_time === "string" &&
    REMINDER_OK.has(body.reminder_time)
  ) {
    patch.reminder_time = body.reminder_time;
  }
  if (typeof body.timezone === "string") {
    patch.timezone = body.timezone.slice(0, 64);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  try {
    const row = await updateUserRow(patch);
    return NextResponse.json({ user: row });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}