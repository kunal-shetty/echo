/**
 * @file me/route.ts
 * @description The current user's profile.
 * GET returns the session's user (or none); PATCH updates profile fields,
 * creating a guest account on first use.
 */

import { NextResponse } from "next/server.js";
import {
  getSessionUser,
  getUserRow,
  requireUserId,
  toPublicUser,
  updateUserRow,
  type UserProfilePatch,
} from "@/lib/server/user";
import { serverError } from "@/lib/server/http";
import { isSupabaseConfigured } from "@/lib/server/supabase";

export const runtime = "nodejs";

const REMINDER_TIMES = new Set(["morning", "evening", "off"]);

export async function GET() {
  try {
    const session = await getSessionUser();
    const row = session ? await getUserRow(session.userId) : null;
    if (!session || !row) {
      return NextResponse.json({ authenticated: false, guest: false, user: null });
    }
    return NextResponse.json({
      authenticated: session.verified,
      guest: !session.verified,
      user: toPublicUser(row),
    });
  } catch (e) {
    return serverError(e, "me/GET");
  }
}

export async function PATCH(req: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Backend not configured." }, { status: 503 });
  }
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: UserProfilePatch = {};
  if (raw.display_name !== undefined) {
    if (raw.display_name !== null && typeof raw.display_name !== "string") {
      return NextResponse.json({ error: "Invalid display_name" }, { status: 400 });
    }
    const name = (raw.display_name ?? "").trim().slice(0, 60);
    patch.display_name = name || null;
  }
  if (raw.home_currency !== undefined) {
    if (typeof raw.home_currency !== "string" || !/^[A-Za-z]{3}$/.test(raw.home_currency)) {
      return NextResponse.json({ error: "Invalid home_currency" }, { status: 400 });
    }
    patch.home_currency = raw.home_currency.toUpperCase();
  }
  if (raw.reminder_time !== undefined) {
    if (typeof raw.reminder_time !== "string" || !REMINDER_TIMES.has(raw.reminder_time)) {
      return NextResponse.json({ error: "Invalid reminder_time" }, { status: 400 });
    }
    patch.reminder_time = raw.reminder_time as UserProfilePatch["reminder_time"];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const userId = await requireUserId();
    const row = await updateUserRow(userId, patch);
    return NextResponse.json({ user: row ? toPublicUser(row) : null });
  } catch (e) {
    return serverError(e, "me/PATCH");
  }
}
