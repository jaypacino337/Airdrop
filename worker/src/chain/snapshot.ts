import { PublicKey, type Connection } from '@solana/web3.js';
import { unpackAccount } from '@solana/spl-token';
import { INCINERATOR, isPublicMainnetRpc, pumpBondingCurve, type TokenInfo } from './solana.js';

/**
 * Holder snapshot of the project token. Replaces the EVM Transfer-log
 * indexer: on Solana every token account carries its current balance, so a
 * full scan at the cycle's slot is exact and needs no stored history.
 *
 * Ported from the memcoinz `snapshot` skill:
 *  - Helius `getTokenAccounts` (paginated) when HELIUS_API_KEY is set,
 *    otherwise getProgramAccounts on the mint's token program (SPL or
 *    Token-2022) — never on the public endpoint, which rejects it.
 *  - Balances are summed per OWNER (one wallet can hold several accounts).
 *  - Frozen accounts are skipped; they cannot receive or move tokens.
 *  - The incinerator, the pump.fun bonding curve and (by default) every
 *    off-curve owner are reported as excluded. Off-curve owners are PDAs:
 *    PumpSwap/Raydium/Meteora pools, curves, lockers, vaults — never people.
 */

export interface SnapshotHolder {
  owner: string;
  balanceRaw: bigint;
}

export interface HolderSnapshot {
  slot: number;
  source: 'helius' | 'rpc';
  /** Every owner with a positive balance that passed the exclusion rules. */
  holders: SnapshotHolder[];
  /** Owners dropped as PDAs / burn / bonding curve. */
  excludedCount: number;
  /** Distinct owners with a positive balance, before exclusions. */
  ownerCount: number;
}

export interface SnapshotOptions {
  token: TokenInfo;
  heliusApiKey?: string;
  /** Exclude off-curve (PDA) owners. Default true. */
  excludePdas?: boolean;
  /** Override for tests; defaults to Helius mainnet. */
  heliusUrl?: string;
}

interface RawAccount {
  owner: string;
  amount: bigint;
}

export async function takeHolderSnapshot(conn: Connection, opts: SnapshotOptions): Promise<HolderSnapshot> {
  const slot = await conn.getSlot('confirmed');
  const useHelius = Boolean(opts.heliusApiKey);
  const accounts = useHelius
    ? await viaHelius(opts.heliusUrl ?? `https://mainnet.helius-rpc.com/?api-key=${opts.heliusApiKey}`, opts.token.mint)
    : await viaRpc(conn, opts.token);

  const byOwner = new Map<string, bigint>();
  for (const account of accounts) {
    if (account.amount > 0n) byOwner.set(account.owner, (byOwner.get(account.owner) ?? 0n) + account.amount);
  }

  const burnt = new Set([INCINERATOR, pumpBondingCurve(new PublicKey(opts.token.mint)).toBase58()]);
  const excludePdas = opts.excludePdas ?? true;
  const holders: SnapshotHolder[] = [];
  let excludedCount = 0;

  for (const [owner, balanceRaw] of byOwner) {
    if (burnt.has(owner) || (excludePdas && !isOnCurve(owner))) {
      excludedCount += 1;
      continue;
    }
    holders.push({ owner, balanceRaw });
  }

  holders.sort((a, b) =>
    b.balanceRaw === a.balanceRaw ? (a.owner < b.owner ? -1 : 1) : b.balanceRaw > a.balanceRaw ? 1 : -1,
  );

  return { slot, source: useHelius ? 'helius' : 'rpc', holders, excludedCount, ownerCount: byOwner.size };
}

export function isOnCurve(owner: string): boolean {
  try {
    return PublicKey.isOnCurve(new PublicKey(owner).toBytes());
  } catch {
    return false;
  }
}

async function viaRpc(conn: Connection, token: TokenInfo): Promise<RawAccount[]> {
  if (isPublicMainnetRpc(conn.rpcEndpoint)) {
    throw new Error('Holder scans need a dedicated RPC (Helius/Triton/QuickNode). Set SOLANA_RPC_URL or HELIUS_API_KEY.');
  }
  const mint = new PublicKey(token.mint);
  const accounts = await conn.getProgramAccounts(token.programId, {
    commitment: 'confirmed',
    filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
  });

  const out: RawAccount[] = [];
  for (const { pubkey, account } of accounts) {
    try {
      const decoded = unpackAccount(pubkey, account, token.programId);
      if (!decoded.mint.equals(mint) || decoded.isFrozen) continue;
      out.push({ owner: decoded.owner.toBase58(), amount: decoded.amount });
    } catch {
      // Not a token-account layout (e.g. the mint itself under Token-2022).
    }
  }
  return out;
}

interface HeliusPage {
  error?: { message: string };
  result?: {
    token_accounts?: Array<{ owner: string; amount: number | string; frozen?: boolean }>;
    cursor?: string;
  };
}

async function viaHelius(url: string, mint: string): Promise<RawAccount[]> {
  const out: RawAccount[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10_000; page += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'ustr-snapshot',
        method: 'getTokenAccounts',
        params: { mint, limit: 1000, ...(cursor ? { cursor } : {}) },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`Helius getTokenAccounts -> ${res.status}`);
    // Amounts arrive as JSON numbers; quote them first so balances above
    // 2^53 raw units survive parsing exactly.
    const text = (await res.text()).replace(/"amount"\s*:\s*(\d+)/g, '"amount":"$1"');
    const json = JSON.parse(text) as HeliusPage;
    if (json.error) throw new Error(`Helius: ${json.error.message}`);
    const accounts = json.result?.token_accounts ?? [];
    for (const account of accounts) {
      if (account.frozen) continue;
      out.push({ owner: account.owner, amount: BigInt(account.amount) });
    }
    cursor = json.result?.cursor;
    if (!cursor || accounts.length === 0) break;
  }
  return out;
}
