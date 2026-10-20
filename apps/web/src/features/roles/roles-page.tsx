import { useState } from 'react';
import type { Role } from '@erp/contracts';
import { Can } from '@/components/can';
import { SimpleTable } from '@/components/data-table/simple-table';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { RoleEditorDialog } from './role-editor-dialog';
import { usePermissionGroups, useRoles } from './use-roles';

const TIER_LABEL = { SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', STAFF: 'Staff' } as const;

type Target = { kind: 'create' } | { kind: 'open'; role: Role } | null;

export function RolesPage() {
  const { can } = useAuth();
  const roles = useRoles();
  const groups = usePermissionGroups();
  const [target, setTarget] = useState<Target>(null);
  const failed = roles.isError || groups.isError;

  return (
    <PageContainer>
      <PageHeader
        title="Roles and permissions"
        description="What each role may see and do. Branch limits apply on top of these permissions."
        actions={
          <Can permission="roles.manage">
            <Button disabled={!groups.data} onClick={() => setTarget({ kind: 'create' })}>
              New role
            </Button>
          </Can>
        }
      />

      {roles.isPending || groups.isPending ? (
        <LoadingState label="Loading roles…" rows={4} />
      ) : failed ? (
        <ErrorState onRetry={() => Promise.all([roles.refetch(), groups.refetch()])}>
          Could not load the roles.
        </ErrorState>
      ) : roles.data.length === 0 ? (
        <EmptyState>There are no roles you can assign.</EmptyState>
      ) : (
        <SimpleTable
          label="Roles"
          rows={roles.data}
          getRowKey={(role) => role.id}
          columns={[
            {
              header: 'Role',
              cell: (role) => (
                <>
                  <span className="font-medium">{role.name}</span>
                  {role.description ? (
                    <span className="block text-xs text-muted-foreground">{role.description}</span>
                  ) : null}
                </>
              ),
            },
            { header: 'Level', cell: (role) => TIER_LABEL[role.tier] },
            {
              header: 'Type',
              cell: (role) => (
                <StatusBadge
                  status={role.isSystem ? 'ACTIVE' : 'NONE'}
                  tone={role.isSystem ? 'info' : 'neutral'}
                  label={role.isSystem ? 'System' : 'Custom'}
                />
              ),
            },
            { header: 'People', align: 'right', cell: (role) => role.userCount },
            { header: 'Permissions', align: 'right', cell: (role) => role.permissionCodes.length },
            {
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              cell: (role) => {
                const label = can('roles.manage') && role.editable ? 'Edit' : 'View';
                return (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${label} ${role.name}`}
                    onClick={() => setTarget({ kind: 'open', role })}
                  >
                    {label}
                  </Button>
                );
              },
            },
          ]}
        />
      )}

      {target && groups.data ? (
        <RoleEditorDialog
          key={target.kind === 'open' ? `${target.role.id}-${target.role.rowVersion}` : 'new'}
          role={target.kind === 'open' ? target.role : null}
          groups={groups.data}
          canManage={can('roles.manage')}
          onClose={() => setTarget(null)}
          onSaved={(message) => {
            toast.success(message);
            setTarget(null);
          }}
        />
      ) : null}
    </PageContainer>
  );
}
