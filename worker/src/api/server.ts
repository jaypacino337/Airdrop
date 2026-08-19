import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Context } from '../context.js';
import { isCycleRunning, runCycle } from '../cycle.js';
import { errorMessage, log } from '../logger.js';
import { formatUi } from '../util/amount.js';

export interface ServerDeps {
  ctx: Context;
  nextRunAt: () => number;
}

/**
 * A small read-only API in front of Supabase, plus a token-protected manual
 * trigger. Railway health checks hit GET /health.
 */
export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const { ctx } = deps;
  const app = Fastify({ logger: false, trustProxy: true });

  const origins = ctx.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  await app.register(cors, { origin: origins.includes('*') ? true : origins });

  app.get('/health', async () => ({
    status: 'ok',
    dryRun: ctx.env.DRY_RUN,
    cycleRunning: isCycleRunning(),
    nextRunAt: new Date(deps.nextRunAt()).toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  }));

  app.get('/api/config', async () => ({
    projectTokenMint: ctx.env.PROJECT_TOKEN_MINT,
    projectTokenDecimals: ctx.projectMint.decimals,
    rewardTokenMint: ctx.env.REWARD_TOKEN_MINT,
    rewardTokenDecimals: ctx.rewardMint.decimals,
    distributor: ctx.wallet.publicKey.toBase58(),
    cycleIntervalMs: ctx.env.CYCLE_INTERVAL_MS,
    minEligibleTokens: ctx.env.MIN_ELIGIBLE_TOKENS,
    maxWalletShareBps: ctx.env.MAX_WALLET_SHARE_BPS,
    dryRun: ctx.env.DRY_RUN,
    nextRunAt: new Date(deps.nextRunAt()).toISOString(),
  }));

  app.get('/api/stats', async () => {
    const stats = await ctx.repo.stats();
    return { ...stats, nextRunAt: new Date(deps.nextRunAt()).toISOString() };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/cycles', async (request) => {
    const limit = clampLimit(request.query.limit, 20, 100);
    return { cycles: await ctx.repo.lastCycles(limit) };
  });

  app.get<{ Params: { id: string } }>('/api/cycles/:id', async (request, reply) => {
    const cycle = await ctx.repo.cycleById(request.params.id);
    if (!cycle) return reply.code(404).send({ error: 'cycle not found' });
    return cycle;
  });

  app.get<{ Querystring: { limit?: string } }>('/api/leaderboard', async (request) => {
    const limit = clampLimit(request.query.limit, 50, 200);
    return { leaderboard: await ctx.repo.leaderboard(limit) };
  });

  app.get<{ Params: { address: string } }>('/api/wallet/:address', async (request, reply) => {
    const address = request.params.address.trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return reply.code(400).send({ error: 'not a valid Solana address' });
    }
    const [totals, history] = await Promise.all([
      ctx.repo.walletTotals(address),
      ctx.repo.walletHistory(address, 25),
    ]);
    return {
      address,
      totalReceivedRaw: totals.total_received_raw,
      totalReceivedUi: formatUi(BigInt(totals.total_received_raw || '0'), ctx.rewardMint.decimals, 6),
      payoutCount: totals.payout_count,
      history,
    };
  });

  app.get<{ Querystring: { limit?: string } }>('/api/events', async (request) => {
    const limit = clampLimit(request.query.limit, 25, 100);
    return { events: await ctx.repo.recentEvents(limit) };
  });

  app.post('/api/admin/run-cycle', async (request, reply) => {
    const token = ctx.env.ADMIN_TOKEN;
    if (!token) return reply.code(503).send({ error: 'ADMIN_TOKEN is not configured' });
    const provided = (request.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (provided !== token) return reply.code(401).send({ error: 'unauthorized' });
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
