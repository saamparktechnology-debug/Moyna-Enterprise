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

## Punches and pay by hours (chunk 8)

- **Punch in and out as often as needed.** Each time is one punch; a person has at most one open at a time and punches never overlap. A working day is still the India date of the punch in, so a night shift stays on the day it began. The day's attendance row shows the first punch in, the last punch out and the minutes worked.
- **Editing punches** needs the permission `attendance.edit_punches` (Admin and Super Admin by default; give it to or take it from a role in Users and roles). Add, change or remove a punch with a reason; the old and new times are audited. Not for a future day, before the person joined, after they left, on approved leave or in a month whose payroll is final, and not your own punches (a Super Admin may). The older "Correct attendance" replaces a day's punches with one.
- **Pay** depends on the person's kind of salary: see "Two kinds of salary" below. (The company setting "Pay basis" of chunk 8 was removed.)

## Two kinds of salary (chunk 12)

Each person is paid in one of two ways, chosen on their staff profile (Staff, Add or Edit):

- **Fixed monthly salary.** The salary for the days employed in the month, less unpaid leave. The hours worked do not change it.
- **Paid by the day (no work, no pay).** A **daily rate** (for example 400 rupees) is the pay for a **full duty day** (8 hours unless the company sets another number in Settings, Company: Full duty, in hours). The work of each day is added up from its punches and counted in **whole 30-minute blocks**: 30 to 59 minutes count as 30, so 59 minutes is paid as 30 and 29 minutes as nothing. Each block pays the daily rate times 30 and divided by the full-duty minutes (400 a day is 25 for each half-hour). **Hours beyond full duty are paid at the same rate**, with no cap. A day with no work earns nothing, and a day of leave earns nothing. The month's pay is the total of the blocks, rounded to the paisa; payroll shows the hours worked, the minutes paid for and the daily rate.

A person can be changed from one kind to the other (the right amount goes with each); what it was is kept in the audit trail. Payroll already made for a month does not change.

## Employee agreements (chunk 10)

An agreement paper for each employee, with **terms and rules that can be edited**.

1. **Templates** (HR, Agreements, Templates): keep the terms you use often. "Start from example terms" gives a starting text only; have your own adviser check the wording. A template can be edited or switched off; changing it does not change agreements already made.
2. **New agreement**: choose the employee and a template (or write the terms yourself) and the date it starts. The text is filled in and **can be edited** before printing. Details written as `{{employee_name}}`, `{{employee_code}}`, `{{designation}}`, `{{department}}`, `{{join_date}}`, `{{salary}}`, `{{duty_hours}}`, `{{effective_from}}`, `{{company_name}}`, `{{company_address}}`, `{{proprietor}}` and `{{today}}` are filled in for the employee when it is printed (use the buttons under the text). A name that is not one of these is refused so a typo cannot print as it is.
3. **Print** the draft (a PDF with the company's heading and the agreement number `AG-ddmmyyyyhhmm`). At the end are two places to sign: **the employee on the left, the Super Admin on the right**.
4. After both have signed the paper, **Upload signed copy** (a PDF, JPEG or PNG scan or photo, up to 5 MB, with the date it was signed and a tick for each of the two signatures). This is the acceptance. The agreement is then **frozen** as signed, with its details filled in as they were that day (the database refuses any later change); it can only be ended.
5. **One agreement in force at a time.** Signing a new agreement for a person ends the one before it the day before the new one starts. **End** an agreement from a day with a reason (for example when the employee leaves). A draft that is not needed can be **thrown away** with a reason and stays in the list as discarded.
6. **The employee** sees their own signed agreements under "My agreement" on their page and can read, print and open the signed copy. Drafts are not shown to them. Who opened a signed copy is recorded.

Needs `hr.manage` to make, edit, upload, end and see all agreements; `hr.view` for an employee's own. The signed copies are kept in the same file store as customer KYC files (local disk unless the file store is changed). Audit: `AGREEMENT_CREATED`, `_UPDATED`, `_DISCARDED`, `_SIGNED`, `_ENDED`, `_COPY_VIEWED`, `AGREEMENT_TEMPLATE_CREATED` and `_UPDATED`.

## Weekly offs, holidays and each person's roster (chunk 15)

- **The company's weekly off days** (Settings, Company: *Weekly off days*): `SUN` by default; `SAT,SUN` for two days; `NONE` for no weekly off. **Pay daily staff for off days** (`YES` or `NO`, default `NO`) decides whether a person paid by the day is paid for the off days they do not work. Only the Super Admin can change settings.
- **Company holidays** (HR, Holidays tab): a list for each year. Anyone who may see HR can read it; only the **Super Admin** adds or removes a holiday (a day can be a holiday once; the change is audited as `HOLIDAY_ADDED` and `HOLIDAY_REMOVED`).
- **The roster of one employee** (HR, Staff, **Roster**, Super Admin only): the Super Admin can give a person **weekly off days of their own** (for example only Wednesday, or none) or hand them back to the company's, and can add **days off for that person alone** (with a reason). Managers can read a roster; they cannot change it. Audit: `STAFF_WEEKLY_OFF_SET`, `STAFF_DAY_OFF_ADDED`, `STAFF_DAY_OFF_REMOVED`. A day off cannot be added or removed in a month whose pay for that person is final, or before they joined or after they left.
- **Which rule wins for a day:** the person's own day off, then a company holiday, then their weekly off (their own days if they have set ones, else the company's).
- **Effect on pay (applies when a payroll is made; one already made keeps what it had):**
  - *Fixed salary*: not changed, except that **leave taken over an off day is not counted as leave** (so an unpaid leave from Friday to Monday with a Sunday off counts 3 days, not 4).
  - *Paid by the day*: paid for the hours worked, also on an off day. With **Pay daily staff for off days = YES** each off day they did not work adds one full duty day at the daily rate; the payroll note says "including N weekly off or holiday days". With NO (the default) nothing is added.
- **On their own day** (HR, My day) a person is told when today is a holiday, their weekly off or a day off of their own. They can still punch in if asked to work; the hours then count as normal.
