import type { PgBoss } from 'pg-boss';
import { QUEUES } from '../queue.js';

export interface OutboxEvent {
  id: string;
  eventType: string;
  payload: unknown;
  branchId: string | null;
}

export interface EventPublisher {
  publish(event: OutboxEvent): Promise<void>;
}

export class PgBossPublisher implements EventPublisher {
  constructor(private readonly boss: PgBoss) {}

  async publish(event: OutboxEvent): Promise<void> {
    await this.boss.send(
      QUEUES.DOMAIN_EVENTS,
      {
        eventId: event.id,
        eventType: event.eventType,
        payload: event.payload,
        branchId: event.branchId,
      },
      { singletonKey: event.id },
    );
  }
}
