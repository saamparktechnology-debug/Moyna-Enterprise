import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { LoginRequestSchema } from '@erp/contracts';
import type { LoginRequest } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { FormField, Input } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api-client';
import { useAuth } from './auth-provider';

function safeDestination(from: unknown): string {
  return typeof from === 'string' &&
    from.startsWith('/') &&
    !from.startsWith('//') &&
    !from.startsWith('/login')
    ? from
    : '/';
}

export function LoginPage() {
  const { user, expired, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginRequest>({
    resolver: zodResolver(LoginRequestSchema),
    defaultValues: { username: '', password: '' },
  });

  if (user && !isSubmitting) {
    return (
      <Navigate
        to={
          user.mustChangePassword
            ? '/change-password'
            : safeDestination((location.state as { from?: unknown } | null)?.from)
        }
        replace
      />
    );
  }

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const session = await signIn(values);
      navigate(
        session.user.mustChangePassword
          ? '/change-password'
          : safeDestination((location.state as { from?: unknown } | null)?.from),
        { replace: true },
      );
    } catch (error) {
      setServerError(
        error instanceof ApiError ? error.message : 'Something went wrong. Try again.',
      );
    }
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Sign in to ERP</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {expired ? <Alert>Your session ended. Sign in again to continue.</Alert> : null}
            {serverError ? <Alert tone="error">{serverError}</Alert> : null}
            <FormField label="Username" error={errors.username?.message}>
              {(props) => (
                <Input {...props} autoComplete="username" autoFocus {...register('username')} />
              )}
            </FormField>
            <FormField label="Password" error={errors.password?.message}>
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  autoComplete="current-password"
                  {...register('password')}
                />
              )}
            </FormField>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
