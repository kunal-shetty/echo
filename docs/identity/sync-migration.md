# Sync & Migration

This document describes the process of synchronizing data across devices and migrating guest data to a cloud account.

## Overview
Echo ensures that a user's financial history is preserved regardless of the device they use. This is achieved through a "Merge-on-Auth" strategy.

## The Sync Process
When a user authenticates on a new device:
1. **Identity Match**: The system checks if the authenticated email is already linked to a `user_id` in the database.
2. **Local Discovery**: The app checks for any existing guest transactions in the local storage of the current device.
3. **Conflict Resolution**:
    - If local transactions exist and the user is now authenticated, the system triggers a migration.
    - The local records are uploaded to the server and associated with the verified `user_id`.
4. **State Update**: The `useTransactions` hook switches from `LocalStorageProvider` to `ApiStorageProvider`.

## Technical Implementation (`__tests__/api/auth-verify.test.ts`)
The migration logic is handled during the `/api/auth/verify` call:
- The server identifies the "old" device ID associated with the email.
- It performs a bulk update across several tables:
    - `accounts`
    - `merchant_aliases`
    - `transactions`
    - `budgets`
    - `insights`
- This effectively "moves" the history from the guest account to the verified account.
- Finally, the orphaned guest record in the `users` table is deleted to keep the database clean.

## User Experience
To the user, this feels seamless: they log in, and their previous guest memories simply "appear" in their synced account.
