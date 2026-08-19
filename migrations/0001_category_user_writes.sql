-- =====================================================================
--  Migration 0001 — allow user-row writes on categories
-- =====================================================================
--
--  schema.sql created a catch-all `categories_deny` permissive policy
--  for anon + authenticated. Because it's permissive, it shadows per-
--  action policies on user rows: an INSERT with user_id NOT NULL
--  passes `categories_user_insert` (when defined) but ALSO fails the
--  deny-all policy on the same command, so the insert is blocked.
--
--  We drop the catch-all and add three narrow permissive policies,
--  one per write command. Each requires `user_id is not null`, which
--  keeps system rows non-writable.
--
--  Reads remain governed by `categories_read_system` (system rows
--  visible to anon + authenticated) plus the implicit rule that
--  user rows are invisible to anon key holders.
--
--  Note: the service_role key bypasses RLS, so all writes today flow
--  through `/api/categories` and the route enforces ownership.
--  These policies matter if/when Echo exposes the anon key.
--
--  Idempotent: safe to re-run.

drop policy if exists categories_deny on public.categories;

drop policy if exists categories_user_insert on public.categories;
create policy categories_user_insert on public.categories
  for insert to anon, authenticated
  with check (user_id is not null);

drop policy if exists categories_user_update on public.categories;
create policy categories_user_update on public.categories
  for update to anon, authenticated
  using (user_id is not null)
  with check (user_id is not null);

drop policy if exists categories_user_delete on public.categories;
create policy categories_user_delete on public.categories
  for delete to anon, authenticated
  using (user_id is not null);
