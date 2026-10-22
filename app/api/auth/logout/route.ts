import { NextResponse } from "next/server.js";
import { endSession } from "@/lib/server/user";
import { serverError } from "@/lib/server/http";

export async function POST() {
  try {
    await endSession();
  } catch (e) {
    return serverError(e, "auth/logout");
  }
  return NextResponse.json({ success: true });
}
