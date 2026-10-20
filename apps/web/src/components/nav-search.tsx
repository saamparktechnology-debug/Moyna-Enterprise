import { Search, Star } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent, Ref } from 'react';
import { Input } from '@/components/ui/input';
import { searchNavItems } from '@/app/navigation';
import type { NavItem } from '@/app/navigation';
import { cn } from '@/lib/utils';

interface UseNavSearch {
  results: NavItem[];
  activeIndex: number;
  listId: string;
  optionId: (index: number) => string;
  onKeyDown: (event: KeyboardEvent) => void;
}

/**
 * Search over the screens a person may open. Arrow keys move through the results, Enter opens the
 * highlighted one and Escape is handed to `onEscape` (clear the text, or close the palette).
 */
export function useNavSearch(
  items: readonly NavItem[],
  query: string,
  onSelect: (item: NavItem) => void,
  onEscape: () => void,
): UseNavSearch {
  const listId = useId();
  const results = useMemo(() => searchNavItems(items, query), [items, query]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [seenQuery, setSeenQuery] = useState(query);
  if (seenQuery !== query) {
    setSeenQuery(query);
    setActiveIndex(0);
  }
  const last = Math.max(results.length - 1, 0);
  return {
    results,
    activeIndex: Math.min(activeIndex, last),
    listId,
    optionId: (index) => `${listId}-option-${index}`,
    onKeyDown: (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => (current >= last ? 0 : current + 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => (current <= 0 ? last : current - 1));
      } else if (event.key === 'Enter') {
        const chosen = results[Math.min(activeIndex, last)];
        if (chosen) {
          event.preventDefault();
          onSelect(chosen);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
      }
    },
  };
}

interface NavSearchInputProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  search: UseNavSearch;
  expanded: boolean;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  shortcut?: string;
  className?: string;
}

/** A combobox input: it stays focused while the results are navigated with the arrow keys. */
export function NavSearchInput({
  label,
  placeholder,
  value,
  onChange,
  search,
  expanded,
  inputRef,
  autoFocus,
  shortcut,
  className,
}: NavSearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded={expanded}
        aria-controls={expanded ? search.listId : undefined}
        aria-activedescendant={
          expanded && search.results.length > 0 ? search.optionId(search.activeIndex) : undefined
        }
        aria-autocomplete="list"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        className={cn('pl-8', shortcut && 'pr-14')}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={search.onKeyDown}
      />
      {shortcut ? (
        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 font-mono text-[0.6875rem] text-muted-foreground">
          {shortcut}
        </kbd>
      ) : null}
    </div>
  );
}

interface NavSearchListProps {
  search: UseNavSearch;
  favourites: readonly string[];
  onSelect: (item: NavItem) => void;
  emptyText: string;
  className?: string;
}

export function NavSearchList({
  search,
  favourites,
  onSelect,
  emptyText,
  className,
}: NavSearchListProps) {
  if (search.results.length === 0) {
    return (
      <div id={search.listId} role="listbox" aria-label="Matching screens" className={className}>
        <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      </div>
    );
  }
  return (
    <div id={search.listId} role="listbox" aria-label="Matching screens" className={className}>
      {search.results.map((item, index) => {
        const Icon = item.icon;
        const active = index === search.activeIndex;
        return (
          <div
            key={item.path}
            id={search.optionId(index)}
            role="option"
            aria-selected={active}
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2',
              active && 'bg-accent text-accent-foreground',
            )}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(item)}
          >
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{item.label}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {item.description}
              </span>
            </span>
            {favourites.includes(item.path) ? (
              <Star
                className="size-3.5 shrink-0 fill-current text-warning"
                aria-label="Favourite"
              />
            ) : null}
            <span className="shrink-0 text-xs text-muted-foreground">{item.group}</span>
          </div>
        );
      })}
    </div>
  );
}
