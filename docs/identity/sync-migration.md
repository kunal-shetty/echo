# Sync & Migration

This document describes how data follows a user across devices.

## Overview
Every browser starts as a guest with its own server-side account. Verifying
an email links that browser to the account that owns the email.

## The Sync Process
When a user verifies an email on a device (`POST /api/auth/verify`):
1. **Identity match**: the server looks up the account that owns the email.
2. **Merge**: if this device is currently a guest and a different account
   owns the email, the database function `merge_user_data(guest, owner)`
   moves the guest's data into the owner's account in one transaction:
   - transactions and recurring rules move onto the owner's default account;
   - categories with the same name collapse onto the owner's copy;
   - aliases and budgets keep the owner's row on conflict;
   - voice sessions move over; insights are dropped (they're regenerated);
   - the guest user (with its accounts and sessions) is deleted.
3. **Sign-in**: the session is rotated to point at the owner's account.
4. **Refresh**: the client reloads its transaction list
   (`components/profile/sync-sheet.tsx`).

## Safety
The merge only ever runs from the caller's **own** guest account into the
account they just proved they own with the email code. It never moves data
out of a verified account, and two verified accounts are never merged:
signing in to a second email from a verified device just switches accounts.

## User Experience
Users log in on a new device and their history is there; anything they
recorded as a guest on that device is added to it.
