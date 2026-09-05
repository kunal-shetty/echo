# Storage Strategy

This document describes how Echo handles data persistence across different user states (Guest vs. Authenticated).

## Overview
Echo employs a "Provider Pattern" to abstract the data source, allowing the app to function identically whether data is stored locally or in the cloud.

## Storage Providers (`lib/storage-providers.ts`)

### 1. LocalStorageProvider
Used for guest users and offline access.
- **Mechanism**: Serializes the transaction list to a JSON string in `window.localStorage`.
- **Pros**: Zero latency, works without internet, no account required.
- **Cons**: Data is device-specific; cleared if browser cache is wiped.

### 2. ApiStorageProvider
Used for authenticated users.
- **Mechanism**: Communicates with Supabase via REST API endpoints.
- **Pros**: Data is synced across devices, backed up in the cloud.
- **Cons**: Requires network connectivity.

## The `useTransactions` Hook
The `useTransactions` hook acts as the coordinator:
1. It checks for authentication status (`/api/me`).
2. It instantiates the appropriate provider.
3. It exposes a unified API (`list`, `add`, `update`, `remove`) so the components don't need to know where the data is stored.

## Data Integrity
To prevent data loss during the transition from Guest $\rightarrow$ Authenticated, the system implements a migration flow:
- When a user logs in, `migrateLocalData()` is called.
- All transactions in `LocalStorage` are pushed to the Supabase backend.
- Local storage is cleared only after a successful server confirmation.
