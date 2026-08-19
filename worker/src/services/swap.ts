import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import type { Env } from '../env.js';
import type { MintInfo } from '../chain/mint.js';
import { associatedTokenAddress, getTokenBalanceRaw } from '../chain/transfer.js';
import { deserializeTransaction, sendAndConfirm } from '../chain/tx.js';
import { errorMessage, log } from '../logger.js';
import { fetchBytes, fetchJson } from '../util/http.js';
import { lamportsToSol, priorityFeeSol } from '../util/amount.js';

export const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export interface SwapResult {
  status: 'swapped' | 'skipped' | 'disabled';
  provider?: 'jupiter' | 'pumpportal';
  signature?: string;
  lamportsSpent: bigint;
  boughtRaw: bigint;
  reason?: string;
}

/**
 * Spend one reward token's slice of the claimed SOL on that token.
 *
 * The amount bought is measured from the on-chain token balance before and
 * after the swap, not from the router's quote, so partial fills and fees are
 * reflected exactly.
 */
export async function buyRewardToken(
  env: Env,
  connection: Connection,
  wallet: Keypair,
  rewardMint: MintInfo,
  lamportsIn: bigint,
): Promise<SwapResult> {
  if (env.SWAP_PROVIDER === 'disabled') {
    return { status: 'disabled', lamportsSpent: 0n, boughtRaw: 0n, reason: 'SWAP_PROVIDER=disabled' };
  }
  if (lamportsIn < BigInt(env.MIN_SWAP_LAMPORTS)) {
    return {
      status: 'skipped',
      lamportsSpent: 0n,
      boughtRaw: 0n,
      reason: `only ${lamportsToSol(lamportsIn)} SOL spendable, below MIN_SWAP_LAMPORTS`,
    };
  }
  if (env.DRY_RUN) {
    const quote = await quoteJupiter(env, lamportsIn, rewardMint.mint.toBase58()).catch(() => undefined);
    log.info('dry run: skipping buyback', {
      lamportsIn: lamportsIn.toString(),
      quotedOut: quote?.outAmount,
    });
    return {
      status: 'skipped',
      lamportsSpent: 0n,
      boughtRaw: 0n,
      reason: `dry run (quote: ${quote?.outAmount ?? 'n/a'})`,
    };
  }

  const rewardAta = associatedTokenAddress(rewardMint, wallet.publicKey);
  const balanceBefore = await getTokenBalanceRaw(connection, rewardAta);

  const order: Array<'jupiter' | 'pumpportal'> =
    env.SWAP_PROVIDER === 'auto' ? ['jupiter', 'pumpportal'] : [env.SWAP_PROVIDER];

  let lastError: unknown;
  for (const provider of order) {
    try {
      const signature =
        provider === 'jupiter'
          ? await swapViaJupiter(env, connection, wallet, rewardMint, lamportsIn)
          : await swapViaPumpPortal(env, connection, wallet, rewardMint, lamportsIn);

      const balanceAfter = await getTokenBalanceRaw(connection, rewardAta);
      const boughtRaw = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0n;

      log.info('buyback complete', {
        provider,
        signature,
        solIn: lamportsToSol(lamportsIn),
        boughtRaw: boughtRaw.toString(),
      });

      return { status: 'swapped', provider, signature, lamportsSpent: lamportsIn, boughtRaw };
    } catch (err) {
      lastError = err;
      log.warn('swap provider failed', { provider, error: errorMessage(err) });
    }
  }

  throw new Error(`all swap providers failed: ${errorMessage(lastError)}`);
}

// --- Jupiter -----------------------------------------------------------------

interface JupiterQuote {
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string;
  routePlan?: unknown[];
  [key: string]: unknown;
}

async function quoteJupiter(env: Env, lamportsIn: bigint, outputMint: string): Promise<JupiterQuote> {
  const url = new URL(`${env.JUPITER_BASE_URL}/swap/v1/quote`);
  url.searchParams.set('inputMint', WSOL_MINT);
  url.searchParams.set('outputMint', outputMint);
  url.searchParams.set('amount', lamportsIn.toString());
  url.searchParams.set('slippageBps', String(env.SWAP_SLIPPAGE_BPS));
  url.searchParams.set('restrictIntermediateTokens', 'true');
  return fetchJson<JupiterQuote>({ url: url.toString(), timeoutMs: 20_000 });
}

async function swapViaJupiter(
  env: Env,
  connection: Connection,
  wallet: Keypair,
  rewardMint: MintInfo,
  lamportsIn: bigint,
): Promise<string> {
  return sendAndConfirm(
    connection,
    env,
    wallet,
    async () => {
      const quote = await quoteJupiter(env, lamportsIn, rewardMint.mint.toBase58());
      if (BigInt(quote.outAmount ?? '0') <= 0n) throw new Error('jupiter returned an empty route');

      const { swapTransaction } = await fetchJson<{ swapTransaction: string }>({
        url: `${env.JUPITER_BASE_URL}/swap/v1/swap`,
        method: 'POST',
        body: {
          quoteResponse: quote,
          userPublicKey: wallet.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports: Math.round(priorityFeeSol(env.PRIORITY_FEE_MICROLAMPORTS) * 1e9),
              priorityLevel: 'high',
            },
          },
        },
        timeoutMs: 30_000,
      });

      return VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
    },
    { label: 'swap:jupiter' },
  );
}

// --- PumpPortal (bonding curve + pump AMM) -----------------------------------

async function swapViaPumpPortal(
  env: Env,
  connection: Connection,
  wallet: Keypair,
  rewardMint: MintInfo,
  lamportsIn: bigint,
): Promise<string> {
  return sendAndConfirm(
    connection,
    env,
    wallet,
    async () => {
      const bytes = await fetchBytes({
        url: `${env.PUMPPORTAL_BASE_URL}/api/trade-local`,
        method: 'POST',
        body: {
          publicKey: wallet.publicKey.toBase58(),
          action: 'buy',
          mint: rewardMint.mint.toBase58(),
          amount: lamportsToSol(lamportsIn),
          denominatedInSol: 'true',
          slippage: env.SWAP_SLIPPAGE_BPS / 100,
          priorityFee: priorityFeeSol(env.PRIORITY_FEE_MICROLAMPORTS),
          pool: 'auto',
        },
        timeoutMs: 30_000,
      });
      return deserializeTransaction(bytes);
    },
    { label: 'swap:pumpportal' },
  );
}
