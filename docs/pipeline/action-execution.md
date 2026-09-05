# Action Execution Pipeline

This document describes the third stage of the Echo pipeline: executing the structured intent against the database.

## Overview
Once an intent is parsed, the system performs the corresponding CRUD operation on the Supabase backend, while resolving entities like accounts and categories.

## Execution Flows

### 1. Create Transaction
- **Account Resolution**: If no account is specified, the system fetches the user's `is_default` account.
- **Merchant Resolution**: The merchant name is passed through `resolveMerchant()`. If it's a new merchant, a new alias is created.
- **Category Resolution**:
    - The system checks if the parsed category name matches a system category.
    - If not, it automatically creates a new user-specific category.
- **Persistence**: The record is inserted into the `transactions` table.

### 2. Update Transaction
- **Target Matching**: Uses the `matchId` provided by the LLM to find the specific record.
- **Partial Patching**: Only the fields specified by the LLM (e.g., just the amount) are updated, preserving other data.

### 3. Delete Transaction
- **Soft Delete**: Records are marked with a `deleted_at` timestamp rather than being physically removed, allowing for potential recovery.

### 4. Query Execution
- **Aggregation**: For "sum" queries, the system performs a `SUM()` operation on `amount_minor` filtered by date/category.
- **Reasoning**: The raw data is passed back to the LLM to generate a "Reasoned Response" (e.g., "You spent ₹1,200 on coffee, which is 20% higher than last month").

## Database Integrity
- **Minor Units**: All financial amounts are stored as integers (e.g., cents/paise) to avoid floating-point precision errors during aggregation.
- **Consistency**: The system ensures that every transaction is linked to a valid account and category.
