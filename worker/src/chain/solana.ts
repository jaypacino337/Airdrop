import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  Transaction,
  VersionedTransaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, unpackMint } from '@solana/spl-token';
import bs58 from 'bs58';
import type { Cluster, Env } from '../env.js';

/**
 * Solana plumbing for the engine. Ported from the memcoinz `solana-core`
 * skill (scripts/lib.ts) so the worker builds standalone in Docker.
 */

export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const PUMP_AMM_PROGRAM_ID = new PublicKey('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
export const NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112');
export const INCINERATOR = '1nc1nerator11111111111111111111111111111111';
export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const PUMPPORTAL_LOCAL = 'https://pumpportal.fun/api/trade-local';

/** Genesis hashes of the public clusters; localnet's is random per ledger. */
const GENESIS: Partial<Record<Cluster, string>> = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
};

export function getConnection(env: Env): Connection {
  return new Connection(env.SOLANA_RPC_URL, 'confirmed');
}

/** getProgramAccounts over a whole mint is rejected by the public endpoint. */
export function isPublicMainnetRpc(url: string): boolean {
  return url.includes('api.mainnet-beta.solana.com');
}

export async function assertCluster(conn: Connection, cluster: Cluster | ''): Promise<void> {
  if (!cluster) return;
  const expected = GENESIS[cluster];
  const actual = await conn.getGenesisHash();
  if (cluster === 'localnet') {
    if (Object.values(GENESIS).includes(actual)) {
      throw new Error(`SOLANA_CLUSTER=localnet, but the RPC is a public cluster (genesis ${actual})`);
    }
    return;
  }
  if (actual !== expected) {
    throw new Error(`RPC genesis hash ${actual} is not ${cluster} — wrong SOLANA_RPC_URL?`);
  }
}

/** A secret key as solana-keygen's JSON byte array or a base58 string (Phantom export). */
export function parseSecretKey(raw: string): Keypair {
  const text = raw.trim();
  const bytes = text.startsWith('[') ? Uint8Array.from(JSON.parse(text) as number[]) : bs58.decode(text);
  if (bytes.length !== 64) throw new Error(`secret key is ${bytes.length} bytes, expected 64`);
  return Keypair.fromSecretKey(bytes);
}

export function isValidSecretKey(raw: string): boolean {
  try {
    parseSecretKey(raw);
    return true;
  } catch {
    return false;
  }
}

export function isValidAddress(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

export interface TokenInfo {
  mint: string;
  /** SPL Token or Token-2022 — every ATA, transfer and burn needs the right one. */
  programId: PublicKey;
  decimals: number;
  supply: bigint;
}

/**
 * Reads the mint and refuses to continue if the address is not a mint owned
 * by one of the token programs — the cheapest guard against a mistyped
 * address receiving real transfers.
 */
export async function resolveToken(conn: Connection, mint: string): Promise<TokenInfo> {
  const key = new PublicKey(mint);
  const info = await conn.getAccountInfo(key, 'confirmed');
  if (!info) throw new Error(`Mint ${mint} not found on this RPC — wrong cluster?`);
  const programId = info.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : info.owner.equals(TOKEN_PROGRAM_ID)
      ? TOKEN_PROGRAM_ID
      : null;
  if (!programId) throw new Error(`${mint} is not a token mint (owner ${info.owner.toBase58()})`);
  const decoded = unpackMint(key, info, programId);
  return { mint, programId, decimals: decoded.decimals, supply: decoded.supply };
}

export function ataOf(token: TokenInfo, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(new PublicKey(token.mint), owner, true, token.programId);
}

/** Raw token balance of `owner`'s associated account (0 if it does not exist). */
export async function tokenBalance(conn: Connection, token: TokenInfo, owner: PublicKey): Promise<bigint> {
  const balance = await conn.getTokenAccountBalance(ataOf(token, owner), 'confirmed').catch(() => null);
  return BigInt(balance?.value.amount ?? '0');
}

// --- pump.fun PDAs -----------------------------------------------------------

/** Bonding-curve account for a mint (holds the curve's tokens pre-graduation). */
export function pumpBondingCurve(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], PUMP_PROGRAM_ID)[0];
}

export function pumpCreatorVault(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('creator-vault'), creator.toBuffer()], PUMP_PROGRAM_ID)[0];
}

export function pumpAmmCreatorVaultAuthority(creator: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('creator_vault'), creator.toBuffer()], PUMP_AMM_PROGRAM_ID)[0];
}

// --- sending -----------------------------------------------------------------

export function priorityIxs(microLamports: number, units?: number): TransactionInstruction[] {
  const ixs: TransactionInstruction[] = [];
  if (units) ixs.push(ComputeBudgetProgram.setComputeUnitLimit({ units }));
  if (microLamports > 0) ixs.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));
  return ixs;
}

export interface SignedTx {
  tx: Transaction;
  signature: string;
  blockhash: string;
  /** After this block height the tx can never land — a resend is then safe. */
  lastValidBlockHeight: number;
}

/**
 * Builds and signs a transaction and returns its signature *before* it is
 * sent, so the caller can write it to the ledger first. If the process dies
 * mid-send, the ledger still knows which signature to look up on restart.
 */
export async function buildSigned(
  conn: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): Promise<SignedTx> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: signers[0]!.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(...signers);
  return { tx, signature: bs58.encode(tx.signature!), blockhash, lastValidBlockHeight };
}

/** Thrown when the RPC refused the tx in preflight — it was never broadcast. */
export class RejectedTxError extends Error {
  override name = 'RejectedTxError';
}

/** Thrown when the tx landed but failed on chain — no funds moved. */
export class FailedTxError extends Error {
  override name = 'FailedTxError';
}

export async function broadcast(conn: Connection, built: SignedTx): Promise<void> {
  try {
    await conn.sendRawTransaction(built.tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  } catch (err) {
    // A JSON-RPC error from sendTransaction means the node refused it
    // (preflight failure, unhealthy node): it was never forwarded.
    if (err instanceof SendTransactionError) {
      const detail = err.transactionError;
      const tail = (detail.logs ?? []).slice(-3).join(' | ');
      throw new RejectedTxError(`${detail.message || err.message.split('\n')[0]}${tail ? ` — ${tail}` : ''}`);
    }
    throw err;
  }
}

export async function confirm(conn: Connection, built: Pick<SignedTx, 'signature' | 'blockhash' | 'lastValidBlockHeight'>): Promise<void> {
  const res = await conn.confirmTransaction(
    { signature: built.signature, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight },
    'confirmed',
  );
  if (res.value.err) throw new FailedTxError(`tx ${built.signature} failed: ${JSON.stringify(res.value.err)}`);
}

export async function sendIxs(conn: Connection, ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  const built = await buildSigned(conn, ixs, signers);
  await broadcast(conn, built);
  await confirm(conn, built);
  return built.signature;
}

// --- PumpPortal (build remotely, sign locally, no API key) --------------------

/** POSTs to PumpPortal's local-transaction API; returns the unsigned tx bytes. */
export async function pumpPortalLocal(body: Record<string, unknown>): Promise<Uint8Array> {
  const res = await fetch(PUMPPORTAL_LOCAL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status !== 200) {
    throw new Error(`PumpPortal ${String(body.action)} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Signs and sends a PumpPortal trade-local response (a serialized VersionedTransaction). */
export async function sendPumpPortalTx(conn: Connection, bytes: Uint8Array, signer: Keypair): Promise<string> {
  const tx = VersionedTransaction.deserialize(bytes);
  if (!tx.message.staticAccountKeys[0]?.equals(signer.publicKey)) {
    throw new Error('PumpPortal returned a transaction whose fee payer is not the treasury — refusing to sign');
  }
  tx.sign([signer]);
  const signature = bs58.encode(tx.signatures[0]!);
  const { lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  await conn.sendTransaction(tx, { maxRetries: 3 });
  await confirm(conn, { signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight });
  return signature;
}

export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Lamports -> "1.234567" SOL, display only. */
export function formatSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, '0').slice(0, 6).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Decimal SOL amount for PumpPortal's `amount` field (it takes SOL, not lamports). */
export function lamportsToSolNumber(lamports: bigint): number {
  return Number(lamports) / Number(LAMPORTS_PER_SOL);
}
