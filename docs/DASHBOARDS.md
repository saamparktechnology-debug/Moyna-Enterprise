# Dashboards (Stage 5, module 5.1)

Two read-only dashboards, both worked out by the database from SQL views. The page adds nothing up itself.

| Endpoint                  | Permission                | Shows                                                                   |
| ------------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `GET /dashboards/company` | `dashboards.view_company` | Everything the caller can see: totals, a line per branch, a daily trend |
| `GET /dashboards/branch`  | `dashboards.view_branch`  | One branch: sales, purchases, stock, transfers, dues, follow-ups, leads |

Query: `from` and `to` (both or neither; neither means this month so far in India; at most 366 days), `withinDays` (battery expiry window, default 30), and for the branch dashboard `branchId`. Unknown parameters are refused.

## Who sees what

- Row-level security applies to every view (`security_invoker`). A branch user can never read another branch's rows, even by querying a view directly (tested).
- "Company" means every branch the caller can see. A user who has picked a working branch (`X-Branch-Id`) sees the company dashboard limited to it.
- The branch dashboard needs `branchId` unless the caller works in exactly one branch. A branch the caller does not work in is refused with 403; a Super Admin working across all branches may open any (404 if it does not exist).
- Staff hold `dashboards.view_branch` in the role presets, so they see their own branch. The branch dashboard has no commission or payroll figures.
- The company totals are the sum of the branch lines, so they cannot disagree.

## Where each figure comes from

| Figure                         | View                                    | Source tables                                     | Rule                                                                                        |
| ------------------------------ | --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Sales, invoices                | `v_daily_sales`                         | `invoices`                                        | Issued invoices by issue date, total with GST. Drafts and cancelled invoices left out.      |
| Credit notes                   | `v_daily_credit_notes`                  | `credit_notes`                                    | Approved ones by decision date (India).                                                     |
| Revenue                        | `v_daily_sales`, `v_daily_credit_notes` | as above                                          | Taxable value of invoices less taxable value of credit notes (before GST).                  |
| Collected                      | `v_daily_collections`                   | `payments`, `payment_reversals`                   | By payment date. Reversed payments and the non-cash `EXCHANGE` trade-in are left out.       |
| Purchases                      | `v_daily_purchases`                     | `purchase_orders`, `po_lines`                     | Approved, partly received and received orders by order date: quantity ordered × unit cost.  |
| Stock units and value          | `v_stock_value_by_branch`               | `stock_balances`, `v_item_latest_cost`            | Available, reserved and in-transit units at each item's latest approved purchase cost.      |
| Items never bought             | `v_stock_value_by_branch`               | as above                                          | In stock, no approved purchase line: they add nothing to the value and are counted apart.   |
| Outstanding, overdue           | `v_invoice_balances`                    | `invoices`, `credit_notes`, `payment_allocations` | Same rule as the payments module; overdue = outstanding with a due date before today.       |
| Leads created, won, conversion | `v_daily_leads`                         | `leads`                                           | Of the leads created in the period, how many are won now; percent with one decimal.         |
| Follow-ups                     | `v_open_followups`                      | `lead_followups`                                  | Not completed; overdue before now, today until midnight in India, upcoming after.           |
| Commission payable, paid       | `v_commission_worth`                    | `commissions`, `commission_adjustments`           | Payable = amount less what credit notes took back; paid = paid out in the period.           |
| Pending transfers              | `v_pending_transfers`                   | `transfers`                                       | Requested, approved, dispatched or in transit; incoming by destination, outgoing by source. |
| Low stock                      | `v_low_stock`                           | `items`, `stock_balances`, `branches`             | Same rule as the stock module; counted once per item and branch.                            |
| Battery expired, expiring      | `v_battery_expiry_stock`                | `batteries`, `serial_units`                       | Same states as the batteries module; expiring = within `withinDays` from today.             |

Reports (module 5.4) will read the same views, so a dashboard figure and its report cannot differ.

## Known limits

- `v_item_latest_cost` is the only view with definer rights, on purpose: it exposes an item and its cost, nothing by branch.
- `v_daily_leads` groups on a time-zone expression, so the lead range filter cannot use an index. Fine at lead volumes; re-measure in Stage 8.
- Reversed payments are left out of "collected" whatever date they were reversed, matching how dues treat them.
- Refunds of customer credit are not netted from "collected".
- Charts use Recharts (approved stack, first use).
