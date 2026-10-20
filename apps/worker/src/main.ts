import { createLogger, loadWorkerEnv } from './config.js';
import { startWorker } from './worker.js';

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const logger = createLogger(env);
  const worker = await startWorker(env, logger, { consumers: true });

  const shutdown = (signal: string): void => {
    worker.stop(signal).then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error({ err: error }, 'Worker did not stop cleanly');
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
