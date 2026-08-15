-- =====================================================================
--  Echo — Supabase schema
--  Apply via:     psql "$SUPABASE_DB_URL" -f schema.sql
--                   or
--                 Supabase SQL Editor → paste → Run
--  Idempotent:    safe to re-run; uses CREATE ... IF NOT EXISTS everywhere.
-- =====================================================================
--
--  Conventions:
--   - All money is bigint in major currency units (paise). The app does
--     integer math; conversion happens at the API boundary.
--   - All timestamps are timestamptz.
--   - All ids are uuid v4, default gen_random_uuid().
--   - user_id on every user-owned table is FK -> public.users(id) with
--     ON DELETE CASCADE. (We do NOT reference auth.users — Echo has no
--     Supabase Auth.)
--   - There is no auth.uid(). RLS is enabled but DENIES access to the
--     anon/authenticated roles. Only the service_role key (used by our
--     /api routes) bypasses RLS. This keeps the Postgres data private
--     even if the anon key leaks.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- =====================================================================
--  Enums
-- =====================================================================

do $$ begin
  create type account_type as enum ('cash','bank','card','wallet','investment');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tone as enum ('violet','orange','blue','green','pink','red','neutral');
exception when duplicate_object then null; end $$;

do $$ begin
  create type direction as enum ('expense','income','transfer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type source as enum ('voice','manual','import','recurring');
exception when duplicate_object then null; end $$;

do $$ begin
  create type recurrence as enum ('daily','weekly','biweekly','monthly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type attach_kind as enum ('audio','image','receipt');
exception when duplicate_object then null; end $$;

do $$ begin
  create type voice_outcome as enum ('created','clarified','cancelled','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type insight_kind as enum
    ('spend_pattern','anomaly','trend','subscription_check','budget_alert');
exception when duplicate_object then null; end $$;

-- =====================================================================
--  Helper: is_owner(uid)
--  Echo has no auth.uid(), so this just exists as a marker for routes
--  that may want to use it. RLS below does NOT rely on it — service_role
--  bypasses RLS entirely.
-- =====================================================================

create or replace function public.is_owner(uid uuid)
returns boolean
language sql
stable
as $$
  select false   -- always false; service_role bypasses RLS
$$;

-- =====================================================================
--  Generic trigger functions
--  Defined BEFORE any table that uses them.
-- =====================================================================

-- touch_updated_at(): bumps new.updated_at = now() on UPDATE.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =====================================================================
--  users
--  Echo does NOT use Supabase Auth. Each device gets its own uuid
--  (issued by /api routes, persisted in a cookie). When the user later
--  links an email from Profile, that email can claim a different device's
--  data via the migration step in /api/auth/verify.
-- =====================================================================

create table if not exists public.users (
  id                uuid primary key,                       -- device-issued uuid, NOT auth.users
  email             citext unique,
  email_verified_at timestamptz,
  display_name      text,
  avatar_url        text,
  timezone          text not null default 'Asia/Kolkata',
  home_currency     char(3) not null default 'INR',
  reminder_time     text not null default 'evening'
    check (reminder_time in ('morning','evening','off')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists users_touch_updated_at on public.users;
create trigger users_touch_updated_at
  before update on public.users
  for each row execute function public.touch_updated_at();

-- (The old `handle_new_user` trigger on auth.users is intentionally
-- removed: Echo manages the public.users row from server routes.)

-- =====================================================================
--  email_otps
--  Single-use codes for the optional "Sync across devices" flow.
--  Only the service_role key (our /api routes) writes here. The anon
--  key has no access (RLS denies all).
-- =====================================================================

create table if not exists public.email_otps (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null,
  code_hash     text   not null,                 -- sha256(code + server_pepper)
  expires_at    timestamptz not null,
  consumed_at   timestamptz,
  attempts      int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists email_otps_email_active_idx
  on public.email_otps(email, created_at desc)
  where consumed_at is null;

-- =====================================================================
--  accounts
-- =====================================================================

create table if not exists public.accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  name          text not null,
  type          account_type not null,
  currency      char(3) not null,
  balance_minor bigint not null default 0,
  is_default    boolean not null default false,
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists accounts_user_active_idx
  on public.accounts(user_id) where not is_archived;

-- =====================================================================
--  categories
--  user_id IS NULL → system row, visible to all.
-- =====================================================================

create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.users(id) on delete cascade,
  parent_id  uuid references public.categories(id) on delete set null,
  name       text not null,
  icon       text,
  color      text,
  tone       tone not null default 'neutral',
  sort_order int not null default 0,
  unique (user_id, name)
);

create index if not exists categories_user_idx
  on public.categories(user_id);

-- =====================================================================
--  merchant_aliases
-- =====================================================================

create table if not exists public.merchant_aliases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  alias        text not null,
  canonical    text not null,
  category_id  uuid references public.categories(id) on delete set null,
  use_count    int not null default 0,
  last_used_at timestamptz not null default now(),
  unique (user_id, alias)
);

create index if not exists merchant_aliases_user_idx
  on public.merchant_aliases(user_id);

-- =====================================================================
--  transactions
-- =====================================================================

create table if not exists public.transactions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  account_id          uuid not null references public.accounts(id) on delete restrict,
  category_id         uuid references public.categories(id) on delete set null,
  amount_minor        bigint not null check (amount_minor >= 0),
  currency            char(3) not null,
  direction           direction not null default 'expense',
  merchant_raw        text not null,
  merchant_canonical  text,
  note                text,
  transacted_at       timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  source              source not null,
  confidence          numeric(3,2),
  raw_transcript      text,
  clarified           boolean not null default false,
  deleted_at          timestamptz
);

create index if not exists transactions_user_time_idx
  on public.transactions(user_id, transacted_at desc)
  where deleted_at is null;

create index if not exists transactions_user_category_time_idx
  on public.transactions(user_id, category_id, transacted_at desc)
  where deleted_at is null;

create index if not exists transactions_merchant_canonical_idx
  on public.transactions(user_id, merchant_canonical)
  where merchant_canonical is not null;

create index if not exists transactions_user_created_idx
  on public.transactions(user_id, created_at desc);

-- =====================================================================
--  attachments
-- =====================================================================

create table if not exists public.attachments (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  kind           attach_kind not null,
  storage_path   text not null,
  duration_ms    int,
  mime           text not null,
  size_bytes     int not null,
  created_at     timestamptz not null default now()
);

create index if not exists attachments_tx_idx
  on public.attachments(transaction_id);

-- =====================================================================
--  recurring_rules
-- =====================================================================

create table if not exists public.recurring_rules (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.users(id) on delete cascade,
  merchant_canonical text not null,
  category_id        uuid references public.categories(id) on delete set null,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  amount_minor       bigint not null,
  currency           char(3) not null,
  interval           recurrence not null,
  interval_n         int not null default 1,
  next_run_at        timestamptz not null,
  is_paused          boolean not null default false,
  created_at         timestamptz not null default now()
);

create index if not exists recurring_rules_user_next_idx
  on public.recurring_rules(user_id, next_run_at) where not is_paused;

-- =====================================================================
--  budgets
-- =====================================================================

create table if not exists public.budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  category_id  uuid not null references public.categories(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  cap_minor    bigint not null,
  unique (user_id, category_id, period_start)
);

-- =====================================================================
--  voice_sessions
-- =====================================================================

create table if not exists public.voice_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  started_at    timestamptz not null,
  ended_at      timestamptz,
  transcript    text,
  parsed_intent jsonb,
  outcome       voice_outcome not null,
  device        text,
  audio_path    text
);

create index if not exists voice_sessions_user_time_idx
  on public.voice_sessions(user_id, started_at desc);

-- =====================================================================
--  insights
-- =====================================================================

create table if not exists public.insights (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  kind          insight_kind not null,
  period_start  date not null,
  period_end    date not null,
  payload       jsonb not null,
  generated_at  timestamptz not null default now(),
  dismissed_at  timestamptz
);

create index if not exists insights_user_active_idx
  on public.insights(user_id, generated_at desc) where dismissed_at is null;

-- (touch_updated_at is defined earlier in the file.)

-- =====================================================================
--  ensure_default_account(uid)
--  Idempotently creates a "Cash" default account for a user. Called
--  from /api routes after creating a public.users row. Safe to call
--  many times.
-- =====================================================================

create or replace function public.ensure_default_account(uid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.accounts where user_id = uid and is_default
  ) then
    insert into public.accounts (user_id, name, type, currency, is_default)
    select uid, 'Cash', 'cash',
           coalesce((select home_currency from public.users where id = uid), 'INR'),
           true;
  end if;
end;
$$;

-- =====================================================================
--  Row-Level Security
-- =====================================================================

alter table public.users           enable row level security;
alter table public.accounts        enable row level security;
alter table public.transactions    enable row level security;
alter table public.merchant_aliases enable row level security;
alter table public.attachments     enable row level security;
alter table public.recurring_rules enable row level security;
alter table public.budgets         enable row level security;
alter table public.voice_sessions  enable row level security;
alter table public.insights        enable row level security;
-- categories is special: system rows are publicly readable.
alter table public.categories      enable row level security;

-- All Echo data is private. With no Supabase Auth there's no auth.uid(),
-- so we DENY every operation to the anon and authenticated roles. Reads
-- and writes only happen through /api routes that use the service_role
-- key, which bypasses RLS by default.
--
-- The single exception is `categories`: system rows (user_id IS NULL)
-- are publicly readable so the app can list default categories without a
-- round-trip through the server. (If you'd rather keep them private
-- too, drop the `categories_read_system` policy below.)

-- users
drop policy if exists users_deny on public.users;
create policy users_deny on public.users
  for all to anon, authenticated
  using (false) with check (false);

-- accounts
drop policy if exists accounts_deny on public.accounts;
create policy accounts_deny on public.accounts
  for all to anon, authenticated
  using (false) with check (false);

-- categories — system rows readable, user rows deny
drop policy if exists categories_read_system on public.categories;
create policy categories_read_system on public.categories
  for select to anon, authenticated
  using (user_id is null);

drop policy if exists categories_deny on public.categories;
create policy categories_deny on public.categories
  for all to anon, authenticated
  using (user_id is not null) with check (user_id is not null);

-- transactions
drop policy if exists transactions_deny on public.transactions;
create policy transactions_deny on public.transactions
  for all to anon, authenticated
  using (false) with check (false);

-- merchant_aliases
drop policy if exists merchant_aliases_deny on public.merchant_aliases;
create policy merchant_aliases_deny on public.merchant_aliases
  for all to anon, authenticated
  using (false) with check (false);

-- attachments
drop policy if exists attachments_deny on public.attachments;
create policy attachments_deny on public.attachments
  for all to anon, authenticated
  using (false) with check (false);

-- recurring_rules
drop policy if exists recurring_rules_deny on public.recurring_rules;
create policy recurring_rules_deny on public.recurring_rules
  for all to anon, authenticated
  using (false) with check (false);

-- budgets
drop policy if exists budgets_deny on public.budgets;
create policy budgets_deny on public.budgets
  for all to anon, authenticated
  using (false) with check (false);

-- voice_sessions
drop policy if exists voice_sessions_deny on public.voice_sessions;
create policy voice_sessions_deny on public.voice_sessions
  for all to anon, authenticated
  using (false) with check (false);

-- insights
drop policy if exists insights_deny on public.insights;
create policy insights_deny on public.insights
  for all to anon, authenticated
  using (false) with check (false);

-- email_otps — only writable by service_role via /api routes
drop policy if exists email_otps_deny on public.email_otps;
create policy email_otps_deny on public.email_otps
  for all to anon, authenticated
  using (false) with check (false);

-- =====================================================================
--  Realtime publication (so the app can subscribe to inserts)
-- =====================================================================

do $$
begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if found then
    -- add table if missing
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'transactions'
    ) then
      alter publication supabase_realtime add table public.transactions;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = 'insights'
    ) then
      alter publication supabase_realtime add table public.insights;
    end if;
  end if;
end $$;

-- =====================================================================
--  Storage buckets (private)
--  Run separately if you prefer the Supabase UI:
--    - voice-memos  (private, owner-only)
--    - receipts     (private, owner-only)
--    - avatars      (public-read, owner write)
--  Path convention: {user_id}/{session_or_tx_id}.{ext}
-- =====================================================================

insert into storage.buckets (id, name, public)
  values ('voice-memos', 'voice-memos', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('receipts', 'receipts', false)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

-- Storage RLS: deny direct access from anon/authenticated. Uploads and
-- reads happen through /api routes that use the service_role key (which
-- bypasses storage RLS). This keeps media private while still letting us
-- generate signed URLs from the server.

drop policy if exists voice_memos_deny on storage.objects;
create policy voice_memos_deny on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'voice-memos') with check (bucket_id = 'voice-memos');

drop policy if exists receipts_deny on storage.objects;
create policy receipts_deny on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'receipts') with check (bucket_id = 'receipts');

drop policy if exists avatars_deny_write on storage.objects;
create policy avatars_deny_write on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'avatars');

drop policy if exists avatars_deny_update on storage.objects;
create policy avatars_deny_update on storage.objects
  for update to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists avatars_deny_delete on storage.objects;
create policy avatars_deny_delete on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'avatars');

-- Avatars bucket is `public = true` so service_role can hand out direct
-- URLs. Anon reads stay allowed (public bucket semantics).

-- =====================================================================
--  Seed: system categories (user_id IS NULL)
-- =====================================================================

insert into public.categories (user_id, name, icon, color, tone, sort_order) values
  (null, 'Food & Drink',   'UtensilsCrossed',  'oklch(0.8 0.14 65)',  'orange',  0),
  (null, 'Groceries',      'ShoppingBasket',   'oklch(0.78 0.17 160)', 'green',   1),
  (null, 'Transport',      'Car',              'oklch(0.74 0.15 275)', 'violet',  2),
  (null, 'Entertainment',  'Music',            'oklch(0.74 0.14 335)', 'pink',    3),
  (null, 'Shopping',       'ShoppingBag',      'oklch(0.73 0.13 220)', 'blue',    4),
  (null, 'Bills',          'Receipt',          'oklch(0.7 0.13 30)',   'red',     5),
  (null, 'Other',          'Package',          'oklch(0.66 0.02 250)', 'neutral', 99)
on conflict (user_id, name) do nothing;

-- =====================================================================
--  End of schema.sql
-- =====================================================================
