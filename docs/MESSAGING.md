# Messages to customers: WhatsApp and email

Invoices and receipts can be sent to a customer as a PDF, and a message can be sent to many customers at once. Everything sent is kept under **Messages**, with how it went for each person.

## Setting it up (the `.env` file)

- **WhatsApp Business (Meta Cloud API):** `WHATSAPP_TOKEN` (a permanent access token) and `WHATSAPP_PHONE_NUMBER_ID`, from Meta Business Manager. `WHATSAPP_COUNTRY_CODE` (91) is put in front of a 10-digit number.
- **Email through Google SMTP:** turn on 2-step verification on the Gmail account and make an **app password**; set `SMTP_USER`, `SMTP_PASSWORD`, optionally `SMTP_FROM`. The server is `smtp.gmail.com` port 465 unless changed.
- **The 24-hour rule (important).** WhatsApp lets a business send a free message **only to a customer who wrote to the business in the last 24 hours**. For anyone else it allows only an approved **template** message (a utility template is billed, a free-form message in the window is not). So set up templates in Meta Business Manager: category **Utility**, language as `WHATSAPP_TEMPLATE_LANGUAGE`, one body variable `{{1}}`, get each approved, and put its name in the matching setting. **A template for each purpose:** `WHATSAPP_TEMPLATE_NAME` (general bulk messages), `WHATSAPP_TEMPLATE_INVOICE`, `WHATSAPP_TEMPLATE_RECEIPT` and `WHATSAPP_TEMPLATE_REMINDER` (a bulk message to customers who owe money). A purpose with no template of its own uses the nearest one that is set up: a receipt uses the invoice template, then the general one; an invoice or a reminder uses the general one. If none applies, that person fails with the reason, naming the setting to fill in. Meta may refuse or re-classify a template that is only a variable; word the fixed text around it (for example "Update from Moyna Enterprise: {{1}}"). The system sends the free message first and falls back to the template when WhatsApp says the window is closed; without a template those people fail with the reason.
- The staff notifications by email (the older notification system) are sent by the **worker** with the same `SMTP_*` settings and `NOTIFICATION_CHANNELS=EMAIL`; until `SMTP_USER` is set they are only logged.

## Sending an invoice or a receipt

On an **issued invoice**, and on a **payment** (its receipt), press **Send to customer**: choose WhatsApp or email, leave the number or address empty to use the customer's own (or type another), edit the message if you like, and send. The PDF is attached by email and sent as a document on WhatsApp. If the customer has not written in the last 24 hours the WhatsApp message goes as the template, **without the PDF**, and the screen says so; once they reply, send it again. Needs `messages.send` (Admin and staff).

## Bulk messages (Messages page, "New bulk message")

Needs `messages.bulk` (Admin and Super Admin). Choose the channel, the audience (**customers who owe money**, **all customers**, or **customers you choose**) and the message. `{{name}}`, `{{due}}` (what the customer still owes) and `{{shop}}` are filled in for each person. **Count who it reaches** shows how many people have a usable phone number or email address. Each person is sent their **own ordinary message** (never a broadcast or a marketing list). Sending goes in rounds of 20 while the screen is open and shows the progress; if the page is closed, open the campaign and press **Send the waiting ones**. A number that can never work fails at once with the reason; a passing problem is tried three times; **Send the failed ones again** tries them once more. One person with two customer records, or two customers sharing a number, is messaged once.

## Limits

- Replies from customers are not read (no webhook), so the system cannot tell who has written in the last 24 hours; it learns it from WhatsApp's own answer.
- The opt-out list is kept by staff (a customer who asks to stop is added by hand); there is no automatic STOP reply.
- Messages are sent while the screen is open; there is no background sending queue.
- Meta's own prices and limits apply (messaging limits per day, template approval).

## Customers who opted out (chunk 14)

Messages page, **Opted out** (Admin and Super Admin): a list of customers who asked not to get bulk messages. They are **left out of every bulk message** (the count shown before sending says how many were left out) and can be put back with **Include again**. Invoices and receipts sent to one customer still go to them, because that is a message they asked for. A customer is on the list once; adding and removing is audited (`MESSAGE_OPT_OUT_ADDED`, `MESSAGE_OPT_OUT_REMOVED`).
