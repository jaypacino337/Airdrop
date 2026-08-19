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
| `claimed_lamports` | SOL the creator-fee claim actually produced (measured as a balance delta, not a quote) |
| `sol_spent_lamports` | total SOL spent buying across all reward tokens |
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

**`swap: only 0.00x SOL spendable, below MIN_SWAP_LAMPORTS`.** Fees are accruing
more slowly than the reserve threshold. Either lower `MIN_SWAP_LAMPORTS` or leave
it — unspent SOL carries into the next cycle.

**A payout batch failed.** The rows stay `failed` and are retried on the next
cycle by `pendingPayouts`, after each signature is re-checked on chain so a
transaction that actually landed is never sent twice.

**`per-wallet cap relaxed`.** Fewer than 25 wallets qualified, so 4% each cannot
add up to a whole drop. The cycle distributes pro-rata instead and records the
reason. It resolves itself as the holder base grows.

**Transactions time out.** Raise `PRIORITY_FEE_MICROLAMPORTS`, or lower
`TRANSFERS_PER_TX` if simulation complains about transaction size.

**Helius rate limits.** The snapshot falls back to `getProgramAccounts`
automatically; it is slower but works on any RPC.

## Changing the rules

`MIN_ELIGIBLE_TOKENS` and `MAX_WALLET_SHARE_BPS` take effect on the next cycle —
no redeploy of the worker is needed beyond the variable change. Update the
matching `NEXT_PUBLIC_*` values on the web service and redeploy it, or the site
will keep describing the old rules.

## Pausing

- `DRY_RUN=true` — keeps snapshotting and computing, moves no funds.
- `CLAIM_PROVIDER=disabled` — stop claiming, keep distributing what is held.
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

- The service-role key and the creator private key live only in the worker's
  Railway variables. The website only ever receives the anon key, server side.
- `ADMIN_TOKEN` guards the only non-read endpoint. Rotate it if it leaks.
- Nothing in the codebase logs a private key; the wallet module deliberately
  never stringifies its secret.
- If the creator wallet is ever compromised, move the coin's creator authority
  and replace `CREATOR_PRIVATE_KEY` — the ledger stays intact.
