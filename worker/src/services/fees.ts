import type { Connection, PublicKey } from '@solana/web3.js';
import type { Context } from '../context.js';
import { errorMessage, log } from '../logger.js';
import {
  NATIVE_MINT,
  pumpAmmCreatorVaultAuthority,
  pumpCreatorVault,
  pumpPortalLocal,
  sendPumpPortalTx,
} from '../chain/solana.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';

/**
 * Fee income: claim the treasury's pump.fun creator fees (bonding curve and
 * PumpSwap) into the treasury wallet. Ported from the memcoinz `pump-claim`
 * skill. The claim goes through PumpPortal's local-transaction API: PumpPortal
 * builds the transaction, the engine signs it — no API key, and the key never
 * leaves the process. One claim sweeps every coin this creator launched.
 */

export interface ClaimResult {
  status: 'claimed' | 'skipped' | 'disabled';
  /** Best-effort view of what the vaults held (rent stays in the curve vault). */
  claimableRaw: bigint;
  /** Lamports that actually landed in the treasury, net of fees. */
  claimedRaw: bigint;
  txId?: string;
  reason?: string;
}

export async function claimable(conn: Connection, creator: PublicKey) {
  const bondingVault = pumpCreatorVault(creator);
  const ammWsol = getAssociatedTokenAddressSync(NATIVE_MINT, pumpAmmCreatorVaultAuthority(creator), true);
  const [bondingLamports, rent, ammBalance] = await Promise.all([
    conn.getBalance(bondingVault, 'confirmed'),
    conn.getMinimumBalanceForRentExemption(0),
    conn.getTokenAccountBalance(ammWsol, 'confirmed').catch(() => null),
  ]);
  const bonding = BigInt(Math.max(0, bondingLamports - rent));
  const amm = BigInt(ammBalance?.value.amount ?? '0');
  return { bonding, amm, total: bonding + amm };
}

export async function claimCreatorFees(ctx: Context): Promise<ClaimResult> {
  const { env, conn, treasury } = ctx;
  if (env.FEE_CLAIM === 'disabled') return { status: 'disabled', claimableRaw: 0n, claimedRaw: 0n };

  let available: Awaited<ReturnType<typeof claimable>>;
  try {
    available = await claimable(conn, treasury.publicKey);
  } catch (err) {
    return { status: 'skipped', claimableRaw: 0n, claimedRaw: 0n, reason: `vault read failed: ${errorMessage(err).slice(0, 160)}` };
  }

  if (available.total < BigInt(env.MIN_CLAIM_LAMPORTS)) {
    return { status: 'skipped', claimableRaw: available.total, claimedRaw: 0n, reason: 'creator fees below MIN_CLAIM_LAMPORTS, rolls over' };
  }
  if (env.DRY_RUN) {
    return { status: 'skipped', claimableRaw: available.total, claimedRaw: 0n, reason: 'dry run' };
  }

  try {
    const before = BigInt(await conn.getBalance(treasury.publicKey, 'confirmed'));
    const bytes = await pumpPortalLocal({
      publicKey: treasury.publicKey.toBase58(),
      action: 'collectCreatorFee',
      priorityFee: env.PUMPPORTAL_PRIORITY_FEE_SOL,
      pool: 'pump',
    });
    const txId = await sendPumpPortalTx(conn, bytes, treasury);
    const after = BigInt(await conn.getBalance(treasury.publicKey, 'confirmed'));
    const claimedRaw = after > before ? after - before : 0n;
    log.info('creator fees claimed', { txId, claimedLamports: claimedRaw.toString() });
    return { status: 'claimed', claimableRaw: available.total, claimedRaw, txId };
  } catch (err) {
    // A failed claim never blocks the airdrop: the fees stay in the vault.
    return { status: 'skipped', claimableRaw: available.total, claimedRaw: 0n, reason: `claim failed: ${errorMessage(err).slice(0, 200)}` };
  }
}
