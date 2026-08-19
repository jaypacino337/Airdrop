import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { MintInfo } from './mint.js';

export interface TransferTarget {
  owner: string;
  amountRaw: bigint;
}

export function associatedTokenAddress(mintInfo: MintInfo, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    mintInfo.mint,
    owner,
    true, // allow PDAs / off-curve owners
    mintInfo.programId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
}

/**
 * Build the instructions that pay one batch of recipients.
 *
 * Destination token accounts that already exist are left alone; missing ones
 * get an idempotent create (paid for by the distributor, ~0.002 SOL each).
 */
export async function buildTransferInstructions(
  connection: Connection,
  mintInfo: MintInfo,
  source: PublicKey,
  authority: PublicKey,
  targets: readonly TransferTarget[],
): Promise<TransactionInstruction[]> {
  const owners = targets.map((t) => new PublicKey(t.owner));
  const destinations = owners.map((owner) => associatedTokenAddress(mintInfo, owner));

  const existing = await connection.getMultipleAccountsInfo(destinations, 'confirmed');

  const instructions: TransactionInstruction[] = [];

  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i]!;
    const owner = owners[i]!;
    const destination = destinations[i]!;

    if (!existing[i]) {
      instructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          authority,
          destination,
          owner,
          mintInfo.mint,
          mintInfo.programId,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
      );
    }

    if (mintInfo.hasTransferHook) {
      instructions.push(
        await createTransferCheckedWithTransferHookInstruction(
          connection,
          source,
          mintInfo.mint,
          destination,
          authority,
          target.amountRaw,
          mintInfo.decimals,
          [],
          'confirmed',
          mintInfo.programId,
        ),
      );
    } else {
      instructions.push(
        createTransferCheckedInstruction(
          source,
          mintInfo.mint,
          destination,
          authority,
          target.amountRaw,
          mintInfo.decimals,
          [],
          mintInfo.programId,
        ),
      );
    }
  }

  return instructions;
}

export async function getTokenBalanceRaw(
  connection: Connection,
  tokenAccount: PublicKey,
): Promise<bigint> {
  const info = await connection.getAccountInfo(tokenAccount, 'confirmed');
  if (!info || info.data.length < 72) return 0n;
  return info.data.readBigUInt64LE(64);
}
