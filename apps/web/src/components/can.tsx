import type { ReactNode } from 'react';
import { useAuth } from '@/features/auth/auth-provider';

interface CanProps {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}

export function Can({ permission, children, fallback = null }: CanProps) {
  const { can } = useAuth();
  return <>{can(permission) ? children : fallback}</>;
}
