# Items, categories and barcodes (Stage 4, module 4.1)

Items are shared by the whole company; stock for an item is counted per branch (module 4.2). Screens: **Items** (`/items`). Permissions: `items.view` (list, scan lookup, label printing) and `items.manage` (create, edit, deactivate, barcodes, categories).

## Rules

- **Item code**: 2 to 32 capital letters, digits, dots, dashes or underscores, unique, upper-cased by the system, and never changed afterwards. The database also refuses a malformed code.
- **GST rate and HSN code** are optional. When an HSN code with a default rate is chosen and no rate is given, the HSN rate is used. The user may choose a different rate.
- **Serial numbers**: `is_serialized` can change only while the item has no stock, ledger or serial-unit rows in any branch. The check runs in a database function (`item_has_stock_history`) because a branch user cannot see other branches' stock under row-level security.
- **Deactivation** is refused while any branch holds stock of the item (`item_stock_on_hand`). Inactive items are refused by scan lookup, labels and `ItemsService.requireUsable`, which the stock, purchasing and billing modules must call before using an item.
- **Barcodes**: an item has up to 10. Typed barcodes are 4 to 48 visible characters (a 13-digit one must have a valid EAN-13 check digit). Generated barcodes are EAN-13 numbers with prefix `20` (reserved for in-store use), built from the sequence `item_barcode_seq`. A barcode belongs to one item. Adding, removing and printing are audited.
- **Scan lookup** (`GET /items/lookup?barcode=`) tries the barcode, then an item code typed by hand. It returns `isSerialized` so the caller knows to ask for a serial number.
- **Labels** (`POST /items/labels`) return one entry per label, at most 500 per request and 200 per item, preferring the item's EAN-13 barcode. The browser draws EAN-13 barcodes as SVG and prints through a print stylesheet (50 x 25 mm). Other barcodes print as text; drawing them needs a Code 128 encoder.
- **Categories** form a tree up to three levels deep. Names are unique among siblings ignoring case. A category cannot move inside itself, and cannot be deactivated while active items or active subcategories use it.

## Endpoints

| Method and path                                                                               | Permission         |
| --------------------------------------------------------------------------------------------- | ------------------ |
| `GET /items`, `GET /items/:id`, `GET /items/lookup`, `POST /items/labels`                     | `items.view`       |
| `POST /items`, `PATCH /items/:id`, `POST /items/:id/deactivate`, `POST /items/:id/reactivate` | `items.manage`     |
| `POST /items/:id/barcodes`, `POST /items/:id/barcodes/:barcodeId/remove`                      | `items.manage`     |
| `GET /item-categories`                                                                        | `items.view`       |
| `POST /item-categories`, `PATCH /item-categories/:id`                                         | `items.manage`     |
| `GET /reference/units`, `/reference/gst-rates`, `/reference/hsn-codes`                        | any signed-in user |

Edits send the `rowVersion` they read; a stale version answers 409.

## Migration 6 (`20261007000600_items_barcodes`)

Check constraints on item codes and barcodes, a case-insensitive unique index on sibling category names (`item_categories_sibling_name_key`, added to the drift allowlist), the barcode sequence, and the two company-wide stock functions (granted to `erp_app` only).
