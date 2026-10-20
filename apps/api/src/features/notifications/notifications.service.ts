import { Inject, Injectable } from '@nestjs/common';
import { NotificationKindSchema, NotificationListQuerySchema } from '@erp/contracts';
import type {
  MarkAllReadResponse,
  Notification,
  NotificationListResponse,
  UnreadCountResponse,
} from '@erp/contracts';
import type { Prisma } from '@prisma/client';
import { NotFoundError } from '../../common/errors/domain-errors.js';
import { buildPage, toSkipTake } from '../../common/pagination/pagination.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';

interface Row {
  id: string;
  kind: string;
  title: string;
  message: string;
  link: string | null;
  branchId: string | null;
  status: string;
  createdAt: Date;
}

const toDto = (row: Row): Notification => ({
  id: row.id,
  kind: NotificationKindSchema.catch('GENERAL').parse(row.kind),
  title: row.title,
  message: row.message,
  link: row.link,
  branchId: row.branchId,
  read: row.status === 'READ',
  createdAt: row.createdAt.toISOString(),
});

/** The caller's own in-app notifications. Nobody can read or change anyone else's. */
@Injectable()
export class NotificationsService {
  constructor(@Inject(TransactionService) private readonly transactions: TransactionService) {}

  private own(auth: AuthContext): Prisma.NotificationWhereInput {
    return { userId: auth.userId, channel: 'IN_APP' };
  }

  async list(auth: AuthContext, rawQuery: unknown): Promise<NotificationListResponse> {
    const query = NotificationListQuerySchema.parse(rawQuery);
    const where: Prisma.NotificationWhereInput = {
      ...this.own(auth),
      ...(query.unread === true ? { status: { not: 'READ' } } : {}),
      ...(query.unread === false ? { status: 'READ' } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
    };
    return this.transactions.run(async (tx) => {
      const [rows, total, unreadCount] = await Promise.all([
        tx.notification.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          ...toSkipTake(query),
        }),
        tx.notification.count({ where }),
        tx.notification.count({ where: { ...this.own(auth), status: { not: 'READ' } } }),
      ]);
      return { ...buildPage(rows.map(toDto), total, query), unreadCount };
    });
  }

  async unreadCount(auth: AuthContext): Promise<UnreadCountResponse> {
    return this.transactions.run(async (tx) => ({
      unreadCount: await tx.notification.count({
        where: { ...this.own(auth), status: { not: 'READ' } },
      }),
    }));
  }

  async markRead(auth: AuthContext, id: string): Promise<Notification> {
    return this.transactions.run(async (tx) => {
      const found = await tx.notification.findFirst({ where: { id, ...this.own(auth) } });
      if (!found) throw new NotFoundError('Notification', id);
      if (found.status === 'READ') return toDto(found);
      return toDto(
        await tx.notification.update({
          where: { id },
          data: { status: 'READ', readAt: new Date() },
        }),
      );
    });
  }

  async markAllRead(auth: AuthContext): Promise<MarkAllReadResponse> {
    return this.transactions.run(async (tx) => {
      const result = await tx.notification.updateMany({
        where: { ...this.own(auth), status: { not: 'READ' } },
        data: { status: 'READ', readAt: new Date() },
      });
      return { updated: result.count };
    });
  }
}
