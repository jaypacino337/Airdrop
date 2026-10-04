-- =============================================================================
-- URANIUM STRATEGY — move an existing EVM (Robinhood Chain) ledger aside
-- before installing the Solana schema.
--
--   1. Run THIS file in Supabase → SQL Editor.
--   2. Then run supabase/schema.sql.
--
-- Nothing is deleted. The EVM tables (0x addresses, wei amounts, tx hashes)
-- move into the `evm_archive` schema together with their indexes, sequences
-- and policies, so the history stays queryable but the website and engine
-- only ever see Solana rows. The archive schema is not exposed through the
-- API (it is not in Supabase's exposed schemas list).
--
-- Safe to re-run: every step checks first. A fresh project can skip this file.
-- =============================================================================

create schema if not exists evm_archive;
revoke all on schema evm_archive from anon, authenticated;

-- Views read the old columns; they are recreated by schema.sql.
drop view if exists public.airdrop_stats;
drop view if exists public.reward_totals;
drop view if exists public.leaderboard;

do $$
declare
  t text;
begin
  -- Only an EVM-era table is moved: it has the columns the Solana schema renamed.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'cycles' and column_name = 'native_spent_wei') then
    foreach t in array array['events', 'payouts', 'snapshot_holders', 'cycle_rewards', 'holders', 'indexer_state', 'cycles'] loop
      if to_regclass('public.' || t) is not null and to_regclass('evm_archive.' || t) is null then
        execute format('alter table public.%I set schema evm_archive', t);
      end if;
    end loop;
  end if;
  -- The EVM holder index has no Solana equivalent (snapshots are taken from
  -- the chain every cycle), so archive it even on a half-migrated project.
  foreach t in array array['holders', 'indexer_state'] loop
    if to_regclass('public.' || t) is not null and to_regclass('evm_archive.' || t) is null then
      execute format('alter table public.%I set schema evm_archive', t);
    end if;
  end loop;
end $$;
