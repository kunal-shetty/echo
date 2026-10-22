# Authentication Flow

This document describes how Echo manages user identity and secure access.

## Overview
Echo uses a "guest-first" identity model. Everyone starts as a guest and can
optionally verify an email address with a one-time code to sync across
devices. Guests and verified users are both stored server-side.

## The One Rule
**Identity comes only from a server-side session.** The `echo_session`
cookie holds an opaque random id; the server looks it up in the `sessions`
table (and checks `expires_at`) to find the user. Nothing else the client
sends — user ids, device ids, other cookies, request bodies — is ever
treated as an identity. See `lib/server/user.ts`.

## The Identity Hierarchy

### 1. Guest
- The first time a browser *writes* something (adds a transaction, saves
  its profile, asks a question), `requireUserId()` creates a `users` row
  with no email, a default "Cash" account, and a session.
- Guest sessions last a year. Read endpoints never create guests; without
  a session they simply return no data.
- Guest creation is rate limited per IP.

### 2. Verified
1. User enters an email → `POST /api/auth/start`.
   - Rate limited per IP, and at most 5 codes per email per hour (counted
     in the database).
   - A 6-digit code is hashed with `OTP_PEPPER` and stored in `email_otps`,
     then sent via Resend.
2. User enters the code → `POST /api/auth/verify`.
   - The attempt counter is incremented atomically (`increment_otp_attempts`)
     *before* the code is checked; after 5 attempts the code is locked.
   - The code is consumed atomically, so it can only succeed once.
3. On success:
   - **The email already has an account** → the caller is signed in to it.
     If the caller was a guest, the guest's own data is merged into that
     account first (`merge_user_data`, one transaction). Data only ever
     flows from the caller's guest into the verified account.
   - **No account has the email, caller is a guest** → the guest claims it.
   - **Otherwise** → a new verified account is created.
   - The session id is rotated (old session deleted, new cookie issued).

### 3. Sessions
- `echo_session` is `httpOnly`, `sameSite=lax`, and `secure` in production.
- Verified sessions last 30 days.
- `POST /api/auth/logout` deletes the session row and clears the cookie;
  the browser becomes a fresh guest on its next write.

## Security Measures
- **No client-chosen identity**: there is no endpoint that signs you in by
  email alone, and no fallback to client-supplied ids.
- **OTP hashing**: codes are never stored in plain text. `OTP_PEPPER` is
  required in production.
- **Attempt and send limits**: atomic per-code attempt counting, per-email
  send limits, per-IP rate limits.
- **Scoped queries**: every database query is filtered by the session's
  `user_id`; ids coming from clients or the LLM must be uuids the user owns.
- **Database lockdown**: RLS denies the anon/authenticated roles on every
  table, and `EXECUTE` on the `security definer` functions is revoked from
  them, so the public anon key can't read or change anything.
