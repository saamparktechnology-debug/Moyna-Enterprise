import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useDebouncedValue } from './use-debounced-value';

export type SortOrder = 'asc' | 'desc';

export interface ListParamDefaults {
  pageSize: number;
  /** Each extra filter and its default value, for example `{ status: 'active' }`. */
  filters?: Record<string, string>;
}

export interface ListParams {
  page: number;
  pageSize: number;
  search: string;
  /** Undefined until the person clicks a column heading; the server then uses its own default order. */
  sortBy: string | undefined;
  sortOrder: SortOrder;
  filters: Record<string, string>;
}

export interface ListParamSetters {
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSearch: (search: string) => void;
  setSort: (sortBy: string | undefined, sortOrder: SortOrder) => void;
  setFilter: (name: string, value: string) => void;
  /** Clears the search and every filter back to its default, and returns to page 1. */
  clear: () => void;
}

const positive = (text: string | null, fallback: number): number => {
  const value = Number(text);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

/**
 * The state of one list (page, page size, search, sort, filters) kept in the address bar, so a
 * filtered list survives a refresh and the back button, and a link to it can be shared. Values that
 * equal their default are left out of the address, which keeps the default list's request unchanged.
 *
 * Several lists can share one screen (tabs): give each its own `prefix`.
 */
export function useListParams(
  defaults: ListParamDefaults,
  prefix = '',
): [ListParams, ListParamSetters] {
  const [search, setSearchParams] = useSearchParams();
  const key = (name: string) => (prefix ? `${prefix}.${name}` : name);
  const filterDefaults = useMemo(() => defaults.filters ?? {}, [defaults.filters]);

  const params = useMemo<ListParams>(() => {
    const filters: Record<string, string> = {};
    for (const [name, fallback] of Object.entries(filterDefaults)) {
      filters[name] = search.get(prefix ? `${prefix}.${name}` : name) ?? fallback;
    }
    const order = search.get(prefix ? `${prefix}.order` : 'order');
    return {
      page: positive(search.get(prefix ? `${prefix}.page` : 'page'), 1),
      pageSize: positive(search.get(prefix ? `${prefix}.size` : 'size'), defaults.pageSize),
      search: search.get(prefix ? `${prefix}.q` : 'q') ?? '',
      sortBy: search.get(prefix ? `${prefix}.sort` : 'sort') ?? undefined,
      sortOrder: order === 'asc' || order === 'desc' ? order : 'asc',
      filters,
    };
  }, [search, prefix, defaults.pageSize, filterDefaults]);

  // Router updates are built from the parameters of the last render, so two changes made before a
  // re-render (a debounced search firing as someone picks a filter) would overwrite each other.
  // `latest` always holds the newest address this hook has written or seen.
  const latest = useRef(search);
  useEffect(() => {
    latest.current = search;
  }, [search]);
  const change = useCallback(
    (edit: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(latest.current);
      edit(next);
      latest.current = next;
      setSearchParams(next, { replace: true });
    },
    [setSearchParams],
  );
  const put = (next: URLSearchParams, name: string, value: string, fallback: string) => {
    if (value === fallback) next.delete(key(name));
    else next.set(key(name), value);
  };

  const setters = useMemo<ListParamSetters>(
    () => ({
      setPage: (page) => change((next) => put(next, 'page', String(page), '1')),
      setPageSize: (size) =>
        change((next) => {
          put(next, 'size', String(size), String(defaults.pageSize));
          next.delete(key('page'));
        }),
      setSearch: (text) =>
        change((next) => {
          put(next, 'q', text, '');
          next.delete(key('page'));
        }),
      setSort: (sortBy, sortOrder) =>
        change((next) => {
          if (sortBy === undefined) {
            next.delete(key('sort'));
            next.delete(key('order'));
          } else {
            next.set(key('sort'), sortBy);
            next.set(key('order'), sortOrder);
          }
          next.delete(key('page'));
        }),
      setFilter: (name, value) =>
        change((next) => {
          put(next, name, value, filterDefaults[name] ?? '');
          next.delete(key('page'));
        }),
      clear: () =>
        change((next) => {
          next.delete(key('q'));
          next.delete(key('page'));
          for (const name of Object.keys(filterDefaults)) next.delete(key(name));
        }),
    }),
    // `key` and `put` only depend on the prefix and defaults already listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [change, prefix, defaults.pageSize, filterDefaults],
  );

  return [params, setters];
}

/** True when the search or any filter differs from its default. */
export function isFiltered(params: ListParams, defaults: ListParamDefaults): boolean {
  if (params.search.trim() !== '') return true;
  return Object.entries(defaults.filters ?? {}).some(
    ([name, fallback]) => params.filters[name] !== fallback,
  );
}

/**
 * The text in a list's search box. The box updates at once; the address bar (and so the request)
 * follows after a short pause, so typing does not send a request per keystroke.
 */
export function useSearchBox(
  params: ListParams,
  setters: ListParamSetters,
  delayMs = 300,
): [text: string, setText: (text: string) => void, clearText: () => void] {
  const [text, setText] = useState(params.search);
  const settled = useDebouncedValue(text.trim(), delayMs);
  const { setSearch } = setters;
  useEffect(() => {
    if (settled !== params.search) setSearch(settled);
    // Only a change in what was typed should write to the address bar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);
  // The address changed from outside (back button, a link): show what it says.
  const [seenSearch, setSeenSearch] = useState(params.search);
  if (seenSearch !== params.search) {
    setSeenSearch(params.search);
    setText((current) => (current.trim() === params.search ? current : params.search));
  }
  return [text, setText, () => setText('')];
}
