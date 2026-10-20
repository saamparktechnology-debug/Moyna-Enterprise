# Purchasing and receiving (Stage 4, module 4.4)

Suppliers, purchase orders, goods receipts that are checked line by line, a shared workflow for discrepancies, returns to a supplier, supplier payments and a supplier ledger. Suppliers are shared by the whole company; orders, receipts, returns and payments belong to a branch, so a branch user sees only their own. There are no new permissions: `suppliers.view`/`manage`, `purchases.view`/`create`/`approve`/`receive`/`return`, `supplier_payments.create`, `discrepancies.view`/`resolve`. Staff may look at everything and receive goods; creating, approving, returning, paying and settling are for managers.

## Purchase orders

A purchase order is a **Draft** (editable, lines can be replaced), then **Approved**, **Partially received**, **Received** or **Cancelled**. A draft cannot be received against; an approved order cannot be edited. Cancelling needs a reason and is refused once any goods have arrived. An order has one line per item, a cost per unit, and is numbered per branch and financial year (for example `AAPO/2627/00001`). Lines are always listed by item code. Approving or editing with an old version is refused, and two simultaneous approvals let one win. A supplier that is inactive cannot be ordered from or approved for.

## Receiving goods

`POST /purchase-orders/:id/receive` verifies each line against what the order **still expects** (ordered, less units accepted and units written off):

- Units within what is still expected and in good condition go to **Available**.
- **Damaged** units, units **beyond the order** (excess) and **wrong items** go to **Quarantine**, each with a discrepancy to settle.
- If the delivery note says more was sent than arrived, the difference is a **short** discrepancy (no stock).
- A plain item is counted by number; a serial item by one serial number per unit, with an optional chassis number, a damaged flag, and battery dates (manufactured, expiry, warranty months) that create the battery record. Serial numbers must be new across the whole company, and a refused receipt leaves nothing behind.
- The order moves to Partially received, then Received, as accepted and written-off quantities cover what was ordered. Two deliveries arriving at the same moment are taken in turn, so Available never exceeds the order.

## Settling a discrepancy

| Kind       | May be settled by         | Effect                                                                                                                            |
| ---------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Short      | Claim, Write off          | Closes it. A claim leaves the quantity expected; a write-off removes it from the order.                                           |
| Excess     | Accept, Return            | Accept moves it to Available and charges for it. Return sends it out of Quarantine on a return worth nothing.                     |
| Wrong item | Return, Write off         | Never accepted.                                                                                                                   |
| Damaged    | Accept, Return, Write off | Accept makes it Available. Return leaves the quantity expected as a replacement. Write off scraps it and the company pays for it. |

Each decision is made once (a stale or repeated decision is refused, and two at once let one win), is audited and queued in the outbox.

## What the company owes

Charged = units accepted on receipt, plus units accepted later, plus damaged units the company chose to write off, each at the order's unit cost. Credited = returns of accepted stock. Outstanding = charged minus credited minus paid, counting only the branches the caller can see. **Returns** send accepted stock back at the order's cost and cannot exceed what was bought and kept (returns that settle a discrepancy are never charged, so they do not count against it); serial units are returned by unit and become scrapped. Returns are numbered (`PRT`) and can never be changed or deleted, not even by the application's database role.

**Payments** (`POST /suppliers/:id/payments`) record the amount, the date (not in the future), the mode from the list, an optional reference and the branch that paid. A payment cannot exceed what is outstanding, and two payments of the full balance at once let one win. The **ledger** lists receipts, later acceptances, write-offs, returns and payments newest first with a running balance.

## Suppliers

A GSTIN is checked (format, check character and that it starts with the state code) and is unique. A supplier cannot be deactivated while any branch has a draft, approved or partly received order with them; that check runs with the owner's rights because a branch user cannot see other branches' orders.

## The Purchasing screen

One page, `/purchasing`, with a tab for each part. A person sees only the tabs their permissions allow: **Orders** and **Receipts** and **Returns** with `purchases.view`, **Discrepancies** with `discrepancies.view`, **Suppliers** with `suppliers.view`.

- **Orders**: search by order number or supplier, filter by status (including "open", meaning waiting for goods), page on the server. A new order is a draft with one or more lines (item, quantity, unit cost) and a running total; the item and supplier are found by typing. Opening an order shows its lines with what has been accepted, closed and is still to come. A manager can approve or cancel it (cancelling needs a reason); the person who made it can edit a draft; **Receive goods** appears only on an approved or partly received order, for people who may receive.
- **Receiving goods**: for each line still open, count what arrived and how many were damaged, optionally with the delivery note's quantity so a short delivery is recorded. Serial items are counted by typing or pasting serial numbers (one per line), marking damaged ones, and adding battery dates. "Something else arrived" records a wrong item. The result says how many discrepancies now need a decision.
- **Receipts**: each goods receipt with its order, supplier and the number of open discrepancies; opening one lists every line with what arrived, what was accepted and what went wrong.
- **Discrepancies**: what waits for a decision (or what was settled), filtered by status and kind. Only the settlements that fit the kind of problem are offered, and a transfer problem is sent to the transfer workflow instead.
- **Returns**: goods accepted on an order can be sent back to the supplier, by quantity or by serial unit, with a reason; the supplier's credit is shown when it is recorded.
- **Suppliers**: create and edit (the GSTIN must belong to the chosen state), mark inactive (refused while the supplier has open orders), and see the ledger with what is owed. People who may record payments can do so from the ledger.

Every dialog keeps what the user typed when the server refuses, and shows the server's reasons next to the field they are about, or at the top when they are about the whole request.

## Endpoints

| Method and path                                                                                                                                | Permission                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `GET /suppliers`, `/suppliers/:id`, `/suppliers/:id/ledger`                                                                                    | `suppliers.view`           |
| `POST /suppliers`, `PATCH /suppliers/:id`                                                                                                      | `suppliers.manage`         |
| `POST /suppliers/:id/payments`                                                                                                                 | `supplier_payments.create` |
| `GET /purchase-orders`, `/purchase-orders/:id`, `GET /goods-receipts`, `/goods-receipts/:id`, `GET /purchase-returns`, `/purchase-returns/:id` | `purchases.view`           |
| `POST /purchase-orders`, `PATCH /purchase-orders/:id`                                                                                          | `purchases.create`         |
| `POST /purchase-orders/:id/approve`, `/cancel`                                                                                                 | `purchases.approve`        |
| `POST /purchase-orders/:id/receive`                                                                                                            | `purchases.receive`        |
| `POST /purchase-returns`                                                                                                                       | `purchases.return`         |
| `GET /discrepancies`, `/discrepancies/:id`                                                                                                     | `discrepancies.view`       |
| `POST /discrepancies/:id/resolve`                                                                                                              | `discrepancies.resolve`    |
| `GET /reference/payment-modes`                                                                                                                 | any signed-in user         |

## Migration 9 (`20261007000900_purchasing`)

The `purchase_returns` and `purchase_return_lines` tables (branch row-level security, row-version triggers, no update or delete for the application), the `PURCHASE_RETURN` document type (run `pnpm db:setup` so each branch gets its `PRT` number series), `supplier_payments.reference`, `goods_receipts.delivery_note_no` and `note`, a unique GSTIN, one line per item on an order, deleting the lines of a draft order only, and `supplier_has_open_orders()` for the deactivation rule.
