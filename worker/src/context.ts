import type { Connection, Keypair } from '@solana/web3.js';
import { assertCluster, getConnection, parseSecretKey, resolveToken, type TokenInfo } from './chain/solana.js';
import type { Env, RewardTokenConfig } from './env.js';
import { SupabaseRepo, type LedgerRepo } from './db/repo.js';
import { getSupabase } from './db/supabase.js';
import { log } from './logger.js';
import { toRaw } from './util/amount.js';

/** One configured reward token, resolved against the chain. */
export interface RewardToken extends RewardTokenConfig {
  info: TokenInfo;
}

export interface Context {
  env: Env;
  conn: Connection;
  /** Receives the creator fees, holds the rewards and signs every payout. */
  treasury: Keypair;
  projectToken: TokenInfo;
  rewards: RewardToken[];
  repo: LedgerRepo;
  /** Owners never paid, on top of the snapshot's own PDA/burn exclusions. */
  excluded: Set<string>;
  minEligibleRaw: bigint;
}

let context: Context | undefined;

export async function getContext(env: Env): Promise<Context> {
  if (context) return context;
  context = await buildContext(env, { conn: getConnection(env), repo: new SupabaseRepo(getSupabase(env)) });
  return context;
}

/** Resolves every mint on chain. Injectable connection and ledger for tests and localnet runs. */
export async function buildContext(env: Env, deps: { conn: Connection; repo: LedgerRepo }): Promise<Context> {
  const { conn, repo } = deps;
  await assertCluster(conn, env.SOLANA_CLUSTER);
  const treasury = parseSecretKey(env.TREASURY_SECRET_KEY);

  const [projectToken, ...rewardInfos] = await Promise.all([
    resolveToken(conn, env.PROJECT_TOKEN_MINT.trim()),
    ...env.rewardTokens.map((token) => resolveToken(conn, token.mint)),
  ]);

  const rewards: RewardToken[] = env.rewardTokens.map((token, index) => ({
    ...token,
    info: rewardInfos[index]!,
  }));

  const excluded = new Set<string>([
    ...env.EXCLUDED_WALLETS,
    treasury.publicKey.toBase58(),
    projectToken!.mint,
    ...rewards.map((reward) => reward.info.mint),
  ]);

  const minEligibleRaw = toRaw(String(env.MIN_ELIGIBLE_TOKENS), projectToken!.decimals);

  log.info('engine ready', {
    treasury: treasury.publicKey.toBase58(),
    projectToken: projectToken!.mint,
    projectDecimals: projectToken!.decimals,
    projectProgram: projectToken!.programId.toBase58(),
    rewards: rewards.map((reward) => ({
      symbol: reward.symbol,
      mint: reward.info.mint,
      weightBps: reward.weightBps,
      decimals: reward.info.decimals,
    })),
    minEligibleTokens: env.MIN_ELIGIBLE_TOKENS,
    maxWalletShareBps: env.MAX_WALLET_SHARE_BPS,
    feeClaim: env.FEE_CLAIM,
    swapProvider: env.SWAP_PROVIDER,
    dryRun: env.DRY_RUN,
  });

  return { env, conn, treasury, projectToken: projectToken!, rewards, repo, excluded, minEligibleRaw };
}
