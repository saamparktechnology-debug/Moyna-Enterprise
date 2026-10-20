# Reports (Stage 5, module 5.4)

## Endpoints

| Endpoint                                     | Permission                                          | What it does                                                        |
| -------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /reports`                               | `reports.view`                                      | The reports this person may open                                    |
| `GET /reports/:code`                         | `reports.view` + the report's own module permission | Rows (paged), totals over every row, sort and filters               |
| `GET /reports/:code/export?format=xlsx\|pdf` | `reports.export` + the module permission            | The whole result as a file; writes an audit row (`REPORT_EXPORTED`) |

Filters: `from` and `to` (both or neither; neither means this month so far; at most 366 days), `branchId`, `page`, `pageSize` (1 to 100), `sortBy` (any column key) and `sortOrder`. Unknown parameters and unknown sort fields are refused. Row-level security limits every report to the caller's branches; naming another branch gives 403.

## The 16 reports

| Code                  | Shows                                                                       | Dates                | Also needs                |
| --------------------- | --------------------------------------------------------------------------- | -------------------- | ------------------------- |
| `SALES`               | Issued invoices: taxable value, tax, total                                  | Issue date           | `invoices.view`           |
| `GST_SALES`           | GST invoices with customer GSTIN and CGST, SGST, IGST                       | Issue date           | `invoices.view`           |
| `NON_GST_SALES`       | Invoices issued without GST                                                 | Issue date           | `invoices.view`           |
| `PURCHASES`           | Approved, partly received and received orders: quantity and value           | Order date           | `purchases.view`          |
| `STOCK`               | Stock on hand today by branch and item, valued at the latest purchase cost  | Today                | `stock.view`              |
| `TRANSFERS`           | Transfers with requested, sent, received and damaged quantities             | Requested date       | `transfers.view`          |
| `ADJUSTMENTS`         | Stock adjustments and their status                                          | Requested date       | `stock.view`              |
| `EXCHANGES`           | Exchanges: value returned, valuation, new value, difference                 | Created date         | `invoices.view`           |
| `DUES`                | Invoices still owed, days overdue, credited, paid, outstanding              | Today                | `payments.view`           |
| `PAYMENTS`            | Money received, reversals marked                                            | Payment date         | `payments.view`           |
| `COMMISSIONS`         | Broker commissions: amount, payable now, paid                               | Created date         | `brokers.view`            |
| `LEADS`               | Leads by source: created, won, lost, open, conversion                       | Created date (India) | `leads.view`              |
| `ATTENDANCE`          | Days present and approved leave days per staff member                       | Work and leave dates | `hr.view`                 |
| `BRANCH_PERFORMANCE`  | Per branch: sales, revenue, purchases, collected, dues, stock value, leads  | Period               | `dashboards.view_company` |
| `BATTERY_EXPIRY`      | Batteries in stock expired or expiring within 90 days                       | Today                | `batteries.view`          |
| `DAMAGED_SHORT_STOCK` | Damaged stock on hand, and short or damaged deliveries found when receiving | Found date           | `stock.view`              |

Reports about "today" (stock, dues, battery expiry) ignore the dates and say so. A report's money and whole-number columns are added up in a totals row.

## Files

- **Excel (.xlsx):** one sheet with the title, filters, a frozen heading row, the rows (money and whole numbers stored as numbers) and a totals row.
- **PDF:** landscape A4 table with repeated headings, a totals row, page numbers and a generated stamp.
- A download holds at most 20,000 rows; above that the person is asked to narrow the dates or branch (400).
- Both writers are small, dependency-free modules behind the `ReportExporter` interface (`features/reports/xlsx-exporter.ts`, `pdf-exporter.ts`, `zip.ts`). The approved stack lists no Excel or PDF library; exceljs or pdfkit can replace them without touching the reports.

## Known limits

- The PDF uses the built-in Helvetica font: Latin characters only, and the rupee sign prints as "Rs.". Other scripts print as "?". The Excel file keeps all characters.
- Files were validated with `openpyxl` and `pypdf` in the sandbox, not with Microsoft Excel or Acrobat.
- The 20,000-row cap has no automated test (it would need that many rows).
- No scheduled or emailed reports; no saved report filters.
- This module also fixes a time-zone bug in the 5.1 lead view (migration 25): leads were dated 5 hours 30 minutes early.
