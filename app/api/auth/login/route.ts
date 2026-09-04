import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback?provider=google`;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider");

  if (provider !== "google") {
    return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  }

  if (!GOOGLE_CLIENT_ID) {
    return NextResponse.json({ error: "Google Client ID not configured" }, { status: 500 });
  }

  // Generate state for CSRF protection
  const state = randomBytes(16).toString("hex");
  const store = await cookies();
  store.set("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 15 // 15 mins
  });

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", GOOGLE_REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
