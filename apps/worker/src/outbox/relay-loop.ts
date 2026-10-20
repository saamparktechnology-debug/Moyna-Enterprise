import type { Logger } from 'pino';
import type { OutboxRelay } from './relay.js';

export interface RelayLoop {
  stop(): Promise<void>;
}

export function startRelayLoop(
  relay: OutboxRelay,
  intervalMs: number,
  batchSize: number,
  logger: Logger,
): RelayLoop {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> = Promise.resolve();

  const tick = async (): Promise<void> => {
    let again = false;
    try {
      const result = await relay.relayBatch();
      again = result.published + result.retrying + result.failed >= batchSize;
    } catch (error) {
      logger.error({ err: error }, 'Outbox relay batch failed');
    }
    if (!stopped)
      timer = setTimeout(
        () => {
          running = tick();
        },
        again ? 0 : intervalMs,
      );
  };

  running = tick();
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running;
    },
  };
}
