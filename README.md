# Uranium Strategy — $USTR

**Hold USTR. Get paid in uranium.**

Uranium Strategy is a Pons coin on Robinhood Chain that pays its holders in
tokenized uranium exposure, every five minutes, automatically.

Every cycle the engine:

1. reads the **treasury** — the public wallet where Pons creator fees land and
   uranium tokens are held,
2. optionally **buys** the reward tokens with spendable native balance,
3. brings the **holder index** up to the chain head from Transfer logs,
4. **airdrops** the treasury's uranium pro-rata — minimum **500,000 USTR** to
   qualify, hard **4% ceiling** per wallet per drop, contracts (pools, routers,
   lockers) excluded automatically.

Nothing to claim, nothing to stake, nothing to sign up for. Tokens simply
arrive, and every leg is written to a public ledger.

```
Pons creator fees ──▶ treasury ──▶ [optional buyback: native → uranium tokens]
                                          │
        holder index (Transfer logs) ──▶ allocate (500k min, 4% cap)
                                          │
              website ◀── ledger (Supabase) ◀── ERC-20 transfers, one per wallet
```

## What is in here

| Path | What it is |
| --- | --- |
| `worker/` | The engine (Railway): holder indexer, allocation, sequential ERC-20 payouts with a crash-safe ledger, optional UniswapV2-style buyback, read-only API. TypeScript + ethers, no framework magic. |
| `web/` | The site: Cold-War survey-terminal design, landing page + live feed. Next.js 16 + Tailwind v4. Deploys to Vercel (root dir `web`) or Railway. |
| `supabase/schema.sql` | The ledger: cycles, per-token rewards, the holder index, snapshots, payouts, events, public views. |
| `docs/` | [Deploy](docs/DEPLOY.md) · [Operations](docs/OPERATIONS.md) · [Architecture](docs/ARCHITECTURE.md) |

## Quick start

```bash
npm install
cp .env.example .env            # engine settings
cp web/.env.example web/.env    # website settings

npm test                        # allocation + config parsing (18 tests)
npm run build                   # typecheck and build both packages

npm run dev:worker              # engine (starts in DRY_RUN by default)
npm run dev:web                 # site on http://localhost:3000
```

## The variables that matter

| Variable | What it is |
| --- | --- |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | The ledger. Run `supabase/schema.sql` first. Enough on its own for a green deploy (the engine waits in standby). |
| `EVM_RPC_URL` | A Robinhood Chain RPC endpoint. |
| `TREASURY_PRIVATE_KEY` | The wallet that receives fees, holds uranium and sends the airdrop. |
| `PROJECT_TOKEN_ADDRESS` (+ `PROJECT_TOKEN_DEPLOY_BLOCK`) | The USTR token from Pons; the deploy block is where the holder index starts. |
| `REWARD_TOKENS` | What gets dropped: `SYMBOL:0xADDRESS:WEIGHT_BPS`, weights totalling 10000. |

> **About "uranium":** xU3O8 (tokenized physical U₃O₈) is transfer-restricted —
> only whitelisted wallets can hold it. If arbitrary-holder transfers are not
> possible on your chain, distribute an unrestricted uranium proxy (for example
> the NNE stock token) and hold xU3O8 in the treasury as the visible reserve.
> The engine works with any standard ERC-20; the choice is one env var.

> **Start with `DRY_RUN=true`.** The engine indexes holders, computes the full
> allocation and writes it to Supabase without signing anything. Check the
> numbers, then flip it to `false`.

## Safety properties

- Every payout row is written to Supabase **before** anything is signed, keyed
  on `(cycle_id, owner, token)`. A crashed engine resumes; it never pays twice.
- A row that already carries a tx hash is checked against the chain before any
  resend.
- Transfers go out sequentially, so nonces cannot collide; a gas/RPC failure
  stops the run and the remainder resumes next cycle (`MAX_PAYOUTS_PER_CYCLE`).
- The treasury keeps `NATIVE_RESERVE_WEI` back so it can always pay gas.
- Run **exactly one replica**. Two engines on one wallet would collide.

## Deploying

| Service | Where | Config |
| --- | --- | --- |
| engine | Railway | config-as-code `railway.worker.json` (Dockerfile.worker), health `/health`, **1 replica** |
| web | Vercel (root dir `web`) or Railway (`railway.web.json`) | vars from `web/.env.example` |

Click-by-click in [docs/DEPLOY.md](docs/DEPLOY.md).

## Disclaimer

An independent community project — not affiliated with Robinhood, Pons,
uranium.io or any uranium producer. "Uranium" refers to tokenized market
exposure, not physical material. This code moves real funds: read it, run it
dry, and only then hand it a funded key.
