import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useListParams } from './use-list-params';

const DEFAULTS = { pageSize: 10, filters: { status: 'active' } };

function wrapper(initial = '/') {
  return ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );
}

function setup(initial = '/') {
  return renderHook(
    () => {
      const [params, set] = useListParams(DEFAULTS);
      return { params, set, location: useLocation() };
    },
    { wrapper: wrapper(initial) },
  );
}

describe('useListParams', () => {
  it('reads the address and fills in the defaults', () => {
    const { result } = setup('/?q=ravi&status=inactive&page=3&sort=name&order=desc');
    expect(result.current.params).toEqual({
      page: 3,
      pageSize: 10,
      search: 'ravi',
      sortBy: 'name',
      sortOrder: 'desc',
      filters: { status: 'inactive' },
    });
  });

  it('leaves values that equal their default out of the address', () => {
    const { result } = setup();
    act(() => result.current.set.setFilter('status', 'inactive'));
    expect(result.current.location.search).toBe('?status=inactive');
    act(() => result.current.set.setFilter('status', 'active'));
    expect(result.current.location.search).toBe('');
  });

  it('returns to page 1 when the search, a filter or the sort changes', () => {
    const { result } = setup('/?page=4');
    act(() => result.current.set.setSearch('ravi'));
    expect(new URLSearchParams(result.current.location.search).get('page')).toBeNull();
  });

  it('keeps two changes made before a re-render (a search and a filter picked together)', () => {
    const { result } = setup();
    act(() => {
      result.current.set.setSearch('ravi');
      result.current.set.setFilter('status', 'inactive');
    });
    const query = new URLSearchParams(result.current.location.search);
    expect(query.get('q')).toBe('ravi');
    expect(query.get('status')).toBe('inactive');
  });

  it('keeps a filter when a debounced search lands after it, and the other way round', () => {
    const { result } = setup();
    act(() => {
      result.current.set.setFilter('status', 'inactive');
      result.current.set.setSort('name', 'desc');
      result.current.set.setSearch('meera');
    });
    const query = new URLSearchParams(result.current.location.search);
    expect(Object.fromEntries(query)).toEqual({
      status: 'inactive',
      sort: 'name',
      order: 'desc',
      q: 'meera',
    });
  });

  it('clear puts the search and filters back to their defaults', () => {
    const { result } = setup('/?q=ravi&status=inactive&sort=name&order=asc');
    act(() => result.current.set.clear());
    expect(new URLSearchParams(result.current.location.search).get('q')).toBeNull();
    expect(new URLSearchParams(result.current.location.search).get('status')).toBeNull();
    expect(new URLSearchParams(result.current.location.search).get('sort')).toBe('name');
  });
});
