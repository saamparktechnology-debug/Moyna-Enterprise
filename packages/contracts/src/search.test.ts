import { describe, expect, it } from 'vitest';
import { SearchQuerySchema } from './search.js';

describe('search query', () => {
  it('trims the text and defaults to five results of every kind', () => {
    const parsed = SearchQuerySchema.parse({ q: '  ravi  ' });
    expect(parsed).toEqual({ q: 'ravi', types: undefined, limit: 5 });
  });
  it('reads a comma separated list of kinds in any case', () => {
    expect(SearchQuerySchema.parse({ q: 'abc', types: 'serial, Customer' }).types).toEqual([
      'SERIAL',
      'CUSTOMER',
    ]);
  });
  it('refuses short text, unknown kinds, a bad limit and unknown fields', () => {
    expect(SearchQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: 'abc', types: 'banana' }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: 'abc', limit: 21 }).success).toBe(false);
    expect(SearchQuerySchema.safeParse({ q: 'abc', extra: 1 }).success).toBe(false);
  });
});
