import { Connection, PublicKey } from '@solana/web3.js';
import type { Env } from '../env.js';
import { log } from '../logger.js';
import { retry } from '../util/async.js';
import type { MintInfo } from './mint.js';
import { rpcCall } from './rpc.js';

export interface HolderRow {
  owner: string;
  balanceRaw: bigint;
}

interface HeliusTokenAccount {
  address: string;
  mint: string;
  owner: string;
  amount: number | string;
  frozen?: boolean;
}

interface HeliusTokenAccountsPage {
  total: number;
  limit: number;
  page?: number;
  cursor?: string;
  token_accounts?: HeliusTokenAccount[];
}

const PAGE_LIMIT = 1_000;
const MAX_PAGES = 200; // 200k token accounts — far beyond any pump.fun coin

/**
 * Snapshot every wallet holding `mint`, summed per owner (a wallet can hold
 * the same mint in several token accounts).
 *
 * Primary path is Helius `getTokenAccounts` (fast, paginated). If that is
 * unavailable we fall back to a plain `getProgramAccounts` scan, which any
 * RPC can serve.
 */
export async function snapshotHolders(
  env: Env,
  connection: Connection,
  mintInfo: MintInfo,
): Promise<HolderRow[]> {
  try {
    return await snapshotViaHelius(env, mintInfo);
  } catch (err) {
    log.warn('helius getTokenAccounts unavailable, falling back to getProgramAccounts', {
      error: err instanceof Error ? err.message : String(err),
    });
    return snapshotViaProgramAccounts(connection, mintInfo, env);
  }
}

async function snapshotViaHelius(env: Env, mintInfo: MintInfo): Promise<HolderRow[]> {
  const balances = new Map<string, bigint>();
  let page = 1;

  for (; page <= MAX_PAGES; page += 1) {
    const result = await retry(
      () =>
        rpcCall<HeliusTokenAccountsPage>(env, 'getTokenAccounts', {
          mint: mintInfo.mint.toBase58(),
          page,
          limit: PAGE_LIMIT,
          options: { showZeroBalance: false },
        }),
      { attempts: 3, baseDelayMs: 700 },
    );

    const accounts = result.token_accounts ?? [];
    for (const account of accounts) {
      if (!env.INCLUDE_FROZEN_ACCOUNTS && account.frozen) continue;
      const amount = BigInt(account.amount ?? 0);
      if (amount <= 0n) continue;
      balances.set(account.owner, (balances.get(account.owner) ?? 0n) + amount);
    }

    if (accounts.length < PAGE_LIMIT) break;
  }

  if (page > MAX_PAGES) log.warn('holder snapshot hit the page ceiling', { maxPages: MAX_PAGES });

  return toRows(balances);
}

async function snapshotViaProgramAccounts(
  connection: Connection,
  mintInfo: MintInfo,
  env: Env,
): Promise<HolderRow[]> {
  // SPL token account layout: mint[0..32], owner[32..64], amount u64[64..72],
  // ... state u8 at 108 (2 = frozen). Token-2022 accounts share this prefix.
  const accounts = await connection.getProgramAccounts(mintInfo.programId, {
    commitment: 'confirmed',
    filters: [{ memcmp: { offset: 0, bytes: mintInfo.mint.toBase58() } }],
  });

  const balances = new Map<string, bigint>();
  for (const { account } of accounts) {
    const data = account.data;
    if (data.length < 72) continue;
    const owner = new PublicKey(data.subarray(32, 64)).toBase58();
    const amount = data.readBigUInt64LE(64);
    if (amount <= 0n) continue;
    if (!env.INCLUDE_FROZEN_ACCOUNTS && data.length > 108 && data[108] === 2) continue;
    balances.set(owner, (balances.get(owner) ?? 0n) + amount);
  }
  return toRows(balances);
}

function toRows(balances: Map<string, bigint>): HolderRow[] {
  return [...balances.entries()]
    .map(([owner, balanceRaw]) => ({ owner, balanceRaw }))
    .sort((a, b) => (b.balanceRaw === a.balanceRaw ? 0 : b.balanceRaw > a.balanceRaw ? 1 : -1));
}
