import type { BranchPerformance } from '@erp/contracts';
import { AlertTriangle } from 'lucide-react';
import { SimpleTable } from '@/components/data-table/simple-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { s } from 'node_modules/vitest/dist/chunks/config.d.BxjInJat';

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

export const formatRupees = (amount: string): string => rupees.format(Number(amount));

const compact = new Intl.NumberFormat('en-IN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Short numbers for chart axes, such as 1.2K or 3.4L. */
export const formatCompact = (amount: number): string => compact.format(amount);

interface StatProps {
  label: string;
  value: string;
  hint?: string;
  tone?: 'normal' | 'warn';
}

export function Stat({ label, value, hint, tone = 'normal' }: StatProps) {
  const warn = tone === 'warn';
  return (
    <Card className={cn(warn && 'border-destructive/50 bg-destructive-subtle')}>
      <CardContent className="space-y-1 p-4">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {warn ? (
            <>
              <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
              <span className="sr-only">Needs attention: </span>
            </>
          ) : null}
          {label}
        </p>
        <p className={cn('tabular break-words text-2xl font-semibold', warn && 'text-destructive')}>
          {value}
        </p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function StatGrid({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="section-title">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}

export const percent = (rate: number | null): string => (rate === null ? '—' : `${rate}%`);

export function BranchTable({
  branches,
  onOpen,
}: {
  branches: BranchPerformance[];
  onOpen: (branchId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Branch performance</CardTitle>
      </CardHeader>
      <CardContent>
        <SimpleTable
          label="Branch performance"
          rows={branches}
          getRowKey={(row) => row.branchId}
          columns={[
            {
              header: 'Branch',
              cell: (row) => (
                <>
                  <button
                    type="button"
                    className="rounded-sm text-left font-medium text-primary underline underline-offset-2"
                    onClick={() => onOpen(row.branchId)}
                  >
                    {row.branchCode} · {row.branchName}
                  </button>
                  {row.isActive ? null : (
                    <span className="ml-2 text-xs text-muted-foreground">inactive</span>
                  )}
                </>
              ),
            },
            { header: 'Sales', align: 'right', cell: (row) => formatRupees(row.sales.sales) },
            {
              header: 'Purchases',
              align: 'right',
              cell: (row) => formatRupees(row.purchases.value),
            },
            {
              header: 'Outstanding',
              align: 'right',
              cell: (row) => formatRupees(row.dues.outstanding),
            },
            {
              header: 'Stock value',
              align: 'right',
              cell: (row) => formatRupees(row.stock.value),
            },
            {
              header: 'Conversion',
              align: 'right',
              cell: (row) => percent(row.leads.conversionRate),
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}
