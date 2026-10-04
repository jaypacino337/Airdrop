# Uranium Strategy — $USTR

**Hold USTR. Get paid in uranium.**

Uranium Strategy is a pump.fun coin on **Solana** that pays its holders in
tokenized uranium exposure, every five minutes, automatically.

Every cycle the engine:

1. **claims** the coin's pump.fun creator fees into the **treasury**, the
   public creator wallet that also holds the reward tokens,
2. optionally **buys** the reward tokens with spendable SOL (PumpPortal),
3. **snapshots** every USTR holder at one slot (Helius or
   `getProgramAccounts`; SPL Token and Token-2022),
4. **airdrops** the treasury's rewards pro-rata. You need at least
   **500,000 USTR** to qualify, there's a hard **4% ceiling** per wallet per
   drop, and pools, the bonding curve and every other PDA are excluded
   automatically.

There's nothing to claim, stake or sign up for. Tokens simply arrive (the
engine opens your token account if you don't have one), and every leg is
written to a public ledger.

```
pump.fun creator fees ──claim──▶ treasury ──▶ [optional buyback: SOL → reward tokens]
                                                   │
      holder snapshot (token accounts @ slot) ──▶ allocate (500k min, 4% cap)
                                                   │
            website ◀── ledger (Supabase) ◀── SPL transfers, batched, ATA created if missing
```

## What is in here

| Path | What it is |
| --- | --- |
| `worker/` | The engine (Railway): pump.fun fee claim, holder snapshot, allocation, batched SPL / Token-2022 payouts with a crash-safe ledger, optional PumpPortal buyback, read-only API. TypeScript + `@solana/web3.js`, no framework magic. The chain layer is ported from the memcoinz skills (`snapshot`, `airdrop`, `pump-claim`, `buyback-burn`). |
| `web/` | The site: Cold-War survey-terminal design, landing page + live feed. Next.js 16 + Tailwind v4. Deploys to Vercel (root dir `web`) or Railway. |
| `supabase/schema.sql` | The ledger: cycles, per-token rewards, snapshots, payouts, events, public views. `supabase/migrations/001_evm_to_solana.sql` archives an existing EVM ledger first. |
| `docs/` | [Deploy](docs/DEPLOY.md) · [Operations](docs/OPERATIONS.md) · [Architecture](docs/ARCHITECTURE.md) |

## Quick start

```bash
npm install
cp .env.example .env            # engine settings
cp web/.env.example web/.env    # website settings

npm test                        # allocation, config, snapshot, payouts, claims, full cycles (51 tests)
npm run build                   # typecheck and build both packages

npm run dev:worker              # engine (starts in DRY_RUN by default)
npm run e2e:localnet --workspace worker   # real cycles on solana-test-validator
npm run dev:web                 # site on http://localhost:3000
```

## The variables that matter

| Variable | What it is |
| --- | --- |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | The ledger. Run `supabase/schema.sql` first. Enough on its own for a green deploy (the engine waits in standby). |
| `SOLANA_RPC_URL` (+ optional `HELIUS_API_KEY`) | A **dedicated** Solana RPC. The public endpoint rejects holder scans. |
| `TREASURY_SECRET_KEY` | The pump.fun **creator** wallet: it claims the fees, holds the rewards and sends the airdrop. Base58 or a JSON byte array. |
| `PROJECT_TOKEN_MINT` | The USTR mint. |
| `REWARD_TOKENS` | What gets dropped: `SYMBOL:MINT:WEIGHT_BPS`, weights totalling 10000. Any SPL or Token-2022 mint. |

> **About "uranium":** which SPL token gets dropped is one env var
> (`REWARD_TOKENS`). Pick a freely transferable Solana token for the uranium
> exposure. With `SWAP_PROVIDER=pumpportal` it also needs a pump.fun,
> PumpSwap or Raydium pool. Otherwise keep the buyback disabled and fund the
> treasury with it directly.

> **Start with `DRY_RUN=true`** (the default). The engine reads the fee vault,
> snapshots holders, computes the full allocation and writes it to Supabase
> without signing anything. Check the
> numbers, then flip it to `false`.

## Safety properties

- Every payout row is written to Supabase **before** anything is signed. Rows
  are keyed on `(cycle_id, owner, token)`. A crashed engine resumes; it never
  pays twice.
- Each batch's signature and its blockhash expiry are written to the ledger
  **before** broadcast. A signed row is looked up on chain before anything else
  happens to it, and it's only resent if it failed or can no longer land.
  This is proven on a real validator by deliberately crashing right after
  broadcast.
- Only what is not already owed counts as a cycle's pot (balance minus
  unconfirmed payouts).
- A run that can't afford its fees and new-account rent is postponed, not
  half-sent. `NATIVE_RESERVE_LAMPORTS` is kept back from buybacks.
- PumpPortal transactions are signed locally. One whose fee payer isn't the
  treasury is refused.
- Run **exactly one replica**. Two engines on one wallet would race each
  other.

## Deploying

| Service | Where | Config |
| --- | --- | --- |
| engine | Railway | config-as-code `railway.worker.json` (Dockerfile.worker), health `/health`, **1 replica** |
| web | Vercel (root dir `web`) or Railway (`railway.web.json`) | vars from `web/.env.example` |

Click-by-click in [docs/DEPLOY.md](docs/DEPLOY.md).

## Disclaimer

An independent community project. It isn't affiliated with pump.fun, Solana,
uranium.io or any uranium producer. "Uranium" refers to tokenized market
exposure, not physical material. This code moves real funds: read it, run it
dry, and only then hand it a funded key.
