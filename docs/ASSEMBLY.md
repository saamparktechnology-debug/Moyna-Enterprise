# Assembly (manufacturing)

Making a product from parts in our own stock. **Nothing is costed**: the parts leave stock, the finished product comes into stock, and a **selling price** is set.

## Who may do it

The permission **`manufacturing.manage`**. The **Super Admin** has it. An Admin does not have it until a role is given it (Users and roles: add "Assemble products from stock and set their selling price" to the role). Without it the Assembly page, its menu entry and its endpoints are closed (403).

## How an assembly works

- **Assemble a product** (Assembly page): choose the branch (if you have several), the product being made, its **selling price**, how many, and the **parts from stock** with their quantities. A note is optional. The product must already exist as an item (create it in Items first).
- **Parts counted by quantity** go out of Available stock by the quantity given. If any part is short, **nothing at all happens** (no stock moves, no price changes). Stock is always posted through the stock ledger as `ASSEMBLY_USED` (parts) and `ASSEMBLY_MADE` (the product).
- **A part tracked by serial number** (a battery, a motor) is chosen unit by unit and becomes **INSTALLED**: it leaves stock and can never be sold again. A battery that goes into a vehicle is recorded as **installed in that vehicle**, so its warranty and history follow the vehicle.
- **A product tracked by serial number** (a vehicle) is made **one at a time** with its serial number and, optionally, chassis and motor numbers. A product counted by quantity can be made in any quantity.
- **The selling price** is saved on the product. In billing, choosing the item **starts the price from it**; the biller may change it. The Items list shows it.
- Each assembly gets a number like invoices: `AS-111120261123` (day, month, year, hour, minute; the next free minute if that one is used). An assembly is never changed afterwards (the database refuses updates), and the audit trail records what was made, the parts and the old and new selling price.
- Everything is in one branch: parts in another branch do not count.

## A new product made on the spot

Instead of choosing an existing item, choose **A new item** in the Assemble dialog and give its code, name, category and unit (and, if you like, an HSN code, a GST rate, and whether it has a serial number of its own, like a vehicle). The item is created in the same step as the assembly, so if the assembly fails nothing is created. Only someone who may manage items can do this.

## Cost of the parts, and the profit

The cost is **worked out from the purchase prices set on the parts' items** (the real price and the price shown to Admin and staff, as on invoices) and kept with the assembly as it was that day. A Super Admin sees the cost and profit on the real prices; everyone else sees them on the shown prices. If any part has no purchase price, the cost and profit are blank. **Profit** is the selling price times the number made, less the cost of the parts. Nothing else (labour, other costs) is counted.

## Reversing an assembly

**Reverse** (Assembly page, with the permission) takes an assembly apart again, with a reason: the product leaves stock, the parts come back (a numbered part is available again), a battery is no longer recorded as installed, and the product's selling price goes back to what it was if nobody changed it since. It is **refused if the product has already been sold or moved** (a vehicle must still be available; a counted product must still be in stock in full). The assembly stays on the list marked Reversed, with its reason; the audit trail keeps it (`ASSEMBLY_REVERSED`). A reversed vehicle's serial number stays used (it is marked scrapped).

## Not included

- Parts are not "reserved" while a person fills in the form; the check happens when they press Assemble.

## Endpoints

`GET /assemblies` (search by number or product), `GET /assemblies/:id`, `POST /assemblies`, `POST /assemblies/:id/reverse`. Audit actions `ASSEMBLY_CREATED`, `ASSEMBLY_REVERSED`.

## Database (migrations 31 and 32, `20261007003100_assembly` and `20261007003200_assembly_extras`)

New tables `assemblies`, `assembly_parts` and `assembly_units` (branch-scoped by row-level security, update revoked), `items.selling_price`, and new enum values `ASSEMBLY_USED`, `ASSEMBLY_MADE`, `ASSEMBLY_RETURNED`, `ASSEMBLY_UNMADE` (movement types) and `INSTALLED` (serial unit state); migration 32 adds the cost columns on `assemblies` and the table `assembly_reversals`.
