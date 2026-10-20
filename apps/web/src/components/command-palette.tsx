import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { NavSearchInput, NavSearchList, useNavSearch } from '@/components/nav-search';
import type { NavItem } from '@/app/navigation';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Only the screens this person may open. */
  items: readonly NavItem[];
  favourites: readonly string[];
  /** Paths visited lately, newest first; they lead the list while nothing is typed. */
  recent: readonly string[];
  onSelect: (item: NavItem) => void;
}

/** Ctrl/Cmd+K: jump to any screen by name, keyword or module. */
export function CommandPalette({
  open,
  onOpenChange,
  items,
  favourites,
  recent,
  onSelect,
}: CommandPaletteProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        className="top-[15%] max-h-[70dvh] translate-y-0 gap-0 overflow-hidden p-0 sm:p-0"
      >
        <DialogTitle className="sr-only">Go to a screen</DialogTitle>
        <DialogDescription className="sr-only">
          Type to filter the screens. Use the arrow keys to choose one and Enter to open it.
        </DialogDescription>
        <PaletteBody
          items={items}
          favourites={favourites}
          recent={recent}
          onSelect={onSelect}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function PaletteBody({
  items,
  favourites,
  recent,
  onSelect,
  onClose,
}: Omit<CommandPaletteProps, 'open' | 'onOpenChange'> & { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const ordered = useMemo(() => {
    const seen = recent
      .map((path) => items.find((item) => item.path === path))
      .filter((item): item is NavItem => item !== undefined);
    return [...seen, ...items.filter((item) => !seen.includes(item))];
  }, [items, recent]);
  const search = useNavSearch(ordered, query, onSelect, onClose);
  return (
    <>
      <NavSearchInput
        label="Search screens"
        placeholder="Search screens…"
        value={query}
        onChange={setQuery}
        search={search}
        expanded
        autoFocus
        className="border-b p-2 [&_input]:border-0 [&_input]:shadow-none [&_svg]:left-5"
      />
      <NavSearchList
        search={search}
        favourites={favourites}
        onSelect={onSelect}
        emptyText="No screen matches your search."
        className="max-h-[50dvh] overflow-y-auto p-2"
      />
    </>
  );
}
