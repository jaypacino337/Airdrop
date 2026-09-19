import { getAddress } from 'ethers';
import type { Env } from '../env.js';
import type { Repo } from '../db/repo.js';
import { errorMessage, log } from '../logger.js';
import { retry } from '../util/async.js';
import { TRANSFER_TOPIC, erc20Interface, getProvider } from './evm.js';

const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * Maintains the USTR holder index in Supabase from Transfer logs.
 *
 * Instead of re-scanning the whole chain every five minutes, the indexer
 * remembers the last block it has applied and only folds in the delta. If
 * the stored state belongs to a different token address it starts over.
 *
 * Returns the block number the index is now current to.
 */
export async function updateHolderIndex(env: Env, repo: Repo): Promise<number> {
  const provider = getProvider(env);
  const token = env.PROJECT_TOKEN_ADDRESS.toLowerCase();

  const head = await provider.getBlockNumber();
  const state = await repo.indexerState();

  let from =
    state && state.token_address === token
      ? state.last_block + 1
      : env.PROJECT_TOKEN_DEPLOY_BLOCK;

  if (state && state.token_address !== token) {
    log.warn('project token changed — rebuilding the holder index from scratch');
    await repo.resetHolders();
  }

  if (from > head) return head;

  const deltas = new Map<string, bigint>();

  while (from <= head) {
    const to = Math.min(from + env.LOG_SCAN_CHUNK - 1, head);
    const logs = await retry(
      () =>
        provider.getLogs({
          address: token,
          topics: [TRANSFER_TOPIC],
          fromBlock: from,
          toBlock: to,
        }),
      { attempts: 4, baseDelayMs: 800, label: 'getLogs' },
    );

    for (const entry of logs) {
      let parsed;
      try {
        parsed = erc20Interface.parseLog({ topics: [...entry.topics], data: entry.data });
      } catch {
        continue;
      }
      if (!parsed) continue;
      const sender = (parsed.args[0] as string).toLowerCase();
      const receiver = (parsed.args[1] as string).toLowerCase();
      const value = parsed.args[2] as bigint;
      if (value === 0n) continue;
      if (sender !== ZERO) deltas.set(sender, (deltas.get(sender) ?? 0n) - value);
      if (receiver !== ZERO) deltas.set(receiver, (deltas.get(receiver) ?? 0n) + value);
    }

    from = to + 1;
  }

  if (deltas.size > 0) {
    await repo.applyBalanceDeltas(deltas);
    log.info('holder index updated', { touched: deltas.size, head });
  }

  await repo.setIndexerState(token, head);

  // Classify newly-seen addresses so pools and routers can be excluded.
  if (env.EXCLUDE_CONTRACT_HOLDERS) {
    const unknown = await repo.holdersWithUnknownKind(50);
    for (const address of unknown) {
      try {
        const code = await provider.getCode(getAddress(address));
        await repo.markHolderKind(address, code !== '0x');
      } catch (err) {
        log.warn('getCode failed; will retry next cycle', { address, error: errorMessage(err) });
      }
    }
  }

  return head;
}
