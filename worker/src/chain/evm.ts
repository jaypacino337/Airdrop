import { Contract, Interface, JsonRpcProvider, Wallet, type TransactionResponse } from 'ethers';
import type { Env } from '../env.js';
import { log } from '../logger.js';

export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

export const erc20Interface = new Interface(ERC20_ABI);
export const TRANSFER_TOPIC = erc20Interface.getEvent('Transfer')!.topicHash;

let provider: JsonRpcProvider | undefined;

export function getProvider(env: Env): JsonRpcProvider {
  if (!provider) {
    provider = new JsonRpcProvider(env.EVM_RPC_URL, undefined, {
      staticNetwork: true,
      batchMaxCount: 10,
    });
  }
  return provider;
}

export function getWallet(env: Env): Wallet {
  const key = env.TREASURY_PRIVATE_KEY.trim();
  return new Wallet(key.startsWith('0x') ? key : `0x${key}`, getProvider(env));
}

export function erc20(env: Env, address: string): Contract {
  return new Contract(address, ERC20_ABI, getWallet(env));
}

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
}

/**
 * Reads a token's decimals and symbol from chain and refuses to continue if
 * the address is not actually a token — the cheapest possible guard against
 * a mistyped address receiving real transfers.
 */
export async function resolveToken(env: Env, address: string): Promise<TokenInfo> {
  const contract = erc20(env, address);
  try {
    const [decimals, symbol] = await Promise.all([
      contract.getFunction('decimals')() as Promise<bigint>,
      (contract.getFunction('symbol')() as Promise<string>).catch(() => '?'),
    ]);
    return { address: address.toLowerCase(), symbol, decimals: Number(decimals) };
  } catch (err) {
    throw new Error(`Address ${address} does not answer decimals() — is it really an ERC-20 on this chain?`);
  }
}

/** Send a tx and wait for one confirmation, bounded by TX_TIMEOUT_MS. */
export async function waitForTx(
  env: Env,
  response: TransactionResponse,
  label: string,
): Promise<void> {
  const receipt = await response.wait(1, env.TX_TIMEOUT_MS);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`transaction ${response.hash} (${label}) reverted`);
  }
  log.debug('transaction confirmed', { label, hash: response.hash, block: receipt.blockNumber });
}

export async function assertChain(env: Env): Promise<void> {
  if (!env.CHAIN_ID) return;
  const network = await getProvider(env).getNetwork();
  if (Number(network.chainId) !== env.CHAIN_ID) {
    throw new Error(
      `RPC reports chain id ${network.chainId}, but CHAIN_ID=${env.CHAIN_ID} was configured — wrong network?`,
    );
  }
}
