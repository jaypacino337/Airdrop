# Architecture

## One process, one loop

`worker/src/index.ts` starts a Fastify server (health check + read API) and a
`setTimeout` loop that runs a cycle every `CYCLE_INTERVAL_MS`. The next tick is
scheduled after the previous cycle finishes, so a slow cycle delays the next one
rather than overlapping with it. `runCycle` additionally refuses to start while
another is in flight.

## A cycle, in order

`worker/src/cycle.ts`

| Step | Module | Notes |
| --- | --- | --- |
| 1. Claim creator fees | `services/claim.ts` | PumpPortal's local-transaction API by default: it returns an unsigned transaction that the worker signs itself, so the key never leaves the process. `CLAIM_PROVIDER=onchain` builds the instruction directly (experimental — verify against the current IDL). |
| 2. Buy each reward token | `services/swap.ts` | The spendable SOL is split by the configured weights (50/50 for WLFI + TRUMP) and each slice is bought separately: Jupiter first, PumpPortal as fallback. The amount bought is measured from the token balance before and after, never from the quote. |
| 3. Read each pot | `chain/transfer.ts` | The distributor's entire balance of that reward token, so last cycle's dust is included. |
| 4. Snapshot | `chain/holders.ts` | Helius `getTokenAccounts`, paginated, summed per owner; `getProgramAccounts` fallback. Off-curve owners (pools, vaults, bonding curves) are dropped. |
| 5. Allocate | `core/allocate.ts` | Pure function, no I/O — run once per reward token against the same snapshot. See below. |
| 6. Persist | `db/repo.ts` | Snapshot rows, a `cycle_rewards` row per token, and *pending* payout rows — all written before anything is signed. |
| 7. Distribute | `services/distributor.ts` | Per token: batches of `TRANSFERS_PER_TX` recipients per transaction, each simulated, sent and confirmed before the next batch. |

Every leg updates the cycle row as it completes, so a crashed cycle leaves a
readable trail of exactly how far it got.

## The allocation function

`core/allocate.ts` is deliberately pure and integer-only (`bigint` throughout),
which is what makes it testable — see `worker/test/allocate.test.ts`.

```
eligible   = holders with balance >= MIN, minus excluded wallets
cap        = pot * MAX_WALLET_SHARE_BPS / 10000

repeat:
  anyone whose pro-rata share of the remaining budget exceeds `cap`
  is fixed at `cap` and removed from the pool
until nobody new exceeds the cap

everyone left splits the remaining budget pro-rata by balance
```

The loop matters: capping the largest wallet increases everyone else's share,
which can push the second largest over the line. A single pass would leave the
cap violated.

Rounding is always down, so allocations can never exceed the pot. The remainder
stays in the distributor and joins the next cycle's pot.

If `eligible_count * cap < 100%` the cap is mathematically unsatisfiable; the
function sets `capRelaxed` and falls back to pure pro-rata rather than silently
distributing less than the pot.

## Idempotency

The `(cycle_id, owner, mint)` unique constraint on `payouts` is the idempotency
key — per wallet *and* per reward token, so a failure distributing one token can
never cause a double-send of the other.

1. Rows are inserted as `pending` before any signing.
2. A batch is sent, the signature is written and the rows move to `sent`.
3. On confirmation they become `confirmed`.

If the worker dies at any point, the next cycle picks up `pending` and `failed`
rows, checks any signature it already has against the chain (`searchTransaction-
History: true`), marks the ones that actually landed as confirmed, and only then
resends the rest.

## Token programs

Every mint is resolved at boot (`chain/mint.ts`): decimals, owning token
program, and whether the mint carries a Token-2022 transfer hook or transfer fee.
Transfers are built against the resolved program, and hook-aware instructions are
used when the mint declares a hook. Recipient token accounts are created with the
idempotent instruction, and only when they are actually missing, which keeps both
fees and transaction size down.

## The website

`web/` is a Next.js app with no client-side database access at all. Its API
routes (`app/api/*`) query Supabase server side with the anon key against
read-only views and RLS-protected tables. The browser only ever sees aggregate
JSON.

- `/` — landing page: rules, mechanics, wallet lookup.
- `/dashboard` — live counters, distribution history with Solscan links, the
  latest snapshot, recent payouts.

Both poll their endpoints; there is no websocket to keep alive and nothing to
hydrate from the chain in the browser.

## Why Supabase and not just the chain

Chain state answers "what is true now". The ledger answers "what did the engine
do, and why" — including the cycles where it deliberately did nothing. That is
what makes the distribution auditable by anyone rather than only reconstructible
by whoever runs it.
