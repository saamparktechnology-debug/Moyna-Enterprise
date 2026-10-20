import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { User } from '@erp/contracts';
import { Can } from '@/components/can';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { listBranches } from '@/features/branches/branches-api';
import { listRoles } from '@/features/roles/roles-api';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { TemporaryPasswordDialog } from './temporary-password-dialog';
import type { IssuedPassword } from './temporary-password-dialog';
import { UserFormDialog } from './user-form-dialog';
import { UserStatusDialog } from './user-status-dialog';
import type { StatusAction } from './user-status-dialog';
import { useUsers } from './use-users';
import type { UserListParams } from './users-api';

const DEFAULTS = { pageSize: 10, filters: { status: 'active', roleId: '', branchId: '' } };

type FormTarget = { kind: 'create' } | { kind: 'edit'; user: User } | null;

function lastSignIn(value: string | null): string {
  return value
    ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';
}

export function UsersPage() {
  const [params, set] = useListParams(DEFAULTS);
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [formTarget, setFormTarget] = useState<FormTarget>(null);
  const [statusTarget, setStatusTarget] = useState<{ user: User; action: StatusAction } | null>(
    null,
  );
  const [issued, setIssued] = useState<IssuedPassword | null>(null);
  const status = params.filters['status'] as UserListParams['status'];
  const roleId = params.filters['roleId'] ?? '';
  const branchId = params.filters['branchId'] ?? '';
  const query = useUsers({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status,
    roleId,
    branchId,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const roles = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const branches = useQuery({
    queryKey: ['branches', 'picker'],
    queryFn: () => listBranches({ page: 1, pageSize: 100, search: '', status: 'active' }),
  });
  const filtered = isFiltered(params, DEFAULTS);
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<User, unknown>[] = [
    {
      id: 'name',
      header: 'Name',
      meta: { sortKey: 'fullName', alwaysVisible: true },
      cell: ({ row }) => (
        <>
          <span className="font-medium">{row.original.fullName}</span>
          <span className="block break-id text-xs text-muted-foreground">
            {row.original.username} · {row.original.email}
          </span>
        </>
      ),
    },
    { id: 'role', header: 'Role', cell: ({ row }) => row.original.role?.name ?? '—' },
    {
      id: 'branches',
      header: 'Branches',
      cell: ({ row }) => row.original.branches.map((branch) => branch.code).join(', ') || '—',
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <>
          <StatusBadge
            status={row.original.status}
            label={row.original.status === 'ACTIVE' ? 'Active' : 'Inactive'}
          />
          {row.original.mustChangePassword && row.original.status === 'ACTIVE' ? (
            <span className="mt-1 block text-xs text-muted-foreground">Must change password</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'lastLoginAt',
      header: 'Last sign-in',
      meta: { sortKey: 'lastLoginAt' },
      cell: ({ row }) => lastSignIn(row.original.lastLoginAt),
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => {
        const user = row.original;
        return (
          <Can permission="users.manage">
            {user.manageable ? (
              <RowActions>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${user.username}`}
                  onClick={() => setFormTarget({ kind: 'edit', user })}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Reset password of ${user.username}`}
                  onClick={() => setStatusTarget({ user, action: 'reset' })}
                >
                  Reset password
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${user.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'} ${user.username}`}
                  onClick={() =>
                    setStatusTarget({
                      user,
                      action: user.status === 'ACTIVE' ? 'deactivate' : 'reactivate',
                    })
                  }
                >
                  {user.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                </Button>
              </RowActions>
            ) : null}
          </Can>
        );
      },
    },
  ];

  const roleName = roles.data?.find((role) => role.id === roleId)?.name ?? 'Selected role';
  const branch = branches.data?.items.find((item) => item.id === branchId);
  const chips = [
    ...(status !== 'active'
      ? [
          {
            label: `Show: ${status === 'all' ? 'All users' : 'Inactive users'}`,
            onRemove: () => set.setFilter('status', 'active'),
          },
        ]
      : []),
    ...(roleId !== ''
      ? [{ label: `Role: ${roleName}`, onRemove: () => set.setFilter('roleId', '') }]
      : []),
    ...(branchId !== ''
      ? [
          {
            label: `Branch: ${branch ? branch.code : 'Selected branch'}`,
            onRemove: () => set.setFilter('branchId', ''),
          },
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Users"
        description="Staff logins, their role and the branches they work in."
        actions={
          <Can permission="users.manage">
            <Button onClick={() => setFormTarget({ kind: 'create' })}>New user</Button>
          </Can>
        }
      />
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Name, username or email"
        chips={chips}
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Show</span>
          <Select
            className="w-full sm:w-44"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="active">Active users</option>
            <option value="inactive">Inactive users</option>
            <option value="all">All users</option>
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Role</span>
          <Select
            className="w-full sm:w-44"
            value={roleId}
            onChange={(event) => set.setFilter('roleId', event.target.value)}
          >
            <option value="">All roles</option>
            {roles.data?.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Branch</span>
          <Select
            className="w-full sm:w-52"
            value={branchId}
            onChange={(event) => set.setFilter('branchId', event.target.value)}
          >
            <option value="">All branches</option>
            {branches.data?.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} · {item.name}
              </option>
            ))}
          </Select>
        </label>
      </DataTableToolbar>

      <DataTable
        label="Users"
        noun="users"
        columns={columns}
        query={query}
        getRowId={(user) => user.id}
        filtered={filtered}
        emptyText="There are no users yet."
        filteredEmptyText="No users match your search. Clear the search or change the filters."
        emptyAction={
          filtered ? (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : undefined
        }
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        sort={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortChange={set.setSort}
        columnVisibility
      />

      {formTarget ? (
        <UserFormDialog
          key={
            formTarget.kind === 'edit'
              ? `${formTarget.user.id}-${formTarget.user.rowVersion}`
              : 'new'
          }
          user={formTarget.kind === 'edit' ? formTarget.user : null}
          onClose={() => setFormTarget(null)}
          onSaved={(message, temporary) => {
            toast.success(message);
            setFormTarget(null);
            if (temporary) setIssued({ ...temporary, reason: 'created' });
          }}
        />
      ) : null}
      <UserStatusDialog
        target={statusTarget}
        onClose={() => setStatusTarget(null)}
        onDone={(user, action, temporaryPassword) => {
          setStatusTarget(null);
          if (action === 'reset' && temporaryPassword) {
            setIssued({ username: user.username, password: temporaryPassword, reason: 'reset' });
          } else {
            toast.success(
              `${user.fullName} ${action === 'deactivate' ? 'deactivated' : 'reactivated'}`,
            );
          }
        }}
      />
      <TemporaryPasswordDialog issued={issued} onClose={() => setIssued(null)} />
    </PageContainer>
  );
}
