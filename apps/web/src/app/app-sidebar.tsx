import { ChevronDown, Search, Boxes } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { FavoritesNav, NavItemRow } from '@/components/favorites-nav';
import { NavSearchInput, NavSearchList, useNavSearch } from '@/components/nav-search';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { moveEntry, toggleFavourite } from '@/lib/preferences';
import type { Preferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import type { NavItem } from './navigation';
import { shortcutLabel, useVisibleNav } from './use-visible-nav';

interface AppSidebarProps {
  collapsed: boolean;
  preferences: Preferences;
  onChangePreferences: (change: Partial<Preferences>) => void;
  onOpenPalette: () => void;
  /** Called after a link is followed, so the mobile drawer can close. */
  onNavigate?: (() => void) | undefined;
}

/**
 * The sidebar: product name, a search that filters the menu as you type, the favourites, and the
 * screens in groups by business function. Groups open and close; a collapsed sidebar shows icons with
 * tooltips. It only ever lists screens the signed-in user may open.
 */
export function AppSidebar({
  collapsed,
  preferences,
  onChangePreferences,
  onOpenPalette,
  onNavigate,
}: AppSidebarProps) {
  const { groups, items } = useVisibleNav();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [closedGroups, setClosedGroups] = useState<readonly string[]>([]);
  const searching = query.trim() !== '' && !collapsed;

  const choose = (item: NavItem) => {
    setQuery('');
    navigate(item.path);
    onNavigate?.();
  };
  const search = useNavSearch(items, query, choose, () => setQuery(''));

  const favourites = preferences.favourites
    .map((path) => items.find((item) => item.path === path))
    .filter((item): item is NavItem => item !== undefined);
  const togglePin = (path: string) =>
    onChangePreferences({ favourites: toggleFavourite(preferences.favourites, path) });
  const move = (path: string, delta: -1 | 1) =>
    onChangePreferences({
      favourites: moveEntry(preferences.favourites, preferences.favourites.indexOf(path), delta),
    });
  const toggleGroup = (label: string) =>
    setClosedGroups((current) =>
      current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label],
    );

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div
        className={cn(
          'flex h-topbar shrink-0 items-center gap-2.5 px-4',
          collapsed && 'justify-center px-0',
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
        >
          <Boxes className="size-4" />
        </span>
        <span
          className={cn('truncate text-base font-semibold tracking-tight', collapsed && 'sr-only')}
        >
          ERP
        </span>
      </div>

      <div className={cn('shrink-0 px-3 pb-2', collapsed && 'flex justify-center px-0')}>
        {collapsed ? (
          <Tooltip content="Search screens" shortcut={shortcutLabel()} side="right">
            <Button variant="ghost" size="icon" aria-label="Search screens" onClick={onOpenPalette}>
              <Search />
            </Button>
          </Tooltip>
        ) : (
          <NavSearchInput
            label="Search menu"
            placeholder="Search menu…"
            value={query}
            onChange={setQuery}
            search={search}
            expanded={searching}
            shortcut={shortcutLabel()}
          />
        )}
      </div>

      <nav
        aria-label="Main navigation"
        className={cn('min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4', collapsed && 'px-2')}
      >
        {searching ? (
          <NavSearchList
            search={search}
            favourites={preferences.favourites}
            onSelect={choose}
            emptyText="No screen matches your search."
          />
        ) : (
          <>
            <FavoritesNav
              items={favourites}
              collapsed={collapsed}
              onTogglePin={togglePin}
              onMove={move}
              onNavigate={onNavigate}
            />
            {groups.map((group) => {
              const open = collapsed || !closedGroups.includes(group.label);
              const headingId = `nav-group-${group.label.replace(/\W+/g, '-').toLowerCase()}`;
              return (
                <section key={group.label} aria-labelledby={headingId} className="space-y-1">
                  {collapsed ? (
                    <h2 id={headingId} className="sr-only">
                      {group.label}
                    </h2>
                  ) : (
                    <h2 id={headingId}>
                      <button
                        type="button"
                        aria-expanded={open}
                        className="eyebrow flex w-full items-center justify-between rounded-md px-2.5 py-1 text-sidebar-muted hover:text-sidebar-foreground"
                        onClick={() => toggleGroup(group.label)}
                      >
                        {group.label}
                        <ChevronDown
                          className={cn('size-3.5 transition-transform', !open && '-rotate-90')}
                          aria-hidden="true"
                        />
                      </button>
                    </h2>
                  )}
                  {open ? (
                    <ul className="space-y-0.5">
                      {group.items.map((item) => (
                        <NavItemRow
                          key={item.path}
                          item={item}
                          collapsed={collapsed}
                          pinned={preferences.favourites.includes(item.path)}
                          onTogglePin={togglePin}
                          onNavigate={onNavigate}
                        />
                      ))}
                    </ul>
                  ) : null}
                </section>
              );
            })}
          </>
        )}
      </nav>
    </div>
  );
}
