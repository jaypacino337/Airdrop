import { Connection } from '@solana/web3.js';
import type { Env } from '../env.js';
import { fetchJson } from '../util/http.js';

let connection: Connection | undefined;

export function getConnection(env: Env): Connection {
  if (!connection) {
    connection = new Connection(env.rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: env.CONFIRM_TIMEOUT_MS,
      disableRetryOnRateLimit: false,
    });
  }
  return connection;
}

let fallback: Connection | undefined;

export function getFallbackConnection(env: Env): Connection | undefined {
  if (!env.rpcUrlFallback) return undefined;
  if (!fallback) fallback = new Connection(env.rpcUrlFallback, { commitment: 'confirmed' });
  return fallback;
}

let rpcId = 0;

/**
 * Raw JSON-RPC call — needed for Helius-only methods such as
 * `getTokenAccounts`, which the web3.js client does not model.
 */
export async function rpcCall<T>(env: Env, method: string, params: unknown): Promise<T> {
  rpcId += 1;
  const body = { jsonrpc: '2.0', id: `moderna-${rpcId}`, method, params };
  const res = await fetchJson<{ result?: T; error?: { code: number; message: string } }>({
    url: env.rpcUrl,
    method: 'POST',
    body,
    timeoutMs: 45_000,
  });
  if (res.error) throw new Error(`RPC ${method} failed (${res.error.code}): ${res.error.message}`);
  if (res.result === undefined) throw new Error(`RPC ${method} returned no result`);
  return res.result;
}
