# Storage Strategy

This document describes how Echo persists data for guests and verified users.

## Overview
All data lives in Supabase (PostgreSQL), for guests and verified users
alike. A guest is just a `users` row without a verified email (see
[Authentication Flow](../identity/auth-flow.md)), so there is one storage
path for everyone and no client-side copy of the ledger.

## Client: `TransactionsProvider` (`lib/use-transactions.tsx`)
- Mounted once in the root layout; `useTransactions()` reads it from any
  component, so a change made in one place (voice, manual add, bulk import)
  shows up everywhere.
- Talks to the `/api/transactions` endpoints through `ApiStorageProvider`
  (`lib/storage-providers.ts`), which maps the UI's camelCase fields to the
  API's snake_case ones.
- `ingest(tx)` adds a transaction the server already saved (e.g. a
  high-confidence voice entry) without saving it again.

## Server
- Every write goes through `validateTransactionInput`
  (`lib/server/transaction-input.ts`): the account is always the user's
  default (clients can't choose it), categories must be visible to the user,
  and lengths, currency, direction, and source are normalized.
- Voice creates are saved immediately only at confidence ≥ 0.7; below that
  `/api/voice-intent` returns a draft and the client saves it once the user
  confirms.

## Legacy local data
Older versions kept guest transactions in `localStorage`
(`echo-tx-local-v1`). On load, the provider uploads any such rows once to
`POST /api/transactions/migrate` (validated like any other write) and
clears the local copy only after the server confirms. If the upload fails,
the local copy is kept and retried on the next load.
