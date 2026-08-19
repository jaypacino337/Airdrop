import { BASE58_ADDRESS, loadEnv, parseRewardTokens, type Env } from './env.js';
import { errorMessage } from './logger.js';

export interface Readiness {
  ready: boolean;
  /** Human-readable list of what still has to be filled in. */
  missing: string[];
}

/**
 * Supabase and an RPC key are enough to boot. The wallet and the mints are
 * only needed to actually run a cycle, so a deploy that has not been fully
 * configured yet comes up healthy and waits in standby instead of
 * crash-looping.
 */
export function checkReadiness(env: Env = loadEnv()): Readiness {
  const missing: string[] = [];

  if (!env.CREATOR_PRIVATE_KEY.trim()) {
    missing.push('CREATOR_PRIVATE_KEY — the pump.fun coin creator wallet');
  }

  if (!env.PROJECT_TOKEN_MINT.trim()) {
    missing.push('PROJECT_TOKEN_MINT — the mint whose holders get paid');
  } else if (!BASE58_ADDRESS.test(env.PROJECT_TOKEN_MINT.trim())) {
    missing.push('PROJECT_TOKEN_MINT — not a valid base58 Solana address');
  }

  if (!env.REWARD_TOKENS.trim()) {
    missing.push('REWARD_TOKENS — e.g. WLFI:<mint>:5000,TRUMP:<mint>:5000');
  } else {
    try {
      parseRewardTokens(env.REWARD_TOKENS);
    } catch (err) {
      missing.push(`REWARD_TOKENS — ${errorMessage(err)}`);
    }
  }

  return { ready: missing.length === 0, missing };
}
