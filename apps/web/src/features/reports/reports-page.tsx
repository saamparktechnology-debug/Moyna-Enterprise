import { useState } from 'react';
import { DASHBOARD_MAX_RANGE_DAYS, daysBetween, todayInIndia } from '@erp/contracts';
import type { ReportCode, ReportColumn } from '@erp/contracts';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Alert } from '@/components/alert';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { EmptyState } from '@/components/empty-state';
import { DateRangePicker } from '@/components/forms/date-range-picker';
import { LoadingState } from '@/components/loading-state';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Select } from '@/components/select-field';
import { Button, buttonVariants } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { ApiError } from '@/lib/api-client';
import { exportUrl } from './reports-api';
import type { ReportParams } from './reports-api';
import { useReport, useReportBranches, useReportCatalog } from './use-reports';

const PAGE_SIZE = 25;
const monthStart = (today: string): string => `${today.slice(0, 8)}01`;

function periodProblem(from: string, to: string): string | null {
  if (!from || !to) return 'Choose both dates';
  if (from > to) return 'The end date is before the start';
  if (daysBetween(from, to) + 1 > DASHBOARD_MAX_RANGE_DAYS)
    return `Choose at most ${DASHBOARD_MAX_RANGE_DAYS} days`;
  return null;
}

const align = (column: ReportColumn): string =>
  column.type === 'money' || column.type === 'int' ? 'text-right' : 'text-left';

function formatCell(value: string | number | null, column: ReportColumn): string {
  if (value === null || value === '') return '';
  if (column.type === 'money')
    return Number(value).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return String(value);
}

export function ReportsPage() {
  const { can } = useAuth();
  const catalog = useReportCatalog();
  const branches = useReportBranches();
  const today = todayInIndia();
  const [code, setCode] = useState<ReportCode | ''>('');
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const reports = catalog.data ?? [];
  const selected = reports.find((entry) => entry.code === code) ?? null;
  const problem = selected?.usesPeriod ? periodProblem(from, to) : null;
  const params: ReportParams = { from, to, branchId, page, pageSize: PAGE_SIZE, sortBy, sortOrder };
  const report = useReport(
    selected?.code ?? null,
    params,
    selected?.usesPeriod ?? false,
    problem === null,
  );

  const choose = (next: ReportCode | '') => {
    setCode(next);
    setPage(1);
    setSortBy('');
    setSortOrder('asc');
  };
  const sortOn = (key: string) => {
    setPage(1);
    if (sortBy === key) setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    else {
      setSortBy(key);
      setSortOrder('asc');
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        description="Choose a report, narrow it by dates and branch, and download it as Excel or PDF."
      />

      {catalog.isPending ? <LoadingState label="Loading reports…" rows={2} /> : null}
      {catalog.error ? (
        <div className="space-y-2">
          <Alert tone="error">
            {catalog.error instanceof ApiError
              ? catalog.error.message
              : 'Reports could not be loaded'}
          </Alert>
          <Button type="button" variant="secondary" onClick={() => void catalog.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {catalog.data && reports.length === 0 ? (
        <Alert>You may not open any reports. Ask an administrator.</Alert>
      ) : null}

      {reports.length > 0 ? (
        <form
          aria-label="Report filters"
          className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Report</span>
            <Select
              className="w-full sm:w-64"
              value={code}
              onChange={(event) => choose(event.target.value as ReportCode | '')}
            >
              <option value="">Choose a report</option>
              {reports.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.title}
                </option>
              ))}
            </Select>
          </label>
          {selected?.usesPeriod ? (
            <>
              <DateRangePicker
                legend="Period"
                from={from}
                to={to}
                onChange={(range) => {
                  setFrom(range.from);
                  setTo(range.to);
                  setPage(1);
                }}
              />
            </>
          ) : null}
          <label className="space-y-1 text-sm">
            <span className="block text-muted-foreground">Branch</span>
            <Select
              className="w-full sm:w-52"
              value={branchId}
              onChange={(e) => {
                setBranchId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All branches</option>
              {(branches.data ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.code} · {branch.name}
                </option>
              ))}
            </Select>
          </label>
        </form>
      ) : null}

      {selected ? <p className="text-sm text-muted-foreground">{selected.description}</p> : null}
      {selected && !selected.usesPeriod ? (
        <p className="text-sm text-muted-foreground">
          This report shows the position today, so the dates do not apply.
        </p>
      ) : null}
      {problem ? <Alert tone="error">{problem}</Alert> : null}

      {selected && !problem ? (
        <>
          {report.isPending ? <LoadingState label="Loading report…" rows={5} /> : null}
          {report.error ? (
            <div className="space-y-2">
              <Alert tone="error">
                {report.error instanceof ApiError
                  ? report.error.message
                  : 'The report could not be loaded'}
              </Alert>
              <Button type="button" variant="secondary" onClick={() => void report.refetch()}>
                Try again
              </Button>
            </div>
          ) : null}

          {report.data ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="tabular text-sm font-medium">
                  {report.data.total} {report.data.total === 1 ? 'row' : 'rows'}
                </p>
                {can('reports.export') ? (
                  <div className="flex gap-2">
                    <a
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      href={exportUrl(selected.code, 'xlsx', params, selected.usesPeriod)}
                    >
                      Download Excel
                    </a>
                    <a
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      href={exportUrl(selected.code, 'pdf', params, selected.usesPeriod)}
                    >
                      Download PDF
                    </a>
                  </div>
                ) : null}
              </div>

              {report.data.rows.length === 0 ? (
                <EmptyState>No rows for these filters.</EmptyState>
              ) : (
                <div
                  role="region"
                  aria-label={`${selected.title} report, scrollable`}
                  tabIndex={0}
                  className="relative overflow-x-auto rounded-lg border bg-card"
                >
                  <table className="w-full text-sm" aria-label={`${selected.title} report`}>
                    <thead className="border-b bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        {selected.columns.map((column) => (
                          <th
                            key={column.key}
                            scope="col"
                            className={`px-(--cell-px) py-2.5 font-medium ${align(column)}`}
                            aria-sort={
                              sortBy === column.key
                                ? sortOrder === 'asc'
                                  ? 'ascending'
                                  : 'descending'
                                : 'none'
                            }
                          >
                            <button
                              type="button"
                              className={`inline-flex items-center gap-1 rounded-sm uppercase tracking-wide hover:text-foreground ${sortBy === column.key ? 'text-foreground' : ''}`}
                              onClick={() => sortOn(column.key)}
                            >
                              {column.label}
                              {sortBy === column.key ? (
                                sortOrder === 'asc' ? (
                                  <ArrowUp className="size-3.5" aria-hidden="true" />
                                ) : (
                                  <ArrowDown className="size-3.5" aria-hidden="true" />
                                )
                              ) : (
                                <ArrowUpDown className="size-3.5 opacity-60" aria-hidden="true" />
                              )}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {report.data.rows.map((row, index) => (
                        <tr key={index} className="border-b hover:bg-muted/40">
                          {selected.columns.map((column) => (
                            <td
                              key={column.key}
                              className={`px-(--cell-px) py-(--row-py) ${column.type === 'money' || column.type === 'int' ? 'tabular' : ''} ${align(column)}`}
                            >
                              {formatCell(row[column.key] ?? null, column)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    {Object.keys(report.data.totals).length > 0 ? (
                      <tfoot className="border-t bg-muted/40">
                        <tr className="font-semibold">
                          {selected.columns.map((column, index) => (
                            <td
                              key={column.key}
                              className={`px-(--cell-px) py-2.5 ${column.type === 'money' || column.type === 'int' ? 'tabular' : ''} ${align(column)}`}
                            >
                              {index === 0
                                ? 'Total'
                                : formatCell(report.data.totals[column.key] ?? null, column)}
                            </td>
                          ))}
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>
              )}

              {report.data.totalPages > 1 ? (
                <DataTablePagination
                  page={report.data.page}
                  pageSize={report.data.pageSize}
                  total={report.data.total}
                  totalPages={report.data.totalPages}
                  shown={report.data.rows.length}
                  isFetching={report.isFetching}
                  onPageChange={setPage}
                />
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </PageContainer>
  );
}
