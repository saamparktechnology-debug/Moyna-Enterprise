import type { Paginated, PaginationQuery, SortOrder } from '@erp/contracts';
import { ValidationFailedError } from '../errors/domain-errors.js';

export function toSkipTake(query: Pick<PaginationQuery, 'page' | 'pageSize'>): {
  skip: number;
  take: number;
} {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

export function buildPage<T>(
  items: T[],
  total: number,
  query: Pick<PaginationQuery, 'page' | 'pageSize'>,
): Paginated<T> {
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
  };
}

export function toOrderBy(
  allowed: readonly string[],
  query: Pick<PaginationQuery, 'sortBy' | 'sortOrder'>,
  fallback: { field: string; order: SortOrder },
): Record<string, SortOrder>[] {
  const field = query.sortBy ?? fallback.field;
  if (!allowed.includes(field)) {
    throw new ValidationFailedError('Unsupported sort field', [
      { field: 'sortBy', message: `Sort by one of: ${allowed.join(', ')}` },
    ]);
  }
  const order = query.sortBy ? query.sortOrder : fallback.order;
  const orderBy: Record<string, SortOrder>[] = [{ [field]: order }];
  if (field !== 'id') {
    orderBy.push({ id: 'asc' });
  }
  return orderBy;
}

export function dateRange(
  field: string,
  range: { from?: Date | undefined; to?: Date | undefined },
): Record<string, { gte?: Date; lte?: Date }> | undefined {
  if (range.from && range.to && range.from > range.to) {
    throw new ValidationFailedError('Invalid date range', [
      { field: 'from', message: 'Start date must not be after the end date' },
    ]);
  }
  if (!range.from && !range.to) return undefined;
  const bounds: { gte?: Date; lte?: Date } = {};
  if (range.from) bounds.gte = range.from;
  if (range.to) bounds.lte = range.to;
  return { [field]: bounds };
}

/** Treats the characters that mean something to LIKE as plain text. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

export function containsAny(
  fields: readonly string[],
  term: string | undefined,
): { OR: Record<string, { contains: string; mode: 'insensitive' }>[] } | undefined {
  const trimmed = term?.trim();
  if (!trimmed) return undefined;
  return {
    OR: fields.map((field) => ({
      [field]: { contains: escapeLike(trimmed), mode: 'insensitive' as const },
    })),
  };
}
