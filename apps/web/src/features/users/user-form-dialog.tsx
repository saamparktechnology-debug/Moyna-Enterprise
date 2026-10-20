import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { CreateUserRequestSchema, UpdateUserRequestSchema } from '@erp/contracts';
import type { Branch, Role, User } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { listBranches } from '@/features/branches/branches-api';
import { listRoles } from '@/features/roles/roles-api';
import { ApiError } from '@/lib/api-client';
import { useUserMutations } from './use-users';

const EditSchema = UpdateUserRequestSchema.omit({ rowVersion: true });
const FIELDS = ['username', 'fullName', 'email', 'roleId', 'branchIds'] as const;
type FieldName = (typeof FIELDS)[number];
const isField = (name: string): name is FieldName => (FIELDS as readonly string[]).includes(name);

interface FormValues {
  username: string;
  fullName: string;
  email: string;
  roleId: string;
  branchIds: string[];
}

interface UserFormDialogProps {
  user: User | null;
  onClose: () => void;
  onSaved: (message: string, temporaryPassword?: { username: string; password: string }) => void;
}

export function UserFormDialog({ user, onClose, onSaved }: UserFormDialogProps) {
  const roles = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const branches = useQuery({
    queryKey: ['branches', 'picker'],
    queryFn: () => listBranches({ page: 1, pageSize: 100, search: '', status: 'active' }),
  });
  const loading = roles.isPending || branches.isPending;
  const failed = roles.isError || branches.isError;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogTitle>{user ? `Edit ${user.fullName}` : 'New user'}</DialogTitle>
        <DialogDescription>
          {user
            ? 'The username cannot be changed. Role and branch changes apply on the next thing the person does.'
            : 'The account starts with a temporary password that you will see once. The person must change it when they first sign in.'}
        </DialogDescription>
        {loading ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading roles and branches…
          </p>
        ) : failed || !roles.data || !branches.data ? (
          <div className="mt-4 space-y-3">
            <Alert tone="error">Could not load the roles and branches.</Alert>
            <Button
              variant="secondary"
              onClick={() => void Promise.all([roles.refetch(), branches.refetch()])}
            >
              Retry
            </Button>
          </div>
        ) : (
          <UserForm
            user={user}
            roles={roles.data}
            branches={branches.data.items}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface UserFormProps {
  user: User | null;
  roles: Role[];
  branches: Branch[];
  onClose: () => void;
  onSaved: UserFormDialogProps['onSaved'];
}

function UserForm({ user, roles, branches, onClose, onSaved }: UserFormProps) {
  const { user: me } = useAuth();
  const editing = user !== null;
  const isSelf = editing && user.id === me?.id;
  const { create, update } = useUserMutations();
  const [serverError, setServerError] = useState<string | null>(null);
  const roleOptions = roles
    .filter((role) => role.tier !== 'SUPER_ADMIN')
    .map((role) => ({ id: role.id, name: role.name }));
  if (user?.role && !roleOptions.some((option) => option.id === user.role?.id))
    roleOptions.push({ id: user.role.id, name: user.role.name });
  const hiddenBranches = editing
    ? user.branches.filter((own) => !branches.some((branch) => branch.id === own.id))
    : [];

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(editing ? EditSchema : CreateUserRequestSchema) as never,
    defaultValues: {
      username: user?.username ?? '',
      fullName: user?.fullName ?? '',
      email: user?.email ?? '',
      roleId: user?.role?.id ?? '',
      branchIds: user
        ? user.branches
            .filter((own) => branches.some((branch) => branch.id === own.id))
            .map((own) => own.id)
        : [],
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      if (user) {
        await update.mutateAsync({
          id: user.id,
          values: {
            fullName: values.fullName,
            email: values.email,
            roleId: values.roleId,
            branchIds: isSelf ? user.branches.map((branch) => branch.id) : values.branchIds,
            rowVersion: user.rowVersion,
          },
        });
        onSaved(`${values.fullName} saved`);
      } else {
        const created = await create.mutateAsync(values);
        onSaved(`${created.user.fullName} was added`, {
          username: created.user.username,
          password: created.temporaryPassword,
        });
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setServerError('Something went wrong. Try again.');
        return;
      }
      let placed = false;
      for (const detail of error.details) {
        if (isField(detail.field)) {
          setError(detail.field, { message: detail.message });
          placed = true;
        }
      }
      if (!placed) setServerError(error.message);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
      {serverError ? <Alert tone="error">{serverError}</Alert> : null}
      <FormField
        label="Username"
        error={errors.username?.message}
        hint="3 to 32 lowercase letters, digits, dots, dashes or underscores"
      >
        {(props) => (
          <Input {...props} disabled={editing} autoComplete="off" {...register('username')} />
        )}
      </FormField>
      <FormField label="Full name" error={errors.fullName?.message}>
        {(props) => <Input {...props} autoComplete="off" {...register('fullName')} />}
      </FormField>
      <FormField label="Email" error={errors.email?.message}>
        {(props) => <Input {...props} type="email" autoComplete="off" {...register('email')} />}
      </FormField>
      <FormField
        label="Role"
        error={errors.roleId?.message}
        hint={isSelf ? 'You cannot change your own role' : undefined}
      >
        {(props) => (
          <Select {...props} disabled={isSelf} {...register('roleId')}>
            <option value="">Choose a role</option>
            {roleOptions.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <fieldset
        className="space-y-2"
        aria-describedby={errors.branchIds ? 'branch-error' : undefined}
      >
        <legend className="text-sm font-medium">Branches</legend>
        {isSelf ? (
          <p className="text-xs text-muted-foreground">You cannot change your own branches.</p>
        ) : null}
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2">
          {branches.map((branch) => (
            <label key={branch.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                value={branch.id}
                disabled={isSelf}
                {...register('branchIds')}
              />
              <span>
                {branch.code} · {branch.name}
              </span>
            </label>
          ))}
        </div>
        {hiddenBranches.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Also works in {hiddenBranches.map((branch) => branch.code).join(', ')}, which you do not
            manage. Those stay as they are.
          </p>
        ) : null}
        {errors.branchIds?.message ? (
          <p id="branch-error" className="text-sm text-destructive">
            {errors.branchIds.message}
          </p>
        ) : null}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Create user'}
        </Button>
      </div>
    </form>
  );
}
