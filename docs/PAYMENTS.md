# Payments and dues (module 4.8)

Money received from customers, how it settles invoices, what each customer still owes, and the customer ledger.

## What it does

- **Record a payment** (`POST /payments`, permission `payments.create`): customer, amount, mode (from `payment_modes`), date received (not in the future), optional reference and note. The receipt number is taken from the branch's `PAYMENT_RECEIPT` series (for example `HQRCT/2627/00001`), gap-free.
- **Allocation**: the payment can settle named invoices (`allocations`), settle the oldest dues first (`allocateAutomatically`, ordered by due date, then issue date, then number), or be kept whole as an advance. Whatever is not applied to an invoice stays with the customer as **credit** and can be applied later (`POST /payments/:id/allocations`).
- **Partial and full payment**: an invoice shows `UNPAID`, `PARTIAL` or `PAID`. `PAID` means nothing is left to pay, whether by payments or by approved credit notes.
- **Reverse a payment** (`POST /payments/:id/reverse`, permission `payments.reverse`, Admin and Super Admin): adds a reversal row; the payment and its allocations stay as they were, and the invoices owe the money again.
- **Dues** (`GET /dues`): issued invoices with total, credited, paid and outstanding, filtered to outstanding, overdue, settled or all, with totals over the whole filter. An invoice is overdue when money is owed and its due date is before today in India.
- **Customers** (`GET /dues/customers`): one line per customer who owes money or holds credit.
- **Customer ledger** (`GET /dues/customers/:id/ledger`): invoices, cancellations, approved credit notes, payments and reversals in order with a running balance. A negative balance means the customer has credit.

## How the balance is worked out

```
outstanding = max(0, invoice total - approved credit notes - allocations of payments that are not reversed)
surplus     = max(0, allocations + approved credit notes - invoice total)
credit held = unapplied part of live payments + surpluses
```

A credit note counts once it is approved. A pending credit note changes nothing.

## Safety

- **Duplicates**: the browser makes one `idempotencyKey` per payment form. A repeated request with the same key returns the payment already recorded; the same key with different details is refused (409). A reference (cheque, UPI or bank number) cannot be used twice for the same mode and branch unless the first payment was reversed.
- **Races**: requests are serialised by an advisory lock on the key and reference, a row lock on the customer, and row locks on the invoices, taken in id order. The database repeats the invoice and payment checks in a trigger that takes its own row locks, so a direct insert cannot over-apply either.
- **Ledger**: `payments`, `payment_allocations` and `payment_reversals` refuse UPDATE and DELETE (trigger `payments_ledger_frozen`).
- **Branches**: every row carries a branch and row-level security applies. A payment and the invoices it settles must be in the same branch and belong to the same customer; the browser never decides the branch.
- **Audit and events**: `PAYMENT_RECORDED`, `PAYMENT_APPLIED` and `PAYMENT_REVERSED` audit rows; outbox events `payment.recorded`, `payment.applied` and `payment.reversed`.

## Change to billing

An invoice with payments cannot be cancelled. After this module a payment that has been reversed no longer counts, so reversing a payment unblocks the cancellation. (`billing.service.ts`, one line.)

## Database (migration 14, `20261007001400_payments_dues`)

`payments` gains `reference`, `note` and `idempotency_key` (unique per branch when set). New table `payment_reversals` (one per payment). New triggers: ledger freeze, `payment_allocations_check`, `payment_reversals_check`. No existing data is changed.

## Decisions and limits

- **Refunds**: the schema has no outgoing payment, so refunding a customer's surplus after a credit note is not built. The surplus is shown as credit held and can only be seen, not paid out.
- A payment can be applied to a given invoice once (the allocation primary key is payment plus invoice).
- Anyone holding `payments.reverse` may reverse any payment in their branches, including their own. There is no second approver.
- The ledger and the dues only count the branches the caller can see, because customers are company-wide and payments are not.
- Credit held is not yet taken into account when an invoice is issued; someone applies it by hand or with "Apply the rest".
- The payments list filter `withCredit` needs a customer.

## Advances for quotations

An advance taken for a quotation (module 4.11) is an ordinary payment that also names the quotation (`payments.quotation_id`). It is held as credit for the customer until the invoice delivering the quotation is issued, when it is applied to that invoice. Reversing it works as for any payment.

## Trade-in payments (module 4.12)

When an exchange is approved, the value of the old vehicle is paid in as a payment in the reserved mode `EXCHANGE` and applied to the delivery invoice. That mode cannot be used for an ordinary payment: the API refuses it and the payment screens leave it out. See `EXCHANGES.md`.

## Refunding a customer's credit

`POST /refunds` (permission `payments.refund`, managers only) pays back money a customer holds as credit: unapplied payments and what they overpaid on invoices, less refunds already paid. Money held for an **accepted quotation's advance cannot be refunded**; it belongs to that order. `GET /refunds/credit?customerId=` shows what is held and what is refundable, and `GET /refunds` lists refunds.

- A refund is for more than nothing and no more than the refundable credit, checked while the customer is locked, so two refunds arriving together cannot overspend it. The reserved `EXCHANGE` mode cannot be used.
- It has its own number (`RFD` series), a mode, a date (not in the future), a reference, a reason and a retry key: the same key returns the refund already paid; a different refund under it is a 409.
- A refund is a record of money paid out and is never changed or deleted (database rule). It lowers the credit in the dues list and appears in the customer ledger as `REFUND`. It is audited (`CUSTOMER_REFUND_PAID`) and queued as `customer.refund_paid`.
- The ledger dialog has a **Refund credit** button for people who may pay refunds when the customer has credit.
