import { NextResponse, type NextRequest } from "next/server";

// /api/* is rewritten to the FastAPI backend (see next.config.ts). When the
// backend is a separate Vercel project, Vercel replaces x-forwarded-for with
// this server's address, so every visitor would share one rate limit. Pass
// the visitor's IP along with a shared secret the backend checks.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Never forward values a client set itself.
  headers.delete("x-echo-client-ip");
  headers.delete("x-echo-proxy-secret");

  const secret = process.env.ECHO_PROXY_SECRET;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip");
  if (secret && ip) {
    headers.set("x-echo-client-ip", ip);
    headers.set("x-echo-proxy-secret", secret);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: "/api/:path*",
};
