import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { SEARCH_MIN_LENGTH, SEARCH_TYPE_LABELS, SEARCH_TYPES } from '@erp/contracts';
import type { SearchResult } from '@erp/contracts';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/auth-provider';
import { ApiError } from '@/lib/api-client';
import { useGlobalSearch } from './use-search';

/** One box in the header: barcode, serial number, invoice number, customer name or phone. */
export function SearchBox() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { term, ready, data, error, isFetching } = useGlobalSearch(typed);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (!user) return null;

  const choose = (result: SearchResult) => {
    setOpen(false);
    setTyped('');
    navigate(result.link);
  };
  const waiting = typed.trim().length >= SEARCH_MIN_LENGTH && (typed.trim() !== term || isFetching);

  return (
    <div ref={container} role="search" className="relative w-72">
      <Input
        type="text"
        aria-label="Find anything"
        aria-controls={open && typed.trim().length > 0 ? listId : undefined}
        placeholder="Barcode, serial, invoice, customer…"
        value={typed}
        autoComplete="off"
        onChange={(event) => {
          setTyped(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      />
      {open && typed.trim().length > 0 ? (
        <div
          id={listId}
          className="absolute left-0 right-0 z-20 mt-1 max-h-96 overflow-auto rounded-md border bg-card p-2 text-sm shadow-lg"
        >
          {typed.trim().length < SEARCH_MIN_LENGTH ? (
            <p className="p-2 text-muted-foreground">
              Type at least {SEARCH_MIN_LENGTH} characters
            </p>
          ) : error ? (
            <p role="alert" className="p-2 text-destructive">
              {error instanceof ApiError ? error.message : 'Search failed'}
            </p>
          ) : waiting && !data ? (
            <p role="status" className="p-2 text-muted-foreground">
              Searching…
            </p>
          ) : ready && data && data.results.length === 0 ? (
            <p role="status" className="p-2 text-muted-foreground">
              Nothing found for “{data.query}”
            </p>
          ) : data ? (
            SEARCH_TYPES.filter((type) => data.results.some((row) => row.type === type)).map(
              (type) => (
                <section
                  key={type}
                  aria-label={SEARCH_TYPE_LABELS[type]}
                  className="mb-2 last:mb-0"
                >
                  <h2 className="px-2 py-1 text-xs font-semibold uppercase text-muted-foreground">
                    {SEARCH_TYPE_LABELS[type]}
                  </h2>
                  <ul>
                    {data.results
                      .filter((row) => row.type === type)
                      .map((row) => (
                        <li key={`${row.type}-${row.id}`}>
                          <button
                            type="button"
                            className="w-full rounded px-2 py-1.5 text-left hover:bg-accent"
                            onClick={() => choose(row)}
                          >
                            <span className="block font-medium">
                              {row.title}
                              {row.exact ? (
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                  exact match
                                </span>
                              ) : null}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {row.subtitle}
                            </span>
                          </button>
                        </li>
                      ))}
                  </ul>
                </section>
              ),
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
