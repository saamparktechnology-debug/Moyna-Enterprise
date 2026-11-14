# Chunk 14 to 16 - WhatsApp template per purpose and opt-out list; weekly offs and holidays; per-employee roster

Unzip over the project root (paths are relative to it), after chunks 1 to 13. This one zip holds three steps that were built together.

    pnpm install --frozen-lockfile     # no new packages
    pnpm db:migrate                    # applies 20261007003600_messaging_optout_templates and 20261007003700_holidays_and_roster
    pnpm exec prisma generate
    pnpm build:packages
    pnpm db:seed                       # nothing new to seed; safe to run

What you get:
  Chunk 14: a WhatsApp template for each purpose (general, invoice, receipt, reminder) and an "Opted out" list on the Messages page.
            Optional .env: WHATSAPP_TEMPLATE_INVOICE, WHATSAPP_TEMPLATE_RECEIPT, WHATSAPP_TEMPLATE_REMINDER (see docs/MESSAGING.md).
  Chunk 15: company weekly off days (default Sunday) and holidays set by the Super Admin (HR, Holidays tab); Settings, Company has
            "Weekly off days" and "Pay daily staff for off days". Payroll, leave days and "My day" follow them (docs/HR.md).
  Chunk 16: the Super Admin sets the roster of any employee (HR, Staff, Roster): their own weekly off days and days off.
  Also: four small lint fixes that were already failing in the original project (unused `index` prop in invoice-form-dialog.tsx, unused
  `salesTotal` in dashboard-page.tsx, a bogus import in dashboard-parts.tsx, a variable reassigned during render in dashboard-charts.tsx).

Behaviour change to know about: with no setting saved, Sunday is now the weekly off. A person on a fixed salary is paid the same;
leave over a Sunday no longer counts those Sundays as leave days. Daily-paid staff are still paid only for hours worked unless you set
"Pay daily staff for off days" to YES.

Run the API integration tests after migrating (they need PostgreSQL): pnpm --filter @erp/api test:integration
Restart the API.
