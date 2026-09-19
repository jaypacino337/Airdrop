import { EVM_ADDRESS, loadEnv, parseRewardTokens, type Env } from './env.js';
import { errorMessage } from './logger.js';

export interface Readiness {
  ready: boolean;
  /** Human-readable list of what still has to be filled in. */
  missing: string[];
}

/**
 * Supabase is enough to boot. The RPC, treasury key and token addresses are
 * only needed to actually run a cycle, so a deploy that has not been fully
 * configured yet comes up healthy and waits in standby instead of
 * crash-looping.
 */
export function checkReadiness(env: Env = loadEnv()): Readiness {
  const missing: string[] = [];

  if (!env.EVM_RPC_URL.trim()) {
    missing.push('EVM_RPC_URL — the Robinhood Chain RPC endpoint');
  }

  if (!env.TREASURY_PRIVATE_KEY.trim()) {
    missing.push('TREASURY_PRIVATE_KEY — the wallet that holds fees and sends the airdrop');
  } else if (!/^(0x)?[0-9a-fA-F]{64}$/.test(env.TREASURY_PRIVATE_KEY.trim())) {
    missing.push('TREASURY_PRIVATE_KEY — not a valid 32-byte hex key');
  }

  if (!env.PROJECT_TOKEN_ADDRESS.trim()) {
    missing.push('PROJECT_TOKEN_ADDRESS — the USTR token whose holders get paid');
  } else if (!EVM_ADDRESS.test(env.PROJECT_TOKEN_ADDRESS.trim())) {
    missing.push('PROJECT_TOKEN_ADDRESS — not a valid 0x address');
  }

  if (!env.REWARD_TOKENS.trim()) {
    missing.push('REWARD_TOKENS — e.g. xU3O8:0x…:10000');
  } else {
    try {
      parseRewardTokens(env.REWARD_TOKENS);
    } catch (err) {
      missing.push(`REWARD_TOKENS — ${errorMessage(err)}`);
    }
  }

  return { ready: missing.length === 0, missing };
}
