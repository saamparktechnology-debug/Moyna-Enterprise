import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { CommandPalette } from '@/components/command-palette';
import { Toaster } from '@/components/toast';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAuth } from '@/features/auth/auth-provider';
import { ANONYMOUS_SCOPE, pushRecent, usePreferences } from '@/lib/preferences';
import { useAppearance } from '@/lib/use-appearance';
import { useMediaQuery } from '@/lib/use-media-query';
import { cn } from '@/lib/utils';
import { AppSidebar } from './app-sidebar';
import { AppTopbar } from './app-topbar';
import { navItemForLocation } from './navigation';
import type { NavItem } from './navigation';
import { useVisibleNav } from './use-visible-nav';

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
};

export function AppLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { preferences, update } = usePreferences(user?.id ?? ANONYMOUS_SCOPE);
  const { items } = useVisibleNav();
  const desktop = useMediaQuery('(min-width: 768px)');
  const wide = useMediaQuery('(min-width: 1024px)');
  const [drawerAt, setDrawerAt] = useState<string | null>(null);
  const drawerOpen = drawerAt === pathname;
  const setDrawerOpen = useCallback(
    (open: boolean) => setDrawerAt(open ? pathname : null),
    [pathname],
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const collapsed = desktop && (preferences.sidebarCollapsed ?? !wide);

  useAppearance(preferences.theme, preferences.density);

  // Remember the screens visited, for the palette's "recent" list.
  const { recent } = preferences;
  useEffect(() => {
    const item = navItemForLocation(pathname);
    if (item && recent[0] !== item.path) update({ recent: pushRecent(recent, item.path) });
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/Cmd+K opens the palette. "/" focuses the page's own search box, but never while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (isEditable(event.target) || paletteOpen) return;
        const field = document.querySelector<HTMLElement>(
          'main input[type="search"], main [data-page-search]',
        );
        if (field) {
          event.preventDefault();
          field.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paletteOpen]);

  const toggleSidebar = useCallback(() => {
    if (desktop) update({ sidebarCollapsed: !collapsed });
    else setDrawerOpen(true);
  }, [collapsed, desktop, update, setDrawerOpen]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };
  const openScreen = (item: NavItem) => {
    setPaletteOpen(false);
    navigate(item.path);
  };

  const sidebar = (
    <AppSidebar
      collapsed={collapsed}
      preferences={preferences}
      onChangePreferences={update}
      onOpenPalette={() => setPaletteOpen(true)}
      onNavigate={() => setDrawerOpen(false)}
    />
  );

  return (
    <TooltipProvider>
      <a
        href="#main-content"
        className="sr-only z-[80] rounded-md print:hidden bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to main content
      </a>
      <div className="flex min-h-dvh print:block">
        {desktop ? (
          <aside
            className={cn(
              'sticky top-0 hidden h-dvh shrink-0 border-r border-sidebar-border transition-[width] duration-(--duration-base) md:block print:hidden',
              collapsed ? 'w-(--sidebar-width-collapsed)' : 'w-(--sidebar-width)',
            )}
          >
            {sidebar}
          </aside>
        ) : (
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent side="left" className="bg-sidebar p-0">
              <SheetTitle className="sr-only">Navigation menu</SheetTitle>
              <SheetDescription className="sr-only">
                Choose a screen. Close this menu with Escape.
              </SheetDescription>
              {sidebar}
            </SheetContent>
          </Sheet>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          {user ? (
            <AppTopbar
              desktop={desktop}
              collapsed={collapsed}
              onToggleSidebar={toggleSidebar}
              onOpenPalette={() => setPaletteOpen(true)}
              user={{ fullName: user.fullName, username: user.username, roles: user.roles }}
              preferences={preferences}
              onChangePreferences={update}
              onSignOut={() => void handleSignOut()}
            />
          ) : null}
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 p-4 outline-none sm:p-6 print:p-0"
          >
            <Outlet />
          </main>
        </div>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={items}
        favourites={preferences.favourites}
        recent={preferences.recent}
        onSelect={openScreen}
      />
      <div className="print:hidden">
        <Toaster />
      </div>
    </TooltipProvider>
  );
}
