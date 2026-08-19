/**
 * Run exactly one cycle and exit — handy for a first DRY_RUN=true smoke test,
 * or as a Railway cron job if you would rather not keep a process alive.
 *
 *   npm run cycle:once --workspace worker
 */
import { getContext } from '../context.js';
import { runCycle } from '../cycle.js';
import { loadEnv } from '../env.js';
import { errorMessage, log, setLogLevel } from '../logger.js';

async function main(): Promise<void> {
  const env = loadEnv();
  setLogLevel(env.LOG_LEVEL);
  const ctx = await getContext(env);
  const summary = await runCycle(ctx);
  log.info('run-once complete', summary);
  process.exit(summary.status === 'failed' ? 1 : 0);
}

main().catch((err) => {
  log.error('run-once failed', { error: errorMessage(err) });
  process.exit(1);
});
