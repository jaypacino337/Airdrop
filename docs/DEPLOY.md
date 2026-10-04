# Deploying

Three pieces: a Supabase project (the ledger), a Railway engine, and the
website (Vercel or Railway). Roughly 15 minutes end to end.

## 1. Supabase

1. Create a project at supabase.com.
2. SQL Editor → New query → paste all of `supabase/schema.sql` → **Run**.
   **Upgrading the existing EVM (Robinhood Chain) project:** first run
   `supabase/migrations/001_evm_to_solana.sql`. It moves the old tables, with
   all their history, into a private `evm_archive` schema. Then run
   `schema.sql`. Both files are safe to re-run.
3. Project settings → API. Copy the Project URL, the **service_role** key
   (engine only) and the **anon** key (website only).

## 2. Railway — engine

1. New project → Deploy from GitHub repo → this repository.
2. Service settings → **Config as code** → `railway.worker.json`.
3. Variables — **these three give you a green deploy immediately**:

   ```
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   SOLANA_RPC_URL=...         # optional at this stage; a DEDICATED RPC (Helius etc.)
   ```

   The engine boots into **standby**: `/health` returns 200 and lists exactly
   what is still missing. Nothing crash-loops while you collect addresses.

4. Settings → **Replicas: 1**. Two engines share one wallet and would collide.
5. When you have them, add the rest and redeploy:

   ```
   TREASURY_SECRET_KEY=...              # Railway "sealed" variable; the pump.fun creator wallet
   PROJECT_TOKEN_MINT=...               # the USTR mint (base58)
   REWARD_TOKENS=URANIUM:<mint>:10000   # SPL or Token-2022
   HELIUS_API_KEY=...                   # optional, faster holder snapshots
   SOLANA_CLUSTER=mainnet-beta          # refuses any other cluster
   DRY_RUN=true
   ADMIN_TOKEN=<openssl rand -hex 32>
   ```

   The engine reads every mint on boot (it must be owned by the SPL Token or
   Token-2022 program) and checks the RPC's genesis hash against
   `SOLANA_CLUSTER`. A typo fails loudly instead of sending funds into the
   void.

6. Watch the logs for `engine ready`, then `cycle finished`. Check the
   `cycles` and `snapshot_holders` tables. When the numbers look right, set
   `DRY_RUN=false` and redeploy — that is when real transfers start.

Check what it is waiting for at any time:

```bash
curl -s https://<engine-domain>/health | jq
```

## 3. Website

**Vercel** (recommended): Add New → Project → this repo →
**Root Directory `web`** → paste the variables from `web/.env.example`
(minimum `SUPABASE_URL` + `SUPABASE_ANON_KEY`) → Deploy. If the project was
imported before this branch existed, set the Production Branch to it.

**Railway**: second service from the same repo, config-as-code
`railway.web.json`, same variables.

`NEXT_PUBLIC_*` values are baked in at build time — redeploy after changing
one, a restart is not enough.

## 4. Verify

```bash
curl https://<engine>/health
curl https://<engine>/api/config
curl -X POST https://<engine>/api/admin/run-cycle -H "Authorization: Bearer $ADMIN_TOKEN"
```

Then open the site's `/dashboard`: countdown, last distribution and the
holder snapshot should all be populated.

## Fees on pump.fun

`TREASURY_SECRET_KEY` must be the wallet that **created the coin on
pump.fun**. Only the creator can claim its fees. With `FEE_CLAIM=pumpfun`
(the default) every cycle reads the creator vaults and, once they hold
`MIN_CLAIM_LAMPORTS` (0.01 SOL), claims them into the treasury through
PumpPortal (signed locally, no API key). In dry run it only reports what's
claimable.

With `SWAP_PROVIDER=pumpportal` the claimed SOL (minus
`NATIVE_RESERVE_LAMPORTS`) is spent on the reward tokens by weight. That
works for tokens PumpPortal can route: pump.fun curves, PumpSwap and Raydium
pools. Otherwise leave it `disabled` and fund the treasury's reward-token
account yourself. The engine distributes whatever it holds.

Keep about 0.1 SOL in the treasury. Each first-time recipient needs a token
account (~0.002 SOL rent, paid by the treasury). A run that can't afford its
fees and rent is postponed, not half-sent.

## Testing on a local validator

```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
npm run e2e:localnet --workspace worker
```

This spawns `solana-test-validator`, creates the mints and holders, and runs
real cycles: dry run, a live cycle, and a crash right after broadcast that's
then resumed. It asserts on-chain balances against the ledger. It refuses to
run against any public cluster.
