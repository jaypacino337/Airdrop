/**
 * End-to-end run of the real engine against a local solana-test-validator.
 *
 *   npm run e2e:localnet --workspace worker
 *
 * Spawns `solana-test-validator` (must be on PATH) on a throwaway ledger
 * unless LOCALNET_RPC_URL points at one already running. Refuses to run
 * against any public cluster. Uses the in-memory ledger (same semantics as
 * the Supabase one) because there is no PostgREST here.
 *
 * What it proves, on a real chain:
 *  1. DRY_RUN moves nothing but stages the full allocation.
 *  2. A live cycle pays every eligible holder of a 6-decimal SPL project
 *     token in a Token-2022 reward AND an SPL reward (50/50 weights):
 *     500k minimum, 4% cap, PDA / treasury / minnow excluded, ATAs created.
 *  3. Crash between broadcast and confirmation: the next cycle reconciles the
 *     signature from the ledger and pays nobody twice.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, type SendOptions } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { buildContext } from '../src/context.js';
import { runCycle } from '../src/cycle.js';
import { loadEnv, resetEnv } from '../src/env.js';
import { setLogLevel } from '../src/logger.js';
import { MemoryRepo } from '../test/support/memory-repo.js';

const RPC = process.env.LOCALNET_RPC_URL ?? 'http://127.0.0.1:8899';
const UNIT = 1_000_000n;
let validator: ChildProcess | undefined;
let ledgerDir: string | undefined;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`E2E FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
}

async function rpcUp(conn: Connection): Promise<boolean> {
  try {
    await conn.getVersion();
    return true;
  } catch {
    return false;
  }
}

async function ensureValidator(conn: Connection): Promise<void> {
  if (await rpcUp(conn)) return;
  ledgerDir = mkdtempSync(path.join(tmpdir(), 'ustr-ledger-'));
  console.log(`starting solana-test-validator (ledger ${ledgerDir})`);
  validator = spawn('solana-test-validator', ['--reset', '--quiet', '--ledger', ledgerDir], { stdio: 'ignore' });
  for (let i = 0; i < 120; i += 1) {
    if (await rpcUp(conn)) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error('solana-test-validator did not come up');
}

async function fund(conn: Connection, key: PublicKey, sol: number): Promise<void> {
  const sig = await conn.requestAirdrop(key, sol * LAMPORTS_PER_SOL);
  const latest = await conn.getLatestBlockhash();
  await conn.confirmTransaction({ signature: sig, ...latest }, 'confirmed');
}

async function balanceOf(conn: Connection, mint: PublicKey, owner: PublicKey, programId: PublicKey): Promise<bigint> {
  const { value } = await conn.getTokenAccountsByOwner(owner, { mint, programId });
  let total = 0n;
  for (const { pubkey } of value) total += BigInt((await conn.getTokenAccountBalance(pubkey)).value.amount);
  return total;
}

async function main(): Promise<void> {
  setLogLevel((process.env.LOG_LEVEL as 'info') ?? 'warn');
  const conn = new Connection(RPC, 'confirmed');
  await ensureValidator(conn);
  const genesis = await conn.getGenesisHash();
  if (
    ['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d', 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY'].includes(genesis)
  ) {
    throw new Error('refusing to run the e2e against a public cluster');
  }
  console.log(`localnet ${RPC} (genesis ${genesis})`);

  // --- world -----------------------------------------------------------------
  const treasury = Keypair.generate();
  const authority = Keypair.generate();
  await fund(conn, treasury.publicKey, 50);
  await fund(conn, authority.publicKey, 50);

  const project = await createMint(conn, authority, authority.publicKey, null, 6, Keypair.generate(), undefined, TOKEN_PROGRAM_ID);
  const uranium = await createMint(conn, authority, authority.publicKey, null, 9, Keypair.generate(), undefined, TOKEN_2022_PROGRAM_ID);
  const usdc = await createMint(conn, authority, authority.publicKey, null, 6, Keypair.generate(), undefined, TOKEN_PROGRAM_ID);

  const give = async (mint: PublicKey, owner: PublicKey, amount: bigint, programId = TOKEN_PROGRAM_ID, offCurve = false) => {
    const ata = await getOrCreateAssociatedTokenAccount(conn, authority, mint, owner, offCurve, 'confirmed', undefined, programId);
    await mintTo(conn, authority, mint, ata.address, authority, amount, [], undefined, programId);
  };

  const holders: PublicKey[] = [];
  for (let i = 0; i < 25; i += 1) {
    const owner = Keypair.generate().publicKey;
    holders.push(owner);
    await give(project, owner, (600_000n + BigInt(i) * 20_000n) * UNIT);
  }
  const whale = Keypair.generate().publicKey;
  await give(project, whale, 30_000_000n * UNIT);
  const minnow = Keypair.generate().publicKey;
  await give(project, minnow, 499_999n * UNIT);
  const pool = PublicKey.findProgramAddressSync([Buffer.from('pool')], TOKEN_PROGRAM_ID)[0];
  await give(project, pool, 80_000_000n * UNIT, TOKEN_PROGRAM_ID, true);
  await give(project, treasury.publicKey, 2_000_000n * UNIT);

  await give(uranium, treasury.publicKey, 1_000_000_000_000n, TOKEN_2022_PROGRAM_ID); // 1,000 URANIUM (9 dp)
  await give(usdc, treasury.publicKey, 500_000_000n); // 500 USDC-like (6 dp)
  console.log('world ready: 25 holders + whale + minnow + pool PDA + treasury');

  const makeEnv = (vars: Record<string, string>) => {
    resetEnv();
    const env = loadEnv({
      SUPABASE_URL: 'https://localnet.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'not-used-memory-ledger',
      SOLANA_RPC_URL: RPC,
      SOLANA_CLUSTER: 'localnet',
      TREASURY_SECRET_KEY: bs58.encode(treasury.secretKey),
      PROJECT_TOKEN_MINT: project.toBase58(),
      REWARD_TOKENS: `URANIUM:${uranium.toBase58()}:5000,USDC:${usdc.toBase58()}:5000`,
      PRIORITY_MICROLAMPORTS: '1000',
      ...vars,
    });
    resetEnv();
    return env;
  };
  const repo = new MemoryRepo();

  // --- 1. dry run -------------------------------------------------------------
  console.log('\n[1] DRY_RUN cycle (pump.fun vault read only)');
  const dry = await runCycle(await buildContext(makeEnv({ FEE_CLAIM: 'pumpfun' }), { conn, repo }));
  check(dry.status === 'skipped', 'dry run cycle is "skipped"');
  check(dry.eligibleCount === 26, `26 eligible wallets (got ${dry.eligibleCount})`);
  check(repo.payouts.length === 52 && repo.payouts.every((p) => p.status === 'skipped'), '52 payouts staged and marked skipped');
  check((await balanceOf(conn, uranium, whale, TOKEN_2022_PROGRAM_ID)) === 0n, 'nothing moved on chain');

  // --- 2. live ----------------------------------------------------------------
  console.log('\n[2] live cycle');
  const live = await runCycle(await buildContext(makeEnv({ DRY_RUN: 'false', FEE_CLAIM: 'disabled' }), { conn, repo }));
  check(live.status === 'completed', `live cycle completed (${live.txCount} txs, ${live.durationMs} ms)`);
  for (const [mint, programId, symbol] of [
    [uranium, TOKEN_2022_PROGRAM_ID, 'URANIUM (Token-2022)'],
    [usdc, TOKEN_PROGRAM_ID, 'USDC (SPL)'],
  ] as const) {
    const paid = repo.paidTo(mint.toBase58());
    check(paid.size === 26, `${symbol}: 26 wallets paid`);
    let onChainMatches = true;
    for (const [owner, amount] of paid) {
      if ((await balanceOf(conn, mint, new PublicKey(owner), programId)) !== amount) onChainMatches = false;
    }
    check(onChainMatches, `${symbol}: every on-chain balance equals the ledger's confirmed amount`);
    const pot = BigInt(live.rewards.find((r) => r.token === mint.toBase58())!.potRaw);
    check(paid.get(whale.toBase58()) === (pot * 400n) / 10_000n, `${symbol}: whale capped at exactly 4% of the pot`);
    for (const [name, owner] of [
      ['minnow', minnow],
      ['pool PDA', pool],
      ['treasury', treasury.publicKey],
    ] as const) {
      check(!paid.has(owner.toBase58()), `${symbol}: ${name} not paid`);
    }
  }

  // --- 3. crash between broadcast and confirmation ---------------------------
  console.log('\n[3] crash after broadcast, then resume');
  await mintTo(conn, authority, usdc, (await getOrCreateAssociatedTokenAccount(conn, authority, usdc, treasury.publicKey)).address, authority, 100_000_000n);
  const before = new Map<string, bigint>();
  for (const owner of [...holders, whale]) before.set(owner.toBase58(), await balanceOf(conn, usdc, owner, TOKEN_PROGRAM_ID));

  let crashed = false;
  const crashing = new Proxy(conn, {
    get(target, prop, receiver) {
      if (prop === 'sendRawTransaction') {
        return async (raw: Buffer, opts?: SendOptions) => {
          const sig = await target.sendRawTransaction(raw, opts);
          if (!crashed) {
            crashed = true;
            throw new Error('ECONNRESET: socket hang up (simulated crash after broadcast)');
          }
          return sig;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const crashCycle = await runCycle(await buildContext(makeEnv({ DRY_RUN: 'false', FEE_CLAIM: 'disabled' }), { conn: crashing, repo }));
  const inLimbo = repo.payouts.filter((p) => p.status === 'sent' && p.tx_id);
  check(crashed && inLimbo.length > 0, `crash left ${inLimbo.length} rows "sent" with their signature (cycle ${crashCycle.status})`);

  await new Promise((r) => setTimeout(r, 1_500)); // let the orphaned tx confirm
  const resume = await runCycle(await buildContext(makeEnv({ DRY_RUN: 'false', FEE_CLAIM: 'disabled' }), { conn, repo }));
  check(repo.payouts.every((p) => p.status === 'confirmed' || p.status === 'skipped'), `resume settled every row (cycle ${resume.status})`);

  const owedThisRound = new Map<string, bigint>();
  for (const p of repo.payouts) {
    if (p.token === usdc.toBase58() && p.status === 'confirmed' && p.cycle_id === crashCycle.cycleId) {
      owedThisRound.set(p.owner, (owedThisRound.get(p.owner) ?? 0n) + BigInt(p.amount_raw));
    }
  }
  let exactlyOnce = true;
  for (const [owner, prior] of before) {
    const now = await balanceOf(conn, usdc, new PublicKey(owner), TOKEN_PROGRAM_ID);
    if (now - prior !== (owedThisRound.get(owner) ?? 0n)) exactlyOnce = false;
  }
  check(exactlyOnce, 'every wallet received the crashed round exactly once on chain');

  console.log('\nE2E PASSED');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    validator?.kill('SIGINT');
    if (ledgerDir) rmSync(ledgerDir, { recursive: true, force: true });
    // web3.js keeps retrying its confirmation websocket after the validator stops.
    process.exit(process.exitCode ?? 0);
  });
