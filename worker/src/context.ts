import { Connection, Keypair } from '@solana/web3.js';
import type { Env, RewardTokenConfig } from './env.js';
import { getConnection } from './chain/rpc.js';
import { resolveMint, type MintInfo } from './chain/mint.js';
import { keypairFromSecret } from './chain/wallet.js';
import { Repo } from './db/repo.js';
import { getSupabase } from './db/supabase.js';
import { log } from './logger.js';
import { toRaw } from './util/amount.js';

/** Burn / incinerator addresses that must never be counted as holders. */
const ALWAYS_EXCLUDED = [
  '1nc1nerator11111111111111111111111111111111',
  '11111111111111111111111111111111',
];

/** One configured reward token, resolved against the chain. */
export interface RewardToken extends RewardTokenConfig {
  mintInfo: MintInfo;
}

export interface Context {
  env: Env;
  connection: Connection;
  wallet: Keypair;
  projectMint: MintInfo;
  rewards: RewardToken[];
  repo: Repo;
  excluded: Set<string>;
  minEligibleRaw: bigint;
}

let context: Context | undefined;

export async function getContext(env: Env): Promise<Context> {
  if (context) return context;

  const connection = getConnection(env);
  const wallet = keypairFromSecret(env.CREATOR_PRIVATE_KEY);

  const [projectMint, ...rewardMints] = await Promise.all([
    resolveMint(connection, env.PROJECT_TOKEN_MINT),
    ...env.rewardTokens.map((token) => resolveMint(connection, token.mint)),
  ]);

  const rewards: RewardToken[] = env.rewardTokens.map((token, index) => ({
    ...token,
    mintInfo: rewardMints[index]!,
  }));

  const excluded = new Set<string>([
    ...ALWAYS_EXCLUDED,
    ...env.EXCLUDED_WALLETS,
    wallet.publicKey.toBase58(),
  ]);

  const minEligibleRaw = toRaw(String(env.MIN_ELIGIBLE_TOKENS), projectMint.decimals);

  log.info('engine ready', {
    wallet: wallet.publicKey.toBase58(),
    projectMint: env.PROJECT_TOKEN_MINT,
    projectDecimals: projectMint.decimals,
    rewards: rewards.map((reward) => ({
      symbol: reward.symbol,
      mint: reward.mint,
      weightBps: reward.weightBps,
      decimals: reward.mintInfo.decimals,
      tokenProgram: reward.mintInfo.programId.toBase58(),
    })),
    minEligibleTokens: env.MIN_ELIGIBLE_TOKENS,
    maxWalletShareBps: env.MAX_WALLET_SHARE_BPS,
    dryRun: env.DRY_RUN,
    excludedWallets: excluded.size,
  });

  context = {
    env,
    connection,
    wallet,
    projectMint,
    rewards,
    repo: new Repo(getSupabase(env)),
    excluded,
    minEligibleRaw,
  };
  return context;
}
