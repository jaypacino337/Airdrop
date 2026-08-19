import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import type { Env } from '../env.js';
import { errorMessage, log } from '../logger.js';
import { buildV0Transaction, deserializeTransaction, sendAndConfirm, withComputeBudget } from '../chain/tx.js';
import { fetchBytes } from '../util/http.js';
import { lamportsToSol, priorityFeeSol } from '../util/amount.js';

export interface ClaimResult {
  status: 'claimed' | 'skipped' | 'disabled';
  signature?: string;
  claimedLamports: bigint;
  reason?: string;
}

/**
 * pump.fun pays coin creators a share of trading fees. This claims whatever
 * has accrued to the creator wallet so the next leg can spend it on the reward
 * tokens.
 */
export async function claimCreatorFees(
  env: Env,
  connection: Connection,
  creator: Keypair,
): Promise<ClaimResult> {
  if (env.CLAIM_PROVIDER === 'disabled') {
    return { status: 'disabled', claimedLamports: 0n, reason: 'CLAIM_PROVIDER=disabled' };
  }

  const before = BigInt(await connection.getBalance(creator.publicKey, 'confirmed'));

  if (env.DRY_RUN) {
    log.info('dry run: skipping creator-fee claim', { wallet: creator.publicKey.toBase58() });
    return { status: 'skipped', claimedLamports: 0n, reason: 'dry run' };
  }

  let signature: string;
  try {
    signature =
      env.CLAIM_PROVIDER === 'pumpportal'
        ? await claimViaPumpPortal(env, connection, creator)
        : await claimOnChain(env, connection, creator);
  } catch (err) {
    const message = errorMessage(err);
    // "nothing to claim" is a normal outcome, not a failure.
    if (/no.*(fee|creator).*(to collect|available)|insufficient/i.test(message)) {
      return { status: 'skipped', claimedLamports: 0n, reason: message.slice(0, 200) };
    }
    throw err;
  }

  const after = BigInt(await connection.getBalance(creator.publicKey, 'confirmed'));
  const delta = after > before ? after - before : 0n;

  log.info('creator fees claimed', {
    signature,
    claimedSol: lamportsToSol(delta),
    provider: env.CLAIM_PROVIDER,
  });

  return { status: 'claimed', signature, claimedLamports: delta };
}

async function claimViaPumpPortal(env: Env, connection: Connection, creator: Keypair): Promise<string> {
  return sendAndConfirm(
    connection,
    env,
    creator,
    async () => {
      const bytes = await fetchBytes({
        url: `${env.PUMPPORTAL_BASE_URL}/api/trade-local`,
        method: 'POST',
        body: {
          publicKey: creator.publicKey.toBase58(),
          action: 'collectCreatorFee',
          priorityFee: priorityFeeSol(env.PRIORITY_FEE_MICROLAMPORTS),
        },
        timeoutMs: 30_000,
      });
      return deserializeTransaction(bytes);
    },
    { label: 'claim:pumpportal' },
  );
}

// --- Experimental direct-program path ---------------------------------------
// Verify these against the current pump.fun IDL before switching a live
// deployment to CLAIM_PROVIDER=onchain. Every transaction is simulated before
// it is sent, so a stale layout fails safely instead of burning SOL.
const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const CREATOR_VAULT_SEED = Buffer.from('creator-vault');
const EVENT_AUTHORITY_SEED = Buffer.from('__event_authority');

function anchorDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

async function claimOnChain(env: Env, connection: Connection, creator: Keypair): Promise<string> {
  const [creatorVault] = PublicKey.findProgramAddressSync(
    [CREATOR_VAULT_SEED, creator.publicKey.toBuffer()],
    PUMP_PROGRAM_ID,
  );
  const [eventAuthority] = PublicKey.findProgramAddressSync([EVENT_AUTHORITY_SEED], PUMP_PROGRAM_ID);

  const instruction = new TransactionInstruction({
    programId: PUMP_PROGRAM_ID,
    keys: [
      { pubkey: creator.publicKey, isSigner: true, isWritable: true },
      { pubkey: creatorVault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: eventAuthority, isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator('collect_creator_fee'),
  });

  return sendAndConfirm(
    connection,
    env,
    creator,
    async () => {
      const { transaction } = await buildV0Transaction(
        connection,
        creator.publicKey,
        withComputeBudget([instruction], env, 120_000),
      );
      return transaction;
    },
    { label: 'claim:onchain' },
  );
}
