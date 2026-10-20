import { ChevronsUpDown, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';

export interface ComboOption {
  value: string;
  label: string;
  /** A second line under the label (a code, a phone number, a GSTIN). */
  description?: string;
}

export interface SearchableComboboxProps {
  id?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string | undefined;
  'aria-required'?: boolean | undefined;
  value: ComboOption | null;
  onChange: (option: ComboOption | null) => void;
  options: readonly ComboOption[];
  /**
   * For a server-backed list: called with the typed text after `debounceMs`, so one request is sent for
   * what was typed and not one per key. Leave it out when `options` is already the complete list.
   */
  onSearchChange?: (text: string) => void;
  debounceMs?: number;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => unknown;
  placeholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** Shows a button that clears the choice. */
  clearable?: boolean;
  className?: string;
}

/**
 * A text box that suggests options as you type, for lists too long for a plain select. The box keeps
 * focus the whole time; the arrow keys move through the suggestions, Enter chooses and Escape closes.
 */
export function SearchableCombobox({
  value,
  onChange,
  options,
  onSearchChange,
  debounceMs = 300,
  loading = false,
  error = null,
  onRetry,
  placeholder = 'Search…',
  emptyText = 'Nothing matches.',
  disabled,
  clearable,
  className,
  ...aria
}: SearchableComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const shown = typed ?? value?.label ?? '';

  const debounced = useDebouncedValue(typed ?? '', debounceMs);
  const lastSent = useRef<string | null>(null);
  useEffect(() => {
    // Only a settled value is sent: while `typed` is ahead of `debounced` the person is still typing.
    if (!onSearchChange || typed === null || debounced !== typed || lastSent.current === debounced)
      return;
    lastSent.current = debounced;
    onSearchChange(debounced);
  }, [debounced, typed, onSearchChange]);

  const [seenOptions, setSeenOptions] = useState(options);
  if (seenOptions !== options) {
    setSeenOptions(options);
    setActive(0);
  }

  const choose = (option: ComboOption) => {
    onChange(option);
    setTyped(null);
    setOpen(false);
  };
  const close = () => {
    setOpen(false);
    setTyped(null);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive((current) => Math.min(current + 1, Math.max(options.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && open) {
      const chosen = options[active];
      if (chosen) {
        event.preventDefault();
        choose(chosen);
      }
    } else if (event.key === 'Tab') {
      close();
    }
  };

  const activeId = open && options[active] ? `${listId}-${active}` : undefined;

  return (
    <Popover open={open && !disabled} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverAnchor asChild>
        <div className={cn('relative', className)}>
          <Input
            {...aria}
            ref={input}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            autoComplete="off"
            disabled={disabled}
            placeholder={placeholder}
            value={shown}
            className={cn('pr-14')}
            onChange={(event) => {
              setTyped(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
          />
          <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center">
            {clearable && value && !disabled ? (
              <button
                type="button"
                aria-label="Clear selection"
                className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => {
                  onChange(null);
                  setTyped(null);
                  input.current?.focus();
                }}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
            <ChevronsUpDown className="mx-1.5 size-4 text-muted-foreground" aria-hidden="true" />
          </div>
        </div>
      </PopoverAnchor>
      <PopoverContent
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          if (input.current?.contains(event.target as Node)) event.preventDefault();
        }}
        className="max-h-64 overflow-y-auto"
      >
        <div id={listId} role="listbox" aria-label={aria['aria-label'] ?? 'Suggestions'}>
          {error ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 px-2 py-2 text-sm text-destructive"
            >
              <span>{error}</span>
              {onRetry ? (
                <button type="button" className="underline" onClick={() => void onRetry()}>
                  Retry
                </button>
              ) : null}
            </div>
          ) : loading ? (
            <p role="status" className="px-2 py-2 text-sm text-muted-foreground">
              Searching…
            </p>
          ) : options.length === 0 ? (
            <p role="status" className="px-2 py-2 text-sm text-muted-foreground">
              {emptyText}
            </p>
          ) : (
            options.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={value?.value === option.value}
                className={cn(
                  'cursor-pointer rounded-sm px-2 py-1.5 text-sm',
                  index === active && 'bg-accent text-accent-foreground',
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(option)}
              >
                <span className="block truncate">{option.label}</span>
                {option.description ? (
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
