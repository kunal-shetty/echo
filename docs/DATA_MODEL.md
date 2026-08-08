# Echo — Data Model

This is the canonical database design for Echo, the voice-first finance tracker.
It is engineered for **PostgreSQL** (Supabase-friendly, but works on any Postgres
with `pgcrypto` and `uuid-ossp`). The frontend mocked in `lib/dummy-data.ts`
mirrors these types in `lib/schema.ts`.

The model assumes:

- One user = one household. No multi-tenant sharing in v1.
- Money is always stored as **integer minor units** (paise / cents) to avoid
  floating-point bugs. Display logic converts at the API boundary.
- All voice/audio evidence is **optional** — the user can interact entirely
  by typing. `attachments` exist so we can play back the utterance to resolve
  disputes.
- Most queries are time-bounded (`transacted_at` range), so indexes prioritize
  `user_id` + `transacted_at DESC`.

---

## Entity-relationship overview

```
                    ┌──────────┐
                    │  users   │  (mirrors auth.users)
                    └─────┬────┘
                          │ 1
        ┌─────────────────┼────────────────┬─────────────────┐
        │ 1               │ 1              │ 1               │ 1
        ▼                 ▼                ▼                 ▼
   ┌─────────┐     ┌─────────────┐   ┌──────────┐    ┌──────────────┐
   │accounts │ 1──∞│transactions│∞──1│categories│    │voice_sessions│
   └─────────┘     └──────┬──────┘   └──────────┘    └──────────────┘
                          │ 1
                          │ ∞
                          ▼
                    ┌─────────────┐
                    │ attachments │
                    └─────────────┘

   ┌──────────────┐    ┌──────────┐    ┌────────────┐
   │recurring_rules│   │ budgets  │    │  insights  │
   └──────────────┘    └──────────┘    └────────────┘
```

---

## Tables

### `users`

Mirrors the auth provider (Supabase `auth.users`). One row per signed-in user.

| Column         | Type         | Notes                                  |
| -------------- | ------------ | -------------------------------------- |
| `id`           | `uuid PK`    | FK → `auth.users.id` (cascade delete)  |
| `email`        | `text`       | Synced from auth; citext              |
| `display_name` | `text`       | First name for greetings                |
| `avatar_url`   | `text NULL`  |                                        |
| `timezone`     | `text`       | IANA, default `Asia/Kolkata`           |
| `home_currency`| `char(3)`    | ISO 4217, default `INR`                |
| `created_at`   | `timestamptz`| default `now()`                        |

```sql
create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         citext,
  display_name  text,
  avatar_url    text,
  timezone      text not null default 'Asia/Kolkata',
  home_currency char(3) not null default 'INR',
  created_at    timestamptz not null default now()
);
```

### `accounts`

A cash account, bank account, card, or wallet that holds a balance.

| Column         | Type         | Notes                                    |
| -------------- | ------------ | ---------------------------------------- |
| `id`           | `uuid PK`    | default `gen_random_uuid()`              |
| `user_id`      | `uuid FK`    | → `users.id`                             |
| `name`         | `text`       | e.g. "HDFC Savings", "Cash"              |
| `type`         | `account_type` | enum: `cash`, `bank`, `card`, `wallet`, `investment` |
| `currency`     | `char(3)`    | ISO 4217                                 |
| `balance_minor`| `bigint`     | Cached balance in minor units (paise)    |
| `is_default`   | `boolean`    | default `false`                          |
| `is_archived`  | `boolean`    | default `false`                          |
| `created_at`   | `timestamptz`|                                          |

```sql
create type account_type as enum ('cash','bank','card','wallet','investment');

create table public.accounts (
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
create index accounts_user_idx on public.accounts(user_id) where not is_archived;
```

### `categories`

A flat-ish hierarchy. Pre-seeded with `user_id = null` system categories; users
can add their own.

| Column     | Type        | Notes                                |
| ---------- | ----------- | ------------------------------------ |
| `id`       | `uuid PK`   |                                      |
| `user_id`  | `uuid NULL` | null = system row, visible to all    |
| `parent_id`| `uuid NULL` | self-FK for sub-categories          |
| `name`     | `text`      |                                      |
| `icon`     | `text`      | lucide icon name or emoji            |
| `color`    | `text`      | hex token, e.g. `var(--emerald)`     |
| `tone`     | `tone`      | enum: `violet`, `orange`, `blue`, `green`, `pink`, `red`, `neutral` |
| `sort_order`| `int`      |                                      |

```sql
create type tone as enum ('violet','orange','blue','green','pink','red','neutral');

create table public.categories (
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
```

### `transactions` — the central table

Every remembered expense / income lands here.

| Column              | Type           | Notes                                                                                       |
| ------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `id`                | `uuid PK`      | default `gen_random_uuid()`                                                                 |
| `user_id`           | `uuid FK`      | → `users.id`                                                                                |
| `account_id`        | `uuid FK`      | → `accounts.id`                                                                             |
| `category_id`       | `uuid FK NULL` | → `categories.id` - null until categorized (during STT parse)                              |
| `amount_minor`      | `bigint`       | Always positive; sign is implied by `direction` to keep sort logic simple                  |
| `currency`          | `char(3)`      | ISO 4217                                                                                     |
| `direction`         | `direction`    | enum: `expense`, `income`, `transfer`                                                       |
| `merchant_raw`      | `text`         | What the user or STT said: "spent 150 on lunch" → "lunch"                                   |
| `merchant_canonical`| `text`         | Resolved canonical name ("Lunch Bistro") - matched against `merchant_aliases`              |
| `note`              | `text NULL`    | User-added note                                                                             |
| `transacted_at`     | `timestamptz`  | When it happened (defaults to `now()`)                                                       |
| `created_at`        | `timestamptz`  |                                                                                             |
| `source`            | `source`       | enum: `voice`, `manual`, `import`, `recurring`                                              |
| `confidence`        | `numeric(3,2)` | 0.00–1.00, STT parse confidence; null for manual                                            |
| `raw_transcript`    | `text NULL`    | Original utterance, kept for re-parse / improving models                                    |
| `clarified`         | `boolean`      | true if user was asked to confirm amount (resolved ambiguity)                               |
| `deleted_at`        | `timestamptz`  | Soft delete                                                                                  |

```sql
create type direction as enum ('expense','income','transfer');
create type source as enum ('voice','manual','import','recurring');

create table public.transactions (
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

create index transactions_user_time_idx
  on public.transactions(user_id, transacted_at desc)
  where deleted_at is null;

create index transactions_user_category_time_idx
  on public.transactions(user_id, category_id, transacted_at desc)
  where deleted_at is null;

create index transactions_merchant_canonical_idx
  on public.transactions(user_id, merchant_canonical)
  where merchant_canonical is not null;
```

### `merchant_aliases`

Maps user utterances ("lunch", "the corner cafe") to canonical names ("Lunch Bistro").

| Column          | Type        | Notes                              |
| --------------- | ----------- | ---------------------------------- |
| `id`            | `uuid PK`   |                                    |
| `user_id`       | `uuid FK`   |                                    |
| `alias`         | `text`      | Lowercased, trimmed phrase         |
| `canonical`     | `text`      | Resolved name + default category   |
| `category_id`   | `uuid FK`   | Default category for this merchant |
| `use_count`     | `int`       | Increased on every match            |
| `last_used_at`  | `timestamptz`|                                   |

```sql
create table public.merchant_aliases (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  alias        text not null,
  canonical    text not null,
  category_id  uuid references public.categories(id) on delete set null,
  use_count    int not null default 0,
  last_used_at timestamptz not null default now(),
  unique (user_id, alias)
);
```

### `attachments`

Audio memo, screenshot, or receipt for a transaction.

| Column          | Type        | Notes                            |
| --------------- | ----------- | -------------------------------- |
| `id`            | `uuid PK`   |                                  |
| `transaction_id`| `uuid FK`   | → `transactions.id`              |
| `kind`          | `attach_kind`| enum: `audio`, `image`, `receipt` |
| `storage_path`  | `text`      | Supabase storage path            |
| `duration_ms`   | `int NULL`  | For audio                        |
| `mime`          | `text`      |                                  |
| `size_bytes`    | `int`       |                                  |
| `created_at`    | `timestamptz`|                                 |

```sql
create type attach_kind as enum ('audio','image','receipt');
create table public.attachments (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  kind           attach_kind not null,
  storage_path   text not null,
  duration_ms    int,
  mime           text not null,
  size_bytes     int not null,
  created_at     timestamptz not null default now()
);
```

### `recurring_rules`

Inferred from "I get coffee every morning". Used to pre-create `source = 'recurring'`
rows.

| Column          | Type             | Notes                                              |
| --------------- | ---------------- | -------------------------------------------------- |
| `id`            | `uuid PK`        |                                                    |
| `user_id`       | `uuid FK`        |                                                    |
| `merchant_canonical` | `text`       |                                                    |
| `category_id`   | `uuid FK`        |                                                    |
| `account_id`    | `uuid FK`        |                                                    |
| `amount_minor`  | `bigint`         |                                                    |
| `currency`      | `char(3)`        |                                                    |
| `interval`      | `recurrence`     | enum: `daily`, `weekly`, `biweekly`, `monthly`     |
| `interval_n`    | `int`            | Every Nth interval (e.g. every 2 weeks)            |
| `next_run_at`   | `timestamptz`    |                                                    |
| `is_paused`     | `boolean`        |                                                    |
| `created_at`    | `timestamptz`    |                                                    |

```sql
create type recurrence as enum ('daily','weekly','biweekly','monthly');
create table public.recurring_rules (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  merchant_canonical text not null,
  category_id       uuid references public.categories(id) on delete set null,
  account_id        uuid not null references public.accounts(id) on delete cascade,
  amount_minor      bigint not null,
  currency          char(3) not null,
  interval          recurrence not null,
  interval_n        int not null default 1,
  next_run_at       timestamptz not null,
  is_paused         boolean not null default false,
  created_at        timestamptz not null default now()
);
```

### `budgets`

Per-category caps for a given period.

| Column          | Type         | Notes                              |
| --------------- | ------------ | ---------------------------------- |
| `id`            | `uuid PK`    |                                    |
| `user_id`       | `uuid FK`    |                                    |
| `category_id`   | `uuid FK`    |                                    |
| `period_start`  | `date`       |                                    |
| `period_end`    | `date`       |                                    |
| `cap_minor`     | `bigint`     |                                    |

```sql
create table public.budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  category_id  uuid not null references public.categories(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  cap_minor    bigint not null,
  unique (user_id, category_id, period_start)
);
```

### `voice_sessions`

One row per "Hold to speak" session. Important for debugging STT and improving
the parser.

| Column        | Type          | Notes                                           |
| ------------- | ------------- | ----------------------------------------------- |
| `id`          | `uuid PK`     |                                                 |
| `user_id`     | `uuid FK`     |                                                 |
| `started_at`  | `timestamptz` |                                                 |
| `ended_at`    | `timestamptz NULL` |                                            |
| `transcript`  | `text NULL`   | Final STT text                                  |
| `parsed_intent`| `jsonb NULL` | `{ amount, merchant, category, confidence }`    |
| `outcome`     | `voice_outcome` | enum: `created`, `clarified`, `cancelled`, `failed` |
| `device`      | `text NULL`   | `iOS 18.1`, `Chrome 128`, etc.                  |
| `audio_path`  | `text NULL`   | Supabase storage path to the audio file         |

```sql
create type voice_outcome as enum ('created','clarified','cancelled','failed');
create table public.voice_sessions (
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
create index voice_sessions_user_time_idx
  on public.voice_sessions(user_id, started_at desc);
```

### `insights`

Generated rows produced by a nightly job. The mobile app reads from this
table for the Insights tab.

| Column         | Type         | Notes                                          |
| -------------- | ------------ | ---------------------------------------------- |
| `id`           | `uuid PK`    |                                                |
| `user_id`      | `uuid FK`    |                                                |
| `kind`         | `insight_kind` | enum: `spend_pattern`, `anomaly`, `trend`, `subscription_check`, `budget_alert` |
| `period_start` | `date`       |                                                |
| `period_end`   | `date`       |                                                |
| `payload`      | `jsonb`      | `{ title, text, hero_metric, cta }`            |
| `generated_at` | `timestamptz`|                                                |
| `dismissed_at` | `timestamptz NULL` |                                          |

```sql
create type insight_kind as enum
  ('spend_pattern','anomaly','trend','subscription_check','budget_alert');
create table public.insights (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  kind          insight_kind not null,
  period_start  date not null,
  period_end    date not null,
  payload       jsonb not null,
  generated_at  timestamptz not null default now(),
  dismissed_at  timestamptz
);
```

---

## Row-level security (Supabase)

Every user-owned table gets `enable row level security` and a policy that
restricts reads/writes to the authenticated user matching `user_id`.

```sql
-- helper
create function public.is_owner(uid uuid) returns boolean
  language sql stable as $$
    select uid = auth.uid()
$$;

-- one template per table; replace <table>
alter table public.transactions enable row level security;

create policy "own rows" on public.transactions
  for all
  using       (is_owner(user_id))
  with check  (is_owner(user_id));

-- categories are special: system rows (user_id IS NULL) are readable by everyone
alter table public.categories enable row level security;
create policy "read public + own" on public.categories
  for select using (user_id is null or is_owner(user_id));
create policy "insert own" on public.categories
  for insert with check (is_owner(user_id));
create policy "update own" on public.categories
  for update using (is_owner(user_id));
create policy "delete own" on public.categories
  for delete using (is_owner(user_id) and user_id is not null);
```

Apply the same `is_owner(<fk>)` pattern to `accounts`, `attachments`,
`recurring_rules`, `budgets`, `voice_sessions`, `merchant_aliases`, `insights`,
`transactions`, `users`.

---

## Common queries

### Recents (Home screen)

```sql
select t.id, t.amount_minor, t.currency, t.merchant_raw, t.merchant_canonical,
       t.transacted_at, t.source, t.direction,
       c.name as category, c.tone as category_tone, c.icon as category_icon
from   transactions t
left join categories c on c.id = t.category_id
where  t.user_id = auth.uid()
  and  t.deleted_at is null
order  by t.transacted_at desc
limit  20;
```

### Monthly trend (Insights chart)

```sql
select date_trunc('month', transacted_at) as month,
       sum(amount_minor) filter (where direction = 'expense') as spend_minor,
       sum(amount_minor) filter (where direction = 'income')  as income_minor
from   transactions
where  user_id = auth.uid()
  and  deleted_at is null
  and  transacted_at >= now() - interval '6 months'
group  by 1
order  by 1;
```

### Spending by category (Insights pie)

```sql
select c.name, c.tone,
       sum(t.amount_minor) as total_minor
from   transactions t
join   categories    c on c.id = t.category_id
where  t.user_id = auth.uid()
  and  t.deleted_at is null
  and  t.transacted_at >= date_trunc('month', now())
  and  t.direction = 'expense'
group  by c.name, c.tone
order  by total_minor desc;
```

### Merchant alias resolution (during STT)

```sql
select canonical, category_id, use_count
from   merchant_aliases
where  user_id = auth.uid()
  and  alias = lower(trim($1))
order  by use_count desc
limit  1;
```

### Budget check (for upcoming insight)

```sql
with spend as (
  select category_id, sum(amount_minor) as spent_minor
  from   transactions
  where  user_id = auth.uid()
    and  direction = 'expense'
    and  deleted_at is null
    and  transacted_at >= $1 and transacted_at < $2
  group  by category_id
)
select b.category_id, b.cap_minor, coalesce(s.spent_minor, 0) as spent_minor,
       (coalesce(s.spent_minor, 0)::numeric / b.cap_minor) as ratio
from   budgets b
left join spend s on s.category_id = b.category_id
where  b.user_id = auth.uid()
  and  b.period_start = $1 and b.period_end = $2;
```

### Recents search (Activity screen)

```sql
select id, merchant_raw, merchant_canonical, amount_minor, transacted_at, category_id
from   transactions
where  user_id = auth.uid()
  and  deleted_at is null
  and  (merchant_raw  ilike '%' || $1 || '%'
        or  coalesce(merchant_canonical,'') ilike '%' || $1 || '%')
order  by transacted_at desc
limit  50;
```

---

## Money, currency, time

- **Storage**: `bigint` minor units. `150.00 INR` → `15000`.
- **Never** use `numeric` / `float` for money in app code. Convert only at the
  boundary (API response formatter, UI input).
- **Timezone**: convert at the SQL boundary using `user.timezone`:

  ```sql
  select (transacted_at at time zone u.timezone)::date as local_day
  from transactions t, users u
  where u.id = t.user_id;
  ```

- **Display**: app side keeps `Intl.NumberFormat` per currency; the server
  never formats.

---

## Storage buckets (Supabase Storage)

| Bucket           | Privacy          | Purpose                                  |
| ---------------- | ---------------- | ---------------------------------------- |
| `voice-memos`    | private (per-user) | Raw audio from `voice_sessions`        |
| `receipts`       | private (per-user) | Scanned receipts / images              |
| `avatars`        | public-read, owner-write | User profile photos              |

Path convention: `{user_id}/{session_or_tx_id}.{ext}` so RLS policies can
verify ownership by prefix.

---

## Migration order

1. `users`, `categories`, `accounts` (foundations)
2. `transactions` + indexes
3. `merchant_aliases`, `attachments`
4. `recurring_rules`, `budgets`
5. `voice_sessions`
6. `insights`
7. RLS policies on all tables
8. Storage buckets + policies
9. Seed system categories (`user_id IS NULL`) in a 000-seed.sql migration.

---

## Why this shape?

- **`amount_minor` + `direction`**: lets you list, sort, and aggregate without
  branching on sign. The number is what the user said; the direction is the
  semantic role.
- **`merchant_raw` + `merchant_canonical`**: keeps the user's exact words for
  debugging and the system's resolved name for grouping. `merchant_aliases`
  is the join table that powers "lunch" → "Lunch Bistro" without losing the
  original phrase.
- **`source` + `confidence` + `raw_transcript`**: every voice row carries the
  evidence needed to re-parse or improve the model later. STT is the part
  most likely to be wrong, so we keep the raw signal.
- **`voice_sessions` as a first-class table**: even though most sessions
  produce one transaction, the session itself is the unit of UX. Knowing
  *outcome = 'failed'* is the difference between "user churned" and
  "user kept trying but the mic was broken on iOS 18.1".
- **`insights` cached as rows**: the mobile app reads a tiny table instead of
  recomputing SQL on every screen. Nightly job writes a few rows per user.
- **`soft delete` on `transactions`**: never `DELETE` money. `deleted_at` plus
  RLS keeps the audit trail.
- **No `numeric` for money**: `bigint` is faster, deterministic, and stores
  every value exactly. Display rounding is the only place we ever introduce
  a float.
