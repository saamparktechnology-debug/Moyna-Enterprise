import { useQueryClient } from '@tanstack/react-query';
import { Select } from '@/components/select-field';
import { useAuth } from '@/features/auth/auth-provider';
import { SESSION_KEY } from '@/features/auth/auth-provider';
import { chooseActiveBranch, useActiveBranch } from './active-branch';

const ALL = 'all';

export function BranchSwitcher() {
  const { user } = useAuth();
  const active = useActiveBranch();
  const queryClient = useQueryClient();
  if (!user) return null;

  const [only] = user.branches;
  if (user.branches.length === 0) {
    return <span className="whitespace-nowrap text-muted-foreground">No branch assigned</span>;
  }
  if (user.branches.length === 1 && only) {
    return (
      <span role="group" aria-label="Working branch" className="whitespace-nowrap font-medium">
        {only.code} · {only.name}
      </span>
    );
  }

  return (
    <label className="flex items-center gap-2">
      <span className="hidden text-muted-foreground xl:inline">Branch</span>
      <Select
        aria-label="Working branch"
        className="h-control-sm w-44 xl:w-56"
        value={active ?? ALL}
        onChange={(event) => {
          chooseActiveBranch(user, event.target.value === ALL ? null : event.target.value);
          void queryClient.invalidateQueries({
            predicate: (query) => query.queryKey[0] !== SESSION_KEY[0],
          });
        }}
      >
        <option value={ALL}>All branches</option>
        {user.branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.code} · {branch.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
