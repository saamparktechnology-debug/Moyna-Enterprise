import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { BranchContextService } from '../branch-context/branch-context.service.js';
import type { TxClient } from '../prisma/scoped-prisma.service.js';
import { redactSensitive } from './redact.js';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  branchId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

function toJson(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(redactSensitive(value));
}

@Injectable()
export class AuditService {
  constructor(@Inject(BranchContextService) private readonly contexts: BranchContextService) {}

  async record(tx: TxClient, entry: AuditEntry): Promise<void> {
    const context = this.contexts.require();
    await tx.$executeRaw`
      INSERT INTO audit_log
        (id, actor_id, branch_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, request_id)
      VALUES
        (${randomUUID()}::uuid, ${context.userId}::uuid, ${entry.branchId ?? null}::uuid, ${entry.action},
         ${entry.entityType}, ${entry.entityId ?? null}::uuid, ${toJson(entry.oldValue)}::jsonb,
         ${toJson(entry.newValue)}::jsonb, ${context.ipAddress ?? null}, ${context.userAgent ?? null},
         ${context.requestId ?? null})`;
  }
}
