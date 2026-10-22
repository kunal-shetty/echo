/**
 * @file http.ts
 * @description Shared response helpers for API routes.
 */

import { NextResponse } from "next/server.js";

/**
 * Logs an unexpected error server-side and returns a generic response.
 * Raw database / upstream messages are never sent to the client.
 * Errors carrying a numeric `status` (e.g. 429 from guest creation) keep it.
 */
export function serverError(e: unknown, context: string): NextResponse {
  const status =
    typeof (e as { status?: unknown })?.status === "number"
      ? (e as { status: number }).status
      : 500;
  if (status === 429) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down and try again shortly." },
      { status },
    );
  }
  console.error(`[${context}]`, e);
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status },
  );
}
