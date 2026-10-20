# Demo data

A realistic demo for **Bengal Toto Motors Pvt Ltd**, a West Bengal dealer of TOTO e-rickshaws, batteries and spare parts, with four branches. Two ways to load it; both give the same system.

> **Only ever load this into a demo database.** Both ways are meant for an empty system. The SQL restore **replaces all data** in the database it is loaded into, and the date step edits dates directly.

## What you get

| Area           | What is in it                                                                                                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company        | Name, address, GSTIN, phone and email in Settings; 4 branches (Kolkata head office, Howrah, Siliguri, Durgapur), each with its own GSTIN                                                                                  |
| People         | The owner, 5 Admins and 8 Staff, spread over the branches (one Admin works in two). 13 have HR records                                                                                                                    |
| Catalogue      | 30 items: 4 TOTO models, 4 battery models (with manufacture and expiry dates), motors, controllers, chargers, tyres and spare parts, with barcodes, HSN and GST rates                                                     |
| Buying         | 5 suppliers, 20 purchase orders approved and received with serial numbers; short and damaged deliveries (4 receiving problems, 2 resolved, 2 still open); supplier payments                                               |
| Stock          | About 1,200 units in stock; 9 transfers in every state (received, on the way, approved, requested); 6 stock adjustments (approved, rejected, pending); 8 expired and a few soon-to-expire batteries; many low-stock lines |
| Selling        | About 90 invoices over five weeks (GST, non-GST and interstate); 14 quotations in every state, including booking advances and 2 custom builds in progress; broker commissions with payouts                                |
| Money          | Full, part and unpaid sales; later payments; 14 overdue invoices; 6 credit notes (approved, pending, rejected); 2 refunds; 2 reversed payments; 2 vehicle exchanges                                                       |
| Customers      | 106 customers (individuals, fleet businesses, a few from Bihar and Jharkhand); KYC documents: 32 verified, 2 rejected, 18 waiting                                                                                         |
| Sales pipeline | 56 leads in every stage (12 converted to customers) with notes and follow-ups, some overdue, some due today                                                                                                               |
| HR             | 6 weeks of attendance, leave (approved, pending, rejected) and September payroll (8 records finalised, 5 still draft)                                                                                                     |
| Alerts         | About 80 notifications in the inbox: dues, low stock, battery expiry, transfers, receiving problems, KYC, commission, follow-ups                                                                                          |
| Reports        | All 16 reports have rows; Excel and PDF downloads work                                                                                                                                                                    |

The money is plausible: about Rs 65 lakh of sales over five weeks (Rs 27 lakh this month), Rs 12 to 15 lakh outstanding of which Rs 4 to 7 lakh is overdue (the exact split of later payments varies a little between script runs), and a large opening stock.

## Sign-in

Every demo user has the password **`Demo@Toto#2026`**.

| User                                         | Role                                  | Branch             |
| -------------------------------------------- | ------------------------------------- | ------------------ |
| `superadmin`                                 | Super Admin (owner, Arindam Sengupta) | All                |
| `soumik.dutta`                               | Admin                                 | Kolkata            |
| `shreya.chatterjee`                          | Admin                                 | Kolkata and Howrah |
| `rina.mondal`                                | Admin                                 | Howrah             |
| `abhijit.roy`                                | Admin                                 | Siliguri           |
| `partha.ghosh`                               | Admin                                 | Durgapur           |
| `tanmoy.saha`, `priya.bose`, `debojit.nandi` | Staff                                 | Kolkata            |
| `sanjay.das`, `kaushik.paul`                 | Staff                                 | Howrah             |
| `moumita.pal`, `tenzing.sherpa`              | Staff                                 | Siliguri           |
| `rajesh.kar`                                 | Staff                                 | Durgapur           |

If you load it with the script, the owner's password is the one in your `.env` (`SEED_SUPER_ADMIN_PASSWORD`). With the SQL restore it is `Demo@Toto#2026`.

## Option A: run the script (needs the app running)

1. Start from an empty system: `pnpm db:setup` (migrate, provision, base seed).
2. In `.env` set `KYC_STORAGE_PATH` to an absolute folder (KYC uploads need it) and keep `SEED_SUPER_ADMIN_PASSWORD`.
3. Start the app: `pnpm dev`.
4. `pnpm demo:seed` (about one minute). It signs in as the people above and uses the real API, so every number series, stock movement and audit row is genuine.
5. `pnpm demo:finish` spreads the documents over the last five weeks (the API stamps everything with today's date, so without this the charts show one day) and runs the daily reminders once so the notification inbox is full.
6. `pnpm demo:check` prints the headline figures and the row count of every report.

The script refuses to run on a system with several branches. Random choices use a fixed seed, so each run gives a very similar demo; a few payment amounts can differ slightly. The SQL file (Option B) is exactly the same every time.

## Option B: restore the SQL file (fastest, for rehearsals)

1. `pnpm db:migrate && pnpm db:provision` on an empty database. **Do not** run `pnpm db:seed`.
2. Load the data (**this replaces everything in the database**), using the owner connection:
   ```
   gunzip -c demo/demo-data.sql.gz | psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1
   ```
3. Put the KYC documents where the app looks for them:
   ```
   mkdir -p "$KYC_STORAGE_PATH" && tar -xzf demo/kyc-files.tar.gz -C "$KYC_STORAGE_PATH"
   ```
4. Start the app. To reset between rehearsals, repeat steps 1 to 3 on a fresh database. Dates in the dump are fixed (about 10 October 2026), so for a live presentation on another day, prefer Option A, or choose a date range in the dashboards and reports that covers 7 September to 10 October.

## Suggested walkthrough

1. **Dashboard** as the owner: company figures, branch table, the day-by-day chart. Open a branch.
2. **Reports** (Sales, GST sales, Dues, Stock, Battery expiry, Branch performance) with an Excel and a PDF download.
3. **Stock**: low-stock lines, transfers on their way and waiting for approval, a receiving problem, expired batteries, serial numbers and warranty.
4. **Selling**: a quotation with a booking advance; a custom build in progress; a vehicle invoice with a serial number; a part-paid invoice and its dues; a credit note; a refund; an exchange.
5. **Customers**: KYC pending review; the customer's invoices and payments.
6. **Leads**: the pipeline, overdue follow-ups, a converted lead.
7. **Staff**: attendance, leave, payroll; sign in as a branch Staff member to show what they cannot see.
8. **Notifications and search**: the inbox, then search a serial number, invoice number or phone number.
9. **Settings**: company details, approval limits, number series, tax rates and the audit log (filter by person).

## Notes and limits

- Stock movements (the ledger) and audit-log entries carry the date the data was created, not the spread dates. Documents, payments, leads and transfers carry the spread dates.
- The people, customers and GSTINs are made up. GSTINs have valid check characters; the PAN-like numbers are fictional.
- KYC files are one-page specimen PDFs.
- Nothing is sent by email or SMS (no provider is configured).
