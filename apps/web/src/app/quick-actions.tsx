import { Plus } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/tooltip';
import { useAuth } from '@/features/auth/auth-provider';

/**
 * Each action opens the screen's own dialog (the screen reads `?action=`), and is offered only to
 * people who hold the permission that screen's button needs.
 */
const ACTIONS = [
  { label: 'New invoice', to: '/sales?action=new', permission: 'invoices.create' },
  { label: 'Record payment', to: '/payments?action=record', permission: 'payments.create' },
  { label: 'New customer', to: '/customers?action=new', permission: 'customers.manage' },
] as const;

export function QuickActions() {
  const { can } = useAuth();
  const allowed = ACTIONS.filter((action) => can(action.permission));
  if (allowed.length === 0) return null;
  return (
    <DropdownMenu>
      <Tooltip content="Quick actions">
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" aria-label="Quick actions">
            <Plus />
            <span className="hidden lg:inline">New</span>
          </Button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Create</DropdownMenuLabel>
        {allowed.map((action) => (
          <DropdownMenuItem key={action.to} asChild>
            <Link to={action.to}>{action.label}</Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
