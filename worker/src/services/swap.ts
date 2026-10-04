import type { Context, RewardToken } from '../context.js';
import { lamportsToSolNumber, pumpPortalLocal, sendPumpPortalTx, tokenBalance } from '../chain/solana.js';
import { errorMessage, log } from '../logger.js';

export interface SwapResult {
  status: 'swapped' | 'skipped' | 'disabled';
  txId?: string;
  /** Lamports spent. */
  nativeSpent: bigint;
  boughtRaw: bigint;
  reason?: string;
}

/**
 * Optional buyback leg: spend one reward token's slice of the treasury's
 * spendable SOL on that token through PumpPortal (trade-local: PumpPortal
 * builds the transaction, the engine signs it). This is the buy half of the
 * memcoinz `buyback-burn` skill — the tokens are kept for the airdrop, not
 * burned. PumpPortal routes pump.fun curves, PumpSwap and Raydium pools
 * (SWAP_POOL=auto picks); a reward token without such a pool needs
 * SWAP_PROVIDER=disabled and a treasury that is topped up by hand.
 *
 * Only the delta bought in this run is reported, never tokens the treasury
 * already held.
 */
export async function buyRewardToken(ctx: Context, reward: RewardToken, lamportsIn: bigint): Promise<SwapResult> {
  const { env, conn, treasury } = ctx;

  if (env.SWAP_PROVIDER === 'disabled') {
    return { status: 'disabled', nativeSpent: 0n, boughtRaw: 0n };
  }
  if (lamportsIn < BigInt(env.MIN_SWAP_LAMPORTS)) {
    return { status: 'skipped', nativeSpent: 0n, boughtRaw: 0n, reason: 'below MIN_SWAP_LAMPORTS, rolls over' };
  }
  if (env.DRY_RUN) {
    return { status: 'skipped', nativeSpent: 0n, boughtRaw: 0n, reason: 'dry run' };
  }

  try {
    const before = await tokenBalance(conn, reward.info, treasury.publicKey);
    const bytes = await pumpPortalLocal({
      publicKey: treasury.publicKey.toBase58(),
      action: 'buy',
      mint: reward.info.mint,
      amount: lamportsToSolNumber(lamportsIn),
      denominatedInSol: 'true',
      slippage: env.SWAP_SLIPPAGE_BPS / 100,
      priorityFee: env.PUMPPORTAL_PRIORITY_FEE_SOL,
      pool: env.SWAP_POOL,
    });
    const txId = await sendPumpPortalTx(conn, bytes, treasury);
    const after = await tokenBalance(conn, reward.info, treasury.publicKey);
    const boughtRaw = after > before ? after - before : 0n;
    log.info('buyback complete', { symbol: reward.symbol, txId, boughtRaw: boughtRaw.toString() });
    return { status: 'swapped', txId, nativeSpent: lamportsIn, boughtRaw };
  } catch (err) {
    return { status: 'skipped', nativeSpent: 0n, boughtRaw: 0n, reason: errorMessage(err).slice(0, 200) };
  }
}
