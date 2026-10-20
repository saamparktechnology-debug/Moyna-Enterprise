import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SEARCH_MIN_LENGTH } from '@erp/contracts';
import { searchEverything } from './search-api';

const DELAY_MS = 300;

/** Waits until the person stops typing before the value is used. */
export function useDebounced<T>(value: T, delay = DELAY_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export function useGlobalSearch(typed: string) {
  const term = useDebounced(typed.trim());
  const ready = term.length >= SEARCH_MIN_LENGTH;
  const query = useQuery({
    queryKey: ['search', term],
    queryFn: () => searchEverything(term),
    enabled: ready,
    staleTime: 10_000,
    retry: false,
  });
  return { term, ready, ...query };
}
