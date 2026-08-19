import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Context } from '../context.js';
import { isCycleRunning, runCycle } from '../cycle.js';
import type { Env } from '../env.js';
import type { Repo } from '../db/repo.js';
import { errorMessage, log } from '../logger.js';
import type { Readiness } from '../readiness.js';
import { formatUi } from '../util/amount.js';

export interface ServerDeps {
  env: Env;
  repo: Repo;
  /** Null until the wallet and mints are configured — see readiness.ts. */
  ctx: Context | null;
  readiness: Readiness;
  nextRunAt: () => number;
}

/**
 * A small read-only API in front of Supabase, plus a token-protected manual
 * trigger. Railway health checks hit GET /health.
 */
export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { env, repo, ctx, readiness } = deps;
  const app = Fastify({ logger: false, trustProxy: true });

  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  await app.register(cors, { origin: origins.includes('*') ? true : origins });

  // Always 200 so a not-yet-configured deploy still passes its health check.
  app.get('/health', async () => ({
    status: readiness.ready ? 'ok' : 'standby',
    ready: readiness.ready,
    missing: readiness.missing,
    dryRun: env.DRY_RUN,
    cycleRunning: isCycleRunning(),
    nextRunAt: readiness.ready ? new Date(deps.nextRunAt()).toISOString() : null,
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get('/api/config', async () => ({
    ready: readiness.ready,
    missing: readiness.missing,
    projectTokenMint: env.PROJECT_TOKEN_MINT || null,
    projectTokenDecimals: ctx?.projectMint.decimals ?? null,
    rewardTokens: (ctx?.rewards ?? []).map((reward) => ({
      symbol: reward.symbol,
      mint: reward.mint,
      weightBps: reward.weightBps,
      decimals: reward.mintInfo.decimals,
    })),
    distributor: ctx?.wallet.publicKey.toBase58() ?? null,
    cycleIntervalMs: env.CYCLE_INTERVAL_MS,
    minEligibleTokens: env.MIN_ELIGIBLE_TOKENS,
    maxWalletShareBps: env.MAX_WALLET_SHARE_BPS,
    dryRun: env.DRY_RUN,
    nextRunAt: readiness.ready ? new Date(deps.nextRunAt()).toISOString() : null,
  }));

  app.get('/api/stats', async () => {
    const [stats, rewardTotals] = await Promise.all([repo.stats(), repo.rewardTotals()]);
    return { ...stats, rewardTotals, nextRunAt: new Date(deps.nextRunAt()).toISOString() };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/cycles', async (request) => {
    const limit = clampLimit(request.query.limit, 20, 100);
    return { cycles: await repo.lastCycles(limit) };
  });

  app.get<{ Params: { id: string } }>('/api/cycles/:id', async (request, reply) => {
    const cycle = await repo.cycleById(request.params.id);
    if (!cycle) return reply.code(404).send({ error: 'cycle not found' });
    return cycle;
  });

  app.get<{ Querystring: { limit?: string } }>('/api/leaderboard', async (request) => {
    const limit = clampLimit(request.query.limit, 50, 200);
    return { leaderboard: await repo.leaderboard(limit) };
  });

  app.get<{ Params: { address: string } }>('/api/wallet/:address', async (request, reply) => {
    const address = request.params.address.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return reply.code(400).send({ error: 'not a valid Solana address' });
    }
    const [totals, history] = await Promise.all([
      repo.walletTotals(address),
      repo.walletHistory(address, 50),
    ]);

    const decimalsByMint = new Map((ctx?.rewards ?? []).map((r) => [r.mint, r.mintInfo.decimals]));

    return {
      address,
      totals: totals.map((total) => ({
        mint: total.mint,
        symbol: total.symbol,
        totalReceivedRaw: total.total_received_raw,
        totalReceivedUi: formatUi(
          BigInt(total.total_received_raw || '0'),
          decimalsByMint.get(total.mint) ?? 0,
          6,
        ),
        payoutCount: total.payout_count,
      })),
      history,
    };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/events', async (request) => {
    const limit = clampLimit(request.query.limit, 25, 100);
    return { events: await repo.recentEvents(limit) };
  });

  app.post('/api/admin/run-cycle', async (request, reply) => {
    const token = env.ADMIN_TOKEN;
    if (!token) return reply.code(503).send({ error: 'ADMIN_TOKEN is not configured' });
    const provided = (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (provided !== token) return reply.code(401).send({ error: 'unauthorized' });
    if (!ctx) {
      return reply.code(503).send({ error: 'engine is in standby', missing: readiness.missing });
    }
    if (isCycleRunning()) return reply.code(409).send({ error: 'a cycle is already running' });

    log.info('manual cycle triggered via API');
    const summary = await runCycle(ctx);
    return summary;
  });

  app.setErrorHandler((error, _request, reply) => {
    log.error('api error', { error: errorMessage(error) });
    reply.code(500).send({ error: errorMessage(error) });
  });

  return app;
}

function clampLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}
