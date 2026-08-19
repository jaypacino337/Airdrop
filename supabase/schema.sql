-- =============================================================================
-- Trump Strategy — Supabase schema
-- Run once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: every statement is idempotent.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- cycles: one row per 5-minute run
-- ---------------------------------------------------------------------------
create table if not exists public.cycles (
  id                uuid primary key default gen_random_uuid(),
  status            text not null default 'running'
                    check (status in ('running','completed','failed','skipped')),
  dry_run           boolean not null default false,

  started_at        timestamptz not null default now(),
  finished_at       timestamptz,

  -- claim leg
  claim_signature   text,
  claimed_lamports  bigint not null default 0,

  -- buyback leg (per-token detail lives in cycle_rewards)
  swap_provider     text,
  sol_spent_lamports bigint not null default 0,

  -- distribution leg
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
-- snapshot_holders: the holder snapshot a cycle distributed against
-- ---------------------------------------------------------------------------
create table if not exists public.snapshot_holders (
  id             bigserial primary key,
  cycle_id       uuid not null references public.cycles(id) on delete cascade,
  owner          text not null,
  balance_raw    numeric(40,0) not null,
  balance_ui     double precision not null,
  share_bps      integer not null default 0,
  capped         boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (cycle_id, owner)
);

create index if not exists snapshot_holders_owner_idx on public.snapshot_holders (owner);
create index if not exists snapshot_holders_cycle_idx on public.snapshot_holders (cycle_id);

-- ---------------------------------------------------------------------------
-- cycle_rewards: one row per (cycle, reward token). Each token gets its own
-- slice of the claimed SOL, its own buy and its own distribution.
-- ---------------------------------------------------------------------------
create table if not exists public.cycle_rewards (
  id                 bigserial primary key,
  cycle_id           uuid not null references public.cycles(id) on delete cascade,
  mint               text not null,
  symbol             text not null,
  weight_bps         integer not null,
  sol_spent_lamports bigint not null default 0,
  swap_signature     text,
  swap_provider      text,
  bought_raw         numeric(40,0) not null default 0,
  distributed_raw    numeric(40,0) not null default 0,
  payout_count       integer not null default 0,
  decimals           smallint not null default 0,
  note               text,
  created_at         timestamptz not null default now(),
  unique (cycle_id, mint)
);

create index if not exists cycle_rewards_cycle_idx on public.cycle_rewards (cycle_id);
create index if not exists cycle_rewards_mint_idx on public.cycle_rewards (mint);

-- ---------------------------------------------------------------------------
-- payouts: one row per (cycle, wallet, reward token). The unique key is the
-- idempotency key that makes a crashed / restarted worker safe to resume.
-- ---------------------------------------------------------------------------
create table if not exists public.payouts (
  id           bigserial primary key,
  cycle_id     uuid not null references public.cycles(id) on delete cascade,
  owner        text not null,
  mint         text not null,
  symbol       text not null default '',
  amount_raw   numeric(40,0) not null,
  status       text not null default 'pending'
               check (status in ('pending','sent','confirmed','failed','skipped')),
  signature    text,
  attempts     integer not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  unique (cycle_id, owner, mint)
);

create index if not exists payouts_owner_idx on public.payouts (owner);
create index if not exists payouts_mint_idx on public.payouts (mint);
create index if not exists payouts_status_idx on public.payouts (status);
create index if not exists payouts_created_at_idx on public.payouts (created_at desc);

-- ---------------------------------------------------------------------------
-- events: structured operational log, surfaced on the site's activity feed
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
  (select count(*) from public.cycles where status = 'completed')            as completed_cycles,
  (select coalesce(sum(claimed_lamports), 0) from public.cycles)             as total_claimed_lamports,
  (select coalesce(sum(sol_spent_lamports), 0) from public.cycles)           as total_sol_spent_lamports,
  (select count(*) from public.payouts where status = 'confirmed')           as total_payouts,
  (select count(distinct owner) from public.payouts where status = 'confirmed') as unique_recipients,
  (select max(finished_at) from public.cycles where status = 'completed')    as last_completed_at,
  (select eligible_count from public.cycles
     where status = 'completed' order by started_at desc limit 1)            as last_eligible_count;

-- Totals per reward token. Amounts in different decimals must never be summed
-- together, so everything token-denominated is grouped by mint.
create or replace view public.reward_totals as
select
  p.mint,
  max(p.symbol)                    as symbol,
  sum(p.amount_raw)::numeric(40,0) as distributed_raw,
  count(*)                         as payout_count,
  count(distinct p.owner)          as recipient_count,
  max(p.confirmed_at)              as last_payout_at
from public.payouts p
where p.status = 'confirmed'
group by p.mint;

create or replace view public.leaderboard as
select
  owner,
  mint,
  max(symbol)                    as symbol,
  sum(amount_raw)::numeric(40,0) as total_received_raw,
  count(*)                       as payout_count,
  max(confirmed_at)              as last_payout_at
from public.payouts
where status = 'confirmed'
group by owner, mint
order by total_received_raw desc;

-- ---------------------------------------------------------------------------
-- Row level security
-- The worker uses the service-role key (bypasses RLS). The website uses the
-- anon key and gets read-only access to public data.
-- ---------------------------------------------------------------------------
alter table public.cycles           enable row level security;
alter table public.cycle_rewards    enable row level security;
alter table public.snapshot_holders enable row level security;
alter table public.payouts          enable row level security;
alter table public.events           enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'cycles' and policyname = 'public read cycles') then
    create policy "public read cycles" on public.cycles for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'cycle_rewards' and policyname = 'public read cycle_rewards') then
    create policy "public read cycle_rewards" on public.cycle_rewards for select using (true);
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
