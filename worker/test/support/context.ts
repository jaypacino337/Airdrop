import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { buildContext, type Context } from '../../src/context.js';
import { loadEnv, resetEnv, type Env } from '../../src/env.js';
import { setLogLevel } from '../../src/logger.js';
import { FakeChain } from './fake-chain.js';
import { MemoryRepo } from './memory-repo.js';

export function makeEnv(vars: Record<string, string> = {}): Env {
  setLogLevel('error');
  resetEnv();
  const env = loadEnv({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests',
    LOG_LEVEL: 'error',
    ...vars,
  });
  resetEnv();
  return env;
}

export interface Harness {
  ctx: Context;
  chain: FakeChain;
  repo: MemoryRepo;
  treasury: Keypair;
  project: PublicKey;
  reward: PublicKey;
}

/**
 * A ready engine on a fake chain: a 6-decimal project mint (pump.fun style),
 * one reward mint, a treasury with 1 SOL. DRY_RUN stays at its default (on)
 * unless the caller overrides it.
 */
export async function harness(
  vars: Record<string, string> = {},
  opts: { rewardToken2022?: boolean; rewardDecimals?: number } = {},
): Promise<Harness> {
  const chain = new FakeChain();
  const repo = new MemoryRepo();
  const treasury = Keypair.generate();
  const project = chain.createMint({ decimals: 6 }).mint;
  const reward = chain.createMint({ decimals: opts.rewardDecimals ?? 9, token2022: opts.rewardToken2022 }).mint;
  chain.setSol(treasury.publicKey, 1_000_000_000);

  const env = makeEnv({
    SOLANA_RPC_URL: chain.rpcEndpoint,
    TREASURY_SECRET_KEY: bs58.encode(treasury.secretKey),
    PROJECT_TOKEN_MINT: project.toBase58(),
    REWARD_TOKENS: `RWD:${reward.toBase58()}:10000`,
    FEE_CLAIM: 'disabled',
    ...vars,
  });
  const ctx = await buildContext(env, { conn: chain.asConnection(), repo });
  return { ctx, chain, repo, treasury, project, reward };
}
