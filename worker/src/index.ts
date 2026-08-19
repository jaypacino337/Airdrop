import { getContext } from './context.js';
import { createServer } from './api/server.js';
import { runCycle } from './cycle.js';
import { loadEnv } from './env.js';
import { errorMessage, log, setLogLevel } from './logger.js';

/**
 * Railway entry point. One process runs both the 5-minute cycle loop and the
 * small read API the website and health check use.
 */
async function main(): Promise<void> {
  const env = loadEnv();
  setLogLevel(env.LOG_LEVEL);

  const ctx = await getContext(env);

  let timer: NodeJS.Timeout | undefined;
  let nextRunAt = Date.now() + (env.RUN_ON_BOOT ? 0 : env.CYCLE_INTERVAL_MS);
  let stopping = false;

  const app = await createServer({ ctx, nextRunAt: () => nextRunAt });
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  log.info('http server listening', { port: env.PORT });

  const tick = async (): Promise<void> => {
    if (stopping) return;
    nextRunAt = Date.now() + env.CYCLE_INTERVAL_MS;
    try {
      await runCycle(ctx);
    } catch (err) {
      // runCycle already records failures; this only catches the truly unexpected.
      log.error('unhandled cycle error', { error: errorMessage(err) });
    }
    if (!stopping) timer = setTimeout(() => void tick(), Math.max(0, nextRunAt - Date.now()));
  };

  if (env.RUN_ON_BOOT) {
    void tick();
  } else {
    timer = setTimeout(() => void tick(), env.CYCLE_INTERVAL_MS);
  }

  log.info('scheduler started', {
    intervalMs: env.CYCLE_INTERVAL_MS,
    runOnBoot: env.RUN_ON_BOOT,
    dryRun: env.DRY_RUN,
  });

  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down', { signal });
    if (timer) clearTimeout(timer);
    await app.close().catch(() => undefined);
    // Give an in-flight cycle a moment to finish writing its Supabase rows.
    setTimeout(() => process.exit(0), 3_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) =>
    log.error('unhandled rejection', { error: errorMessage(reason) }),
  );
}

main().catch((err) => {
  log.error('fatal startup error', { error: errorMessage(err) });
  process.exit(1);
});
