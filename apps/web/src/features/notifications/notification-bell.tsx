import { Bell } from 'lucide-react';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { useAuth } from '@/features/auth/auth-provider';
import { cn } from '@/lib/utils';
import { useUnreadCount } from './use-notifications';

/** A link to the inbox with the number of unread notifications. */
export function NotificationBell() {
  const { can } = useAuth();
  const allowed = can('notifications.view');
  const { data } = useUnreadCount(allowed);
  if (!allowed) return null;
  const count = data?.unreadCount ?? 0;
  return (
    <Tooltip content="Notifications">
      <Link
        to="/notifications"
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'relative')}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      >
        <Bell />
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-center text-[0.625rem] font-semibold leading-4 text-destructive-foreground"
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </Link>
    </Tooltip>
  );
}
