import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { TxClient } from '../prisma/scoped-prisma.service.js';

export interface OutboxEventInput {
  eventType: string;
  payload: Record<string, unknown>;
  branchId?: string | null;
}

@Injectable()
export class OutboxService {
  async enqueue(tx: TxClient, event: OutboxEventInput): Promise<string> {
    const id = randomUUID();
    await tx.$executeRaw`
      INSERT INTO outbox_events (id, event_type, payload, branch_id)
      VALUES (${id}::uuid, ${event.eventType}, ${JSON.stringify(event.payload)}::jsonb, ${event.branchId ?? null}::uuid)`;
    return id;
  }
}
