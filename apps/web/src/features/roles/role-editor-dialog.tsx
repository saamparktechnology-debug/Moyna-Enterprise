import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { RoleNameSchema } from '@erp/contracts';
import type { PermissionGroup, Role } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { ApiError } from '@/lib/api-client';
import { useRoleMutations } from './use-roles';

const FormSchema = z.object({
  name: RoleNameSchema,
  description: z.string().trim().max(200, 'Use at most 200 characters'),
  tier: z.enum(['ADMIN', 'STAFF']),
});
type FormValues = z.input<typeof FormSchema>;

const TIER_LABEL = { SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', STAFF: 'Staff' } as const;
const titleCase = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

interface RoleEditorDialogProps {
  role: Role | null;
  groups: PermissionGroup[];
  /** Whether the person may change roles at all. Otherwise the dialog is a read-only view. */
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function RoleEditorDialog({
  role,
  groups,
  canManage,
  onClose,
  onSaved,
}: RoleEditorDialogProps) {
  const creating = role === null;
  const readOnly = !canManage || (role !== null && !role.editable);
  const { create, update } = useRoleMutations();
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissionCodes ?? []));
  const [serverError, setServerError] = useState<string | null>(null);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: role?.name ?? '',
      description: role?.description ?? '',
      tier: role?.tier === 'ADMIN' ? 'ADMIN' : 'STAFF',
    },
  });

  const toggle = (code: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });
  const setModule = (group: PermissionGroup, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      for (const permission of group.permissions.filter((p) => !p.reserved)) {
        if (on) next.add(permission.code);
        else next.delete(permission.code);
      }
      return next;
    });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setPermissionError(null);
    const parsed = FormSchema.parse(values);
    const permissionCodes = [...selected].sort();
    const description = parsed.description === '' ? null : parsed.description;
    try {
      if (role) {
        await update.mutateAsync({
          id: role.id,
          values: { name: parsed.name, description, permissionCodes, rowVersion: role.rowVersion },
        });
        onSaved(`Role ${parsed.name} saved`);
      } else {
        await create.mutateAsync({
          name: parsed.name,
          description,
          tier: parsed.tier,
          permissionCodes,
        });
        onSaved(`Role ${parsed.name} created`);
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setServerError('Something went wrong. Try again.');
        return;
      }
      let placed = false;
      for (const detail of error.details) {
        if (detail.field === 'name') {
          setError('name', { message: detail.message });
          placed = true;
        } else if (detail.field === 'permissionCodes') {
          setPermissionError(detail.message);
          placed = true;
        }
      }
      if (!placed) setServerError(error.message);
    }
  });

  const changedPermissions =
    [...selected].sort().join() !== [...(role?.permissionCodes ?? [])].sort().join();

  return (
    <FormDialog
      open
      size="lg"
      title={creating ? 'New role' : readOnly ? `Role ${role.name}` : `Edit role ${role.name}`}
      description={
        creating
          ? 'Choose the level carefully: it decides who may give this role to others, and it cannot be changed later.'
          : role.tier === 'SUPER_ADMIN'
            ? 'The Super Admin role always has every permission and cannot be changed.'
            : 'Changes apply to everyone holding this role on their next action.'
      }
      onClose={onClose}
      onSubmit={onSubmit}
      saving={isSubmitting}
      dirty={isDirty || changedPermissions}
      readOnly={readOnly}
      submitLabel={creating ? 'Create role' : 'Save changes'}
      error={serverError}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" error={errors.name?.message}>
          {(props) => (
            <Input
              {...props}
              disabled={readOnly || role?.isSystem === true}
              autoComplete="off"
              {...register('name')}
            />
          )}
        </FormField>
        <FormField
          label="Level"
          error={errors.tier?.message}
          hint="Super Admin manages Admin roles; Admin manages Staff roles"
        >
          {(props) =>
            creating ? (
              <Select {...props} {...register('tier')}>
                <option value="STAFF">Staff</option>
                <option value="ADMIN">Admin</option>
              </Select>
            ) : (
              <Input {...props} value={TIER_LABEL[role.tier]} disabled readOnly />
            )
          }
        </FormField>
      </div>
      <FormField label="Description" error={errors.description?.message}>
        {(props) => (
          <Input {...props} disabled={readOnly} autoComplete="off" {...register('description')} />
        )}
      </FormField>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Permissions ({selected.size} selected)</legend>
        {permissionError ? <Alert tone="error">{permissionError}</Alert> : null}
        <div className="space-y-3">
          {groups.map((group) => (
            <fieldset key={group.module} className="rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">{titleCase(group.module)}</legend>
              {!readOnly ? (
                <div className="mb-2 flex gap-3 text-xs">
                  <button
                    type="button"
                    className="underline"
                    aria-label={`Select all ${group.module} permissions`}
                    onClick={() => setModule(group, true)}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="underline"
                    aria-label={`Clear all ${group.module} permissions`}
                    onClick={() => setModule(group, false)}
                  >
                    Clear
                  </button>
                </div>
              ) : null}
              <div className="grid gap-1 sm:grid-cols-2">
                {group.permissions.map((permission) => (
                  <label key={permission.code} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.has(permission.code)}
                      disabled={readOnly || permission.reserved}
                      onChange={(event) => toggle(permission.code, event.target.checked)}
                    />
                    <span>
                      {permission.description}
                      <span className="block text-xs text-muted-foreground">
                        {permission.code}
                        {permission.reserved ? ' · Super Admin only' : ''}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </fieldset>
    </FormDialog>
  );
}
