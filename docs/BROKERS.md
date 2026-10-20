# Brokers and commission (module 4.10)

People who bring sales, the commission they are paid, and what is owed to them.

## How a commission is worked out

1. A **draft invoice** may name a broker (`brokerId`). The broker must be active and have a rule in force. The broker is fixed once the invoice is issued (a database rule).
2. When the invoice is **issued**, in the same transaction, the commission is worked out on the **rule in force at that moment** and kept:
   - **Percentage:** the percentage of the invoice's **taxable value** (after discounts, before GST), rounded to the paisa, halves up.
   - **Fixed:** the amount, once per invoice.
   - Either way it never exceeds the taxable value, and an invoice with nothing taxable earns nothing. An invoice with no broker earns nothing.
3. The commission records the rule it used, the base it was worked out on and its amount. Its status starts `PAYABLE`.
4. If the broker was switched off or lost their rule between the draft and the issue, the invoice is **not issued** (400 on `brokerId`) and nothing changes.

## Rules never change

A commission rule is **never edited**. `POST /brokers/:id/rules` retires the rule in force and adds a new one, in one step; the database allows only one live rule per broker, refuses any edit of type, value or broker, and refuses bringing a retired rule back. Commissions already worked out keep pointing at the exact terms they were worked out on, so changing a rule never changes an old commission. A percentage rule is 0 to 100 (not 0), a fixed rule is more than 0.

## Credit notes, cancellations and payment

| Event                                            | Effect                                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credit note approved                             | The commission is lowered by the credited share of the invoice. It is worked out on the total credited so far, not note by note, so the paisa add up exactly; crediting the whole invoice takes back the whole commission. A credit note waiting for approval changes nothing |
| Invoice cancelled                                | The whole commission is taken back                                                                                                                                                                                                                                            |
| Commission fully taken back before it is paid    | Status becomes `REVERSED`                                                                                                                                                                                                                                                     |
| Payout (`commissions.approve_payout`)            | Status becomes `PAID`; the amount paid is what the commission is worth at that moment, with the date, who paid and an optional reference                                                                                                                                      |
| Credit note or cancellation **after** the payout | The commission stays `PAID`; the reduction is recorded, and the difference is shown as **to get back** from the broker. Recovering it is not done in this system                                                                                                              |

Reductions are rows in `commission_adjustments`, added and never changed; the commission itself keeps its original terms. A commission is worth `amount − adjustments`.

## Endpoints

| Endpoint                                                                                         | Permission                                           |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `GET /brokers`, `GET /brokers/:id`, `GET /brokers/:id/ledger`                                    | `brokers.view`                                       |
| `POST /brokers`, `PATCH /brokers/:id` (name, phone, switch on or off), `POST /brokers/:id/rules` | `brokers.manage` (Admin and Super Admin)             |
| `GET /commissions` (filter by status, broker, branch, search)                                    | `brokers.view`                                       |
| `POST /commissions/payout`                                                                       | `commissions.approve_payout` (Admin and Super Admin) |

- **Paying out** takes up to 100 commissions of **one broker**, all `PAYABLE`. The rows are locked first, so two payouts, or a payout and a credit note, arriving together are dealt with one at a time and nothing is paid twice.
- **Ledger**: commissions, credit-note and cancellation deductions, and payouts, with a running balance of what is owed to the broker; a negative balance means the broker was paid more than is now due. The balance is worked out over every entry before the date filter is applied.
- **Phone numbers** must be unique among brokers (a broker may have none).
- Brokers are company-wide; commissions, adjustments and the ledger are per branch with row-level security, so another branch's commissions are hidden (404 on payout) and the figures on a broker count only the branches the caller can see.

## Screens

**Brokers** page: a brokers tab (list, add, edit, switch on or off, rules history and a new rule, ledger) and a commissions tab (filter, choose commissions of one broker, pay out with a reference). The invoice form has an optional **Broker** field, shown to people who may view brokers, listing active brokers with their rule.

## Database (migration 16, `20261007001600_brokers_commission`)

`invoices.broker_id`; unique broker phone; `commission_rules` guard and one-live-rule index (`commission_rules_one_active_key`, a partial index recorded in `scripts/check-schema-drift.mjs`); `commissions.base_amount`, `paid_at`, `paid_by`, `paid_amount`, `payout_reference`, one commission per invoice, an insert check and a guard that fixes its terms and freezes a paid or reversed commission; new table `commission_adjustments` (append-only, never more than the commission, in the commission's branch). Existing rows are not changed; checks that could fail on old rows are added `NOT VALID`.

## Decisions and limits

- **Base of the commission:** the taxable value, before GST (my choice; the requirements do not say).
- **A fixed commission is capped at the taxable value** (my choice, so a commission never exceeds the sale).
- **Payable on issue:** a commission can be paid out as soon as the invoice is issued, whether or not the customer has paid. If you want it payable only once the invoice is paid, that is a small change in the payout check.
- **Exchange** (module 4.12) lowers the commission on the old sale by the returned vehicle's share, through the same adjustments (kind `EXCHANGE`), together with credit notes. The delivery invoice's commission is not changed. See `EXCHANGES.md`.
- **Recovery of money paid and since lowered** is shown, not settled or offset against later payouts.
- A broker has one rule at a time and an invoice one broker. There is no per-item or tiered rule.
- **Not built:** brokers on leads (the `leads.broker_id` column is still unused), reminders for unpaid commission (module 5.2), a commission report (module 5.4).
