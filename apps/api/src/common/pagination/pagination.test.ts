import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../errors/domain-errors.js';
import {
  buildPage,
  containsAny,
  dateRange,
  escapeLike,
  toOrderBy,
  toSkipTake,
} from './pagination.js';

describe('toSkipTake', () => {
  it('computes the offset for any page', () => {
    expect(toSkipTake({ page: 1, pageSize: 25 })).toEqual({ skip: 0, take: 25 });
    expect(toSkipTake({ page: 4, pageSize: 10 })).toEqual({ skip: 30, take: 10 });
  });
});

describe('buildPage', () => {
  it('reports zero pages for an empty list', () => {
    expect(buildPage([], 0, { page: 1, pageSize: 25 })).toEqual({
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
      totalPages: 0,
    });
  });

  it('rounds the page count up', () => {
    expect(buildPage(['a'], 26, { page: 2, pageSize: 25 }).totalPages).toBe(2);
    expect(buildPage(['a'], 25, { page: 1, pageSize: 25 }).totalPages).toBe(1);
    expect(buildPage(['a'], 1, { page: 1, pageSize: 100 }).totalPages).toBe(1);
  });

  it('allows a page beyond the end and returns no items', () => {
    const page = buildPage([], 10, { page: 5, pageSize: 25 });
    expect(page.items).toEqual([]);
    expect(page.totalPages).toBe(1);
  });
});

describe('toOrderBy', () => {
  const allowed = ['createdAt', 'name'] as const;

  it('uses the fallback when no sort is requested', () => {
    expect(
      toOrderBy(allowed, { sortOrder: 'desc' }, { field: 'createdAt', order: 'desc' }),
    ).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
  });

  it('applies a requested sort and adds a stable tiebreaker', () => {
    expect(
      toOrderBy(
        allowed,
        { sortBy: 'name', sortOrder: 'asc' },
        { field: 'createdAt', order: 'desc' },
      ),
    ).toEqual([{ name: 'asc' }, { id: 'asc' }]);
  });

  it('rejects a field that is not allowed, so clients cannot sort by anything', () => {
    expect(() =>
      toOrderBy(
        allowed,
        { sortBy: 'passwordHash', sortOrder: 'asc' },
        { field: 'createdAt', order: 'desc' },
      ),
    ).toThrowError(ValidationFailedError);
  });
});

describe('dateRange', () => {
  it('builds inclusive bounds and omits missing ones', () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-01-31');
    expect(dateRange('createdAt', { from, to })).toEqual({ createdAt: { gte: from, lte: to } });
    expect(dateRange('createdAt', { from })).toEqual({ createdAt: { gte: from } });
    expect(dateRange('createdAt', {})).toBeUndefined();
  });

  it('accepts a single-day range and rejects a reversed one', () => {
    const day = new Date('2026-01-01');
    expect(dateRange('createdAt', { from: day, to: day })).toBeDefined();
    expect(() =>
      dateRange('createdAt', { from: new Date('2026-02-01'), to: new Date('2026-01-01') }),
    ).toThrowError(ValidationFailedError);
  });
});

describe('containsAny', () => {
  it('ignores empty and blank search terms', () => {
    expect(containsAny(['name'], undefined)).toBeUndefined();
    expect(containsAny(['name'], '   ')).toBeUndefined();
  });

  it('searches every field case-insensitively and trims the term', () => {
    expect(containsAny(['name', 'phone'], '  ravi ')).toEqual({
      OR: [
        { name: { contains: 'ravi', mode: 'insensitive' } },
        { phone: { contains: 'ravi', mode: 'insensitive' } },
      ],
    });
  });

  it('searches for % _ and backslash as ordinary characters', () => {
    expect(containsAny(['name'], '50%_off\\')).toEqual({
      OR: [{ name: { contains: '50\\%\\_off\\\\', mode: 'insensitive' } }],
    });
  });
});

describe('escapeLike', () => {
  it('escapes only the characters LIKE treats specially', () => {
    expect(escapeLike('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
    expect(escapeLike('plain text 123')).toBe('plain text 123');
  });
});
