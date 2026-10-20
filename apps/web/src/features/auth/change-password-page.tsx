import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { ChangePasswordRequestSchema, PASSWORD_MIN_LENGTH } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { FormField, Input } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api-client';
import { changePassword } from './auth-api';
import { useAuth } from './auth-provider';

const FormSchema = ChangePasswordRequestSchema.extend({
  confirmPassword: z.string().min(1, 'Repeat the new password'),
}).refine((values) => values.newPassword === values.confirmPassword, {
  path: ['confirmPassword'],
  message: 'The passwords do not match',
});
type FormValues = z.infer<typeof FormSchema>;

export function ChangePasswordPage() {
  const { user, applySession } = useAuth();
  const navigate = useNavigate();
  const forced = user?.mustChangePassword ?? false;
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    setServerError(null);
    setDone(false);
    try {
      const session = await changePassword({ currentPassword, newPassword });
      applySession(session);
      reset();
      if (forced) {
        navigate('/', { replace: true });
      } else {
        setDone(true);
      }
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0) {
        for (const detail of error.details) {
          if (detail.field === 'currentPassword' || detail.field === 'newPassword')
            setError(detail.field, { message: detail.message });
        }
      } else {
        setServerError(
          error instanceof ApiError ? error.message : 'Something went wrong. Try again.',
        );
      }
    }
  });

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">Change password</h1>
      {forced ? <Alert>You must choose a new password before you can continue.</Alert> : null}
      <Card>
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {serverError ? <Alert tone="error">{serverError}</Alert> : null}
            {done ? (
              <Alert tone="success">
                Password changed. Your other devices have been signed out.
              </Alert>
            ) : null}
            <FormField label="Current password" error={errors.currentPassword?.message}>
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  autoComplete="current-password"
                  {...register('currentPassword')}
                />
              )}
            </FormField>
            <FormField
              label="New password"
              error={errors.newPassword?.message}
              hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase of unrelated words works well.`}
            >
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  autoComplete="new-password"
                  {...register('newPassword')}
                />
              )}
            </FormField>
            <FormField label="Repeat new password" error={errors.confirmPassword?.message}>
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  autoComplete="new-password"
                  {...register('confirmPassword')}
                />
              )}
            </FormField>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Change password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
