import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { BranchPerformance, DashboardTrendPoint } from '@erp/contracts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCompact, formatRupees } from './dashboard-parts';

/** Chart colours come from the design tokens, so they follow the light and dark themes. */
const SERIES = {
  sales: 'var(--primary)',
  purchases: 'var(--warning)',
  collected: 'var(--success)',
} as const;

/** Colours for pie slices and bars that are not tied to one of the series above. */
const PALETTE = [
  'var(--primary)',
  'var(--success)',
  'var(--warning)',
  'var(--destructive)',
  'var(--muted-foreground)',
] as const;

const AXIS = { stroke: 'var(--border)', tick: { fill: 'var(--muted-foreground)', fontSize: 12 } };
const TOOLTIP = {
  contentStyle: {
    background: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
  },
  labelStyle: { color: 'var(--popover-foreground)' },
};

export function TrendChart({ points }: { points: DashboardTrendPoint[] }) {
  const data = points.map((point) => ({
    day: point.day.slice(5),
    Sales: Number(point.sales),
    Purchases: Number(point.purchases),
    Collected: Number(point.collected),
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Day by day</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          role="img"
          aria-label="Sales, purchases and money collected for each day"
          className="h-64 w-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="day" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip {...TOOLTIP} />
              <Legend />
              <Line
                type="monotone"
                dataKey="Sales"
                stroke={SERIES.sales}
                strokeWidth={2}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Purchases"
                stroke={SERIES.purchases}
                strokeWidth={2}
                strokeDasharray="6 3"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="Collected"
                stroke={SERIES.collected}
                strokeWidth={2}
                strokeDasharray="2 3"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function BranchSalesChart({ branches }: { branches: BranchPerformance[] }) {
  const data = branches.map((row) => ({
    branch: row.branchCode,
    Sales: Number(row.sales.sales),
    Collected: Number(row.sales.collected),
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales by branch</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          role="img"
          aria-label="Sales and money collected for each branch"
          className="h-64 w-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="branch" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip {...TOOLTIP} />
              <Legend />
              <Bar dataKey="Sales" fill={SERIES.sales} />
              <Bar dataKey="Collected" fill={SERIES.collected} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export interface ChartSlice {
  name: string;
  value: number;
  color?: string;
}

const formatValue = (value: number, money: boolean): string =>
  money ? formatRupees(String(value)) : String(value);

function NoData() {
  return (
    <p className="flex h-64 items-center justify-center text-sm text-muted-foreground">
      No data for this period
    </p>
  );
}

/** A donut chart. Slices with no value are left out so the legend stays clean. */
export function DonutCard({
  title,
  ariaLabel,
  slices,
  money = true,
}: {
  title: string;
  ariaLabel: string;
  slices: ChartSlice[];
  money?: boolean;
}) {
  const data = slices.filter((slice) => slice.value > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <NoData />
        ) : (
          <div role="img" aria-label={ariaLabel} className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={2}
                  stroke="var(--card)"
                >
                  {data.map((slice, index) => (
                    <Cell key={slice.name} fill={slice.color ?? PALETTE[index % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP} formatter={(value) => formatValue(Number(value), money)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Horizontal bars, one per item, for short lists of counts or amounts. */
export function HorizontalBarCard({
  title,
  ariaLabel,
  items,
  money = false,
}: {
  title: string;
  ariaLabel: string;
  items: ChartSlice[];
  money?: boolean;
}) {
  const hasValue = items.some((item) => item.value > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {!hasValue ? (
          <NoData />
        ) : (
          <div role="img" aria-label={ariaLabel} className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={items} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tickFormatter={(value) => (money ? formatCompact(Number(value)) : String(value))}
                  {...AXIS}
                />
                <YAxis type="category" dataKey="name" width={110} {...AXIS} />
                <Tooltip {...TOOLTIP} formatter={(value) => formatValue(Number(value), money)} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {items.map((item, index) => (
                    <Cell key={item.name} fill={item.color ?? PALETTE[index % PALETTE.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Sales and money collected, added up day after day across the period. */
export function RunningTotalChart({ points }: { points: DashboardTrendPoint[] }) {
  let sales = 0;
  let collected = 0;
  const data = points.map((point) => {
    sales += Number(point.sales);
    collected += Number(point.collected);
    return { day: point.day.slice(5), Sales: sales, Collected: collected };
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Running total</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <NoData />
        ) : (
          <div
            role="img"
            aria-label="Sales and money collected, added up over the period"
            className="h-64 w-full"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" {...AXIS} />
                <YAxis tickFormatter={(value) => formatCompact(Number(value))} {...AXIS} />
                <Tooltip {...TOOLTIP} formatter={(value) => formatRupees(String(value))} />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="Sales"
                  stroke={SERIES.sales}
                  fill={SERIES.sales}
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="Collected"
                  stroke={SERIES.collected}
                  fill={SERIES.collected}
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Sales, purchases and what is still owed, side by side for every branch. */
export function BranchCompareChart({ branches }: { branches: BranchPerformance[] }) {
  const data = branches.map((row) => ({
    branch: row.branchCode,
    Sales: Number(row.sales.sales),
    Purchases: Number(row.purchases.value),
    Outstanding: Number(row.dues.outstanding),
  }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales, purchases and dues</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <NoData />
        ) : (
          <div
            role="img"
            aria-label="Sales, purchases and outstanding money by branch"
            className="h-64 w-full"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="branch" {...AXIS} />
                <YAxis tickFormatter={(value) => formatCompact(Number(value))} {...AXIS} />
                <Tooltip {...TOOLTIP} formatter={(value) => formatRupees(String(value))} />
                <Legend />
                <Bar dataKey="Sales" fill={SERIES.sales} />
                <Bar dataKey="Purchases" fill={SERIES.purchases} />
                <Bar dataKey="Outstanding" fill="var(--destructive)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
