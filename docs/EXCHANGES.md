# Exchanges (module 4.12)

A customer is sold a vehicle and later swaps it for another. The old vehicle is taken back, valued, and the difference is settled.

## What an exchange is

An exchange is a **request, then an approval**, attached to the **issued delivery invoice** (the invoice that sold the new vehicle). It does not edit any invoice (issued invoices cannot be edited). It takes back a vehicle that was **sold to the same customer, from the same branch, on an earlier issued invoice** (the original invoice). A vehicle we never sold has no serial record here, so it cannot be taken back; add it through purchasing or a stock adjustment first.

| Kind                       | Valuation of the old vehicle                                                    |
| -------------------------- | ------------------------------------------------------------------------------- |
| `NEW_FOR_NEW` (a swap)     | Exactly what the customer paid for it, tax included                             |
| `OLD_FOR_NEW` (a trade-in) | Chosen by the person asking, more than nothing and up to what the customer paid |

The **difference** is the new vehicle's price on the delivery invoice less the valuation. Above zero the customer pays it; below zero it is held as credit for them. Both are shown in words (`PAYABLE`, `REFUNDABLE`, `EVEN`).

## Endpoints

| Endpoint                                                                                                                                  | Permission                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `GET /exchanges`, `GET /exchanges/:id`                                                                                                    | `invoices.view`                             |
| `GET /exchanges/options?invoiceId=` (the vehicles on the delivery invoice, and the vehicles sold to that customer that can be taken back) | `exchanges.request`                         |
| `POST /exchanges` (ask) and `POST /exchanges/:id/cancel` (the person who asked withdraws)                                                 | `exchanges.request`                         |
| `POST /exchanges/:id/approve` and `/reject` (a reason is needed)                                                                          | `exchanges.approve` (Admin and Super Admin) |

**Self-approval:** nobody approves an exchange they asked for, except a Super Admin (the same rule as credit notes and stock adjustments).

## What approval does, all in one transaction

1. **The old vehicle comes back.**
   - `STOCK`: it moves from `SOLD` to `RETURNED`, with an `EXCHANGE_IN` ledger entry. Looking it over and moving it on is then an ordinary stock adjustment.
   - `SCRAP`: it comes in as `DAMAGED` (`EXCHANGE_IN`) and is written off at once (`WRITE_OFF`, serial state `SCRAPPED`), so the ledger shows both steps.
   - **The batteries fitted in it come back too**, as returned goods with their warranty cleared, as on any other return. When the vehicle is scrapped they are detached from it.
2. **The valuation is paid in as a trade-in**: a payment (module 4.8) in the reserved mode `EXCHANGE`, referenced by the exchange number, applied to the delivery invoice up to what it still owes. What is more than it owes stays as credit for the customer. Paying that credit out to the customer is not built (as in 4.8). If the delivery invoice was already paid in full, the whole valuation is credit.
3. **The commission on the old sale is lowered** by the old vehicle's share of that invoice's taxable value (module 4.10), as an adjustment of kind `EXCHANGE`. It is worked out together with approved credit notes on the same invoice, so the paisa add up and a credit note after an exchange still takes the right amount. If the commission was already paid, the difference is shown as money to get back. **The delivery invoice's commission is not changed**: a trade-in is a payment, not a price cut.

The order, the stock postings and the payment all stand or fall together. The payment mode `EXCHANGE` cannot be chosen anywhere else: the API refuses it and the screens do not offer it.

## Rules

- A vehicle is in **one open exchange at a time**, as the old unit and as the new unit (a database rule; a rejected or withdrawn request frees it).
- A vehicle **covered by a credit note** cannot be exchanged, and a vehicle in an open exchange cannot be credited (API and database). The credit note screen shows it as having nothing returnable.
- **Neither invoice can be cancelled** while an exchange is pending or approved.
- The terms of an exchange never change after it is asked for; a decided exchange never changes at all (database guards). Figures are checked by the database: the difference is exactly the new price less the valuation, the valuation is above nothing and at most what was paid, and a swap is valued at the price paid.
- A vehicle given free has no value to take back and cannot be exchanged.
- Everything is branch-scoped: another branch gets 404, and both invoices and the vehicles must be in the exchange's branch.
- Audit: `EXCHANGE_REQUESTED`, `EXCHANGE_APPROVED`, `EXCHANGE_REJECTED`, `EXCHANGE_CANCELLED`; events `exchange.requested`, `approved`, `rejected`.

## Screens

An **Exchanges** page lists them (search by number, customer or serial number; filter by status and kind). **New exchange** finds the delivery invoice, then offers its vehicles and the customer's earlier vehicles, shows the batteries that come back with the old one, and shows what the exchange comes to as you fill it in. The detail shows both vehicles with their chassis and motor numbers, the money and the trade-in receipt, and the approve, reject and withdraw buttons for those who may use them.

## Database (migration 18, `20261007001800_exchanges`)

New columns on `exchanges` (number, kind, status, original invoice, the amounts, disposition, reason, decision details, trade-in payment); a new document type `EXCHANGE` (prefix `EXC`) and a number series for it; the payment mode `EXCHANGE`; guards and checks as above; two partial unique indexes (`exchanges_old_unit_open_key` and `exchanges_new_unit_open_key`, recorded in `scripts/check-schema-drift.mjs`); and an `EXCHANGE` kind of commission adjustment. Rows that already existed (the application never made any) are filled in with safe values.

## Decisions and limits

- **No valuation limit for approvers.** The requirements ask for "approval limits" without a figure, so only the self-approval rule is built. A limit (for example a maximum valuation an Admin may approve) can be added in `ExchangesService.approve` once you give the figure.
- Only vehicles sold to the same customer by this system can be taken back (above).
- The credit-note path still does not return fitted batteries with a vehicle (open since module 4.7); only exchanges do.
- Refunding credit to the customer is not built; it stays as credit held for them.
- There is no way to reverse an approved exchange; correct it with a new exchange or a stock adjustment.
- No PDF of an exchange.

## Approval limit

Set `EXCHANGE_ADMIN_APPROVAL_LIMIT` (rupees) to let Admins approve only exchanges valued at or under that amount; above it only a Super Admin may approve (403 naming the limit; nothing changes). Leave it unset for no limit.
