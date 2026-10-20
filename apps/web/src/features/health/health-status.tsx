import { ApiError } from '@/lib/api-client';
import { useHealth } from './use-health';

export function HealthStatus() {
  const { data, error, isPending, refetch, isFetching } = useHealth();

  if (isPending) {
    return <p role="status">Checking system status…</p>;
  }

  if (error) {
    const message = error instanceof ApiError ? error.message : 'Something went wrong';
    return (
      <div role="alert" className="flex items-center justify-between gap-4">
        <p className="text-destructive">System unavailable: {message}</p>
        <button
          type="button"
          className="text-sm underline disabled:opacity-50"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <p role="status">
      System healthy · database {data.database} · up {Math.floor(data.uptimeSeconds)}s
    </p>
  );
}
