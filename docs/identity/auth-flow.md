# Authentication Flow

This document describes how Echo manages user identity and secure access.

## Overview
Echo uses a "Device-First" identity model. Users start as guests and can optionally upgrade to a verified account via email OTP (One-Time Password).

## The Identity Hierarchy

### 1. Guest Identity
- Every user is assigned a random UUID (`echo_guest_id`) stored in a cookie/localStorage.
- This allows users to experience the app immediately without a sign-up flow.

### 2. Authenticated Identity
- Users can link their email to their device ID.
- **Verification Flow**:
    1. User enters email.
    2. Server generates a hashed OTP and sends it via email (using Resend).
    3. User enters the 6-digit code.
    4. Server verifies the code and creates a session in the `sessions` table.

### 3. Session Management
- A `echo_session` cookie is issued upon successful verification.
- This session maps the device to a `user_id` in the database.
- Sessions are valid for 30 days.

## Security Measures
- **OTP Hashing**: OTPs are never stored in plain text; they are hashed before being saved to the DB.
- **Attempt Limiting**: The system tracks OTP attempts and blocks further tries after too many failures to prevent brute-forcing.
- **Backend Validation**: Every API request calls `getCurrentUserId()` to ensure the caller is authenticated and authorized for the requested data.
