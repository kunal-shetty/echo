/**
 * @file rate-limit.ts
 * @description Fixed-window, in-memory rate limiting for API routes.
 *
 * Counters live in this server instance's memory, so on a multi-instance
 * or serverless deployment each instance enforces its own limit. That is
 * enough to stop casual abuse of the paid Groq/Resend endpoints; anything
 * security-critical (OTP sends) is additionally limited in the database.
 */

import { NextResponse } from "next/server.js";

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_KEYS = 10_000;

function prune(now: number): void {
  if (windows.size < MAX_KEYS) return;
  for (const [key, w] of windows) {
    if (w.resetAt <= now) windows.delete(key);
  }
  // Still full of live windows: drop the oldest rather than grow forever.
  if (windows.size >= MAX_KEYS) {
    const oldest = windows.keys().next().value;
    if (oldest !== undefined) windows.delete(oldest);
  }
}

/**
 * Consumes one request from `key`'s budget.
 * @returns True if the request is allowed, false if the limit is reached.
 */
export function takeToken(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || w.resetAt <= now) {
    prune(now);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (w.count >= limit) return false;
  w.count += 1;
  return true;
}

/** Best-effort client IP from proxy headers. */
export function clientIpFrom(h: Headers): string {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") ?? "unknown";
}

/**
 * Applies a per-IP limit for a named bucket.
 * @returns A 429 response if the limit is exceeded, otherwise null.
 */
export function rateLimit(
  req: Request,
  bucket: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const ip = clientIpFrom(req.headers);
  if (takeToken(`${bucket}:${ip}`, limit, windowMs)) return null;
  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    { status: 429, headers: { "Retry-After": String(Math.ceil(windowMs / 1000)) } },
  );
}

/** Test-only: clears all counters. */
export function resetRateLimits(): void {
  windows.clear();
}
