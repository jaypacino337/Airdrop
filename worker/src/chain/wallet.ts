import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Accepts either the base58 string Phantom/Solflare export, or the JSON byte
 * array `solana-keygen` writes. Nothing is ever logged from here.
 */
export function keypairFromSecret(secret: string): Keypair {
  const trimmed = secret.trim();
  if (!trimmed) throw new Error('CREATOR_PRIVATE_KEY is empty');

  if (trimmed.startsWith('[')) {
    let bytes: number[];
    try {
      bytes = JSON.parse(trimmed) as number[];
    } catch {
      throw new Error('CREATOR_PRIVATE_KEY looks like JSON but could not be parsed');
    }
    if (!Array.isArray(bytes) || (bytes.length !== 64 && bytes.length !== 32)) {
      throw new Error('CREATOR_PRIVATE_KEY JSON must be a 32 or 64 byte array');
    }
    return bytes.length === 64
      ? Keypair.fromSecretKey(Uint8Array.from(bytes))
      : Keypair.fromSeed(Uint8Array.from(bytes));
  }

  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(trimmed);
  } catch {
    throw new Error('CREATOR_PRIVATE_KEY is not valid base58 (or a JSON byte array)');
  }
  if (decoded.length === 64) return Keypair.fromSecretKey(decoded);
  if (decoded.length === 32) return Keypair.fromSeed(decoded);
  throw new Error(`CREATOR_PRIVATE_KEY decoded to ${decoded.length} bytes; expected 32 or 64`);
}
