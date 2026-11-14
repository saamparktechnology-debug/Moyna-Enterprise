# Chunk 13 - WhatsApp (Business API) and email (Google SMTP): invoices and receipts to customers, bulk messages

Unzip over the project root (paths are relative to it), after chunks 1 to 12.

    pnpm install             # this chunk adds the nodemailer package (pnpm-lock.yaml is in the zip)
    pnpm db:migrate          # applies 20261007003500_messaging
    pnpm exec prisma generate
    pnpm build:packages
    pnpm db:seed             # gives Admin / Super Admin / staff the new permissions messages.send and messages.bulk

Then add to .env (see .env.example and docs/MESSAGING.md):
  WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME (a UTILITY template with one {{1}} variable)
  SMTP_USER, SMTP_PASSWORD (a Google app password), optionally SMTP_FROM
and, for the staff notification emails, the same SMTP_* in the worker's environment plus NOTIFICATION_CHANNELS=EMAIL.
Restart the API and the worker.
