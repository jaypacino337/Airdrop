# Deploying

Three pieces: a Supabase project (the ledger), a Railway worker (the engine) and
a Railway web service (the site). Roughly 20 minutes end to end.

---

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. SQL Editor → New query → paste all of `supabase/schema.sql` → **Run**.
   It is idempotent, so re-running it later to pick up changes is safe.
3. Project settings → API. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (worker only — this key
     bypasses row level security, so it never goes near the browser)
   - **anon** key → `SUPABASE_ANON_KEY` (website only, read-only)

## 2. Helius

1. Create a key at [dashboard.helius.dev](https://dashboard.helius.dev).
2. Copy it into `HELIUS_API_KEY`. The worker derives its RPC URL from it and uses
   Helius's `getTokenAccounts` for holder snapshots, falling back to a plain
   `getProgramAccounts` scan on any RPC if that method is unavailable.

A free key is enough to start; a cycle does roughly a dozen RPC calls plus one
call per 1,000 holders.

## 3. The wallet

`CREATOR_PRIVATE_KEY` must be the wallet that **created the MRNA coin on
pump.fun** — only that wallet can claim its creator fees. The same wallet buys
MRNAx and sends the airdrop.

- Phantom → Settings → Export private key gives you the base58 form.
- `solana-keygen` gives you the JSON byte array. Both are accepted.
- Fund it with a little SOL (0.05–0.1) for transaction fees and the rent on
  recipient token accounts.
- Put it in Railway's variables only. Never commit it, never paste it in chat.

## 4. Mints

- `PROJECT_TOKEN_MINT` — the MRNA mint address from pump.fun.
- `REWARD_TOKEN_MINT` — the MRNAx mint. Look it up on Jupiter or the issuer's
  site and paste the exact address; the worker reads its decimals and token
  program at boot and refuses to start if the mint does not exist.

MRNAx is a Token-2022 asset, so the worker resolves the owning token program for
both mints and builds transfers accordingly (including transfer-hook aware
transfers when the mint declares one).

## 5. Railway — worker service

1. New project → Deploy from GitHub repo → this repository.
2. Service settings → **Config as code** → `railway.worker.json`.
   That points Railway at `Dockerfile.worker` and sets the `/health` check.
3. Variables → paste the contents of `.env.example` and fill them in. Minimum:

   ```
   HELIUS_API_KEY=...
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   CREATOR_PRIVATE_KEY=...
   PROJECT_TOKEN_MINT=...
   REWARD_TOKEN_MINT=...
   DRY_RUN=true
   ADMIN_TOKEN=<openssl rand -hex 32>
   ```

4. Settings → **Replicas: 1**. This matters: two replicas share one wallet and
   would each run their own cycle.
5. Deploy. Watch the logs for `engine ready`, then `cycle finished`.
6. Check the Supabase `cycles` table. When the eligible counts and allocations
   look right, set `DRY_RUN=false` and redeploy.

## 6. Railway — web service

1. In the same project: New → GitHub repo → the same repository.
2. Service settings → **Config as code** → `railway.web.json`.
3. Variables → from `web/.env.example`:

   ```
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   NEXT_PUBLIC_PROJECT_TOKEN_MINT=...
   NEXT_PUBLIC_REWARD_TOKEN_MINT=...
   NEXT_PUBLIC_MIN_ELIGIBLE_TOKENS=500000
   NEXT_PUBLIC_MAX_WALLET_SHARE_BPS=400
   NEXT_PUBLIC_CYCLE_INTERVAL_MS=300000
   ```

   `NEXT_PUBLIC_*` values are baked in at build time — after changing one you
   must redeploy, not just restart.
4. Settings → Networking → Generate domain (or attach your own).

The site reads Supabase directly through its own server-side API routes, so it
does not need the worker to be publicly reachable.

## 7. Verify

```bash
curl https://<worker-domain>/health
curl https://<worker-domain>/api/config
curl -X POST https://<worker-domain>/api/admin/run-cycle \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Then open the site's `/dashboard`: the countdown, the last distribution and the
holder snapshot should all be populated.

## Costs

| Piece | Free tier | What pushes you past it |
| --- | --- | --- |
| Railway | Trial credit, then usage-based | Two always-on services is a few dollars a month |
| Supabase | 500 MB | Row volume — see the retention job in [Operations](OPERATIONS.md) |
| Helius | 1M credits/month | Very large holder counts polled every 5 minutes |
| Solana | — | ~0.000005 SOL per transfer batch, plus ~0.002 SOL rent per brand-new recipient account |
