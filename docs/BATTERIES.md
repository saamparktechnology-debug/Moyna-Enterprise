# Batteries (Stage 4, module 4.3)

A battery is a serial unit of a serialized item with extra details: when it was made, when it expires and how long its warranty lasts. Screen: **Batteries** (`/batteries`). Permissions: `batteries.view` (list, alerts, sale check), `stock.adjust` (record dates, install, take out) and `batteries.override_expiry` (sell or install an expired battery, a manager permission). There is no new permission.

## Dates

- **Expiry and warranty are calendar dates, judged by the day in India** (`todayInIndia`). A battery is good **through** its expiry date and is expired from the next day. A warranty covers the last day it names.
- A battery arrives with its dates in one step: an incoming stock adjustment (module 4.2) may carry `manufacturedOn`, `expiryOn` and `warrantyMonths`, and the battery row is created when the request is approved. Details can also be recorded or changed later (`PATCH /batteries/:serialUnitId`). The first recording needs no version; every later change must send the `rowVersion` it read, and two simultaneous first recordings let only one win. Setting a date to empty clears it.
- Dates are checked in the browser, the API and the database: expiry must be after manufacture, a warranty cannot end before the battery was made, and warranty months are 0 to 120.
- **Duplicate serial numbers** are refused when the stock is asked for and again when it is approved; the first battery is left alone.

## Warranty

The warranty starts on the sale date, not on arrival. When billing (module 4.7) sells a battery it calls `BatteriesService.startWarranty`, which sets the end to the sale date plus the warranty months, counted in calendar months. Where that day does not exist, the last day of the month is used (31 August plus 6 months ends on 28 February; in a leap year, 29 February). A battery with no warranty months, or no details, is left unchanged. The end date can also be typed in by hand.

## Selling or installing an expired battery

An expired battery is refused unless someone who holds `batteries.override_expiry` gives a reason. Staff can ask, but the server answers 403 unless they hold the permission. A battery that is fine, has no dates, or expires today is never blocked and records no override. Every override is audited (`BATTERY_EXPIRY_OVERRIDDEN`, with the purpose, the expiry date and the reason). Billing asks the question with `POST /batteries/:serialUnitId/sale-check`; module 4.7 must call it before selling a battery.

## Installing in a vehicle

Installing reserves the battery for the vehicle: it moves from Available to Reserved with a pair of ledger rows and records the vehicle and the date (today when none is given). It is not a sale. The vehicle must be a unit in the same branch that has not been sold, a battery cannot be installed in itself or twice, and an expired battery needs the override above. Two simultaneous installs of the same battery let one win, and a refused install leaves the stock untouched. Taking it out puts it back in Available stock with another pair of ledger rows; it is refused for a battery that is not installed or has already been sold.

## Expiry alerts

`GET /batteries/alerts?withinDays=30` counts the batteries still in stock (any state except sold or scrapped) that are expired or expire within the window, only in the branches the user can see. The Batteries page shows both counts and filters the list when one is pressed. The list itself filters by expiry (expired, expiring, not near expiry, no date), warranty (covered, ended, not started), installation, item, branch and state, sorts by expiry with batteries that have no date last, and pages on the server.

## Endpoints

| Method and path                                                                                                       | Permission       |
| --------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `GET /batteries`, `GET /batteries/alerts`, `GET /batteries/:serialUnitId`, `POST /batteries/:serialUnitId/sale-check` | `batteries.view` |
| `PATCH /batteries/:serialUnitId`, `POST /batteries/:serialUnitId/install`, `POST /batteries/:serialUnitId/uninstall`  | `stock.adjust`   |

## Migration 8 (`20261007000800_batteries`)

`batteries.installed_in_serial_unit_id` and `installed_on` (always both or neither, never the battery itself), a ten-year limit on warranty months, and the battery columns on `stock_adjustments` with checks that dates are in order and only travel with a serial number.
