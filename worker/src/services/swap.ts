import { Contract } from 'ethers';
import type { Env } from '../env.js';
import type { Context, RewardToken } from '../context.js';
import { erc20, waitForTx } from '../chain/evm.js';
import { errorMessage, log } from '../logger.js';

const ROUTER_ABI = [
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable',
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])',
];

export interface SwapResult {
  status: 'swapped' | 'skipped' | 'disabled';
  txHash?: string;
  weiSpent: bigint;
  boughtRaw: bigint;
  reason?: string;
}

/**
 * Optional buyback leg: spend one reward token's slice of the treasury's
 * native balance through a UniswapV2-compatible router.
 *
 * Default is `disabled`: the engine simply distributes whatever reward-token
 * balance the treasury holds, and acquiring it (claiming Pons fees, buying
 * uranium exposure) stays a treasury operation you can see on the explorer.
 */
export async function buyRewardToken(
  ctx: Context,
  reward: RewardToken,
  weiIn: bigint,
): Promise<SwapResult> {
  const { env } = ctx;

  if (env.SWAP_PROVIDER === 'disabled') {
    return { status: 'disabled', weiSpent: 0n, boughtRaw: 0n };
  }
  if (!env.ROUTER_ADDRESS || !env.WRAPPED_NATIVE_ADDRESS) {
    return {
      status: 'skipped',
      weiSpent: 0n,
      boughtRaw: 0n,
      reason: 'SWAP_PROVIDER=univ2 needs ROUTER_ADDRESS and WRAPPED_NATIVE_ADDRESS',
    };
  }
  if (weiIn < BigInt(env.MIN_SWAP_WEI)) {
    return { status: 'skipped', weiSpent: 0n, boughtRaw: 0n, reason: 'below MIN_SWAP_WEI, rolls over' };
  }
  if (env.DRY_RUN) {
    return { status: 'skipped', weiSpent: 0n, boughtRaw: 0n, reason: 'dry run' };
  }

  const router = new Contract(env.ROUTER_ADDRESS, ROUTER_ABI, ctx.wallet);
  const path = [env.WRAPPED_NATIVE_ADDRESS, reward.info.address];
  const rewardContract = erc20(env, reward.info.address);
  const balanceOf = rewardContract.getFunction('balanceOf');
  const before = (await balanceOf(ctx.wallet.address)) as bigint;

  try {
    const amounts = (await router.getFunction('getAmountsOut')(weiIn, path)) as bigint[];
    const quoted = amounts[amounts.length - 1] ?? 0n;
    if (quoted <= 0n) throw new Error('router quoted zero out — no route/liquidity');
    const minOut = (quoted * BigInt(10_000 - env.SWAP_SLIPPAGE_BPS)) / 10_000n;

    const tx = await router.getFunction('swapExactETHForTokensSupportingFeeOnTransferTokens')(
      minOut,
      path,
      ctx.wallet.address,
      Math.floor(Date.now() / 1000) + 120,
      { value: weiIn },
    );
    await waitForTx(env, tx, `swap:${reward.symbol}`);

    const after = (await balanceOf(ctx.wallet.address)) as bigint;
    const boughtRaw = after > before ? after - before : 0n;
    log.info('buyback complete', { symbol: reward.symbol, txHash: tx.hash, boughtRaw: boughtRaw.toString() });
    return { status: 'swapped', txHash: tx.hash, weiSpent: weiIn, boughtRaw };
  } catch (err) {
    return { status: 'skipped', weiSpent: 0n, boughtRaw: 0n, reason: errorMessage(err).slice(0, 200) };
  }
}
