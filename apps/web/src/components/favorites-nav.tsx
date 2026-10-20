import { ArrowDown, ArrowUp, Star } from 'lucide-react';
import { NavLink } from 'react-router';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import type { NavItem } from '@/app/navigation';
import { cn } from '@/lib/utils';

interface NavItemRowProps {
  item: NavItem;
  collapsed: boolean;
  pinned: boolean;
  onTogglePin: (path: string) => void;
  onNavigate?: (() => void) | undefined;
  /** Present only in the favourites list, where entries can be reordered. */
  onMove?: ((path: string, delta: -1 | 1) => void) | undefined;
  isFirst?: boolean;
  isLast?: boolean;
}

/** One menu entry: the link, a pin toggle and, for a favourite, controls to reorder it. */
export function NavItemRow({
  item,
  collapsed,
  pinned,
  onTogglePin,
  onNavigate,
  onMove,
  isFirst,
  isLast,
}: NavItemRowProps) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex min-h-control-sm min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent',
          isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
          collapsed && 'justify-center px-0',
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
    </NavLink>
  );
  const hidden =
    'opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(pointer:coarse)]:opacity-100 focus-visible:opacity-100';
  return (
    <li className="group/row flex items-center gap-0.5">
      {collapsed ? (
        <Tooltip content={item.label} side="right">
          {link}
        </Tooltip>
      ) : (
        link
      )}
      {collapsed ? null : (
        <>
          {onMove ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn('size-7', hidden)}
                aria-label={`Move ${item.label} up`}
                disabled={isFirst === true}
                onClick={() => onMove(item.path, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn('size-7', hidden)}
                aria-label={`Move ${item.label} down`}
                disabled={isLast === true}
                onClick={() => onMove(item.path, 1)}
              >
                <ArrowDown />
              </Button>
            </>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn('size-7', pinned ? 'opacity-100 text-warning' : hidden)}
            aria-label={
              pinned ? `Unpin ${item.label} from favorites` : `Pin ${item.label} to favorites`
            }
            onClick={() => onTogglePin(item.path)}
          >
            <Star className={cn(pinned && 'fill-current')} />
          </Button>
        </>
      )}
    </li>
  );
}

interface FavoritesNavProps {
  items: readonly NavItem[];
  collapsed: boolean;
  onTogglePin: (path: string) => void;
  onMove: (path: string, delta: -1 | 1) => void;
  onNavigate?: (() => void) | undefined;
}

/** The pinned screens, near the top of the sidebar. Hidden when nothing is pinned. */
export function FavoritesNav({
  items,
  collapsed,
  onTogglePin,
  onMove,
  onNavigate,
}: FavoritesNavProps) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="favorites-heading" className="space-y-1">
      <h2
        id="favorites-heading"
        className={cn('eyebrow px-2.5 text-sidebar-muted', collapsed && 'sr-only')}
      >
        Favorites
      </h2>
      <ul className="space-y-0.5">
        {items.map((item, index) => (
          <NavItemRow
            key={item.path}
            item={item}
            collapsed={collapsed}
            pinned
            onTogglePin={onTogglePin}
            onMove={onMove}
            onNavigate={onNavigate}
            isFirst={index === 0}
            isLast={index === items.length - 1}
          />
        ))}
      </ul>
    </section>
  );
}
