# Database reference

Generated from the Stage 2 schema specification. The source of truth is `prisma/schema.prisma` plus the two migrations in `prisma/migrations/`.

57 tables: the 48 in the approved diagrams and 9 added in Stage 2 (marked below). Every table also carries `id` (UUID) unless it has a natural key, and the standard columns `created_by`, `updated_by`, `created_at`, `updated_at` and `row_version` (left out of the lists below) except link tables, ledgers and a few append-only tables. `row_version` is increased by a database trigger on every update, so a client can detect concurrent edits by sending the version it read.

`?` after a type means the column can be empty. `→ table` is a foreign key. Money is `numeric(14,2)`, rates are `numeric(5,2)` percentages, stock quantities are whole numbers.

## Setup

```
cp .env.example .env      # then change the SEED_* values and passwords
pnpm install
pnpm db:up                # PostgreSQL in Docker (dev and test databases)
pnpm db:setup             # migrate, give the app and worker roles their passwords, seed
pnpm db:drift             # optional: confirm the database matches prisma/schema.prisma
```

`pnpm db:reset` drops everything, re-applies the migrations and seeds again. Never run `prisma migrate dev` against this database: it cannot see the checks, triggers, security policies and six partial or expression indexes that migration 2 adds with SQL, and would try to drop the indexes. Use `pnpm db:migrate` (`migrate deploy`).

## Database roles

| Role          | Used by                 | Can                                                                                                                                                                                               |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `erp` (owner) | migrations, seed, tests | everything; bypasses row-level security                                                                                                                                                           |
| `erp_app`     | the API                 | read and write business tables under row-level security; only append to `audit_log`, `stock_ledger`, `outbox_events` (and not even read the outbox); delete only sessions, link rows and barcodes |
| `erp_worker`  | the worker              | read the outbox and change only its `status`, `processed_at`, `attempts` and `last_error`; owns the `pgboss` schema; nothing else                                                                 |

The migrations create `erp_app` and `erp_worker` without a login. `pnpm db:provision` gives them the passwords found in `DATABASE_URL` and `WORKER_DATABASE_URL`. In production, create the roles and passwords yourself and run the migrations with an account that may create roles.

## Branch isolation

Two independent layers keep a user inside their branches.

1. **Application filter.** A Prisma extension adds the branch condition to every read, update and delete on a branch-scoped model, rejects creates and moves into a branch the user does not have, and fills in the branch when a single-branch user omits it.
2. **Row-level security.** Every query runs in a transaction that first sets `app.user_id`, `app.branch_ids` and `app.is_super`. The policies on the tables below read those settings, so a query with no context returns nothing, and relations are protected even when the filter cannot reach them.

Always run work inside a context and await it inside:

```ts
await branchContext.run({ userId, branchIds, isSuperAdmin }, async () => {
  await transactions.run(async (tx) => {
    const number = await documentNumbers.next(tx, { branchId, docType: 'INVOICE_GST' });
    // ... business writes ...
    await audit.record(tx, { action: 'INVOICE_ISSUED', entityType: 'Invoice', entityId, branchId });
    await outbox.enqueue(tx, { eventType: 'invoice.issued', payload: { entityId }, branchId });
  });
});
```

Raw SQL is only protected inside `transactions.run`. Background work with no user uses `branchContext.runAsSystem`.

Scope kinds: **branch** (row has a `branch_id`), **either branch** (transfers: visible to the sending and receiving branch), **owner only** (notifications), **via its serial unit** (batteries), **branch, null = Super Admin only** (audit log), **company-wide** (shared masters such as customers, suppliers, brokers, items).

## Document numbers

`documentNumbers.next(tx, …)` takes the next number from `document_sequences` with a row lock held until the surrounding transaction ends, so numbers are unique and, because a rolled-back transaction gives its number back, gap-free. A series exists per branch, document type and financial year (1 April to 31 March, India time). Format: `<branch code><series>/<FY>/<5-digit serial>`, for example `HQG/2627/00001`.

| Document type     | Series | Notes                                                                         |
| ----------------- | ------ | ----------------------------------------------------------------------------- |
| `INVOICE_GST`     | `G`    | GST limits the number to 16 characters, so branch codes are 2 to 4 characters |
| `INVOICE_NON_GST` | `N`    | separate series                                                               |
| `CREDIT_NOTE`     | `C`    | also limited to 16 characters                                                 |
| `PURCHASE_ORDER`  | `PO`   |                                                                               |
| `GOODS_RECEIPT`   | `GRN`  |                                                                               |
| `TRANSFER`        | `TRF`  |                                                                               |
| `QUOTATION`       | `QT`   |                                                                               |
| `PAYMENT_RECEIPT` | `RCT`  |                                                                               |

## Money

Use the helpers in `apps/api/src/common/money` (decimal arithmetic, half-up rounding to paise). CGST and SGST are each half of the tax, with any odd paisa on SGST, so CGST plus SGST always equals the total tax. Never use floating point for money.

## Outbox and worker

Business transactions add events with `outbox.enqueue(tx, …)`, so an event exists only if the change committed. The worker polls `outbox_events`, locks a batch with `FOR UPDATE SKIP LOCKED` (parallel workers never share an event), sends each to the pg-boss queue `domain-events` and marks it `PROCESSED`. A failure is retried until `OUTBOX_MAX_ATTEMPTS`, then the event is marked `FAILED` with the last error. Delivery is at least once; consumers use the event id. Jobs that fail in the queue are retried with back-off and then moved to `domain-events-dead`.

## 1. Identity and access

| Table              | Branch scope | Columns                                                                                                                                                                                                                                                                                                           |
| ------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`            | company-wide | `id` uuid; `username` text; `email` text; `full_name` text **(added)**; `password_hash` text; `status` UserStatus; `last_login_at` timestamp?; `failed_login_count` int **(added)**; `locked_until` timestamp? **(added)**; `password_changed_at` timestamp? **(added)**; `must_change_password` bool **(added)** |
| `branches`         | company-wide | `id` uuid; `code` text; `name` text; `gstin` text?; `state_code` text → states; `is_active` bool                                                                                                                                                                                                                  |
| `sessions`         | company-wide | `id` uuid; `user_id` uuid → users; `expires_at` timestamp; `ip_address` text?; `token_hash` text **(added)**; `last_seen_at` timestamp **(added)**; `user_agent` text? **(added)**; `revoked_at` timestamp? **(added)**                                                                                           |
| `roles`            | company-wide | `id` uuid; `name` text; `description` text?; `is_system` bool **(added)**; `tier` RoleTier **(added)**                                                                                                                                                                                                            |
| `permissions`      | company-wide | `id` uuid; `code` text; `description` text?; `module` text **(added)**                                                                                                                                                                                                                                            |
| `role_permissions` | company-wide | `role_id` uuid → roles; `permission_id` uuid → permissions                                                                                                                                                                                                                                                        |
| `user_roles`       | company-wide | `user_id` uuid → users; `role_id` uuid → roles                                                                                                                                                                                                                                                                    |
| `user_branches`    | company-wide | `user_id` uuid → users; `branch_id` uuid → branches                                                                                                                                                                                                                                                               |

## 2. Inventory and batteries

| Table             | Branch scope        | Columns                                                                                                                                                                                                                                                                |
| ----------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `item_categories` | company-wide        | `id` uuid; `name` text; `parent_id` uuid? → item_categories; `is_active` bool **(added)**                                                                                                                                                                              |
| `items`           | company-wide        | `id` uuid; `item_code` text; `name` text; `category_id` uuid → item_categories; `hsn_code` text? → hsn_codes; `tax_rate` rate %? → gst_rates; `unit_code` text → units_of_measure **(added)**; `reorder_level` int; `is_serialized` bool; `is_active` bool **(added)** |
| `item_barcodes`   | company-wide        | `id` uuid; `item_id` uuid → items; `barcode` text                                                                                                                                                                                                                      |
| `serial_units`    | branch              | `id` uuid; `branch_id` uuid → branches; `item_id` uuid → items; `serial_no` text; `state` SerialUnitState; `chassis_no` text?                                                                                                                                          |
| `stock_ledger`    | branch              | `id` uuid; `branch_id` uuid → branches; `item_id` uuid → items; `serial_unit_id` uuid? → serial_units; `state` StockState; `qty_delta` int; `movement_type` MovementType; `source_doc_id` uuid?; `source_doc_type` text? **(added)**                                   |
| `stock_balances`  | branch              | `branch_id` uuid → branches; `item_id` uuid → items; `state` StockState; `quantity` int                                                                                                                                                                                |
| `batteries`       | via its serial unit | `serial_unit_id` uuid → serial_units; `manufactured_on` date?; `expiry_on` date?; `warranty_months` int?; `warranty_end` date?                                                                                                                                         |

## 3. Purchasing and transfers

| Table               | Branch scope  | Columns                                                                                                                                                                                                                                                                          |
| ------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `suppliers`         | company-wide  | `id` uuid; `name` text; `gstin` text?; `phone` text?; `state_code` text? → states **(added)**; `is_active` bool                                                                                                                                                                  |
| `purchase_orders`   | branch        | `id` uuid; `branch_id` uuid → branches; `po_no` text; `supplier_id` uuid → suppliers; `status` PurchaseOrderStatus; `order_date` date                                                                                                                                            |
| `po_lines`          | branch        | `id` uuid; `branch_id` uuid → branches; `po_id` uuid → purchase_orders; `item_id` uuid → items; `qty_ordered` int; `unit_cost` money                                                                                                                                             |
| `supplier_payments` | branch        | `id` uuid; `branch_id` uuid → branches; `supplier_id` uuid → suppliers; `amount` money; `paid_on` date; `mode` text → payment_modes **(added)**                                                                                                                                  |
| `goods_receipts`    | branch        | `id` uuid; `branch_id` uuid → branches; `grn_no` text **(added)**; `po_id` uuid? → purchase_orders; `received_by` uuid → users; `received_at` timestamp                                                                                                                          |
| `receipt_lines`     | branch        | `id` uuid; `branch_id` uuid → branches; `receipt_id` uuid → goods_receipts; `po_line_id` uuid? → po_lines; `item_id` uuid → items **(added)**; `qty_received` int; `qty_accepted` int                                                                                            |
| `transfers`         | either branch | `id` uuid; `transfer_no` text; `from_branch_id` uuid → branches; `to_branch_id` uuid → branches; `status` TransferStatus                                                                                                                                                         |
| `transfer_lines`    | either branch | `id` uuid; `transfer_id` uuid → transfers; `item_id` uuid → items; `serial_unit_id` uuid? → serial_units; `qty_sent` int; `qty_received` int; `from_branch_id` uuid → branches **(added)**; `to_branch_id` uuid → branches **(added)**                                           |
| `discrepancies`     | branch        | `id` uuid; `branch_id` uuid → branches; `receipt_line_id` uuid? → receipt_lines; `transfer_line_id` uuid? → transfer_lines; `type` DiscrepancyType; `qty` int; `status` DiscrepancyStatus; `resolution` DiscrepancyResolution? **(added)**; `resolved_at` timestamp? **(added)** |
| `transfer_events`   | either branch | `id` uuid; `transfer_id` uuid → transfers; `status` TransferStatus; `user_id` uuid → users; `occurred_at` timestamp; `from_branch_id` uuid → branches **(added)**; `to_branch_id` uuid → branches **(added)**                                                                    |

## 4. Customers, leads and brokers

| Table              | Branch scope | Columns                                                                                                                                                                                                                               |
| ------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customers`        | company-wide | `id` uuid; `name` text; `phone` text; `gstin` text?; `kyc_status` KycStatus; `address` text?; `state_code` text? → states **(added)**; `email` text? **(added)**                                                                      |
| `brokers`          | company-wide | `id` uuid; `name` text; `phone` text?; `is_active` bool                                                                                                                                                                               |
| `kyc_documents`    | company-wide | `id` uuid; `customer_id` uuid → customers; `doc_type` text → kyc_document_types; `object_key` text; `status` KycStatus                                                                                                                |
| `leads`            | branch       | `id` uuid; `branch_id` uuid → branches; `name` text **(added)**; `phone` text **(added)**; `customer_id` uuid? → customers; `broker_id` uuid? → brokers; `source` text → lead_sources; `stage` LeadStage; `assigned_to` uuid? → users |
| `lead_followups`   | branch       | `id` uuid; `branch_id` uuid → branches; `lead_id` uuid → leads; `due_at` timestamp; `note` text?; `completed_at` timestamp? **(added)**                                                                                               |
| `commission_rules` | company-wide | `id` uuid; `broker_id` uuid → brokers; `type` CommissionRuleType; `value` money; `is_active` bool **(added)**                                                                                                                         |
| `commissions`      | branch       | `id` uuid; `branch_id` uuid → branches; `broker_id` uuid → brokers; `invoice_id` uuid → invoices; `rule_id` uuid → commission_rules; `amount` money; `status` CommissionStatus                                                        |

## 5. Sales and payments

| Table                 | Branch scope | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `quotations`          | branch       | `id` uuid; `branch_id` uuid → branches; `quotation_no` text; `customer_id` uuid → customers; `status` QuotationStatus; `total` money                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `invoices`            | branch       | `id` uuid; `branch_id` uuid → branches; `invoice_no` text?; `quotation_id` uuid? → quotations; `customer_id` uuid → customers; `type` InvoiceType; `total` money; `status` InvoiceStatus; `issued_on` date?; `subtotal` money **(added)**; `discount_total` money **(added)**; `taxable_value` money **(added)**; `cgst_amount` money **(added)**; `sgst_amount` money **(added)**; `igst_amount` money **(added)**; `round_off` money **(added)**; `place_of_supply` text? → states **(added)**; `branch_gstin` text? **(added)**; `customer_gstin` text? **(added)**; `due_date` date? **(added)** |
| `invoice_lines`       | branch       | `id` uuid; `branch_id` uuid → branches; `invoice_id` uuid → invoices; `item_id` uuid → items; `serial_unit_id` uuid? → serial_units; `qty` int; `hsn_code` text? → hsn_codes; `tax_rate` rate %? → gst_rates; `amount` money; `unit_price` money **(added)**; `discount_amount` money **(added)**; `taxable_amount` money **(added)**; `cgst_amount` money **(added)**; `sgst_amount` money **(added)**; `igst_amount` money **(added)**                                                                                                                                                             |
| `exchanges`           | branch       | `id` uuid; `branch_id` uuid → branches; `invoice_id` uuid → invoices; `old_serial_unit_id` uuid → serial_units; `new_serial_unit_id` uuid → serial_units; `difference_amount` money                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `credit_notes`        | branch       | `id` uuid; `branch_id` uuid → branches; `credit_note_no` text **(added)**; `invoice_id` uuid → invoices; `reason` text; `amount` money                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `payment_allocations` | branch       | `payment_id` uuid → payments; `invoice_id` uuid → invoices; `branch_id` uuid → branches **(added)**; `amount` money                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `payments`            | branch       | `id` uuid; `branch_id` uuid → branches; `receipt_no` text **(added)**; `customer_id` uuid → customers; `mode` text → payment_modes; `amount` money; `paid_on` date                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## 6. HR and platform

| Table             | Branch scope                     | Columns                                                                                                                                                                                                                                           |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `staff`           | branch                           | `id` uuid; `branch_id` uuid → branches; `user_id` uuid → users; `department` text? → departments; `join_date` date; `status` StaffStatus                                                                                                          |
| `attendance`      | branch                           | `id` uuid; `branch_id` uuid → branches; `staff_id` uuid → staff; `work_date` date; `check_in` timestamp?; `check_out` timestamp?                                                                                                                  |
| `leave_requests`  | branch                           | `id` uuid; `branch_id` uuid → branches; `staff_id` uuid → staff; `from_date` date; `to_date` date; `status` LeaveStatus                                                                                                                           |
| `payroll_records` | branch                           | `id` uuid; `branch_id` uuid → branches; `staff_id` uuid → staff; `month` text; `gross` money; `net` money                                                                                                                                         |
| `audit_log`       | branch (null = Super Admin only) | `id` uuid; `actor_id` uuid? → users; `branch_id` uuid? → branches; `action` text; `entity_type` text; `entity_id` uuid?; `old_value` json?; `new_value` json?; `ip_address` text?; `user_agent` text? **(added)**; `request_id` text? **(added)** |
| `notifications`   | owner only                       | `id` uuid; `user_id` uuid → users; `branch_id` uuid? → branches **(added)**; `channel` NotificationChannel; `message` text; `status` NotificationStatus                                                                                           |
| `outbox_events`   | company-wide                     | `id` uuid; `event_type` text; `payload` json; `status` OutboxStatus; `branch_id` uuid? → branches **(added)**; `processed_at` timestamp? **(added)**; `attempts` int **(added)**; `last_error` text? **(added)**                                  |
| `approvals`       | branch                           | `id` uuid; `branch_id` uuid → branches; `entity_type` text; `entity_id` uuid; `requested_by` uuid → users; `approved_by` uuid? → users; `status` ApprovalStatus; `reason` text? **(added)**; `decided_at` timestamp? **(added)**                  |
| `attachments`     | branch                           | `id` uuid; `branch_id` uuid → branches; `entity_type` text; `entity_id` uuid; `object_key` text; `mime_type` text                                                                                                                                 |

## 7. Masters and numbering

| Table                                | Branch scope | Columns                                                                                                                  |
| ------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `states` **(new table)**             | company-wide | `code` text; `name` text; `is_active` bool                                                                               |
| `gst_rates` **(new table)**          | company-wide | `id` uuid; `rate` rate %; `label` text; `is_active` bool                                                                 |
| `hsn_codes` **(new table)**          | company-wide | `code` text; `description` text; `gst_rate` rate %? → gst_rates; `is_active` bool                                        |
| `units_of_measure` **(new table)**   | company-wide | `code` text; `name` text; `is_active` bool                                                                               |
| `payment_modes` **(new table)**      | company-wide | `code` text; `name` text; `is_active` bool                                                                               |
| `lead_sources` **(new table)**       | company-wide | `code` text; `name` text; `is_active` bool                                                                               |
| `kyc_document_types` **(new table)** | company-wide | `code` text; `name` text; `is_active` bool                                                                               |
| `departments` **(new table)**        | company-wide | `code` text; `name` text; `is_active` bool                                                                               |
| `document_sequences` **(new table)** | branch       | `id` uuid; `branch_id` uuid → branches; `doc_type` DocumentType; `financial_year` text; `prefix` text; `next_number` int |

## Additions to the approved diagrams

The diagrams show key columns only. Stages 2 and 3 added these columns (all marked **(added)** above) because a stage requirement or a Stage 4 module clearly needs them:

`users.full_name`, `users.failed_login_count`, `users.locked_until`, `users.password_changed_at`, `users.must_change_password`, `sessions.token_hash`, `sessions.last_seen_at`, `sessions.user_agent`, `sessions.revoked_at`, `roles.is_system`, `roles.tier`, `permissions.module`, `item_categories.is_active`, `items.unit_code`, `items.is_active`, `stock_ledger.source_doc_type`, `suppliers.state_code`, `supplier_payments.mode`, `goods_receipts.grn_no`, `receipt_lines.item_id`, `transfer_lines.from_branch_id`, `transfer_lines.to_branch_id`, `discrepancies.resolution`, `discrepancies.resolved_at`, `transfer_events.from_branch_id`, `transfer_events.to_branch_id`, `customers.state_code`, `customers.email`, `leads.name`, `leads.phone`, `lead_followups.completed_at`, `commission_rules.is_active`, `invoices.subtotal`, `invoices.discount_total`, `invoices.taxable_value`, `invoices.cgst_amount`, `invoices.sgst_amount`, `invoices.igst_amount`, `invoices.round_off`, `invoices.place_of_supply`, `invoices.branch_gstin`, `invoices.customer_gstin`, `invoices.due_date`, `invoice_lines.unit_price`, `invoice_lines.discount_amount`, `invoice_lines.taxable_amount`, `invoice_lines.cgst_amount`, `invoice_lines.sgst_amount`, `invoice_lines.igst_amount`, `credit_notes.credit_note_no`, `payment_allocations.branch_id`, `payment_allocations.created_at`, `payments.receipt_no`, `audit_log.user_agent`, `audit_log.request_id`, `notifications.branch_id`, `outbox_events.branch_id`, `outbox_events.processed_at`, `outbox_events.attempts`, `outbox_events.last_error`, `approvals.reason`, `approvals.decided_at`.

New tables: `states`, `gst_rates`, `hsn_codes`, `units_of_measure`, `payment_modes`, `lead_sources`, `kyc_document_types`, `departments`, `document_sequences`.

## Seeded reference data

`pnpm db:seed` is idempotent and never overwrites changes people have made. It creates: Indian GST states and union territories, GST rates (0, 5, 18 and 40%), sample HSN codes (confirm every rate with your accountant, especially `8504` chargers where sources disagree), units, payment modes, lead sources, KYC document types, departments, the item category tree, every permission, the three system roles with their presets, the default branch, the first Super Admin from the `SEED_*` variables (password stored as Argon2id) and one number series per document type for the current financial year. Re-running adds only what is missing; a new financial year gets its own series.
