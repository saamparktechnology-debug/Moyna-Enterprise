import { KeyRound, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { Link } from 'react-router';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/tooltip';
import type { DensityPreference, Preferences, ThemePreference } from '@/lib/preferences';

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || '?';

interface UserMenuProps {
  fullName: string;
  username: string;
  roles: readonly string[];
  preferences: Preferences;
  onChangePreferences: (change: Partial<Preferences>) => void;
  onSignOut: () => void;
}

/** Initials in the top bar; the menu holds the account, appearance choices and Sign out. */
export function UserMenu({
  fullName,
  username,
  roles,
  preferences,
  onChangePreferences,
  onSignOut,
}: UserMenuProps) {
  return (
    <DropdownMenu>
      <Tooltip content="Account and appearance">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account menu"
            className="flex size-control-sm items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            {initialsOf(fullName)}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-64">
        <div role="group" aria-label="Signed in user" className="px-2 py-2">
          <p className="truncate text-sm font-medium">{fullName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {username}
            {roles.length > 0 ? ` · ${roles.join(', ')}` : ''}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/change-password">
            <KeyRound className="size-4" aria-hidden="true" />
            Change password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preferences.theme}
            onValueChange={(value) => onChangePreferences({ theme: value as ThemePreference })}
          >
            <DropdownMenuRadioItem value="light">
              <Sun className="size-4" aria-hidden="true" />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon className="size-4" aria-hidden="true" />
              Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">
              <Monitor className="size-4" aria-hidden="true" />
              System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Density</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preferences.density}
            onValueChange={(value) => onChangePreferences({ density: value as DensityPreference })}
          >
            <DropdownMenuRadioItem value="standard">Standard</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
