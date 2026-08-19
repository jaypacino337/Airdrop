import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getExtensionTypes,
  getMint,
  unpackMint,
} from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import { log } from '../logger.js';

export interface MintInfo {
  mint: PublicKey;
  decimals: number;
  /** SPL Token or Token-2022 — xStocks style assets use the latter. */
  programId: PublicKey;
  supplyRaw: bigint;
  hasTransferHook: boolean;
  hasTransferFee: boolean;
}

/**
 * Reads a mint and works out which token program owns it. Getting this wrong
 * is the single most common cause of "invalid account owner" failures, so we
 * resolve it once at boot and pass it around.
 */
export async function resolveMint(connection: Connection, mintAddress: string): Promise<MintInfo> {
  const mint = new PublicKey(mintAddress);
  const account = await connection.getAccountInfo(mint, 'confirmed');
  if (!account) throw new Error(`Mint ${mintAddress} does not exist on this cluster`);

  const programId = account.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : account.owner.equals(TOKEN_PROGRAM_ID)
      ? TOKEN_PROGRAM_ID
      : (() => {
          throw new Error(`Mint ${mintAddress} is owned by ${account.owner.toBase58()}, not a token program`);
        })();

  const info = await getMint(connection, mint, 'confirmed', programId);

  let hasTransferHook = false;
  let hasTransferFee = false;
  if (programId.equals(TOKEN_2022_PROGRAM_ID)) {
    const unpacked = unpackMint(mint, account, programId);
    const extensions = getExtensionTypes(unpacked.tlvData);
    hasTransferHook = extensions.includes(ExtensionType.TransferHook);
    hasTransferFee = extensions.includes(ExtensionType.TransferFeeConfig);
    log.info('token-2022 mint detected', {
      mint: mintAddress,
      extensions: extensions.map((e) => ExtensionType[e] ?? e),
    });
  }

  return {
    mint,
    decimals: info.decimals,
    programId,
    supplyRaw: info.supply,
    hasTransferHook,
    hasTransferFee,
  };
}
