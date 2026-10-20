import { Navigate, Outlet, useLocation } from 'react-router';
import { Alert } from '@/components/alert';
import { Button } from '@/components/ui/button';
import { useAuth } from './auth-provider';

export function RequireAuth() {
  const { status, user, retry } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (status === 'error') {
    return (
      <div className="mx-auto max-w-md space-y-3 p-6">
        <Alert tone="error">We could not reach the server to check your session.</Alert>
        <Button onClick={retry}>Try again</Button>
      </div>
    );
  }
  if (!user) {
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );
  }
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}
