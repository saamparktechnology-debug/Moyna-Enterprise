import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_KIND_LABELS,
  NotificationListQuerySchema,
} from './notifications.js';

describe('notification list query', () => {
  it('reads the unread filter from the query string', () => {
    expect(NotificationListQuerySchema.parse({ unread: 'true' }).unread).toBe(true);
    expect(NotificationListQuerySchema.parse({ unread: 'false' }).unread).toBe(false);
    expect(NotificationListQuerySchema.parse({}).unread).toBeUndefined();
  });
  it('refuses unknown kinds and other unread values', () => {
    expect(NotificationListQuerySchema.safeParse({ kind: 'NOPE' }).success).toBe(false);
    expect(NotificationListQuerySchema.safeParse({ unread: 'maybe' }).success).toBe(false);
  });
  it('has a label for every kind', () => {
    for (const kind of NOTIFICATION_KINDS) expect(NOTIFICATION_KIND_LABELS[kind]).toBeTruthy();
  });
});
