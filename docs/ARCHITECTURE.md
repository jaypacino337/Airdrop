# Architecture

## One process, one loop

`worker/src/index.ts` starts a Fastify server (health + read API) and a
`setTimeout` loop that runs a cycle every `CYCLE_INTERVAL_MS`. The next tick is
scheduled after the previous cycle finishes, so cycles never overlap. With
incomplete configuration the process boots into standby instead (readiness.ts)
and `/health` says exactly what is missing.

## A cycle, in order

`worker/src/cycle.ts`

| Step | Module | Notes |
| --- | --- | --- |
| 1. Holder index | `chain/indexer.ts` | Incremental: scans USTR Transfer logs from the last applied block to the chain head (chunked `eth_getLogs`) and folds the deltas into the `holders` table. New addresses get a `getCode` check so pools, routers and lockers can be excluded. |
| 2. Optional buyback | `services/swap.ts` | `disabled` by default — the treasury's reward-token balance IS the pot. `univ2` splits spendable native by the configured weights and swaps through a V2-compatible router, output measured from balance deltas. |
| 3. Read each pot | `chain/evm.ts` | `balanceOf(treasury)` for each reward token, so dust and skipped payouts roll forward automatically. |
| 4. Allocate | `core/allocate.ts` | Pure bigint function, run once per reward token against the same holder set — see below. |
| 5. Persist | `db/repo.ts` | Snapshot rows, a `cycle_rewards` row per token, and *pending* payout rows — all written before anything is signed. |
| 6. Distribute | `services/distributor.ts` | Sequential ERC-20 transfers (no nonce races), each awaited to 1 confirmation, up to `MAX_PAYOUTS_PER_CYCLE` per run. |

## The allocation function

`core/allocate.ts` is pure and integer-only (`bigint` throughout) — see
`worker/test/allocate.test.ts`.

```
eligible = holders with balance >= MIN, minus excluded wallets & contracts
cap      = pot * MAX_WALLET_SHARE_BPS / 10000

repeat:
  anyone whose pro-rata share of the remaining budget exceeds `cap`
  is fixed at `cap` and removed from the pool
until nobody new exceeds the cap

everyone left splits the remaining budget pro-rata by balance
```

The loop matters: capping the largest wallet raises everyone else's share,
which can push the next wallet over the line. Rounding is always down, so the
sum of allocations never exceeds the pot; the remainder stays in the treasury
and joins the next cycle.

If `eligible_count * cap < 100%` the cap is mathematically unsatisfiable; the
function sets `capRelaxed`, falls back to pure pro-rata and the reason is
recorded on the cycle row.

## Idempotency

The `(cycle_id, owner, token)` unique constraint on `payouts` is the
idempotency key.

1. Rows are inserted as `pending` before any signing.
2. A transfer is sent, the hash is written and the row moves to `sent`.
3. On confirmation it becomes `confirmed`.

If the engine dies at any point, the next cycle picks up `pending`, `failed`
and `sent` rows; any row with a hash is checked against the chain first
(`getTransactionReceipt`), so a transfer that actually landed is never sent
twice — per wallet AND per reward token.

## The website

`web/` is a Next.js app with no client-side database access. Its API routes
query Supabase server-side with the anon key against RLS-protected tables and
read-only views. The browser only ever sees aggregate JSON.

- `/` — landing page: rules, mechanics, wallet lookup.
- `/dashboard` — live feed: counters, distribution history with explorer
  links, the latest snapshot, recent payouts.

## Why Supabase and not just the chain

Chain state answers "what is true now". The ledger answers "what did the
engine do, and why" — including cycles where it deliberately did nothing.
That is what makes the distribution auditable by anyone rather than only
reconstructible by whoever runs it.
