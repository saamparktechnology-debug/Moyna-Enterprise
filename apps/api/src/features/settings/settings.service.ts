import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_ADJUSTMENT_ADMIN_LIMIT,
  ResetSettingRequestSchema,
  SETTING_BY_KEY,
  SETTING_DEFINITIONS,
  UpdateSettingRequestSchema,
} from '@erp/contracts';
import type { Setting, SettingDefinition } from '@erp/contracts';
import { AuditService } from '../../common/audit/audit.service.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import type { Env } from '../../common/config/env.js';
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';

type Value = string | number;

/**
 * Settings an administrator can change without a new release. A setting that was never saved uses its default (for the
 * exchange limit, the value from the server's environment; for everything else, the built-in one).
 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: Env,
  ) {}

  private defaultOf(key: string): Value | null {
    if (key === 'approvals.exchange_admin_limit')
      return this.config.EXCHANGE_ADMIN_APPROVAL_LIMIT ?? null;
    if (key === 'approvals.adjustment_admin_limit') return DEFAULT_ADJUSTMENT_ADMIN_LIMIT;
    return null;
  }

  private definition(key: string): SettingDefinition {
    const definition = SETTING_BY_KEY.get(key);
    if (!definition) throw new NotFoundError('Setting', key);
    return definition;
  }

  /** The value in force for a setting: what was saved, else the default, else null. */
  async value(tx: TxClient, key: string): Promise<Value | null> {
    const row = await tx.appSetting.findUnique({ where: { key } });
    return row ? (row.value as Value) : this.defaultOf(key);
  }

  /** The most an Admin may approve for an exchange, or null for no limit. */
  async exchangeLimit(tx: TxClient): Promise<string | null> {
    const value = await this.value(tx, 'approvals.exchange_admin_limit');
    return value === null ? null : String(value);
  }

  async adjustmentLimit(tx: TxClient): Promise<number> {
    const value = await this.value(tx, 'approvals.adjustment_admin_limit');
    return Number(value ?? DEFAULT_ADJUSTMENT_ADMIN_LIMIT);
  }

  async list(): Promise<Setting[]> {
    return this.transactions.run(async (tx) => {
      const rows = await tx.appSetting.findMany();
      const byKey = new Map(rows.map((row) => [row.key, row]));
      return SETTING_DEFINITIONS.map((definition) => {
        const row = byKey.get(definition.key);
        const fallback = this.defaultOf(definition.key);
        return {
          key: definition.key,
          group: definition.group,
          label: definition.label,
          description: definition.description,
          type: definition.type,
          value: row ? (row.value as Value) : fallback,
          defaultValue: fallback,
          source: row ? 'SETTING' : 'DEFAULT',
          rowVersion: row?.rowVersion ?? null,
          updatedAt: row ? row.updatedAt.toISOString() : null,
        } satisfies Setting;
      });
    });
  }

  private async one(key: string): Promise<Setting> {
    const all = await this.list();
    const found = all.find((setting) => setting.key === key);
    if (!found) throw new NotFoundError('Setting', key);
    return found;
  }

  async update(auth: AuthContext, key: string, rawBody: unknown): Promise<Setting> {
    const definition = this.definition(key);
    const input = UpdateSettingRequestSchema.parse(rawBody);
    const parsed = definition.schema.safeParse(
      definition.type === 'int' && typeof input.value === 'string' && input.value.trim() !== ''
        ? Number(input.value)
        : input.value,
    );
    if (!parsed.success)
      throw new ValidationFailedError('That value is not allowed', [
        { field: 'value', message: parsed.error.issues[0]?.message ?? 'Not allowed' },
      ]);
    const value = parsed.data;

    await this.transactions.run(async (tx) => {
      const existing = await tx.appSetting.findUnique({ where: { key } });
      if (existing && input.rowVersion !== existing.rowVersion)
        throw new ConflictError('Someone else changed this setting. Reload and try again');
      if (!existing && input.rowVersion !== undefined)
        throw new ConflictError('This setting has not been saved yet. Reload and try again');
      const before = existing ? (existing.value as Value) : this.defaultOf(key);
      if (existing)
        await tx.appSetting.update({ where: { key }, data: { value, updatedBy: auth.userId } });
      else await tx.appSetting.create({ data: { key, value, updatedBy: auth.userId } });
      await this.audit.record(tx, {
        action: 'SETTING_CHANGED',
        entityType: 'AppSetting',
        oldValue: { key, value: before },
        newValue: { key, value },
      });
    });
    return this.one(key);
  }

  /** Goes back to the default by deleting the saved value. */
  async reset(auth: AuthContext, key: string, rawBody: unknown): Promise<Setting> {
    this.definition(key);
    const input = ResetSettingRequestSchema.parse(rawBody);
    await this.transactions.run(async (tx) => {
      const existing = await tx.appSetting.findUnique({ where: { key } });
      if (!existing) return;
      if (existing.rowVersion !== input.rowVersion)
        throw new ConflictError('Someone else changed this setting. Reload and try again');
      await tx.appSetting.delete({ where: { key } });
      await this.audit.record(tx, {
        action: 'SETTING_RESET',
        entityType: 'AppSetting',
        oldValue: { key, value: existing.value },
        newValue: { key, value: this.defaultOf(key), by: auth.userId },
      });
    });
    return this.one(key);
  }
}
