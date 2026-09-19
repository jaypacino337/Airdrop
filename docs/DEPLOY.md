# Deploying

Three pieces: a Supabase project (the ledger), a Railway engine, and the
website (Vercel or Railway). Roughly 15 minutes end to end.

## 1. Supabase

1. Create a project at supabase.com.
2. SQL Editor → New query → paste all of `supabase/schema.sql` → **Run**.
   (Pivoting from an older deployment of this repo: drop the old tables first.)
3. Project settings → API. Copy the Project URL, the **service_role** key
   (engine only) and the **anon** key (website only).

## 2. Railway — engine

1. New project → Deploy from GitHub repo → this repository.
2. Service settings → **Config as code** → `railway.worker.json`.
3. Variables — **these three give you a green deploy immediately**:

   ```
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   EVM_RPC_URL=...            # optional at this stage
   ```

   The engine boots into **standby**: `/health` returns 200 and lists exactly
   what is still missing. Nothing crash-loops while you collect addresses.

4. Settings → **Replicas: 1**. Two engines share one wallet and would collide.
5. When you have them, add the rest and redeploy:

   ```
   TREASURY_PRIVATE_KEY=...
   PROJECT_TOKEN_ADDRESS=...            # the USTR token from Pons
   PROJECT_TOKEN_DEPLOY_BLOCK=...       # its deploy block (explorer shows it)
   REWARD_TOKENS=xU3O8:0x...:10000      # or an unrestricted uranium proxy
   DRY_RUN=true
   ADMIN_TOKEN=<openssl rand -hex 32>
   ```

   The engine validates every address on boot (it must answer `decimals()`),
   so a typo fails loudly instead of sending funds into the void.

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

## Fees on Pons

Creator fees accrue to your creator wallet through Pons itself. Point
`TREASURY_PRIVATE_KEY` at that wallet (or sweep fees into the treasury on
whatever cadence you like) — the engine distributes whatever uranium the
treasury holds each cycle, so fee claiming stays a visible on-chain treasury
operation rather than an integration risk. If your chain has a V2-style DEX
with the reward token listed, `SWAP_PROVIDER=univ2` + `ROUTER_ADDRESS` +
`WRAPPED_NATIVE_ADDRESS` automates the native→uranium conversion too.
