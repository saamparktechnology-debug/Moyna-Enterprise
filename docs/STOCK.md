# Inventory and stock ledger (Stage 4, module 4.2)

Screens: **Inventory** (`/inventory`) with the tabs Stock, Low stock, Movements, Serial numbers and Adjustments. Permissions: `stock.view` (read everything), `stock.adjust` (ask for an adjustment, cancel your own), `stock.adjust_approve` (approve or reject).

## How stock is held

- `stock_ledger` is the append-only history: one row per movement, with a signed quantity, the stock state, the movement type and the document that caused it. The application role cannot update or delete it.
- `stock_balances` holds the current quantity per branch, item and state (Available, Reserved, In transit, Damaged, Returned, Quarantine). It always equals the sum of the ledger. `stock_balance_drift()` returns any row where it does not, and must return nothing; a test checks this after every kind of movement.
- A serialized item is held as serial units, one ledger row of one piece each. A unit that is sold or scrapped leaves the balances but stays in `serial_units` with its history.

## One way in: `StockPostingService`

Every module that changes stock (adjustments now; receiving, transfers, billing, exchange later) calls `StockPostingService` inside its own transaction. It locks the balance row, refuses to go below zero, writes the ledger row and the balance together, and checks that the item is active. If the surrounding work fails, the balance and the ledger roll back together. Concurrent issues of the same item are serialized by the row lock, so exactly the available quantity can be issued.

## Adjustments

An adjustment is a request first and moves nothing. Kinds: **IN** (stock arrives; a serialized item needs a serial number and creates the unit on approval), **OUT** (count correction), **WRITE_OFF** (disposal; a serial unit becomes scrapped), **STATE_CHANGE** (for example Available to Damaged, as a pair of ledger rows).

Approval rules (decided in this module):

- A person with `stock.adjust_approve` approves or rejects. A rejection needs a reason.
- **Nobody approves their own request**, except a Super Admin, so a business run by one owner can still work. The Super Admin's own approval is audited like any other.
- **A branch Admin approves up to 10 units in one adjustment** (`ADJUSTMENT_ADMIN_APPROVAL_LIMIT`); larger ones wait for a Super Admin. Items have no prices, so the limit is by quantity. Moving this to a company setting belongs to module 5.5.
- The stock is checked again when the request is approved, so a request made when stock was available cannot make it negative later.
- Approving the same request twice at the same moment applies it once. Each decision also updates the matching row in `approvals`, ready for the approvals inbox, and is audited and sent to the outbox.

## Low stock

An item is low in a branch when it has a reorder level above zero and the available quantity is at or below it, including items that have no stock row at all. The list shows the worst shortage first, covers only branches the user can see, and ignores inactive branches.

## Endpoints

| Method and path                                                                                      | Permission                          |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `GET /stock/balances`, `/stock/low`, `/stock/movements`, `/stock/serial-units`, `/stock/adjustments` | `stock.view`                        |
| `POST /stock/adjustments`                                                                            | `stock.adjust`                      |
| `POST /stock/adjustments/:id/cancel`                                                                 | `stock.adjust` (the requester only) |
| `POST /stock/adjustments/:id/approve`, `/reject`                                                     | `stock.adjust_approve`              |

## Migration 7 (`20261007000700_stock_adjustments`)

The `stock_adjustments` table with branch row-level security and checks that make impossible requests unrepresentable, the `StockAdjustmentKind` enum, `stock_balance_drift()` (operations and tests only), and `serial_number_in_use()` (a company-wide yes/no check, because a branch user cannot see other branches' serial units).
