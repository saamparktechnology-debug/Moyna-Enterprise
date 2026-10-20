# Inter-branch transfers (Stage 4, module 4.5)

Screen: **Transfers** (`/transfers`). Permissions: `transfers.view` (list and detail), `transfers.request` (ask for stock, cancel), `transfers.approve` (approve or reject), `transfers.dispatch` and `transfers.receive`. Staff may ask, dispatch and receive; approving is a manager permission. There are no new permissions.

## The flow

A transfer is **asked for by the branch that needs the stock** (the receiving branch) from another branch (the sending branch). A person can ask only for a branch they work in; the sending branch can be any active branch. The request is numbered (`TRF`) and moves no stock.

1. **Requested.** Only the sending branch can **approve** it, or **reject** it with a reason. Either branch can **cancel** it, with an optional note.
2. **Approved.** Only the sending branch can **dispatch** it. Either branch can still cancel.
3. **Dispatched** (on its way). Dispatch takes the goods off the sender's shelf and holds them **in transit** in the receiving branch's stock. From here it cannot be cancelled. Only the receiving branch can **receive** it.
4. **Received.** Receiving brings stock in only on a verified count.

Every step is recorded in the transfer's history with who did it and when, is audited, and is protected against two people acting at once (the version that was read must still be current; of two simultaneous approvals or dispatches, one wins).

## Dispatching

The sender counts what is being sent. A plain item can be sent in a smaller quantity than was asked for (never more); both numbers are kept. A serialized item is sent by scanning each unit, and the number scanned must equal the number asked for. A unit must be available in the sending branch, in the transfer, and listed once. If the sender does not have the stock, the whole dispatch is rolled back and nothing moves. Two transfers can never dispatch the same last units.

## Receiving

The receiver counts what arrived and how many of those are damaged, and scans the serial numbers that arrived. Good units go to Available, damaged units go to Quarantine. Anything that did not arrive stays in transit as a **short** problem, so the stock is never lost silently. A count that cannot be true (more than was sent, more damaged than arrived, a serial number that is not in the transfer) is refused. The same transfer cannot be received twice.

## Problems on arrival

Short and damaged units become discrepancies, settled in the same workflow as purchase receipts (Purchasing, Discrepancies), and only by the receiving branch. A short transfer can only be written off, which clears the goods from transit (a serial unit that never arrived becomes scrapped). Damaged goods can be accepted into stock or written off, but not returned to a supplier, because they did not come from one. The transfer detail shows how many problems still wait for a decision.

## Why one database function

Stock is held by branch, and a branch user cannot write another branch's rows. Dispatch takes the goods off the sender's shelf as the sender, and `transfer_arrive_in_transit(line, user)` puts them in transit at the destination. It takes only a transfer line, reads everything else from it, and refuses unless the transfer is being dispatched by someone who may act for the sending branch, so it cannot be used to change any other stock. It is granted to the application role only.

## Endpoints

| Method and path                                             | Permission           |
| ----------------------------------------------------------- | -------------------- |
| `GET /transfers`, `GET /transfers/:id`                      | `transfers.view`     |
| `POST /transfers`, `POST /transfers/:id/cancel`             | `transfers.request`  |
| `POST /transfers/:id/approve`, `POST /transfers/:id/reject` | `transfers.approve`  |
| `POST /transfers/:id/dispatch`                              | `transfers.dispatch` |
| `POST /transfers/:id/receive`                               | `transfers.receive`  |
| `GET /reference/branches`                                   | any signed-in user   |

## Migration 10 (`20261007001000_transfers`)

A note on every history step, what the sender was asked for next to what was sent, the damaged count, the serial number on the line (readable by both branches), checks that sent is within requested, received within sent and damaged within received, and `transfer_arrive_in_transit`.
