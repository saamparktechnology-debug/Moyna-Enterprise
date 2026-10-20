import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SectionTab<Id extends string> {
  id: Id;
  label: string;
}

interface SectionTabsProps<Id extends string> {
  /** Accessible name of the tab list, for example "Sales sections". */
  label: string;
  tabs: readonly SectionTab<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  /** Keeps ids unique when a screen has more than one tab list. */
  idPrefix?: string;
  className?: string;
}

const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/**
 * Section tabs as the WAI-ARIA tabs pattern describes them: one tab stop, Left/Right/Home/End move
 * between tabs, and each tab names the panel it controls. Wrap the visible content in `SectionPanel`.
 */
export function SectionTabs<Id extends string>({
  label,
  tabs,
  value,
  onChange,
  idPrefix = 'sections',
  className,
}: SectionTabsProps<Id>) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === value);
    const last = tabs.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: index >= last ? 0 : index + 1,
      ArrowLeft: index <= 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
    refs.current.get(target.id)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('flex gap-1 overflow-x-auto border-b', className)}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) refs.current.set(tab.id, element);
              else refs.current.delete(tab.id);
            }}
            id={tabId(idPrefix, tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            className={cn(
              '-mb-px inline-flex min-h-control shrink-0 items-center whitespace-nowrap border-b-2 px-4 text-sm font-medium transition-colors',
              selected
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

interface SectionPanelProps {
  id: string;
  idPrefix?: string;
  children: ReactNode;
  className?: string;
}

/** The content of one tab. Pair it with the `idPrefix` given to `SectionTabs`. */
export function SectionPanel({
  id,
  idPrefix = 'sections',
  children,
  className,
}: SectionPanelProps) {
  return (
    <div
      role="tabpanel"
      id={panelId(idPrefix, id)}
      aria-labelledby={tabId(idPrefix, id)}
      className={cn('space-y-4', className)}
    >
      {children}
    </div>
  );
}
