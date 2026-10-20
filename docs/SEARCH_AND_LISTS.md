# Search and list filtering (Stage 5, module 5.3)

## Global search: `GET /search`

One box in the header finds, in a single request:

| Kind     | Matches on                                                     | Needs permission | Scoped to                   |
| -------- | -------------------------------------------------------------- | ---------------- | --------------------------- |
| Item     | Barcode (exact), item code or name (contains)                  | `items.view`     | Company-wide                |
| Serial   | Serial number (exact, or contains)                             | `stock.view`     | The caller's branches (RLS) |
| Invoice  | Invoice number (exact, or contains)                            | `invoices.view`  | The caller's branches (RLS) |
| Customer | Name (contains); phone when the text looks like a phone number | `customers.view` | Company-wide                |

- Open to any signed-in user; only the kinds the user may view are searched (`searched` in the response says which).
- Query: `q` (2 to 100 characters), optional `types` (comma separated, any case), `limit` (1 to 20 per kind, default 5). Unknown parameters are refused.
- Exact matches come first within each kind and are marked `exact`. Results carry a title, a one-line description and the page that lists that kind of record.
- `%` and `_` typed by the user are plain characters, never wildcards.
- Migration 24 adds trigram (`pg_trgm`) indexes on customer name and phone, item code and name, serial number and invoice number, so contains-searches stay fast. `pg_trgm` ships with PostgreSQL; the migration user creates it once.

## Lists

Every paginated list takes `page` (from 1), `pageSize` (1 to 100) and, where it has a sort, `sortBy` and `sortOrder`; a page size over 100, a page below 1 and an unknown sort field are refused with 400. `list-conformance.int.test.ts` checks all 30 lists. This module added validated sorting to eight lists that ignored `sortBy`:

| List              | Sort fields                                    |
| ----------------- | ---------------------------------------------- |
| Refunds           | `paidOn`, `createdAt`, `amount`, `refundNo`    |
| Stock adjustments | `createdAt`, `status`, `qty`                   |
| Stock movements   | `createdAt`, `movementType`, `qtyDelta`        |
| Low stock         | `shortfall`, `available`, `itemCode`, `branch` |
| Transfers         | `createdAt`, `transferNo`, `status`            |
| Goods receipts    | `receivedAt`, `grnNo`, `createdAt`             |
| Discrepancies     | `createdAt`, `status`, `type`, `qty`           |
| Purchase returns  | `createdAt`, `returnNo`                        |

Without `sortBy` each list keeps its old order. The two small lookup lists (`/lead-sources`, `/item-categories`) stay unpaged by design.

## Known limits

- A search result opens the page that lists that kind of record; it does not yet open the record or pre-fill that page's own search box.
- The new sort fields are available through the API; the list pages do not yet have clickable column headers for them.
- Saved filters (optional in the requirements) are not built.
- Search is contains-matching, not typo-tolerant or ranked by relevance beyond "exact first".
