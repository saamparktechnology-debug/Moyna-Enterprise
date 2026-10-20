import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadRootEnv } from './load-root-env.js';

const KEY = 'ERP_TEST_ENV_PROBE';

afterEach(() => {
  delete process.env[KEY];
});

describe('loadRootEnv', () => {
  it('loads variables from the .env file so test settings there take effect', () => {
    const dir = mkdtempSync(join(tmpdir(), 'erp-env-'));
    const file = join(dir, '.env');
    writeFileSync(file, `${KEY}=from-file\n`);

    loadRootEnv(file);

    expect(process.env[KEY]).toBe('from-file');
    rmSync(dir, { recursive: true });
  });

  it('does not override a variable that is already set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'erp-env-'));
    const file = join(dir, '.env');
    writeFileSync(file, `${KEY}=from-file\n`);
    process.env[KEY] = 'from-shell';

    loadRootEnv(file);

    expect(process.env[KEY]).toBe('from-shell');
    rmSync(dir, { recursive: true });
  });

  it('does nothing when the file does not exist', () => {
    expect(() => loadRootEnv(join(tmpdir(), 'no-such-dir', '.env'))).not.toThrow();
  });
});
