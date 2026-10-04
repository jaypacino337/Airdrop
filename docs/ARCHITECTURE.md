# Architecture

## One process, one loop

`worker/src/index.ts` starts a Fastify server (health + read API) and a
`setTimeout` loop that runs a cycle every `CYCLE_INTERVAL_MS`. The next tick is
scheduled after the previous cycle finishes, so cycles never overlap. With
incomplete configuration the process boots into standby instead (readiness.ts)
and `/health` says exactly what is missing.

## A cycle, in order

`worker/src/cycle.ts`. The chain is Solana. Everything chain-specific lives
in `worker/src/chain/` and the three `services/`; the allocation maths, the
ledger, the API and the scheduler are unchanged from the EVM version.

| Step | Module | Notes |
| --- | --- | --- |
| 1. Fee income | `services/fees.ts` | `FEE_CLAIM=pumpfun`: reads the pump.fun creator vault (bonding curve) and the PumpSwap creator-vault WSOL account, and claims via PumpPortal `collectCreatorFee` if they hold at least `MIN_CLAIM_LAMPORTS`. PumpPortal builds the transaction and the engine signs it locally (no API key). It refuses a transaction whose fee payer isn't the treasury. A failed claim is a note on the cycle, never a failed cycle. |
| 2. Optional buyback | `services/swap.ts` | `disabled` by default: the treasury's reward-token balance *is* the pot. With `pumpportal`, spendable SOL (balance − `NATIVE_RESERVE_LAMPORTS`) is split by weight and spent with PumpPortal `buy`. The amount bought is measured from the balance delta. |
| 3. Holder snapshot | `chain/snapshot.ts` | A full scan at one slot. It uses Helius `getTokenAccounts` when `HELIUS_API_KEY` is set, otherwise `getProgramAccounts` on the mint's own token program (SPL or Token-2022). Balances are summed per owner and frozen accounts skipped. The incinerator, the pump.fun bonding curve and every **off-curve owner (PDA)** are excluded: pools, curves, lockers, vaults. It refuses the public RPC. There's no stored holder index: Solana accounts carry current balances, so every cycle starts from the chain. |
| 4. Read each pot | `cycle.ts` | Treasury's balance of each reward mint **minus payouts already staged but not yet confirmed**, so nothing is promised twice. |
| 5. Allocate | `core/allocate.ts` | A pure bigint function, unchanged. It runs once per reward token against the same holder set (see below). |
| 6. Persist | `db/repo.ts` | Snapshot rows, a `cycle_rewards` row per token, and *pending* payout rows. All are written before anything is signed. |
| 7. Distribute | `services/distributor.ts` | `PAYOUT_BATCH_SIZE` (default 4) transfers per transaction. Each one is an idempotent create of the recipient's associated token account plus `transferChecked` with the mint's token program. A pre-flight check postpones the run if the treasury can't cover fees and new-account rent (~0.002 SOL each). At most `MAX_PAYOUTS_PER_CYCLE` rows per run. |

## The allocation function

`core/allocate.ts` is pure and integer-only (`bigint` throughout) — see
`worker/test/allocate.test.ts`.

```
eligible = holders with balance >= MIN, minus excluded wallets & PDAs
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
2. A batch is built and signed. Its signature (`tx_id`) and its blockhash's
   `last_valid_height` are written to every row in the batch, as `sent`,
   **before** the transaction is broadcast.
3. On confirmation the rows become `confirmed`. If the RPC rejects the
   transaction in preflight, or it lands and fails, the rows become `failed`
   with no `tx_id` and are resent next cycle. Nothing moved.
4. If the outcome is unknown (timeout, dropped connection, crash), the rows
   stay `sent` with their signature.

Every cycle starts by reconciling rows that carry a `tx_id`
(`getSignatureStatuses` with history):

- confirmed on chain → marked `confirmed`, never resent
- failed on chain → resent
- not found, and the block height is past `last_valid_height` → it can never
  land, so it is resent
- not found yet, still within its validity window → left alone until the next
  cycle

A crash between broadcast and confirmation therefore can't pay anyone twice.
This is per wallet and per reward token. It's covered by unit tests
(`worker/test/distributor.test.ts`) and by the localnet end-to-end run, which
crashes a real broadcast on purpose (`npm run e2e:localnet --workspace worker`).

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
