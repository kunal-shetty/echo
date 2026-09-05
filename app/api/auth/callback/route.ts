import { NextResponse } from "next/server.js";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/server/supabase";
import { getOrCreateUserRow } from "@/lib/server/user";
import { randomUUID } from "node:crypto";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/callback?provider=google`;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const provider = searchParams.get("provider");

  if (!code || !state || provider !== "google") {
    return NextResponse.json({ error: "Invalid request parameters" }, { status: 400 });
  }

  // 1. Validate state
  const store = await cookies();
  const savedState = store.get("oauth_state")?.value;
  if (!savedState || savedState !== state) {
    return NextResponse.json({ error: "Invalid state. Possible CSRF attack." }, { status: 400 });
  }
  store.delete("oauth_state");

  try {
    // 2. Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) {
      return NextResponse.json({ error: tokens.error_description || "Token exchange failed" }, { status: 500 });
    }

    const idToken = tokens.id_token;

    // 3. Decode and validate ID token (simplified for this example)
    // In production, use a library like 'jose' or 'google-auth-library' to verify the signature.
    const payloadBase64 = idToken.split(".")[1];
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64").toString());

    const email = payload.email;
    const oauthId = payload.sub;

    if (!email || !oauthId) {
      return NextResponse.json({ error: "Invalid user info in token" }, { status: 400 });
    }

    // 4. Resolve User in DB
    const supabase = getSupabaseAdmin();
    let { data: user, error } = await supabase
      .from("users")
      .select("id")
      .eq("oauth_id", oauthId)
      .maybeSingle();

    if (error) throw error;

    if (!user) {
      // Create new user
      const newUserId = randomUUID();
      const { data: createdUser, error: createError } = await supabase
        .from("users")
        .insert({
          id: newUserId,
          email,
          oauth_id: oauthId,
          oauth_provider: "google",
        })
        .select("*")
        .single();

      if (createError) throw createError;
      user = createdUser;
    }

    const userId = user.id;

    // 5. Create Session
    const sessionId = randomUUID();
    const { error: sessionError } = await supabase
      .from("sessions")
      .insert({
        id: sessionId,
        user_id: userId,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

    if (sessionError) throw sessionError;

    // 6. Set Session Cookie
    store.set("echo_session", sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return NextResponse.redirect(new URL("/", req.url));
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
