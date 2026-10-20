# Billing and invoicing (Stage 4, module 4.7: invoices, the Sales screens and credit notes)

Part A is the invoicing backend, part B the Sales screens and part C credit notes.

## Life of an invoice

**Draft → Issued → Cancelled.** A draft can be edited (its lines are replaced) or discarded. Issuing gives it a number and moves the stock; from then on it is fixed. An issued invoice can only be cancelled, and a cancelled one never changes. A draft never touches stock or takes a number.

- `POST /invoices/preview` works out what an invoice would come to, exactly as saving would, without storing anything.
- Edits send the `rowVersion` they read; a stale edit answers 409.
- **Cancel and reissue** cancels the invoice (with a reason) and starts a new draft with the same lines that points back at it, in one step.

## Money

- Every figure is worked out on the server from the lines; the browser sends only the item, quantity, unit price and discount. Items carry no list price, so the unit price is typed in.
- **Tax is worked out line by line**, on the price after the discount, and rounded half up to the paisa. Inside the state the tax splits into CGST and SGST, with the odd paisa on the SGST side; across a state border the whole of it is IGST. An invoice without GST carries no tax and no GSTIN, and its lines carry no HSN or rate.
- **Place of supply** is the customer's state, or the branch's state when the customer has none. It is inter-state when that differs from the selling branch's state.
- The total is rounded to the nearest rupee and the difference (at most 50 paise either way) is kept as the **round-off**, so taxable value plus tax plus round-off is always exactly the total. The database checks this arithmetic itself.
- A GST invoice needs a GST rate on every item and a GSTIN on the branch. Both GSTINs are copied onto the invoice when it is issued.

## Discounts

Staff may give up to **5% of a line's price** (`DISCOUNT_STAFF_LIMIT_PERCENT`). A bigger discount can be drafted, but only someone who holds `discounts.approve` can issue the invoice; anyone else is told to ask a manager. The audit entry records that a discount was approved. A discount larger than the price is refused.

## Numbers

Numbers come from the shared branch series (one for GST invoices, one for invoices without GST, restarting each financial year) and are taken **when the invoice is issued, inside the same transaction as everything else**. If anything fails (not enough stock, an expired battery, a refused discount) the transaction rolls back and no number is used, so the series has no gaps even when many invoices are issued at once.

## Stock, serial units and batteries

- Issuing takes plain stock out of Available (`SALE`) and moves a serial unit to Sold. A serial item is sold one unit at a time; the unit must be in the branch and available when the invoice is issued (a draft may name a unit that is reserved, but it cannot be issued until it is available). Two invoices competing for the last unit: one issues, the other is refused.
- An **expired battery** cannot be sold without a reason from someone who holds `batteries.override_expiry`; the override is audited.
- The warranty of a battery starts on the day of the sale. A **vehicle sold with batteries fitted** takes them with it: they move from Reserved to Sold and their warranties start the same day.
- Cancelling puts everything back (`SALE_RETURN`), takes the warranties back and returns fitted batteries to Reserved. The invoice number stays used.

## Cancelling

Needs `invoices.cancel`, a reason and the current version, and works once even when two people try at the same moment. It is refused while payments are recorded against the invoice, while a credit note exists, or after an exchange; the message says which.

## PDF

`GET /invoices/:id/pdf` returns a PDF download. It is written by a small built-in writer (no library), uses the standard fonts, and prints the parties, the lines with serial numbers, the tax split, the round-off, the total and the total in words (thousand, lakh, crore). Drafts say "DRAFT - this is not a valid invoice" and cancelled invoices say "CANCELLED - <reason>". Long invoices continue on further pages with the totals on the last. The rupee sign and non-Latin letters are not in the standard fonts and print as `?`.

## Events

Issuing and cancelling add `invoice.issued` and `invoice.cancelled` to the outbox for later modules.

## Endpoints

| Method and path                                                                                                             | Permission        |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `GET /invoices`, `GET /invoices/:id`, `GET /invoices/:id/pdf`                                                               | `invoices.view`   |
| `POST /invoices/preview`, `POST /invoices`, `PATCH /invoices/:id`, `POST /invoices/:id/discard`, `POST /invoices/:id/issue` | `invoices.create` |
| `POST /invoices/:id/cancel`, `POST /invoices/:id/reissue`                                                                   | `invoices.cancel` |

## Migration 12 (`20261007001200_invoicing`)

Cancel details and the link to the invoice that was replaced; a line number on each invoice line; arithmetic checks on invoices and lines; guards that freeze an issued invoice and its lines (only a cancel, or a new due date, is allowed); and two small guarded functions, `discard_invoice_draft` and `clear_invoice_draft_lines`, because the application role has no right to delete rows and these are the only two places a draft's rows are removed.

## The Sales screen (part B)

One page, `/sales` (needs `invoices.view`): a list that is searched by invoice number or customer and filtered by status and by kind, paged on the server. **New invoice** (needs `invoices.create`) opens the draft form.

- **The draft form**: choose the customer (type a name or phone number), the kind of invoice and an optional due date, then add lines. A line is an item, a price and an optional discount, plus a quantity or, for an item tracked by serial number, the serial number being sold (units already chosen on another line are not offered again). The totals underneath come from the server's own preview, so the screen never does its own tax sums and shows exactly what saving will store: IGST across a state border, CGST and SGST inside the state, no tax on an invoice without GST. A discount above 5% is flagged as one a manager must issue. The server's reasons are shown next to the line they are about.
- **The invoice**: shows the customer, the branch, the place of supply and why the tax is split the way it is, each line with its serial number, and the totals. A draft can be edited, issued (with an optional reason for selling an expired battery, which only a manager may give) or discarded after a second confirmation. An issued invoice can be cancelled, or cancelled and reissued (which opens the new draft), with a reason of at least three characters. A cancelled invoice shows who cancelled it and why. **Download PDF** is available for every invoice.
- Buttons appear only for what the person may do; the server decides in the end.

## Credit notes (part C)

A credit note takes goods back and credits the customer. It is **asked for** by someone with `credit_notes.create` and **approved** by someone with `credit_notes.approve` (managers). Only an issued invoice can be credited.

- **Amounts**: a line is credited in proportion to the share returned, rounded half up, for the price after the discount and for each part of the tax (CGST and SGST, or IGST), so the credit mirrors the invoice. Crediting everything that is left on a line takes exactly what is left, so many small credits always add back to the line to the paisa. Credit notes carry no round-off. A line that was given free cannot be credited.
- **No over-crediting**: for each invoice line, what is credited plus what is waiting for a decision can never be more than what was sold. Requests for the same invoice take turns (the invoice is locked), and the database refuses an over-credit even if the application did not. A rejected request releases its goods.
- **Approving**: takes the next gap-free credit note number for the branch **at that moment**, so a rejected or failed request never uses one, and puts the returned goods into the **Returned** stock state (`SALE_RETURN`), where they wait to be inspected and moved to Available, Damaged or Quarantine by a normal stock adjustment. A returned serial unit moves from Sold to Returned and its battery warranty is taken back. The invoice's customer is told through the `credit_note.approved` outbox event. Nobody approves a request they asked for, except a Super Admin.
- **Rejecting**: needs a reason. An approver may reject any request, and a person may withdraw one of their own. Nothing moves.
- **After the decision** the credit note and its lines never change: the database refuses it. An invoice with a waiting or approved credit note cannot be cancelled.
- Fitted batteries sold with a vehicle are not returned with it; return them as their own line if they are on the invoice, or adjust them in stock.
- `GET /invoices/:id/returnable` says what can still be credited on each line.

| Method and path                                                              | Permission                           |
| ---------------------------------------------------------------------------- | ------------------------------------ |
| `GET /credit-notes`, `GET /credit-notes/:id`, `GET /invoices/:id/returnable` | `invoices.view`                      |
| `POST /credit-notes`                                                         | `credit_notes.create`                |
| `POST /credit-notes/:id/approve`                                             | `credit_notes.approve`               |
| `POST /credit-notes/:id/reject`                                              | an approver, or the person who asked |

**Screens**: the Sales page has an **Invoices** tab and a **Credit notes** tab. An issued invoice shows **Raise credit note** (for people who may ask), which lists each line with what was sold, what is already credited and a box for how many to credit, and a reason. A credit note opens with its lines, tax and total, and Approve and Reject while it waits.

**Migration 13 (`20261007001300_credit_notes`)**: a status, tax columns and decision details on credit notes (the number is now optional until approval), the `credit_note_lines` table, and the guards above.

## Still to come after this module

- Payments, outstanding amounts and the credit applied to a customer's account are module 4.8.
- A printable PDF of a credit note is not built; the invoice PDF is.

## Payments

Payments against an invoice are handled by module 4.8 (see `PAYMENTS.md`). An invoice with live payments cannot be cancelled; a payment that has been reversed no longer counts.

## Brokers

A draft invoice may name a broker; commission is worked out when it is issued, lowered by approved credit notes and taken back if the invoice is cancelled. See `BROKERS.md`.

## Quotations

An invoice can be made from an accepted quotation (`POST /invoices/from-quotation`) and keeps its quoted prices. When it is issued, the quotation's advances are applied and the order must be paid for, unless a manager delivers it on credit with a reason. See `QUOTATIONS.md`.

## Exchanges

A vehicle sold on an invoice can be exchanged for another (module 4.12). While an exchange is pending or approved, neither the delivery invoice nor the invoice that sold the old vehicle can be cancelled, and the old vehicle cannot be credited. See `EXCHANGES.md`.

## Credit notes: batteries and PDF

Approving a credit note for a vehicle also returns the **batteries fitted in it**, as returned goods with their warranty cleared, traced to the credit note (`SALE_RETURN`). `GET /credit-notes/:id/pdf` gives the credit note as a PDF (same permission as reading it). A waiting or rejected credit note says on the page that it is not valid, and a non-GST one carries no GSTIN.
