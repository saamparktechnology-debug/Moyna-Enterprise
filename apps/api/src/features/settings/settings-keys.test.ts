import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTING_KEYS } from '@erp/contracts';

const migrations = join(__dirname, '../../../../../prisma/migrations');

describe('the app_settings key check in the database', () => {
  it('allows every setting the application defines', () => {
    let latest = '';
    for (const dir of readdirSync(migrations).sort()) {
      let sql = '';
      try {
        sql = readFileSync(join(migrations, dir, 'migration.sql'), 'utf8');
      } catch {
        continue;
      }
      const match = /ADD CONSTRAINT "chk_app_settings_key_known" CHECK \(([\s\S]*?)\n?\)\);/.exec(sql);
      if (match?.[1]) latest = match[1];
    }
    expect(latest).not.toBe('');
    const missing = SETTING_KEYS.filter((key) => !latest.includes(`'${key}'`));
    expect(missing).toEqual([]);
  });
});
