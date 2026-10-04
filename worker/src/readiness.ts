import { isValidAddress, isValidSecretKey } from './chain/solana.js';
import { loadEnv, parseRewardTokens, type Env } from './env.js';
import { errorMessage } from './logger.js';

export interface Readiness {
  ready: boolean;
  /** Human-readable list of what still has to be filled in. */
  missing: string[];
}

/**
 * Supabase is enough to boot. The RPC, treasury key and mints are only
 * needed to actually run a cycle, so a deploy that has not been fully
 * configured yet comes up healthy and waits in standby instead of
 * crash-looping.
 */
export function checkReadiness(env: Env = loadEnv()): Readiness {
  const missing: string[] = [];

  if (!env.SOLANA_RPC_URL.trim()) {
    missing.push('SOLANA_RPC_URL — a dedicated Solana RPC endpoint (Helius, Triton, QuickNode)');
  }

  if (!env.TREASURY_SECRET_KEY.trim()) {
    missing.push('TREASURY_SECRET_KEY — the pump.fun creator wallet that claims fees and sends the airdrop');
  } else if (!isValidSecretKey(env.TREASURY_SECRET_KEY)) {
    missing.push('TREASURY_SECRET_KEY — not a 64-byte secret key (base58 or a JSON byte array)');
  }

  if (!env.PROJECT_TOKEN_MINT.trim()) {
    missing.push('PROJECT_TOKEN_MINT — the USTR mint whose holders get paid');
  } else if (!isValidAddress(env.PROJECT_TOKEN_MINT.trim())) {
    missing.push('PROJECT_TOKEN_MINT — not a valid base58 Solana address');
  }

  if (!env.REWARD_TOKENS.trim()) {
    missing.push('REWARD_TOKENS — e.g. URANIUM:<mint>:10000');
  } else {
    try {
      parseRewardTokens(env.REWARD_TOKENS);
    } catch (err) {
      missing.push(`REWARD_TOKENS — ${errorMessage(err)}`);
    }
  }

  return { ready: missing.length === 0, missing };
}
