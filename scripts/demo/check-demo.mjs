// Prints the headline figures of the demo system, so you can confirm it is filled before a presentation.
import { Api } from './client.mjs';

const baseUrl = process.env.DEMO_API_URL ?? 'http://localhost:3000';
const password = process.env.DEMO_SUPER_PASSWORD ?? process.env.SEED_SUPER_ADMIN_PASSWORD ?? '';
const api = new Api({
  baseUrl,
  origin: process.env.DEMO_ORIGIN ?? process.env.WEB_ORIGIN ?? 'http://localhost:5173',
});
await api.login(process.env.DEMO_SUPER_USERNAME ?? 'superadmin', password);
const day = (back = 0) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
const rupees = (v) => `Rs ${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const c = await api.get(`/dashboards/company?from=${day(45)}&to=${day()}`);
const month = await api.get('/dashboards/company');
console.log(`Branches: ${c.branchCount}`);
console.log(
  `Last 45 days: ${c.sales.invoices} invoices, sales ${rupees(c.sales.sales)}, collected ${rupees(c.sales.collected)}, purchases ${rupees(c.purchases.value)}`,
);
console.log(
  `This month so far: ${month.sales.invoices} invoices, sales ${rupees(month.sales.sales)}`,
);
console.log(
  `Stock: ${c.stock.units} units worth ${rupees(c.stock.value)}; dues ${rupees(c.dues.outstanding)} (overdue ${rupees(c.dues.overdue)})`,
);
console.log(
  `Leads: ${c.leads.created} created, ${c.leads.won} won; commission payable ${rupees(c.commissions.payable)}`,
);
console.log(
  `Alerts: ${c.alerts.lowStockItems} low-stock lines, ${c.alerts.batteriesExpired} batteries expired, ${c.alerts.batteriesExpiring} expiring soon`,
);
const reports = await api.get('/reports');
for (const report of reports) {
  const result = await api.get(`/reports/${report.code}?from=${day(45)}&to=${day()}&pageSize=1`);
  console.log(`Report ${report.title.padEnd(24)} ${String(result.total).padStart(4)} rows`);
}
const unread = await api.get('/notifications/unread-count');
console.log(`Owner notifications unread: ${unread.unreadCount}`);
