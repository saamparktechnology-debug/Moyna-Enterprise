# Quotations and customized TOTO orders (module 4.11)

A quotation fixes a price for a customer; the customer accepts it and may pay in advance; a customized TOTO is built and numbered; and it is delivered on an invoice at the quoted prices.

## Status

`DRAFT` → `SENT` → `ACCEPTED` → `CONVERTED`. A quotation can also lapse (`EXPIRED`) or be `CANCELLED` before it is converted, and cancelling the invoice it was delivered on reopens it as `ACCEPTED`. The database allows only these moves.

| Step                       | What it does                                                                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write (`POST /quotations`) | Customer, GST or non-GST, validity date, optional broker, lines (item, quantity, price, discount). The tax is worked out when it is written and kept. A number from the branch's `QT` series is given. A customized build also needs a specification |
| Edit                       | Drafts only                                                                                                                                                                                                                                          |
| Send                       | From now on **the lines, prices, customer and totals cannot change**, in the API or in the database. Staff cannot send a quotation with a line discount above their limit (the same limit as on an invoice); a manager can                           |
| Accept                     | Records that the customer accepted the quoted prices                                                                                                                                                                                                 |
| Cancel                     | Needs a reason. Not while an advance is held (reverse it first) or while an invoice stands                                                                                                                                                           |

## Price changes after quotation

Items carry no price list, so the quoted unit price and discount are the price. They are fixed when the quotation is sent, and an invoice made from it keeps the customer, type, broker, items, quantities, prices and discounts exactly as quoted (editing them is refused, 422). **Tax is worked out at the rate in force when the invoice is made**, as the law requires, so if a GST rate changes after the quotation the invoice total can differ from the quoted total; the price before tax does not.

A quotation lapses at the end of its last day unless it has an advance paid against it. **An advance holds the quoted price**, so such a quotation does not expire (the database refuses it). A lapsed quotation cannot be accepted, paid against, built or delivered; make a new one.

## Advances

`POST /quotations/:id/advance` takes money for an **accepted** quotation. It needs `payments.create` as well as `quotations.manage`.

- It is an ordinary payment (module 4.8) that names the quotation, so it has a receipt, can be reversed with `payments.reverse`, and shows as credit held for the customer until the invoice is issued.
- **Partial advances** are fine, in any number, but never add up to more than the quotation's total (400 on `amount`). Two arriving together take only what is left.
- A retried request with the same `idempotencyKey` returns the advance already taken.

## Build tracking and vehicles

For a customized build (`isCustomBuild`), once accepted:

- **Stages:** `NOT_STARTED`, `IN_BUILD`, `QUALITY_CHECK`, `READY`. Forward to any later stage, back from quality check to the build, never out of `READY`. Each move is a note in an append-only history.
- **Vehicles:** for each serialized line, choose the vehicle that will be delivered (`POST /quotations/:id/lines/:lineId/unit`) and record its **chassis and motor numbers**. A vehicle must be in stock in the branch, and is promised to one open quotation at a time. A number already on a vehicle is never replaced, and a number already on another vehicle is refused. The batteries installed in the vehicle are shown with it.
- **`READY`** needs every vehicle chosen with both numbers recorded.

A new column `serial_units.motor_no` (unique) sits beside the existing chassis number. The vehicle is set aside in the quotation; its stock state does not change until the invoice is issued.

## Delivery

1. `POST /invoices/from-quotation` (needs `invoices.create` and `quotations.manage`) turns an accepted quotation into a **draft invoice** at the quoted prices with the chosen vehicles and the broker. For a customized build the build must be `READY`. Only one invoice can stand for a quotation; discarding the draft allows another.
2. The invoice is issued like any other. At that moment, in the same transaction:
   - **Delivery before full payment.** The advances must cover the invoice total. If they do not, issue is refused (422) unless the person holds **`quotations.deliver_unpaid`** (a new manager-only permission) **and** gives `unpaidDeliveryReason`; the shortfall and the reason are audited (`QUOTATION_DELIVERED_UNPAID`) and the rest stays due on the invoice. To deliver a fully paid order, take the rest as an advance on the quotation first.
   - **Advances are applied** to the invoice, oldest first. If more was paid than the invoice is worth (for example the tax rate fell), the extra stays as credit for the customer.
   - The quotation becomes `CONVERTED`. If the quotation had lapsed with nothing paid, issue is refused.
   - The usual issue effects follow: stock moves, the vehicle and its batteries are sold, and the broker's commission is worked out (module 4.10).
3. **Cancelling the invoice** needs the advance payments reversed first (an invoice with payments cannot be cancelled), and then reopens the quotation. A re-issued draft keeps the quotation link.

## Safety

- **Branches:** quotations, lines, build history and advances are branch-scoped with row-level security; another branch gets 404. A Super Admin chooses the branch.
- **Races:** the customer, then the quotation, are locked in the same order on every path that touches both, so advances, conversions and issues arriving together are dealt with one at a time (and two conversions of one quotation give one invoice).
- **History:** build updates are never changed or deleted; lines of a sent quotation cannot be changed or removed; every step is audited (`QUOTATION_*`) and queued as an event (`quotation.sent`, `accepted`, `advance_taken`, `build_updated`, `converted`).

## Database (migration 17, `20261007001700_quotations`)

New columns on `quotations` (type, validity, tax totals, place of supply, broker, custom build, specification, build stage and the sent, accepted and cancelled details); new tables `quotation_lines` and `quotation_build_updates`; `serial_units.motor_no`; `payments.quotation_id`; and triggers for the status and build-stage rules, the freeze after sending, the advance checks, vehicle promising and the build history. Existing rows are not changed.

## Decisions and limits

- **`quotations.deliver_unpaid`** is new, and manager-only (Admin and Super Admin). Reuse of an existing permission would have been wrong: discount approval is not about taking credit.
- A quotation is expired when someone looks at it after its last day (the change is made then); no job is needed, and nothing is notified (module 5.2).
- A vehicle is set aside, not reserved: if the same vehicle is sold on another invoice first, issuing this one is refused.
- A quotation has no PDF yet, and no link to the lead it came from.
- Advances appear in the payments list as ordinary payments; the payments screens do not yet show which quotation they are for.
- There is no way to unassign a vehicle (it can be replaced with another).
