import type { JsonRpcProvider, Wallet } from 'ethers';
import { assertChain, getProvider, getWallet, resolveToken, type TokenInfo } from './chain/evm.js';
import type { Env, RewardTokenConfig } from './env.js';
import { Repo } from './db/repo.js';
import { getSupabase } from './db/supabase.js';
import { log } from './logger.js';
import { toRaw } from './util/amount.js';

const DEAD_ADDRESSES = [
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
];

/** One configured reward token, resolved against the chain. */
export interface RewardToken extends RewardTokenConfig {
  info: TokenInfo;
}

export interface Context {
  env: Env;
  provider: JsonRpcProvider;
  wallet: Wallet;
  projectToken: TokenInfo;
  rewards: RewardToken[];
  repo: Repo;
  excluded: Set<string>;
  minEligibleRaw: bigint;
}

let context: Context | undefined;

export async function getContext(env: Env): Promise<Context> {
  if (context) return context;

  const provider = getProvider(env);
  await assertChain(env);
  const wallet = getWallet(env);

  const [projectToken, ...rewardInfos] = await Promise.all([
    resolveToken(env, env.PROJECT_TOKEN_ADDRESS),
    ...env.rewardTokens.map((token) => resolveToken(env, token.token)),
  ]);

  const rewards: RewardToken[] = env.rewardTokens.map((token, index) => ({
    ...token,
    info: rewardInfos[index]!,
  }));

  const excluded = new Set<string>([
    ...DEAD_ADDRESSES,
    ...env.EXCLUDED_WALLETS,
    wallet.address.toLowerCase(),
    projectToken.address,
    ...rewards.map((reward) => reward.info.address),
  ]);

  const minEligibleRaw = toRaw(String(env.MIN_ELIGIBLE_TOKENS), projectToken.decimals);

  log.info('engine ready', {
    treasury: wallet.address,
    projectToken: projectToken.address,
    projectDecimals: projectToken.decimals,
    rewards: rewards.map((reward) => ({
      symbol: reward.symbol,
      token: reward.info.address,
      weightBps: reward.weightBps,
      decimals: reward.info.decimals,
    })),
    minEligibleTokens: env.MIN_ELIGIBLE_TOKENS,
    maxWalletShareBps: env.MAX_WALLET_SHARE_BPS,
    dryRun: env.DRY_RUN,
  });

  context = {
    env,
    provider,
    wallet,
    projectToken,
    rewards,
    repo: new Repo(getSupabase(env)),
    excluded,
    minEligibleRaw,
  };
  return context;
}
