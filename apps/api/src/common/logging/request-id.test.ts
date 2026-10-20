import { describe, expect, it } from 'vitest';
import { resolveRequestId } from './request-id.js';

describe('resolveRequestId', () => {
  it('keeps a well-formed incoming id', () => {
    expect(resolveRequestId('abc-123_DEF.9')).toBe('abc-123_DEF.9');
  });

  it.each([undefined, '', 'has spaces', 'new\nline', 'x'.repeat(65), ['a', 'b'], 42])(
    'generates a fresh uuid for the unusable value %j',
    (value) => {
      expect(resolveRequestId(value)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
    },
  );
});
