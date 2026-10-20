import { PanelLeft, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { useLocation } from 'react-router';
import { useMediaQuery } from '@/lib/use-media-query';
import { Breadcrumbs } from '@/components/breadcrumbs';
import type { Crumb } from '@/components/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { BranchSwitcher } from '@/features/branches/branch-switcher';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { SearchBox } from '@/features/search/search-box';
import { EXTRA_TITLES, navItemForLocation } from './navigation';
import { QuickActions } from './quick-actions';
import { UserMenu } from './user-menu';
import { shortcutLabel } from './use-visible-nav';
import type { Preferences } from '@/lib/preferences';

/** The crumbs for a location: its menu group, then the screen. */
export function crumbsFor(pathname: string): Crumb[] {
  const item = navItemForLocation(pathname);
  if (item)
    return item.path === '/'
      ? [{ label: item.label }]
      : [{ label: item.group }, { label: item.label }];
  const extra = EXTRA_TITLES[pathname];
  if (extra) return [{ label: extra.group }, { label: extra.label }];
  return [{ label: 'Page not found' }];
}

interface AppTopbarProps {
  desktop: boolean;
  collapsed: boolean;
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
  user: { fullName: string; username: string; roles: readonly string[] };
  preferences: Preferences;
  onChangePreferences: (change: Partial<Preferences>) => void;
  onSignOut: () => void;
}

export function AppTopbar({
  desktop,
  collapsed,
  onToggleSidebar,
  onOpenPalette,
  user,
  preferences,
  onChangePreferences,
  onSignOut,
}: AppTopbarProps) {
  const { pathname } = useLocation();
  const toggleLabel = desktop
    ? collapsed
      ? 'Expand sidebar'
      : 'Collapse sidebar'
    : 'Open navigation menu';
  const ToggleIcon = desktop ? (collapsed ? PanelLeftOpen : PanelLeftClose) : PanelLeft;
  const wide = useMediaQuery('(min-width: 768px)');
  const roomy = useMediaQuery('(min-width: 640px)');
  return (
    <header className="sticky top-0 z-30 border-b print:hidden bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="flex min-h-topbar items-center gap-2 px-3 py-2 sm:px-4">
        <Tooltip content={toggleLabel}>
          <Button variant="ghost" size="icon" aria-label={toggleLabel} onClick={onToggleSidebar}>
            <ToggleIcon />
          </Button>
        </Tooltip>
        <Breadcrumbs items={crumbsFor(pathname)} className="flex-1" />
        {wide ? (
          <div className="w-72 shrink-0 xl:w-80">
            <SearchBox />
          </div>
        ) : null}
        <Tooltip content="Search screens" shortcut={shortcutLabel()}>
          <Button variant="outline" size="sm" aria-label="Search screens" onClick={onOpenPalette}>
            <Search />
            <span className="hidden text-muted-foreground lg:inline">Go to…</span>
          </Button>
        </Tooltip>
        {roomy ? (
          <div className="text-sm">
            <BranchSwitcher />
          </div>
        ) : null}
        <QuickActions />
        <NotificationBell />
        <UserMenu
          fullName={user.fullName}
          username={user.username}
          roles={user.roles}
          preferences={preferences}
          onChangePreferences={onChangePreferences}
          onSignOut={onSignOut}
        />
      </div>
      {!roomy ? (
        <div className="border-t px-3 py-2 text-sm">
          <BranchSwitcher />
        </div>
      ) : null}
      {!wide ? (
        <div className="border-t px-3 py-2">
          <SearchBox />
        </div>
      ) : null}
    </header>
  );
}
