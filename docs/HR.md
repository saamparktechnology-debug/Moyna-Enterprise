# Staff and HR (module 4.13)

Staff profiles, attendance, leave and monthly payroll records.

## Who sees what

Three permissions already existed (`hr.view`, `hr.manage`, `attendance.mark`) and one is new (**`leave.request`**, Ask for own leave, given to Staff, Admin and Super Admin like the other everyday permissions).

| Permission        | Holder                    | Allows                                                                                                                                                                                                      |
| ----------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hr.view`         | everyone, including Staff | Read HR data. **Without `hr.manage` you see only your own** staff profile, attendance, leave and payroll, because the Staff role holds `hr.view` and salaries are private. Another person's record is a 404 |
| `hr.manage`       | Admin, Super Admin        | Manage profiles, correct attendance, decide leave, make and finalize payroll, for everyone in the branches they may use                                                                                     |
| `attendance.mark` | everyone                  | Check in and out for yourself                                                                                                                                                                               |
| `leave.request`   | everyone                  | Ask for your own leave and withdraw it                                                                                                                                                                      |

Everything is branch-scoped by row-level security. A person's profile stays in one branch and one login for good (a database rule).

## Staff profiles

A profile links a **login to a branch**: employee code (unique), department, designation, join date, monthly salary, and the day they left. It is made for an **active user who works in that branch** and has no profile yet (`GET /staff/candidates` lists them). The salary is visible only to the person and to managers, and every change to it is audited with the old and new values.

- **Leaving** (`POST /staff/:id/deactivate` with the last working day) keeps everything they did. It is refused if attendance follows that day or payroll is already final after it. Leave that is waiting is withdrawn, and leave starting after that day is cancelled.
- **Coming back** (`/reactivate`) starts them again on a **new join date after the day they left**; what was recorded before stays. A returning person's old join date is kept in the audit trail.
- A deactivated person cannot check in or out or ask for leave, and no attendance can be recorded after the day they left, by anyone (a database rule). Their login is **not** switched off by this: that stays a Users-screen decision.

## Attendance

- **Check in and check out** are for yourself, at the server's time. A working day is the **date of the check-in in India**, so a night shift that ends after midnight stays on the day it began. A shift still open can be closed for up to 16 hours; a longer one is not closed by the person, a manager corrects it. A shift is never longer than 24 hours (a database rule).
- You cannot check in twice, check out without checking in, check in on a day of **approved leave**, before you have joined, or in a month whose payroll is final.
- **Corrections** (`PUT /attendance/correct`, managers): set or change one day, with a reason; the old and new times are audited. Not before the person joined, after they left, in the future, on approved leave, or in a month whose payroll is final. **A manager cannot correct their own attendance** (a Super Admin can).
- `GET /attendance?month=YYYY-MM` lists a month and counts the days present.

## Leave

Leave is asked for from a first day to a last day, both counted, as **paid or unpaid**. Staff ask for themselves and from today onwards; a manager can record leave for someone else, including in the past.

- **No overlap, ever:** one person never has two live requests (waiting or approved) sharing a day. A clash is a 409 saying which leave it meets; the database enforces it too, and requests arriving together are taken one after the other. Rejected and withdrawn leave frees its days. Back-to-back ranges are fine.
- **Approving** needs a manager other than the person (the same self-approval rule as stock adjustments and credit notes; a Super Admin may). It is refused if the person worked on any of those days (the days are named), or if payroll is final for one of the months. Rejecting needs a reason.
- **Withdrawing:** the person, or a manager, can withdraw waiting leave or leave that has not started. Leave that has started or passed can only be cancelled by a manager. Never in a month whose payroll is final.
- Leave across a month end is listed in **both months** (`?month=` shows leave with a day in that month) and counted in each by the days that fall in it.
- There is no leave balance or entitlement: the requirements give no policy for one.

## Payroll

A payroll record is a person's pay for one month. `POST /payroll/generate` makes a **draft for everyone employed in a month that has ended** and has none yet (running it again does nothing new). The record keeps what it was worked out on, so a later raise changes nothing already made.

- **Pay for the days employed:** the monthly salary shared by the days in the month the person was employed, from their join date to their last day, **both counted**, rounded to the paisa (halves up). Someone who joins on the 16th of a 31-day month is paid for 16 days; February has 28 or 29.
- **Deductions** start as the same share for approved **unpaid** leave in the month (leave across a month end counts only the days in the month), and the note says so. A manager can change them while the record is a draft (not more than the pay); net is pay less deductions.
- **Days present and paid and unpaid leave** are recorded on the record for reference.
- **Finalizing** locks the record. It is refused while leave in that month is still waiting, and **nobody finalizes their own pay** except a Super Admin. From then on, for that person and month, **attendance cannot be corrected, and leave cannot be approved, requested or withdrawn** (the database guards attendance and the record itself).
- Payroll can only be made once the month is over.

This module only **records** payroll. It does not pay anyone, calculate tax or provident fund, or export a payslip.

## Endpoints

`/staff` (list, `me`, `departments`, `candidates`, one, create, edit, `deactivate`, `reactivate`), `/attendance` (`me`, `check-in`, `check-out`, list, `correct`), `/leave` (list, one, ask, `approve`, `reject`, `cancel`), `/payroll` (list with totals, one, `generate`, edit deductions, `finalize`). Audit actions: `STAFF_*`, `ATTENDANCE_CORRECTED`, `LEAVE_*`, `PAYROLL_*`; events `leave.requested`, `leave.approved`, `leave.rejected`, `payroll.finalized`. Self check-ins and check-outs are not audited (they are the record itself).

## Screens

One **HR** page with tabs: **My day** (check in and out, the month so far, for those who may mark attendance), **Leave**, **Attendance**, **Payroll** and **Staff**. Managers get the buttons to add and edit people, mark them as left, correct attendance, decide leave, make payroll, change deductions and finalize.

## Database (migration 19, `20261007001900_staff_hr`)

New columns on `staff`, `leave_requests`, `attendance` and `payroll_records`, and guards: leave never overlaps and moves only along allowed statuses; attendance only for the days a person worked here; a shift is at most a day; a payroll record is made for someone employed in its month, cannot change what it was worked out on, and is frozen once final. Existing rows (the application never made any) are given safe values.

## Decisions and limits

- **Privacy of salaries:** `hr.view` without `hr.manage` shows only your own records (above). Say if Staff should not see their own pay either.
- **Pro-rata by calendar days** and **default deduction for unpaid leave** are my rules, easy to change in `PayrollService.generate`; the requirements give no pay policy. Statutory deductions, overtime, holidays and weekly offs are not modelled.
- Check-in uses the server's clock and has no location or device check.
- A returning person starts again on a new join date; their earlier period stays in the records but is not a separate employment history.
- Logins are not disabled when someone is marked as having left.
- No export, payslip PDF or notifications (module 5.2); the leave events are queued for them.
