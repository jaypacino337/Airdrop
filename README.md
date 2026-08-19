# Moderna — MRNAx airdrop engine

Moderna (**MRNA**) is a pump.fun coin that pays its holders in **MRNAx**, the
tokenised Moderna stock on Solana.

Every five minutes a worker:

1. **claims** the pump.fun creator fees the coin has earned,
2. **buys** MRNAx on the open market with that SOL,
3. **snapshots** every MRNA holder straight from chain state,
4. **distributes** the MRNAx pro-rata — minimum **500,000 MRNA** to qualify, and
   a hard **4% ceiling** on what any single wallet can take from one drop.

Nothing to claim, nothing to stake, nothing to sign up for. Tokens simply arrive.

```
pump.fun creator fees ──▶ claim ──▶ buy MRNAx ──▶ snapshot MRNA holders
                                                        │
                     ledger (Supabase) ◀── transfer ◀── allocate (500k min, 4% cap)
                              │
                              └──▶ website (live dashboard, wallet lookup)
```

## What is in here

| Path | What it is |
| --- | --- |
| `worker/` | The Railway worker: scheduler, claim, swap, snapshot, allocation, distribution, plus a small read-only API. TypeScript, no framework magic. |
| `web/` | The website: landing page and live dashboard. Next.js 16 + Tailwind v4. |
| `supabase/schema.sql` | The ledger: cycles, snapshots, payouts, events, and the views the site reads. |
| `docs/` | [Deploy](docs/DEPLOY.md) · [Operations](docs/OPERATIONS.md) · [Architecture](docs/ARCHITECTURE.md) |
| `Dockerfile.worker`, `Dockerfile.web` | One image per Railway service. |

## Quick start

```bash
npm install
cp .env.example .env            # worker settings — see below
cp web/.env.example web/.env    # website settings

npm test                        # allocation + amount maths
npm run build                   # typecheck and build both packages

npm run dev:worker              # engine (starts in DRY_RUN by default)
npm run dev:web                 # site on http://localhost:3000
```

Run the engine once and exit — the safest first thing to do:

```bash
npm run cycle:once --workspace worker
```

## The five things you have to set

| Variable | Where to get it |
| --- | --- |
| `HELIUS_API_KEY` | [dashboard.helius.dev](https://dashboard.helius.dev) → API keys. Used for RPC and holder indexing. |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project settings → API. Run `supabase/schema.sql` first. |
| `CREATOR_PRIVATE_KEY` | The pump.fun **coin creator** wallet, base58 or JSON array. It claims, buys and pays. |
| `PROJECT_TOKEN_MINT` | The MRNA mint — the coin whose holders get paid. |
| `REWARD_TOKEN_MINT` | The MRNAx mint — the token that gets bought and airdropped. |

Everything else has a working default. `.env.example` documents all of it.

> **Start with `DRY_RUN=true`.** The engine will claim nothing, buy nothing and
> send nothing, but it still snapshots holders, computes the full allocation and
> writes it to Supabase — so you can check the numbers against the chain before a
> single lamport moves. Flip it to `false` when the ledger looks right.

## Distribution rules

- **Minimum 500,000 MRNA** (`MIN_ELIGIBLE_TOKENS`) at the instant of the snapshot.
  Below that a payout is worth less than the fee to send it.
- **4% maximum per wallet** (`MAX_WALLET_SHARE_BPS=400`) of each drop. What a
  capped wallet cannot take is redistributed across everyone still under the cap,
  repeatedly, because redistribution can push the next wallet over the line.
- **Pools and program accounts are excluded** — AMM pools, bonding curves, vaults
  and the distributor itself. Add anything else (team, CEX) to `EXCLUDED_WALLETS`.
- **Nothing is stranded.** Rounding dust and payouts too small to send stay in the
  distributor and roll into the next cycle's pot.
- If there are ever too few eligible wallets to absorb a whole drop under the cap
  (fewer than 25 at 4%), the cap is relaxed for that cycle and the reason is
  recorded on the cycle row.

## Safety properties

- Every payout row is written to Supabase **before** anything is signed, keyed on
  `(cycle_id, owner)`. A worker that dies mid-distribution resumes; it never pays
  twice.
- A row that already carries a signature is re-checked on chain before any resend.
- Every transaction is simulated before it is sent.
- The distributor keeps `SOL_RESERVE_LAMPORTS` back so it can always pay fees.
- Run **exactly one replica**. Two workers on the same wallet would double-pay.

## Deploying

Two Railway services from this one repo — see [docs/DEPLOY.md](docs/DEPLOY.md)
for the click-by-click version.

| Service | Config file | Health check |
| --- | --- | --- |
| `worker` | `railway.worker.json` (`Dockerfile.worker`) | `/health` |
| `web` | `railway.web.json` (`Dockerfile.web`) | `/` |

## Disclaimer

This project is not affiliated with Moderna, Inc. It moves real funds on Solana
mainnet: read the code, run it dry, and only then hand it a funded key.
