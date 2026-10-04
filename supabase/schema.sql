-- =============================================================================
-- URANIUM STRATEGY ($USTR) — Supabase schema
-- Run once in Supabase → SQL Editor → New query → Run. Idempotent.
--
-- Pivoting an old deployment: this replaces the earlier schemas. Drop the old
-- tables first (cycles, cycle_rewards, snapshot_holders, payouts, events).
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- cycles: one row per 5-minute distribution run
-- ---------------------------------------------------------------------------
create table if not exists public.cycles (
  id                uuid primary key default gen_random_uuid(),
  status            text not null default 'running'
                    check (status in ('running','completed','failed','skipped')),
  dry_run           boolean not null default false,

  started_at        timestamptz not null default now(),
  finished_at       timestamptz,

  block_number      bigint,                     -- chain head at snapshot time
  native_spent_wei  numeric(78,0) not null default 0,
  swap_provider     text,

  holder_count      integer not null default 0,
  eligible_count    integer not null default 0,
  capped_count      integer not null default 0,
  payout_count      integer not null default 0,
  tx_count          integer not null default 0,

  note              text,
  error             text
);

create index if not exists cycles_started_at_idx on public.cycles (started_at desc);
create index if not exists cycles_status_idx on public.cycles (status);

-- ---------------------------------------------------------------------------
-- cycle_rewards: one row per (cycle, reward token)
-- ---------------------------------------------------------------------------
create table if not exists public.cycle_rewards (
  id                 bigserial primary key,
  cycle_id           uuid not null references public.cycles(id) on delete cascade,
  token              text not null,             -- ERC-20 address, lowercase
  symbol             text not null,
  weight_bps         integer not null,
  decimals           smallint not null default 18,
  native_spent_wei   numeric(78,0) not null default 0,
  swap_tx            text,
  bought_raw         numeric(78,0) not null default 0,
  pot_raw            numeric(78,0) not null default 0,
  distributed_raw    numeric(78,0) not null default 0,
  payout_count       integer not null default 0,
  note               text,
  created_at         timestamptz not null default now(),
  unique (cycle_id, token)
);

create index if not exists cycle_rewards_cycle_idx on public.cycle_rewards (cycle_id);
create index if not exists cycle_rewards_token_idx on public.cycle_rewards (token);

-- ---------------------------------------------------------------------------
-- holders: the live USTR balance index, maintained incrementally from
-- Transfer logs. is_contract marks pools/routers/lockers, which never
-- receive the airdrop.
-- ---------------------------------------------------------------------------
create table if not exists public.holders (
  address     text primary key,                 -- lowercase 0x address
  balance_raw numeric(78,0) not null default 0,
  is_contract boolean,                          -- null = not yet checked
  updated_at  timestamptz not null default now()
);

create index if not exists holders_balance_idx on public.holders (balance_raw desc);

create table if not exists public.indexer_state (
  id             integer primary key default 1 check (id = 1),
  token_address  text not null,
  last_block     bigint not null default 0,
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- snapshot_holders: what the last cycles distributed against (site display)
-- ---------------------------------------------------------------------------
create table if not exists public.snapshot_holders (
  id          bigserial primary key,
  cycle_id    uuid not null references public.cycles(id) on delete cascade,
  owner       text not null,
  balance_raw numeric(78,0) not null,
  balance_ui  double precision not null,
  share_bps   integer not null default 0,
  capped      boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (cycle_id, owner)
);

create index if not exists snapshot_holders_owner_idx on public.snapshot_holders (owner);
create index if not exists snapshot_holders_cycle_idx on public.snapshot_holders (cycle_id);

-- ---------------------------------------------------------------------------
-- payouts: one row per (cycle, wallet, reward token) — written BEFORE any
-- transaction is signed. The unique key is the idempotency key that makes a
-- crashed or restarted engine resume instead of double-paying.
-- ---------------------------------------------------------------------------
create table if not exists public.payouts (
  id           bigserial primary key,
  cycle_id     uuid not null references public.cycles(id) on delete cascade,
  owner        text not null,
  token        text not null,
  symbol       text not null default '',
  amount_raw   numeric(78,0) not null,
  status       text not null default 'pending'
               check (status in ('pending','sent','confirmed','failed','skipped')),
  tx_hash      text,
  attempts     integer not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (cycle_id, owner, token)
);

create index if not exists payouts_owner_idx on public.payouts (owner);
create index if not exists payouts_token_idx on public.payouts (token);
create index if not exists payouts_status_idx on public.payouts (status);
create index if not exists payouts_created_at_idx on public.payouts (created_at desc);

-- ---------------------------------------------------------------------------
-- events: structured operational log
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id         bigserial primary key,
  cycle_id   uuid references public.cycles(id) on delete cascade,
  level      text not null default 'info' check (level in ('debug','info','warn','error')),
  message    text not null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_created_at_idx on public.events (created_at desc);

-- ---------------------------------------------------------------------------
-- Aggregates used by the website
-- ---------------------------------------------------------------------------
create or replace view public.airdrop_stats as
select
  (select count(*) from public.cycles where status = 'completed')                as completed_cycles,
  (select coalesce(sum(native_spent_wei), 0) from public.cycles)                 as total_native_spent_wei,
  (select count(*) from public.payouts where status = 'confirmed')               as total_payouts,
  (select count(distinct owner) from public.payouts where status = 'confirmed') as unique_recipients,
  (select max(finished_at) from public.cycles where status = 'completed')        as last_completed_at,
  (select eligible_count from public.cycles
     where status = 'completed' order by started_at desc limit 1)                as last_eligible_count;

-- Totals per reward token: amounts in different decimals are never summed.
create or replace view public.reward_totals as
select
  p.token,
  max(p.symbol)                    as symbol,
  sum(p.amount_raw)::numeric(78,0) as distributed_raw,
  count(*)                         as payout_count,
  count(distinct p.owner)          as recipient_count,
  max(p.confirmed_at)              as last_payout_at
from public.payouts p
where p.status = 'confirmed'
group by p.token;

create or replace view public.leaderboard as
select
  owner,
  token,
  max(symbol)                      as symbol,
  sum(amount_raw)::numeric(78,0)   as total_received_raw,
  count(*)                         as payout_count,
  max(confirmed_at)                as last_payout_at
from public.payouts
where status = 'confirmed'
group by owner, token
order by total_received_raw desc;

-- ---------------------------------------------------------------------------
-- Row level security: engine writes with the service role; site reads with
-- the anon key.
-- ---------------------------------------------------------------------------
alter table public.cycles            enable row level security;
alter table public.cycle_rewards     enable row level security;
alter table public.holders           enable row level security;
alter table public.indexer_state     enable row level security;
alter table public.snapshot_holders  enable row level security;
alter table public.payouts           enable row level security;
alter table public.events            enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'cycles' and policyname = 'public read cycles') then
    create policy "public read cycles" on public.cycles for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'cycle_rewards' and policyname = 'public read cycle_rewards') then
    create policy "public read cycle_rewards" on public.cycle_rewards for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'holders' and policyname = 'public read holders') then
    create policy "public read holders" on public.holders for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'snapshot_holders' and policyname = 'public read snapshot_holders') then
    create policy "public read snapshot_holders" on public.snapshot_holders for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'payouts' and policyname = 'public read payouts') then
    create policy "public read payouts" on public.payouts for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'events' and policyname = 'public read events') then
    create policy "public read events" on public.events for select using (true);
  end if;
end $$;

grant select on public.airdrop_stats to anon, authenticated;
grant select on public.reward_totals to anon, authenticated;
grant select on public.leaderboard   to anon, authenticated;
