# Data Schema

This document provides a detailed breakdown of the Echo database schema and TypeScript types.

## Database Tables (PostgreSQL)

### `users`
Stores the primary identity and profile of the user.
- `id`: UUID (Primary Key).
- `email`: Unique email address.
- `display_name`: User's preferred name.
- `home_currency`: ISO currency code (e.g., "INR").
- `reminder_time`: "morning" | "evening" | "off".

### `accounts`
Financial containers (e.g., Bank, Cash, Wallet).
- `id`: UUID.
- `user_id`: FK to `users`.
- `name`: Account name.
- `is_default`: Boolean flag for the primary account used in voice capture.

### `categories`
Organizes transactions. Can be system-seeded or user-defined.
- `id`: UUID.
- `user_id`: FK to `users` (null for system categories).
- `name`: Category label (e.g., "Food & Drink").
- `icon`: Icon identifier (e.g., "CircleDollarSign").
- `tone`: Color theme ("violet", "emerald", etc.).

### `transactions`
The core ledger.
- `id`: UUID.
- `amount_minor`: Integer. Amount in minor units (e.g., 1000 for ₹10.00).
- `direction`: "expense" | "income".
- `merchant_raw`: The original name captured via voice.
- `merchant_canonical`: The resolved, unique merchant name.
- `category_id`: FK to `categories`.
- `account_id`: FK to `accounts`.

### `merchant_aliases`
Maps various spoken names to a single canonical merchant.
- `alias`: The spoken name (e.g., "Blue Bottle").
- `canonical`: The target name (e.g., "Blue Bottle Coffee").
- `category_id`: The default category for this merchant.

---

## TypeScript Interfaces (`lib/schema.ts`)

The frontend uses a mirrored set of types. The `Transaction` interface includes "UI-only" convenience fields like `date` (pre-formatted relative string) and `tone` (resolved from the category).
