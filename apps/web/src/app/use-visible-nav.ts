import { useMemo } from 'react';
import { useAuth } from '@/features/auth/auth-provider';
import { NAV_GROUPS, canSeeNavItem } from './navigation';
import type { NavGroup, NavItem } from './navigation';

/**
 * The menu the signed-in user may use. Every part of the shell (sidebar, favourites, search, palette)
 * reads this one list, so no part can show a screen the others hide.
 */
export function useVisibleNav(): { groups: NavGroup[]; items: NavItem[] } {
  const { can } = useAuth();
  return useMemo(() => {
    const groups = NAV_GROUPS.map((group) => ({
      label: group.label,
      items: group.items.filter((item) => canSeeNavItem(item, can)),
    })).filter((group) => group.items.length > 0);
    return { groups, items: groups.flatMap((group) => group.items) };
  }, [can]);
}

export function shortcutLabel(): string {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? '⌘K' : 'Ctrl K';
}
