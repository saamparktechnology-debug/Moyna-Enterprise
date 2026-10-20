# Branches (Stage 3, module 3.2)

A Super Admin creates, edits, deactivates and reactivates branches. Everyone else with `branches.view` can see the branches they work in. Branches are never deleted.

## Rules

| Rule                                                                                                                                                                                  | Where it is enforced                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Code: 2 to 4 capital letters or digits, unique, never changes. It prefixes every document number, and GST limits invoice numbers to 16 characters.                                    | form, API, database check and unique index                               |
| Name: 2 to 100 characters.                                                                                                                                                            | form, API, database check                                                |
| State: one of the active GST states (`GET /reference/states`).                                                                                                                        | form, API, foreign key                                                   |
| GSTIN: optional. 15 characters in the official layout, a correct check character, and its first two digits equal the branch's state code.                                             | shared validator in `packages/contracts` (form and API), database checks |
| State and GSTIN cannot change once the branch has issued an invoice (GST identity of past documents). A rename is always allowed.                                                     | API                                                                      |
| A branch cannot be deactivated while it holds stock, has an open transfer (requested, approved, dispatched, in transit), or is the last active branch. The answer lists every reason. | API, inside a transaction that locks the branch                          |
| Two people editing at once: every edit carries the `rowVersion` it was loaded at; a stale edit is refused with `409` and nothing is overwritten.                                      | API (`row_version` trigger)                                              |
| Deactivating takes the branch away from its users on their very next request; their sessions stay valid.                                                                              | session access check                                                     |

## Endpoints

| Endpoint                                       | Permission         | Notes                                                                                                                                                                         |
| ---------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /branches`                                | `branches.view`    | paginated; `search` (code or name), `status` (`active` default, `inactive`, `all`), `sortBy` (`code`, `name`, `createdAt`). Super Admin sees all; others only their branches. |
| `GET /branches/:id`                            | `branches.view`    | `404` (not `403`) for a branch the user does not work in                                                                                                                      |
| `POST /branches`                               | `branches.manage`  |                                                                                                                                                                               |
| `PATCH /branches/:id`                          | `branches.manage`  | name, state, GSTIN and `rowVersion`                                                                                                                                           |
| `POST /branches/:id/deactivate`, `/reactivate` | `branches.manage`  | repeating either is harmless                                                                                                                                                  |
| `GET /reference/states`                        | any signed-in user | active GST states, for forms                                                                                                                                                  |

Audit rows: `BRANCH_CREATED`, `BRANCH_UPDATED` (old and new values), `BRANCH_DEACTIVATED`, `BRANCH_REACTIVATED`.

## Not in this module

The branch switcher for people who work in several branches arrives in module 3.3, together with assigning users to branches. A new branch gets its document number series the first time a document is numbered in it.
