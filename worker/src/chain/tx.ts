import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import type { Env } from '../env.js';
import { errorMessage, log } from '../logger.js';
import { retry, sleep } from '../util/async.js';

export interface SendOptions {
  label: string;
  /** Skip simulation (used when a provider already simulated for us). */
  skipSimulation?: boolean;
}

/** Prepend compute-budget instructions so the tx lands under load. */
export function withComputeBudget(
  instructions: TransactionInstruction[],
  env: Env,
  computeUnitLimit = 400_000,
): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: env.PRIORITY_FEE_MICROLAMPORTS }),
    ...instructions,
  ];
}

export async function buildV0Transaction(
  connection: Connection,
  payer: PublicKey,
  instructions: TransactionInstruction[],
): Promise<{ transaction: VersionedTransaction; lastValidBlockHeight: number }> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  return { transaction: new VersionedTransaction(message), lastValidBlockHeight };
}

/** Deserialise a provider-supplied transaction, versioned or legacy. */
export function deserializeTransaction(bytes: Uint8Array): VersionedTransaction {
  try {
    return VersionedTransaction.deserialize(bytes);
  } catch {
    const legacy = Transaction.from(Buffer.from(bytes));
    const message = new TransactionMessage({
      payerKey: legacy.feePayer ?? legacy.instructions[0]!.keys[0]!.pubkey,
      recentBlockhash: legacy.recentBlockhash!,
      instructions: legacy.instructions,
    }).compileToV0Message();
    return new VersionedTransaction(message);
  }
}

export async function simulate(
  connection: Connection,
  transaction: VersionedTransaction,
): Promise<void> {
  const sim = await connection.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'confirmed',
  });
  if (sim.value.err) {
    const logs = (sim.value.logs ?? []).slice(-12).join('\n');
    throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}\n${logs}`);
  }
}

/** Poll signature status until confirmed, or throw on timeout / on-chain error. */
export async function confirmSignature(
  connection: Connection,
  signature: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let delay = 800;
  while (Date.now() < deadline) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: false,
    });
    const status = value[0];
    if (status) {
      if (status.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') return;
    }
    await sleep(delay);
    delay = Math.min(delay * 1.4, 3_000);
  }
  throw new Error(`timed out waiting for confirmation of ${signature}`);
}

/**
 * Sign, (optionally) simulate, send and confirm. Retries rebuild nothing —
 * the caller passes a factory so each attempt gets a fresh blockhash.
 */
export async function sendAndConfirm(
  connection: Connection,
  env: Env,
  signer: Keypair,
  build: () => Promise<VersionedTransaction>,
  options: SendOptions,
): Promise<string> {
  return retry(
    async (attempt) => {
      const transaction = await build();
      transaction.sign([signer]);

      if (!options.skipSimulation) await simulate(connection, transaction);

      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
      });
      log.debug('transaction sent', { label: options.label, signature, attempt });
      await confirmSignature(connection, signature, env.CONFIRM_TIMEOUT_MS);
      log.info('transaction confirmed', { label: options.label, signature });
      return signature;
    },
    {
      attempts: env.MAX_TX_ATTEMPTS,
      baseDelayMs: 1_200,
      maxDelayMs: 10_000,
      onAttemptFailed: (attempt, err) =>
        log.warn('transaction attempt failed', {
          label: options.label,
          attempt,
          error: errorMessage(err),
        }),
    },
  );
}
