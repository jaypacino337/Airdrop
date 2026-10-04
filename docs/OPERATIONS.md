# Operations

## Daily checks

```bash
curl -s https://<worker>/health | jq
curl -s https://<worker>/api/stats | jq
```

`/health` reports readiness, whether a cycle is currently running, and when the
next one is due. `"status": "standby"` means the worker deployed fine but is
still missing configuration — `missing` names each variable. If `nextRunAt` is in the past by more than a cycle, the worker is wedged —
restart the service.

## Reading a cycle

Every cycle writes one row in `cycles` with each leg recorded as it happens:

| Column | Meaning |
| --- | --- |
| `fees_claimed_raw` / `claim_tx` | lamports the pump.fun creator-fee claim actually produced (a balance delta, not a quote), and its signature |
| `native_spent_raw` | total lamports spent buying across all reward tokens |
| `chain_height` | the slot the holder snapshot was taken at |
| `payout_count` / `tx_count` | payouts confirmed and transactions sent across all reward tokens |
| `eligible_count` / `capped_count` | how many wallets qualified, and how many hit the 4% ceiling |
| `note` | why a leg was skipped (nothing to claim, below the swap minimum, cap relaxed…) |
| `error` | set only on `status = failed` |

`payouts` is the authoritative record of what was sent: one row per wallet per
cycle, with the signature and confirmation state.

## Common situations

**Cycles complete but distribute nothing.** Normal when the coin has no trading
volume: no fees to claim means nothing to buy. Check `note` on the cycle row and
the per-token `cycle_rewards` rows.

**`below MIN_SWAP_LAMPORTS, rolls over`.** Fees are accruing
more slowly than the reserve threshold. Either lower `MIN_SWAP_LAMPORTS` or leave
it — unspent native carries into the next cycle.

**A payout batch failed.** Rejected or reverted batches become `failed` with
no signature and are resent next cycle. Batches with an unknown outcome stay
`sent` with their signature. The next cycle looks that signature up on chain:
if it landed, the rows are marked confirmed; if its blockhash has expired
without landing, they're resent; otherwise they're left alone until it's
decided. Nothing is ever sent twice.

**`payouts postponed … treasury has X SOL, needs ~Y`.** The treasury can't
cover transaction fees plus rent for new recipient token accounts. Top it up
with SOL; the rows stay pending and go out next cycle.

**`fees: creator fees below MIN_CLAIM_LAMPORTS`.** Normal at low volume. The
fees wait in the pump.fun vault until there's enough to be worth a claim.

**`per-wallet cap relaxed`.** Fewer than 25 wallets qualified, so 4% each cannot
add up to a whole drop. The cycle distributes pro-rata instead and records the
reason. It resolves itself as the holder base grows.

**Transactions don't land under congestion.** Raise `PRIORITY_MICROLAMPORTS`
(payouts) or `PUMPPORTAL_PRIORITY_FEE_SOL` (claims and buys). Lower
`PAYOUT_BATCH_SIZE` if simulation complains about transaction size or compute.

**`Holder scans need a dedicated RPC`.** `SOLANA_RPC_URL` points at the public
endpoint, which rejects `getProgramAccounts`. Use Helius, Triton or QuickNode,
or set `HELIUS_API_KEY` to snapshot through Helius `getTokenAccounts`.

## Changing the rules

`MIN_ELIGIBLE_TOKENS` and `MAX_WALLET_SHARE_BPS` take effect on the next cycle —
no redeploy of the worker is needed beyond the variable change. Update the
matching `NEXT_PUBLIC_*` values on the web service and redeploy it, or the site
will keep describing the old rules.

## Pausing

- `DRY_RUN=true` — keeps snapshotting and computing, moves no funds.
- 
- `SWAP_PROVIDER=disabled` — stop buying, keep distributing what is held.
- Scale the service to zero replicas to stop entirely.

## Manual run

```bash
curl -X POST https://<worker>/api/admin/run-cycle -H "Authorization: Bearer $ADMIN_TOKEN"
```

Refuses with `409` if a cycle is already in flight.

## Retention

At 5-minute cycles the ledger grows by ~288 cycles a day. `snapshot_holders` is
bounded per cycle by `SNAPSHOT_PERSIST_LIMIT` (200 by default), but `payouts`
grows with your holder count. To keep a Supabase free project comfortable, run
this monthly (Supabase → SQL Editor, or as a scheduled function):

```sql
-- Keep 60 days of detail. Cycle totals are preserved either way.
delete from public.snapshot_holders
 where created_at < now() - interval '60 days';

delete from public.payouts
 where created_at < now() - interval '60 days'
   and status in ('confirmed', 'skipped');

delete from public.events
 where created_at < now() - interval '30 days'
   and level in ('debug', 'info');
```

## Security

- The service-role key and the treasury private key live only in the worker's
  Railway variables. The website only ever receives the anon key, server side.
- `ADMIN_TOKEN` guards the only non-read endpoint. Rotate it if it leaks.
- Nothing in the codebase logs a private key; the wallet module deliberately
  never stringifies its secret.
- If the creator wallet is ever compromised, move the coin's creator authority
  and replace `TREASURY_SECRET_KEY` — the ledger stays intact.
