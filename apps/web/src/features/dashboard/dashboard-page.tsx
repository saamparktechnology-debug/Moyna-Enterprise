import { lazy, Suspense, useState } from 'react';
import { DASHBOARD_MAX_RANGE_DAYS, daysBetween, todayInIndia } from '@erp/contracts';
import type { BranchDashboard, CompanyDashboard } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { ErrorState } from '@/components/error-state';
import { DateRangePicker } from '@/components/forms/date-range-picker';
import { LoadingState } from '@/components/loading-state';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/features/auth/auth-provider';
import { useActiveBranch } from '@/features/branches/active-branch';
import { HealthStatus } from '@/features/health/health-status';
import { ApiError } from '@/lib/api-client';
import { BranchTable, formatRupees, percent, Stat, StatGrid } from './dashboard-parts';
import { useBranchDashboard, useCompanyDashboard } from './use-dashboard';

const TrendChart = lazy(() =>
  import('./dashboard-charts').then((module) => ({ default: module.TrendChart })),
);
const BranchSalesChart = lazy(() =>
  import('./dashboard-charts').then((module) => ({ default: module.BranchSalesChart })),
);
const DonutCard = lazy(() =>
  import('./dashboard-charts').then((module) => ({ default: module.DonutCard })),
);
const HorizontalBarCard = lazy(() =>
  import('./dashboard-charts').then((module) => ({ default: module.HorizontalBarCard })),
);
const RunningTotalChart = lazy(() =>
  import('./dashboard-charts').then((module) => ({ default: module.RunningTotalChart })),
);
const BranchCompareChart = lazy(() =>
  import('./dashboard-charts').then((module) => ({ default: module.BranchCompareChart })),
);

function ChartFallback() {
  return <LoadingState label="Loading chart…" rows={3} />;
}

const monthStart = (today: string): string => `${today.slice(0, 8)}01`;

function periodProblem(from: string, to: string): string | null {
  if (!from || !to) return 'Choose both dates';
  if (from > to) return 'The end date is before the start';
  if (daysBetween(from, to) + 1 > DASHBOARD_MAX_RANGE_DAYS)
    return `Choose at most ${DASHBOARD_MAX_RANGE_DAYS} days`;
  return null;
}

function Loading() {
  return <LoadingState label="Loading dashboard…" rows={4} />;
}

function Failed({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ErrorState onRetry={retry} retryLabel="Try again">
      {error instanceof ApiError ? error.message : 'The dashboard could not be loaded'}
    </ErrorState>
  );
}

function CompanyView({ data, onOpen }: { data: CompanyDashboard; onOpen: (id: string) => void }) {
  const salesTotal = Number(data.sales.sales);
  const collected = Number(data.sales.collected);
  const outstanding = Number(data.dues.outstanding);
  const overdue = Number(data.dues.overdue);

  return (
    <div className="space-y-6">
      <StatGrid title="Sales and money">
        <Stat
          label="Sales (with GST)"
          value={formatRupees(data.sales.sales)}
          hint={`${data.sales.invoices} invoices`}
        />
        <Stat
          label="Revenue (before GST, after credit notes)"
          value={formatRupees(data.sales.revenue)}
        />
        <Stat label="Collected" value={formatRupees(data.sales.collected)} />
        <Stat
          label="Purchases"
          value={formatRupees(data.purchases.value)}
          hint={`${data.purchases.orders} orders`}
        />
      </StatGrid>
      <StatGrid title="Stock and dues">
        <Stat
          label="Stock value"
          value={formatRupees(data.stock.value)}
          hint={`${data.stock.units} units`}
        />
        <Stat
          label="Outstanding"
          value={formatRupees(data.dues.outstanding)}
          hint={`${data.dues.invoices} invoices`}
        />
        <Stat
          label="Overdue"
          value={formatRupees(data.dues.overdue)}
          hint={`${data.dues.overdueInvoices} invoices`}
          tone={data.dues.overdueInvoices > 0 ? 'warn' : 'normal'}
        />
        <Stat label="Active branches" value={String(data.branchCount)} />
      </StatGrid>
      <StatGrid title="Leads and commission">
        <Stat label="Leads created" value={String(data.leads.created)} />
        <Stat
          label="Lead conversion"
          value={percent(data.leads.conversionRate)}
          hint={`${data.leads.won} won`}
        />
        <Stat label="Commission payable" value={formatRupees(data.commissions.payable)} />
        <Stat label="Commission paid" value={formatRupees(data.commissions.paid)} />
      </StatGrid>
      <StatGrid title="Alerts">
        <Stat
          label="Low stock"
          value={String(data.alerts.lowStockItems)}
          hint="items at or below reorder level, per branch"
          tone={data.alerts.lowStockItems > 0 ? 'warn' : 'normal'}
        />
        <Stat
          label="Batteries expired"
          value={String(data.alerts.batteriesExpired)}
          tone={data.alerts.batteriesExpired > 0 ? 'warn' : 'normal'}
        />
        <Stat
          label={`Batteries expiring in ${data.withinDays} days`}
          value={String(data.alerts.batteriesExpiring)}
        />
        <Stat
          label="Items never bought"
          value={String(data.stock.itemsWithoutCost)}
          hint="in stock, not valued"
        />
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<ChartFallback />}>
          <TrendChart points={data.trend} />
        </Suspense>
        <Suspense fallback={<ChartFallback />}>
          <BranchSalesChart branches={data.branches} />
        </Suspense>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<ChartFallback />}>
          <DonutCard
            title="Sales share by branch"
            ariaLabel="Share of total sales that each branch made"
            slices={data.branches.map((row) => ({
              name: row.branchCode,
              value: Number(row.sales.sales),
            }))}
          />
        </Suspense>
        <Suspense fallback={<ChartFallback />}>
          <DonutCard
            title="Stock value by branch"
            ariaLabel="Share of total stock value held by each branch"
            slices={data.branches.map((row) => ({
              name: row.branchCode,
              value: Number(row.stock.value),
            }))}
          />
        </Suspense>
        <Suspense fallback={<ChartFallback />}>
          <DonutCard
            title="Collected and dues"
            ariaLabel="Money collected compared with money still owed and money overdue"
            slices={[
              { name: 'Collected', value: collected, color: 'var(--success)' },
              {
                name: 'Not yet due',
                value: Math.max(outstanding - overdue, 0),
                color: 'var(--warning)',
              },
              { name: 'Past due', value: overdue, color: 'var(--destructive)' },
            ]}
          />
        </Suspense>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<ChartFallback />}>
          <DonutCard
            title="Lead results"
            ariaLabel="Leads that were won compared with leads still open or lost"
            money={false}
            slices={[
              { name: 'Won', value: data.leads.won, color: 'var(--success)' },
              {
                name: 'Not won',
                value: Math.max(data.leads.created - data.leads.won, 0),
                color: 'var(--muted-foreground)',
              },
            ]}
          />
        </Suspense>
        <Suspense fallback={<ChartFallback />}>
          <DonutCard
            title="Commission split"
            ariaLabel="Commission paid compared with commission still payable"
            slices={[
              {
                name: 'Paid',
                value: Number(data.commissions.paid),
                color: 'var(--success)',
              },
              {
                name: 'Payable',
                value: Number(data.commissions.payable),
                color: 'var(--warning)',
              },
            ]}
          />
        </Suspense>
        <Suspense fallback={<ChartFallback />}>
          <HorizontalBarCard
            title="Alert counts"
            ariaLabel="Number of low stock items and batteries that are expired or expiring"
            items={[
              {
                name: 'Low stock',
                value: data.alerts.lowStockItems,
                color: 'var(--warning)',
              },
              {
                name: 'Expired',
                value: data.alerts.batteriesExpired,
                color: 'var(--destructive)',
              },
              {
                name: 'Expiring soon',
                value: data.alerts.batteriesExpiring,
                color: 'var(--primary)',
              },
              {
                name: 'Not valued',
                value: data.stock.itemsWithoutCost,
                color: 'var(--muted-foreground)',
              },
            ]}
          />
        </Suspense>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<ChartFallback />}>
          <BranchCompareChart branches={data.branches} />
        </Suspense>
        <Suspense fallback={<ChartFallback />}>
          <RunningTotalChart points={data.trend} />
        </Suspense>
      </div>
      <BranchTable branches={data.branches} onOpen={onOpen} />
    </div>
  );
}

function BranchView({ data }: { data: BranchDashboard }) {
  const salesTotal = Number(data.sales.sales);
  const collected = Number(data.sales.collected);
  const outstanding = Number(data.dues.outstanding);
  const overdue = Number(data.dues.overdue);

  return (
    <div className="space-y-6">
      <h2 className="section-title">
        {data.branch.code} · {data.branch.name}
      </h2>
      <StatGrid title="Sales and purchases">
        <Stat
          label="Sales (with GST)"
          value={formatRupees(data.sales.sales)}
          hint={`${data.sales.invoices} invoices`}
        />
        <Stat label="Collected" value={formatRupees(data.sales.collected)} />
        <Stat
          label="Purchases"
          value={formatRupees(data.purchases.value)}
          hint={`${data.purchases.orders} orders`}
        />
        <Stat label="Revenue" value={formatRupees(data.sales.revenue)} />
      </StatGrid>
      <StatGrid title="Stock and transfers">
        <Stat
          label="Current stock"
          value={`${data.stock.units} units`}
          hint={formatRupees(data.stock.value)}
        />
        <Stat
          label="Low stock"
          value={String(data.stock.lowStockItems)}
          tone={data.stock.lowStockItems > 0 ? 'warn' : 'normal'}
        />
        <Stat label="Transfers coming in" value={String(data.transfers.incoming)} />
        <Stat label="Transfers going out" value={String(data.transfers.outgoing)} />
      </StatGrid>
      <StatGrid title="Dues and follow-ups">
        <Stat
          label="Outstanding"
          value={formatRupees(data.dues.outstanding)}
          hint={`${data.dues.invoices} invoices`}
        />
        <Stat
          label="Overdue"
          value={formatRupees(data.dues.overdue)}
          tone={data.dues.overdueInvoices > 0 ? 'warn' : 'normal'}
        />
        <Stat
          label="Follow-ups overdue"
          value={String(data.followups.overdue)}
          tone={data.followups.overdue > 0 ? 'warn' : 'normal'}
        />
        <Stat
          label="Follow-ups today"
          value={String(data.followups.today)}
          hint={`${data.followups.upcoming} later`}
        />
      </StatGrid>
      <StatGrid title="Leads and batteries">
        <Stat label="Leads created" value={String(data.leads.created)} />
        <Stat
          label="Lead conversion"
          value={percent(data.leads.conversionRate)}
          hint={`${data.leads.won} won`}
        />
        <Stat
          label="Batteries expired"
          value={String(data.alerts.batteriesExpired)}
          tone={data.alerts.batteriesExpired > 0 ? 'warn' : 'normal'}
        />
        <Stat
          label={`Batteries expiring in ${data.withinDays} days`}
          value={String(data.alerts.batteriesExpiring)}
        />
      </StatGrid>
      <Suspense fallback={<ChartFallback />}>
        <TrendChart points={data.trend} />
      </Suspense>
      <div className="grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<ChartFallback />}>
          <DonutCard
            title="Collected and balance"
            ariaLabel="Money collected compared with sales still to be collected"
            slices={[
              { name: 'Collected', value: collected, color: 'var(--success)' },
              {
                name: 'Balance',
                value: Math.max(salesTotal - collected, 0),
                color: 'var(--warning)',
              },
            ]}
          />
        </Suspense>
        <Suspense fallback={<ChartFallback />}>
          <DonutCard
            title="Dues status"
            ariaLabel="Money owed that is not yet due compared with money past due"
            slices={[
              {
                name: 'Not yet due',
                value: Math.max(outstanding - overdue, 0),
                color: 'var(--warning)',
              },
              { name: 'Past due', value: overdue, color: 'var(--destructive)' },
            ]}
          />
        </Suspense>
        <Suspense fallback={<ChartFallback />}>
          <DonutCard
            title="Lead results"
            ariaLabel="Leads that were won compared with leads still open or lost"
            money={false}
            slices={[
              { name: 'Won', value: data.leads.won, color: 'var(--success)' },
              {
                name: 'Not won',
                value: Math.max(data.leads.created - data.leads.won, 0),
                color: 'var(--muted-foreground)',
              },
            ]}
          />
        </Suspense>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<ChartFallback />}>
          <HorizontalBarCard
            title="Follow-ups"
            ariaLabel="Follow-ups that are overdue, due today and coming later"
            items={[
              { name: 'Overdue', value: data.followups.overdue, color: 'var(--destructive)' },
              { name: 'Today', value: data.followups.today, color: 'var(--warning)' },
              { name: 'Later', value: data.followups.upcoming, color: 'var(--primary)' },
            ]}
          />
        </Suspense>
        <Suspense fallback={<ChartFallback />}>
          <HorizontalBarCard
            title="Stock movement"
            ariaLabel="Stock transfers arriving at and leaving this branch"
            items={[
              { name: 'Incoming', value: data.transfers.incoming, color: 'var(--success)' },
              { name: 'Outgoing', value: data.transfers.outgoing, color: 'var(--warning)' },
            ]}
          />
        </Suspense>
        <Suspense fallback={<ChartFallback />}>
          <RunningTotalChart points={data.trend} />
        </Suspense>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { user, can } = useAuth();
  const activeBranch = useActiveBranch();
  const today = todayInIndia();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const canCompany = can('dashboards.view_company');
  const canBranch = can('dashboards.view_branch');

  const own = user?.branches ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const fallback = activeBranch ?? (own.length === 1 ? (own[0]?.id ?? null) : null);
  const branchId = picked ?? (canCompany ? null : fallback);

  const problem = periodProblem(from, to);
  const params = { from, to };
  const company = useCompanyDashboard(params, canCompany && branchId === null && problem === null);
  const branch = useBranchDashboard(canBranch && problem === null ? branchId : null, params);

  const options =
    canCompany && company.data
      ? company.data.branches.map((row) => ({
          id: row.branchId,
          label: `${row.branchCode} · ${row.branchName}`,
        }))
      : own.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}` }));

  const hasDashboard = canCompany || canBranch;

  return (
    <PageContainer>
      <PageHeader
        title="Dashboard"
        description="How the business is doing for the period you choose."
      />

      {hasDashboard ? (
        <>
          <form
            className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
            aria-label="Dashboard period"
            onSubmit={(event) => event.preventDefault()}
          >
            <DateRangePicker
              legend="Period"
              from={from}
              to={to}
              onChange={(range) => {
                setFrom(range.from);
                setTo(range.to);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setFrom(monthStart(today));
                setTo(today);
              }}
            >
              This month
            </Button>
            {options.length > 0 && (canCompany || options.length > 1) ? (
              <label className="space-y-1 text-sm font-medium">
                <span>Show</span>
                <Select
                  className="w-full sm:w-56"
                  value={branchId ?? ''}
                  onChange={(event) => setPicked(event.target.value || null)}
                >
                  {canCompany ? (
                    <option value="">Whole company</option>
                  ) : (
                    <option value="">Choose a branch</option>
                  )}
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
          </form>

          {problem ? <Alert tone="error">{problem}</Alert> : null}

          {!problem && branchId === null && canCompany ? (
            company.isPending ? (
              <Loading />
            ) : company.error ? (
              <Failed error={company.error} retry={() => void company.refetch()} />
            ) : (
              <CompanyView data={company.data} onOpen={setPicked} />
            )
          ) : null}

          {!problem && branchId === null && !canCompany ? (
            <Alert>Choose a branch to see its dashboard.</Alert>
          ) : null}

          {!problem && branchId !== null ? (
            branch.isPending ? (
              <Loading />
            ) : branch.error ? (
              <Failed error={branch.error} retry={() => void branch.refetch()} />
            ) : (
              <BranchView data={branch.data} />
            )
          ) : null}
        </>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>System status</CardTitle>
        </CardHeader>
        <CardContent>
          <HealthStatus />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
