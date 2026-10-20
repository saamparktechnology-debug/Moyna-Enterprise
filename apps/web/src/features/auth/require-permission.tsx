import type { ReactNode } from 'react';
import { useAuth } from './auth-provider';

interface RequirePermissionProps {
  permission: string | undefined;
  children: ReactNode;
}

export function RequirePermission({ permission, children }: RequirePermissionProps) {
  const { can } = useAuth();
  if (permission && !can(permission)) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">You do not have access</h1>
        <p className="text-muted-foreground">
          Ask an administrator if you need to use this part of the system.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
