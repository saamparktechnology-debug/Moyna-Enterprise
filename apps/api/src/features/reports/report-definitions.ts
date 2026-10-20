import { Prisma } from '@prisma/client';
import type { ReportCode, ReportColumn } from '@erp/contracts';

export interface ReportContext {
  from: string;
  to: string;
  branchId: string | null;
  today: string;
}

export interface ReportDefinition {
  code: ReportCode;
  title: string;
  description: string;
  columns: ReportColumn[];
  usesPeriod: boolean;
  /** Needed besides reports.view, so a report never shows what the person could not see in its own module. */
  needs: string;
  /** The order when nothing is chosen. */
  defaultSort: { key: string; order: 'asc' | 'desc' };
  /** A SELECT whose columns are named exactly like the column keys. */
  base(ctx: ReportContext): Prisma.Sql;
}

const text = (key: string, label: string): ReportColumn => ({ key, label, type: 'text' });
const int = (key: string, label: string): ReportColumn => ({ key, label, type: 'int' });
const money = (key: string, label: string): ReportColumn => ({ key, label, type: 'money' });
const date = (key: string, label: string): ReportColumn => ({ key, label, type: 'date' });

/** The India calendar date of a timestamp column stored without a time zone (UTC). */
const day = (column: string): Prisma.Sql =>
  Prisma.raw(`((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date`);
const dateText = (expression: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`to_char(${expression}, 'YYYY-MM-DD')`;
const within = (expression: Prisma.Sql, ctx: ReportContext): Prisma.Sql =>
  Prisma.sql`${expression} BETWEEN ${ctx.from}::date AND ${ctx.to}::date`;
/** Narrows to one branch when chosen. Row-level security already limits everything to the caller's branches. */
const inBranch = (column: string, ctx: ReportContext): Prisma.Sql =>
  ctx.branchId ? Prisma.sql`AND ${Prisma.raw(column)} = ${ctx.branchId}::uuid` : Prisma.empty;

const invoiceRows = (
  ctx: ReportContext,
  type: 'GST' | 'NON_GST' | null,
  gstColumns: boolean,
) => Prisma.sql`
  SELECT ${dateText(Prisma.sql`i.issued_on`)} AS "date", i.invoice_no AS "invoiceNo", b.code AS "branch",
         c.name AS "customer", ${gstColumns ? Prisma.sql`coalesce(i.customer_gstin, '')` : Prisma.sql`i.type::text`} AS ${Prisma.raw(gstColumns ? '"gstin"' : '"type"')},
         i.taxable_value AS "taxable",
         ${
           gstColumns
             ? Prisma.sql`i.cgst_amount AS "cgst", i.sgst_amount AS "sgst", i.igst_amount AS "igst",`
             : Prisma.sql`(i.cgst_amount + i.sgst_amount + i.igst_amount) AS "tax",`
         }
         i.total AS "total"
  FROM invoices i
  JOIN branches b ON b.id = i.branch_id
  JOIN customers c ON c.id = i.customer_id
  WHERE i.status = 'ISSUED' AND ${within(Prisma.sql`i.issued_on`, ctx)}
    ${type ? Prisma.sql`AND i.type = ${type}::"InvoiceType"` : Prisma.empty} ${inBranch('i.branch_id', ctx)}`;

export const REPORTS: ReportDefinition[] = [
  {
    code: 'SALES',
    title: 'Sales',
    description: 'Issued invoices (GST and non-GST) in the period, with tax and total.',
    columns: [
      date('date', 'Date'),
      text('invoiceNo', 'Invoice'),
      text('branch', 'Branch'),
      text('customer', 'Customer'),
      text('type', 'Type'),
      money('taxable', 'Taxable value'),
      money('tax', 'Tax'),
      money('total', 'Total'),
    ],
    usesPeriod: true,
    needs: 'invoices.view',
    defaultSort: { key: 'date', order: 'desc' },
    base: (ctx) => invoiceRows(ctx, null, false),
  },
  {
    code: 'GST_SALES',
    title: 'GST sales',
    description: 'GST invoices with the customer GSTIN and the CGST, SGST and IGST split.',
    columns: [
      date('date', 'Date'),
      text('invoiceNo', 'Invoice'),
      text('branch', 'Branch'),
      text('customer', 'Customer'),
      text('gstin', 'Customer GSTIN'),
      money('taxable', 'Taxable value'),
      money('cgst', 'CGST'),
      money('sgst', 'SGST'),
      money('igst', 'IGST'),
      money('total', 'Total'),
    ],
    usesPeriod: true,
    needs: 'invoices.view',
    defaultSort: { key: 'date', order: 'desc' },
    base: (ctx) => invoiceRows(ctx, 'GST', true),
  },
  {
    code: 'NON_GST_SALES',
    title: 'Non-GST sales',
    description: 'Invoices issued without GST.',
    columns: [
      date('date', 'Date'),
      text('invoiceNo', 'Invoice'),
      text('branch', 'Branch'),
      text('customer', 'Customer'),
      text('type', 'Type'),
      money('taxable', 'Value'),
      money('tax', 'Tax'),
      money('total', 'Total'),
    ],
    usesPeriod: true,
    needs: 'invoices.view',
    defaultSort: { key: 'date', order: 'desc' },
    base: (ctx) => invoiceRows(ctx, 'NON_GST', false),
  },
  {
    code: 'PURCHASES',
    title: 'Purchases',
    description: 'Approved, partly received and received purchase orders by order date.',
    columns: [
      date('date', 'Order date'),
      text('poNo', 'Purchase order'),
      text('branch', 'Branch'),
      text('supplier', 'Supplier'),
      text('status', 'Status'),
      int('qty', 'Quantity'),
      money('value', 'Value'),
    ],
    usesPeriod: true,
    needs: 'purchases.view',
    defaultSort: { key: 'date', order: 'desc' },
    base: (ctx) => Prisma.sql`
      SELECT ${dateText(Prisma.sql`po.order_date`)} AS "date", po.po_no AS "poNo", b.code AS "branch",
             s.name AS "supplier", po.status::text AS "status", sum(pl.qty_ordered)::int AS "qty",
             sum(pl.qty_ordered * pl.unit_cost) AS "value"
      FROM purchase_orders po
      JOIN branches b ON b.id = po.branch_id
      JOIN suppliers s ON s.id = po.supplier_id
      JOIN po_lines pl ON pl.po_id = po.id
      WHERE po.status IN ('APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED')
        AND ${within(Prisma.sql`po.order_date`, ctx)} ${inBranch('po.branch_id', ctx)}
      GROUP BY po.id, b.code, s.name`,
  },
  {
    code: 'STOCK',
    title: 'Stock',
    description:
      'Stock on hand today by branch and item, valued at each item’s latest purchase cost.',
    columns: [
      text('branch', 'Branch'),
      text('itemCode', 'Item code'),
      text('item', 'Item'),
      int('available', 'Available'),
      int('reserved', 'Reserved'),
      int('inTransit', 'In transit'),
      int('damaged', 'Damaged'),
      money('value', 'Value'),
    ],
    usesPeriod: false,
    needs: 'stock.view',
    defaultSort: { key: 'branch', order: 'asc' },
    base: (ctx) => Prisma.sql`
      SELECT b.code AS "branch", i.item_code AS "itemCode", i.name AS "item",
             (coalesce(sum(sb.quantity) FILTER (WHERE sb.state = 'AVAILABLE'), 0))::int AS "available",
             (coalesce(sum(sb.quantity) FILTER (WHERE sb.state = 'RESERVED'), 0))::int AS "reserved",
             (coalesce(sum(sb.quantity) FILTER (WHERE sb.state = 'IN_TRANSIT'), 0))::int AS "inTransit",
             (coalesce(sum(sb.quantity) FILTER (WHERE sb.state = 'DAMAGED'), 0))::int AS "damaged",
             coalesce(v.value, 0) AS "value"
      FROM stock_balances sb
      JOIN branches b ON b.id = sb.branch_id
      JOIN items i ON i.id = sb.item_id
      LEFT JOIN v_stock_value_by_branch v ON v.branch_id = sb.branch_id AND v.item_id = sb.item_id
      WHERE true ${inBranch('sb.branch_id', ctx)}
      GROUP BY b.code, i.item_code, i.name, v.value`,
  },
  {
    code: 'TRANSFERS',
    title: 'Transfers',
    description:
      'Transfers requested in the period, with quantities requested, sent, received and damaged.',
    columns: [
      date('date', 'Date'),
      text('transferNo', 'Transfer'),
      text('fromBranch', 'From'),
      text('toBranch', 'To'),
      text('status', 'Status'),
      int('requested', 'Requested'),
      int('sent', 'Sent'),
      int('received', 'Received'),
      int('damaged', 'Damaged'),
    ],
    usesPeriod: true,
    needs: 'transfers.view',
    defaultSort: { key: 'date', order: 'desc' },
    base: (ctx) => Prisma.sql`
      SELECT ${dateText(day('t.created_at'))} AS "date", t.transfer_no AS "transferNo", fb.code AS "fromBranch",
             tb.code AS "toBranch", t.status::text AS "status",
             (coalesce(sum(l.qty_requested), 0))::int AS "requested", (coalesce(sum(l.qty_sent), 0))::int AS "sent",
             (coalesce(sum(l.qty_received), 0))::int AS "received", (coalesce(sum(l.qty_damaged), 0))::int AS "damaged"
      FROM transfers t
      JOIN branches fb ON fb.id = t.from_branch_id
      JOIN branches tb ON tb.id = t.to_branch_id
      LEFT JOIN transfer_lines l ON l.transfer_id = t.id
      WHERE ${within(day('t.created_at'), ctx)}
        ${ctx.branchId ? Prisma.sql`AND (t.from_branch_id = ${ctx.branchId}::uuid OR t.to_branch_id = ${ctx.branchId}::uuid)` : Prisma.empty}
      GROUP BY t.id, fb.code, tb.code`,
  },
  {
    code: 'ADJUSTMENTS',
    title: 'Stock adjustments',
    description: 'Adjustments requested in the period and what happened to each.',
    columns: [
      date('date', 'Date'),
      text('branch', 'Branch'),
      text('itemCode', 'Item code'),
      text('serialNo', 'Serial number'),
      text('kind', 'Kind'),
      int('qty', 'Quantity'),
      text('reason', 'Reason'),
      text('status', 'Status'),
    ],
    usesPeriod: true,
    needs: 'stock.view',
    defaultSort: { key: 'date', order: 'desc' },
    base: (ctx) => Prisma.sql`
      SELECT ${dateText(day('a.created_at'))} AS "date", b.code AS "branch", i.item_code AS "itemCode",
             coalesce(a.serial_no, '') AS "serialNo", a.kind::text AS "kind", a.qty AS "qty", a.reason AS "reason",
             a.status::text AS "status"
      FROM stock_adjustments a
      JOIN branches b ON b.id = a.branch_id
      JOIN items i ON i.id = a.item_id
      WHERE ${within(day('a.created_at'), ctx)} ${inBranch('a.branch_id', ctx)}`,
  },
  {
    code: 'EXCHANGES',
    title: 'Exchanges',
    description:
      'Exchanges and returns in the period, with the value taken back and the value given.',
    columns: [
      date('date', 'Date'),
      text('exchangeNo', 'Exchange'),
      text('branch', 'Branch'),
      text('invoiceNo', 'Invoice'),
      text('kind', 'Kind'),
      text('disposition', 'Disposition'),
      text('status', 'Status'),
      money('returned', 'Returned'),
      money('valuation', 'Valuation'),
      money('given', 'New value'),
      money('difference', 'Difference'),
    ],
    usesPeriod: true,
    needs: 'invoices.view',
    defaultSort: { key: 'date', order: 'desc' },
    base: (ctx) => Prisma.sql`
      SELECT ${dateText(day('e.created_at'))} AS "date", e.exchange_no AS "exchangeNo", b.code AS "branch",
             coalesce(i.invoice_no, '') AS "invoiceNo", e.kind AS "kind", e.disposition AS "disposition",
             e.status::text AS "status", coalesce(e.returned_amount, 0) AS "returned",
             coalesce(e.valuation_amount, 0) AS "valuation", coalesce(e.new_amount, 0) AS "given",
             coalesce(e.difference_amount, 0) AS "difference"
      FROM exchanges e
      JOIN branches b ON b.id = e.branch_id
      LEFT JOIN invoices i ON i.id = coalesce(e.original_invoice_id, e.invoice_id)
      WHERE ${within(day('e.created_at'), ctx)} ${inBranch('e.branch_id', ctx)}`,
  },
  {
    code: 'DUES',
    title: 'Dues',
    description: 'Invoices with money still owed today, with how many days late each one is.',
    columns: [
      text('invoiceNo', 'Invoice'),
      text('branch', 'Branch'),
      text('customer', 'Customer'),
      date('dueDate', 'Due date'),
      int('daysOverdue', 'Days overdue'),
      money('total', 'Total'),
      money('credited', 'Credit notes'),
      money('paid', 'Paid'),
      money('outstanding', 'Outstanding'),
    ],
    usesPeriod: false,
    needs: 'payments.view',
    defaultSort: { key: 'outstanding', order: 'desc' },
    base: (ctx) => Prisma.sql`
      SELECT i.invoice_no AS "invoiceNo", b.code AS "branch", c.name AS "customer",
             ${dateText(Prisma.sql`v.due_date`)} AS "dueDate",
             (CASE WHEN v.due_date IS NULL THEN 0 ELSE greatest(${ctx.today}::date - v.due_date, 0) END)::int AS "daysOverdue",
             v.total AS "total", v.credited AS "credited", v.paid AS "paid", v.outstanding AS "outstanding"
      FROM v_invoice_balances v
      JOIN invoices i ON i.id = v.invoice_id
      JOIN branches b ON b.id = v.branch_id
      JOIN customers c ON c.id = v.customer_id
      WHERE v.outstanding > 0 ${inBranch('v.branch_id', ctx)}`,
  },
  {
    code: 'PAYMENTS',
    title: 'Payments',
    description: 'Money received in the period, including payments that were later reversed.',
    columns: [
      date('date', 'Date'),
      text('receiptNo', 'Receipt'),
      text('branch', 'Branch'),
      text('customer', 'Customer'),
      text('mode', 'Mode'),
      text('reference', 'Reference'),
      text('status', 'Status'),
      money('amount', 'Amount'),
    ],
    usesPeriod: true,
    needs: 'payments.view',
    defaultSort: { key: 'date', order: 'desc' },
    base: (ctx) => Prisma.sql`
      SELECT ${dateText(Prisma.sql`p.paid_on`)} AS "date", p.receipt_no AS "receiptNo", b.code AS "branch",
             c.name AS "customer", p.mode AS "mode", coalesce(p.reference, '') AS "reference",
             (CASE WHEN r.payment_id IS NULL THEN 'Received' ELSE 'Reversed' END) AS "status", p.amount AS "amount"
      FROM payments p
      JOIN branches b ON b.id = p.branch_id
      JOIN customers c ON c.id = p.customer_id
      LEFT JOIN payment_reversals r ON r.payment_id = p.id
      WHERE ${within(Prisma.sql`p.paid_on`, ctx)} ${inBranch('p.branch_id', ctx)}`,
  },
  {
    code: 'COMMISSIONS',
    title: 'Commissions',
    description:
      'Broker commissions created in the period, what each is worth now and what was paid.',
    columns: [
      date('date', 'Date'),
      text('branch', 'Branch'),
      text('broker', 'Broker'),
      text('invoiceNo', 'Invoice'),
      text('status', 'Status'),
      money('amount', 'Amount'),
      money('payable', 'Payable now'),
      money('paid', 'Paid'),
    ],
    usesPeriod: true,
    needs: 'brokers.view',
    defaultSort: { key: 'date', order: 'desc' },
    base: (ctx) => Prisma.sql`
      SELECT ${dateText(day('c.created_at'))} AS "date", b.code AS "branch", br.name AS "broker",
             coalesce(i.invoice_no, '') AS "invoiceNo", c.status::text AS "status", c.amount AS "amount",
             w.payable_amount AS "payable", w.paid_amount AS "paid"
      FROM commissions c
      JOIN branches b ON b.id = c.branch_id
      JOIN brokers br ON br.id = c.broker_id
      JOIN invoices i ON i.id = c.invoice_id
      JOIN v_commission_worth w ON w.commission_id = c.id
      WHERE ${within(day('c.created_at'), ctx)} ${inBranch('c.branch_id', ctx)}`,
  },
  {
    code: 'LEADS',
    title: 'Leads',
    description: 'Leads created in the period by source, and how many are won, lost or still open.',
    columns: [
      text('source', 'Source'),
      int('created', 'Created'),
      int('won', 'Won'),
      int('lost', 'Lost'),
      int('open', 'Open'),
      text('conversion', 'Conversion'),
    ],
    usesPeriod: true,
    needs: 'leads.view',
    defaultSort: { key: 'created', order: 'desc' },
    base: (ctx) => Prisma.sql`
      SELECT coalesce(ls.name, l.source) AS "source", count(*)::int AS "created",
             (count(*) FILTER (WHERE l.stage = 'WON'))::int AS "won",
             (count(*) FILTER (WHERE l.stage = 'LOST'))::int AS "lost",
             (count(*) FILTER (WHERE l.stage NOT IN ('WON', 'LOST')))::int AS "open",
             round(100.0 * (count(*) FILTER (WHERE l.stage = 'WON')) / count(*), 1)::text || '%' AS "conversion"
      FROM leads l
      LEFT JOIN lead_sources ls ON ls.code = l.source
      WHERE ${within(day('l.created_at'), ctx)} ${inBranch('l.branch_id', ctx)}
      GROUP BY coalesce(ls.name, l.source)`,
  },
  {
    code: 'ATTENDANCE',
    title: 'Attendance',
    description: 'Days present and approved leave days for each staff member in the period.',
    columns: [
      text('employeeCode', 'Code'),
      text('name', 'Name'),
      text('branch', 'Branch'),
      text('designation', 'Designation'),
      int('daysPresent', 'Days present'),
      int('leaveDays', 'Leave days'),
    ],
    usesPeriod: true,
    needs: 'hr.view',
    defaultSort: { key: 'employeeCode', order: 'asc' },
    base: (ctx) => Prisma.sql`
      SELECT s.employee_code AS "employeeCode", u.full_name AS "name", b.code AS "branch",
             coalesce(s.designation, '') AS "designation",
             (SELECT count(*) FROM attendance a
              WHERE a.staff_id = s.id AND ${within(Prisma.sql`a.work_date`, ctx)})::int AS "daysPresent",
             (SELECT coalesce(sum(least(l.to_date, ${ctx.to}::date) - greatest(l.from_date, ${ctx.from}::date) + 1), 0)
              FROM leave_requests l
              WHERE l.staff_id = s.id AND l.status = 'APPROVED'
                AND l.from_date <= ${ctx.to}::date AND l.to_date >= ${ctx.from}::date)::int AS "leaveDays"
      FROM staff s
      JOIN users u ON u.id = s.user_id
      JOIN branches b ON b.id = s.branch_id
      WHERE s.join_date <= ${ctx.to}::date AND (s.left_on IS NULL OR s.left_on >= ${ctx.from}::date)
        ${inBranch('s.branch_id', ctx)}`,
  },
  {
    code: 'BRANCH_PERFORMANCE',
    title: 'Branch performance',
    description:
      'For each branch: sales, revenue, purchases, money collected, dues, stock value and lead conversion.',
    columns: [
      text('branch', 'Branch'),
      text('name', 'Name'),
      int('invoices', 'Invoices'),
      money('sales', 'Sales'),
      money('revenue', 'Revenue'),
      money('purchases', 'Purchases'),
      money('collected', 'Collected'),
      money('outstanding', 'Outstanding'),
      money('stockValue', 'Stock value'),
      int('leads', 'Leads'),
      int('won', 'Won'),
    ],
    usesPeriod: true,
    needs: 'dashboards.view_company',
    defaultSort: { key: 'sales', order: 'desc' },
    base: (ctx) => Prisma.sql`
      SELECT b.code AS "branch", b.name AS "name",
             coalesce((SELECT sum(invoices) FROM v_daily_sales s WHERE s.branch_id = b.id AND ${within(Prisma.sql`s.day`, ctx)}), 0)::int AS "invoices",
             coalesce((SELECT sum(total) FROM v_daily_sales s WHERE s.branch_id = b.id AND ${within(Prisma.sql`s.day`, ctx)}), 0) AS "sales",
             coalesce((SELECT sum(taxable_value) FROM v_daily_sales s WHERE s.branch_id = b.id AND ${within(Prisma.sql`s.day`, ctx)}), 0)
               - coalesce((SELECT sum(taxable_value) FROM v_daily_credit_notes n WHERE n.branch_id = b.id AND ${within(Prisma.sql`n.day`, ctx)}), 0) AS "revenue",
             coalesce((SELECT sum(value) FROM v_daily_purchases p WHERE p.branch_id = b.id AND ${within(Prisma.sql`p.day`, ctx)}), 0) AS "purchases",
             coalesce((SELECT sum(received) FROM v_daily_collections c WHERE c.branch_id = b.id AND ${within(Prisma.sql`c.day`, ctx)}), 0) AS "collected",
             coalesce((SELECT sum(outstanding) FROM v_invoice_balances d WHERE d.branch_id = b.id), 0) AS "outstanding",
             coalesce((SELECT sum(value) FROM v_stock_value_by_branch k WHERE k.branch_id = b.id), 0) AS "stockValue",
             coalesce((SELECT sum(created) FROM v_daily_leads l WHERE l.branch_id = b.id AND ${within(Prisma.sql`l.day`, ctx)}), 0)::int AS "leads",
             coalesce((SELECT sum(won) FROM v_daily_leads l WHERE l.branch_id = b.id AND ${within(Prisma.sql`l.day`, ctx)}), 0)::int AS "won"
      FROM branches b
      WHERE app_branch_allowed(b.id) ${ctx.branchId ? Prisma.sql`AND b.id = ${ctx.branchId}::uuid` : Prisma.empty}`,
  },
  {
    code: 'BATTERY_EXPIRY',
    title: 'Battery expiry',
    description: 'Batteries in stock that have expired or expire within 90 days, soonest first.',
    columns: [
      text('serialNo', 'Serial number'),
      text('itemCode', 'Item code'),
      text('branch', 'Branch'),
      date('expiryOn', 'Expiry'),
      int('daysLeft', 'Days left'),
      text('status', 'Status'),
    ],
    usesPeriod: false,
    needs: 'batteries.view',
    defaultSort: { key: 'expiryOn', order: 'asc' },
    base: (ctx) => Prisma.sql`
      SELECT su.serial_no AS "serialNo", i.item_code AS "itemCode", b.code AS "branch",
             ${dateText(Prisma.sql`v.expiry_on`)} AS "expiryOn", (v.expiry_on - ${ctx.today}::date)::int AS "daysLeft",
             (CASE WHEN v.expiry_on < ${ctx.today}::date THEN 'Expired' ELSE 'Expiring' END) AS "status"
      FROM v_battery_expiry_stock v
      JOIN serial_units su ON su.id = v.serial_unit_id
      JOIN items i ON i.id = v.item_id
      JOIN branches b ON b.id = v.branch_id
      WHERE v.expiry_on <= ${ctx.today}::date + 90 ${inBranch('v.branch_id', ctx)}`,
  },
  {
    code: 'DAMAGED_SHORT_STOCK',
    title: 'Damaged or short stock',
    description:
      'Damaged stock on hand today, and short or damaged deliveries found when receiving in the period.',
    columns: [
      text('kind', 'What'),
      date('date', 'Date'),
      text('branch', 'Branch'),
      text('itemCode', 'Item code'),
      int('qty', 'Quantity'),
      text('status', 'Status'),
    ],
    usesPeriod: true,
    needs: 'stock.view',
    defaultSort: { key: 'kind', order: 'asc' },
    base: (ctx) => Prisma.sql`
      SELECT 'Damaged stock on hand' AS "kind", NULL::text AS "date", b.code AS "branch", i.item_code AS "itemCode",
             sb.quantity::int AS "qty", 'On hand' AS "status"
      FROM stock_balances sb
      JOIN branches b ON b.id = sb.branch_id
      JOIN items i ON i.id = sb.item_id
      WHERE sb.state = 'DAMAGED' AND sb.quantity > 0 ${inBranch('sb.branch_id', ctx)}
      UNION ALL
      SELECT 'Receiving ' || lower(d.type::text), ${dateText(day('d.created_at'))}, b.code, i.item_code,
             d.qty::int, (CASE WHEN d.status = 'OPEN' THEN 'Open' ELSE 'Resolved' END)
      FROM discrepancies d
      JOIN branches b ON b.id = d.branch_id
      LEFT JOIN receipt_lines rl ON rl.id = d.receipt_line_id
      LEFT JOIN transfer_lines tl ON tl.id = d.transfer_line_id
      JOIN items i ON i.id = coalesce(rl.item_id, tl.item_id)
      WHERE d.type IN ('SHORT', 'DAMAGED') AND ${within(day('d.created_at'), ctx)} ${inBranch('d.branch_id', ctx)}`,
  },
];

export const REPORT_BY_CODE = new Map<string, ReportDefinition>(
  REPORTS.map((report) => [report.code, report]),
);
