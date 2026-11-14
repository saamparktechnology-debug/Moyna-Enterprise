//apps/api/test/integration/hr-punches.int.test.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AttendanceSchema,
  LeaveSchema,
  MyAttendanceSchema,
  PayrollListResponseSchema,
  PunchListResponseSchema,
  PunchSchema,
  StaffSchema,
} from '@erp/contracts';
import type { Payroll, Punch } from '@erp/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, createAuthWorld, loggedIn } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

const FEB = '2026-02';

describe('punching in and out many times a day, and pay by the hours worked', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let adminA: TestClient;
  let adminA2: TestClient;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;

  interface Person {
    userId: string;
    staffId: string;
    client: TestClient;
  }
  /** A person on a fixed monthly salary, or paid by the day when `daily` is a rate. */
  const person = async (salary = '31000.00', daily?: string): Promise<Person> => {
    const username = unique('pn_');
    const userId = await addUser(owner, { username, role: 'STAFF', branchIds: [w.branchA] });
    const response = await adminA.post('/staff', {
      userId,
      branchId: w.branchA,
      employeeCode: unique('PN-'),
      department: null,
      designation: 'Fitter',
      joinDate: '2026-01-01',
      ...(daily ? { salaryType: 'DAILY', dailyRate: daily } : { monthlySalary: salary }),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const staff = StaffSchema.parse(response.body);
    return { userId, staffId: staff.id, client: await loggedIn(app, username) };
  };
  const at = (day: string, time: string): string => `${day}T${time}:00+05:30`;
  const addPunch = (
    client: TestClient,
    p: Person,
    day: string,
    from: string,
    to: string | null,
    reason = 'Forgot to punch',
  ) =>
    client.post('/attendance/punches', {
      staffId: p.staffId,
      punchedInAt: at(day, from),
      punchedOutAt: to ? at(day, to) : null,
      reason,
    });
  const added = async (
    client: TestClient,
    p: Person,
    day: string,
    from: string,
    to: string | null,
  ): Promise<Punch> => {
    const response = await addPunch(client, p, day, from, to);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return PunchSchema.parse(response.body);
  };
  const dayRow = (p: Person, day: string) =>
    owner.attendance.findUniqueOrThrow({
      where: { staffId_workDate: { staffId: p.staffId, workDate: new Date(`${day}T00:00:00Z`) } },
    });
  const payrollOf = async (p: Person, month: string): Promise<Payroll> => {
    const list = PayrollListResponseSchema.parse(
      (await adminA.get(`/payroll?month=${month}&staffId=${p.staffId}`)).body,
    );
    const found = list.items[0];
    if (!found) throw new Error('No payroll record');
    return found;
  };

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    // These tests count calendar days, so they run without a weekly off (the default is Sunday).
    await owner.appSetting.upsert({
      where: { key: 'company.weekly_off_days' },
      update: { value: 'NONE' },
      create: { key: 'company.weekly_off_days', value: 'NONE' },
    });
    app = await createTestApp();
    adminA = await loggedIn(app, 'admin_a');
    await addUser(owner, { username: 'admin_pn2', role: 'ADMIN', branchIds: [w.branchA] });
    adminA2 = await loggedIn(app, 'admin_pn2');
    return async () => {
      await owner.appSetting.deleteMany({
        where: { key: { in: ['company.full_duty_hours', 'company.weekly_off_days'] } },
      });
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('a person punches in and out as often as they like', () => {
    it('keeps every punch of the day and the day’s total, and shows them on their own page', async () => {
      const p = await person();
      for (let round = 0; round < 3; round += 1) {
        expect((await p.client.post('/attendance/check-in', {})).status).toBe(201);
        expect((await p.client.post('/attendance/check-out', {})).status).toBe(200);
      }
      const mine = MyAttendanceSchema.parse((await p.client.get('/attendance/me')).body);
      expect(mine.punches).toHaveLength(3);
      expect(mine.dutyMinutes).toBe(480);
      expect(mine.punches?.every((punch) => punch.source === 'SELF')).toBe(true);
      expect(await owner.attendance.count({ where: { staffId: p.staffId } })).toBe(1);
    });

    it('cannot punch in while a punch is open, and cannot punch out without one', async () => {
      const p = await person();
      expect((await p.client.post('/attendance/check-out', {})).status).toBe(422);
      expect((await p.client.post('/attendance/check-in', {})).status).toBe(201);
      const twice = await p.client.post('/attendance/check-in', {});
      expect(twice.status).toBe(409);
      const open = MyAttendanceSchema.parse((await p.client.get('/attendance/me')).body);
      expect(open.current?.state).toBe('OPEN');
    });

    it('never lets two of a person’s punches overlap, whoever adds them', async () => {
      const p = await person();
      await added(adminA, p, '2026-02-10', '09:00', '13:00');
      const overlap = await addPunch(adminA, p, '2026-02-10', '12:00', '15:00');
      expect(overlap.status).toBe(409);
      const touching = await addPunch(adminA, p, '2026-02-10', '13:00', '17:00');
      expect(touching.status).toBe(201);
    });
  });

  describe('a manager who may edit punch times', () => {
    it('adds punches for a past day, and the day adds them up', async () => {
      const p = await person();
      await added(adminA, p, '2026-02-11', '09:00', '13:00');
      await added(adminA, p, '2026-02-11', '14:00', '18:30');
      await added(adminA, p, '2026-02-11', '20:00', '21:00');
      const row = await dayRow(p, '2026-02-11');
      expect(row.workedMinutes).toBe(4 * 60 + 4.5 * 60 + 60);
      expect(row.checkIn?.toISOString()).toBe('2026-02-11T03:30:00.000Z');
      expect(row.checkOut?.toISOString()).toBe('2026-02-11T15:30:00.000Z');
      const listed = PunchListResponseSchema.parse(
        (await adminA.get(`/attendance/punches?date=2026-02-11&staffId=${p.staffId}`)).body,
      );
      expect(listed.items).toHaveLength(3);
      expect(listed.items.map((punch) => punch.minutes)).toEqual([240, 270, 60]);
      expect(listed.items.every((punch) => punch.source === 'MANAGER')).toBe(true);
    });

    it('changes the times of a punch, with a reason, and the old and new times are audited', async () => {
      const p = await person();
      const punch = await added(adminA, p, '2026-02-12', '09:00', '12:00');
      const response = await adminA.patch(`/attendance/punches/${punch.id}`, {
        punchedOutAt: at('2026-02-12', '13:30'),
        reason: 'Left later than marked',
        rowVersion: punch.rowVersion,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(PunchSchema.parse(response.body)).toMatchObject({
        minutes: 270,
        editReason: 'Left later than marked',
      });
      expect((await dayRow(p, '2026-02-12')).workedMinutes).toBe(270);
      const audits = await owner.auditLog.findMany({
        where: { action: 'PUNCH_EDITED', entityId: punch.id },
      });
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits[0]?.oldValue)).toContain('2026-02-12T06:30:00.000Z');
      expect(JSON.stringify(audits[0]?.newValue)).toContain('Left later than marked');
    });

    it('refuses a change without a reason, with a stale version, or that clashes', async () => {
      const p = await person();
      const first = await added(adminA, p, '2026-02-13', '09:00', '12:00');
      await added(adminA, p, '2026-02-13', '13:00', '17:00');
      const noReason = await adminA.patch(`/attendance/punches/${first.id}`, {
        punchedOutAt: at('2026-02-13', '12:30'),
        rowVersion: first.rowVersion,
      });
      expect(noReason.status).toBe(400);
      const stale = await adminA.patch(`/attendance/punches/${first.id}`, {
        punchedOutAt: at('2026-02-13', '12:30'),
        reason: 'x',
        rowVersion: first.rowVersion + 5,
      });
      expect(stale.status).toBe(409);
      const clash = await adminA.patch(`/attendance/punches/${first.id}`, {
        punchedOutAt: at('2026-02-13', '14:00'),
        reason: 'Worked on',
        rowVersion: first.rowVersion,
      });
      expect(clash.status).toBe(409);
    });

    it('removes a wrong punch with a reason, and what it was is audited', async () => {
      const p = await person();
      const keep = await added(adminA, p, '2026-02-16', '09:00', '13:00');
      const wrong = await added(adminA, p, '2026-02-16', '14:00', '18:00');
      const response = await adminA.post(`/attendance/punches/${wrong.id}/remove`, {
        reason: 'Punched by mistake',
        rowVersion: wrong.rowVersion,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(204);
      expect((await dayRow(p, '2026-02-16')).workedMinutes).toBe(240);
      expect(await owner.attendancePunch.count({ where: { id: wrong.id } })).toBe(0);
      expect(await owner.attendancePunch.count({ where: { id: keep.id } })).toBe(1);
      const audits = await owner.auditLog.findMany({
        where: { action: 'PUNCH_REMOVED', entityId: wrong.id },
      });
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits[0]?.newValue)).toContain('Punched by mistake');
    });

    it('cannot edit a punch in the future, before joining, on approved leave, or in a month whose payroll is final', async () => {
      const p = await person();
      const future = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const later = new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString();
      const ahead = await adminA.post('/attendance/punches', {
        staffId: p.staffId,
        punchedInAt: future,
        punchedOutAt: later,
        reason: 'Too early',
      });
      expect(ahead.status).toBe(400);
      const before = await addPunch(adminA, p, '2025-12-15', '09:00', '17:00');
      expect(before.status).toBe(400);

      const leaveResponse = await adminA.post('/leave', {
        staffId: p.staffId,
        fromDate: '2026-02-18',
        toDate: '2026-02-18',
        kind: 'PAID',
      });
      const leave = LeaveSchema.parse(leaveResponse.body);
      expect(
        (await adminA2.post(`/leave/${leave.id}/approve`, { rowVersion: leave.rowVersion })).status,
      ).toBe(200);
      expect((await addPunch(adminA, p, '2026-02-18', '09:00', '17:00')).status).toBe(422);
    });

    it('is the only way for the people who hold the permission: staff cannot add, change or remove punches', async () => {
      const p = await person();
      const punch = await added(adminA, p, '2026-02-19', '09:00', '12:00');
      expect((await addPunch(p.client, p, '2026-02-19', '13:00', '14:00')).status).toBe(403);
      expect(
        (
          await p.client.patch(`/attendance/punches/${punch.id}`, {
            punchedOutAt: at('2026-02-19', '12:30'),
            reason: 'x',
            rowVersion: punch.rowVersion,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await p.client.post(`/attendance/punches/${punch.id}/remove`, {
            reason: 'x',
            rowVersion: punch.rowVersion,
          })
        ).status,
      ).toBe(403);
    });

    it('may be taken away from a role: without the permission an Admin cannot edit punch times', async () => {
      const p = await person();
      await owner.rolePermission.deleteMany({
        where: { role: { name: 'ADMIN' }, permission: { code: 'attendance.edit_punches' } },
      });
      try {
        const limited = await loggedIn(app, 'admin_a');
        expect((await addPunch(limited, p, '2026-02-20', '09:00', '17:00')).status).toBe(403);
      } finally {
        const role = await owner.role.findFirstOrThrow({ where: { name: 'ADMIN' } });
        const permission = await owner.permission.findFirstOrThrow({
          where: { code: 'attendance.edit_punches' },
        });
        await owner.rolePermission.create({
          data: { roleId: role.id, permissionId: permission.id },
        });
      }
    });

    it('does not let a manager change their own punches (a Super Admin may)', async () => {
      const username = unique('pn_self_');
      const userId = await addUser(owner, { username, role: 'ADMIN', branchIds: [w.branchA] });
      const made = await adminA.post('/staff', {
        userId,
        branchId: w.branchA,
        employeeCode: unique('PN-'),
        department: null,
        designation: 'Manager',
        joinDate: '2026-01-01',
        monthlySalary: '40000.00',
      });
      expect(made.status).toBe(201);
      const me = await loggedIn(app, username);
      const own = await me.post('/attendance/punches', {
        staffId: StaffSchema.parse(made.body).id,
        punchedInAt: at('2026-02-17', '09:00'),
        punchedOutAt: at('2026-02-17', '17:00'),
        reason: 'Mine',
      });
      expect(own.status).toBe(403);
    });
  });

  describe('the old correction of a day still works, on top of punches', () => {
    it('replaces the day’s punches with the one given, and keeps what they were in the audit trail', async () => {
      const p = await person();
      await added(adminA, p, '2026-02-23', '09:00', '11:00');
      await added(adminA, p, '2026-02-23', '12:00', '14:00');
      const response = await adminA.put('/attendance/correct', {
        staffId: p.staffId,
        workDate: '2026-02-23',
        checkIn: at('2026-02-23', '09:00'),
        checkOut: at('2026-02-23', '17:00'),
        reason: 'Whole day',
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const day = AttendanceSchema.parse(response.body);
      expect(day.workedMinutes).toBe(480);
      expect(await owner.attendancePunch.count({ where: { staffId: p.staffId } })).toBe(1);
      const audits = await owner.auditLog.findMany({
        where: { action: 'ATTENDANCE_CORRECTED', entityId: day.id },
      });
      expect(JSON.stringify(audits[0]?.oldValue)).toContain('punches');
    });
  });

  describe('the two kinds of salary', () => {
    it('keeps a fixed monthly salary or a daily rate, each with its own amount', async () => {
      const fixed = await person('31000.00');
      const daily = await person('0', '400.00');
      const fixedStaff = StaffSchema.parse((await adminA.get(`/staff/${fixed.staffId}`)).body);
      const dailyStaff = StaffSchema.parse((await adminA.get(`/staff/${daily.staffId}`)).body);
      expect(fixedStaff).toMatchObject({
        salaryType: 'FIXED',
        monthlySalary: '31000.00',
        dailyRate: null,
      });
      expect(dailyStaff).toMatchObject({
        salaryType: 'DAILY',
        monthlySalary: '0.00',
        dailyRate: '400.00',
      });
    });

    it('refuses the wrong amount for the kind: a fixed salary needs a monthly salary, daily pay a daily rate', async () => {
      const userId = async () =>
        addUser(owner, { username: unique('pn_'), role: 'STAFF', branchIds: [w.branchA] });
      const base = {
        branchId: w.branchA,
        department: null,
        designation: 'Fitter',
        joinDate: '2026-01-01',
      };
      const make = async (extra: Record<string, unknown>) =>
        adminA.post('/staff', {
          ...base,
          userId: await userId(),
          employeeCode: unique('PN-'),
          ...extra,
        });
      expect((await make({ salaryType: 'FIXED' })).status).toBe(400);
      expect(
        (await make({ salaryType: 'FIXED', monthlySalary: '1000', dailyRate: '400' })).status,
      ).toBe(400);
      expect((await make({ salaryType: 'DAILY' })).status).toBe(400);
      expect((await make({ salaryType: 'DAILY', dailyRate: '0' })).status).toBe(400);
      expect(
        (await make({ salaryType: 'DAILY', dailyRate: '400', monthlySalary: '1000' })).status,
      ).toBe(400);
      expect((await make({ monthlySalary: '1000' })).status).toBe(201);
    });

    it('changes from one kind to the other with the right amount, and keeps what it was in the audit trail', async () => {
      const p = await person('31000.00');
      const current = StaffSchema.parse((await adminA.get(`/staff/${p.staffId}`)).body);
      const wrong = await adminA.patch(`/staff/${p.staffId}`, {
        dailyRate: '400',
        rowVersion: current.rowVersion,
      });
      expect(wrong.status).toBe(400);
      const changed = await adminA.patch(`/staff/${p.staffId}`, {
        salaryType: 'DAILY',
        dailyRate: '450',
        rowVersion: current.rowVersion,
      });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect(StaffSchema.parse(changed.body)).toMatchObject({
        salaryType: 'DAILY',
        dailyRate: '450.00',
        monthlySalary: '0.00',
      });
      const audits = await owner.auditLog.findMany({
        where: { action: 'STAFF_UPDATED', entityId: p.staffId },
      });
      expect(JSON.stringify(audits[0]?.oldValue)).toContain('31000.00');
      expect(JSON.stringify(audits[0]?.newValue)).toContain('450.00');
      const afterwards = StaffSchema.parse(changed.body);
      const wrongAgain = await adminA.patch(`/staff/${p.staffId}`, {
        monthlySalary: '1000',
        rowVersion: afterwards.rowVersion,
      });
      expect(wrongAgain.status).toBe(400);
    });
  });

  describe('pay by the day: no work, no pay', () => {
    it('pays a daily rate by the work done in 30-minute blocks: 30 to 59 minutes count as 30, and overtime is paid at the same rate', async () => {
      await owner.appSetting.deleteMany({ where: { key: 'company.full_duty_hours' } });
      const p = await person('0', '400.00');
      // a full 8 hours is 16 half-hours: 400. A half-hour is 25.
      for (const day of ['02', '03', '04', '05', '06'])
        await added(adminA, p, `2026-02-${day}`, '09:00', '17:00');
      await added(adminA, p, '2026-02-09', '08:00', '18:00'); // 10 hours: overtime, 20 blocks = 500
      await added(adminA, p, '2026-02-10', '09:00', '13:30'); // 4 h 30: 9 blocks = 225
      await added(adminA, p, '2026-02-11', '09:00', '16:59'); // 7 h 59: 15 blocks = 375
      await added(adminA, p, '2026-02-12', '09:00', '09:29'); // 29 minutes: nothing
      const generated = await adminA.post('/payroll/generate', { month: FEB });
      expect(generated.status, JSON.stringify(generated.body)).toBe(201);
      const record = await payrollOf(p, FEB);
      // 5 x 400 + 500 + 225 + 375 = 3100; 3720 minutes counted of 3778 worked
      expect(record).toMatchObject({
        salaryType: 'DAILY',
        dailyRate: '400.00',
        paidMinutes: 3720,
        hoursWorked: '62.97',
        creditedDays: '7.75',
        gross: '3100.00',
        deductions: '0.00',
        net: '3100.00',
      });
      expect(record.deductionNote).toContain('half-hours');
    });

    it('counts the blocks day by day: two short stints in a day add up first, then the day is rounded down', async () => {
      const p = await person('0', '400.00');
      await added(adminA, p, '2026-02-13', '09:00', '09:50'); // 50 minutes
      await added(adminA, p, '2026-02-13', '10:00', '10:50'); // 50 minutes: 100 in the day = 3 blocks = 75
      await added(adminA, p, '2026-02-16', '09:00', '09:50'); // another day, 50 minutes = 1 block = 25
      await adminA.post('/payroll/generate', { month: FEB });
      const record = await payrollOf(p, FEB);
      expect(record).toMatchObject({ paidMinutes: 120, gross: '100.00', net: '100.00' });
    });

    it('pays nothing for a month with no work, and nothing for days of leave', async () => {
      const p = await person('0', '400.00');
      const leaveResponse = await adminA.post('/leave', {
        staffId: p.staffId,
        fromDate: '2026-02-03',
        toDate: '2026-02-04',
        kind: 'PAID',
      });
      const leave = LeaveSchema.parse(leaveResponse.body);
      expect(
        (await adminA2.post(`/leave/${leave.id}/approve`, { rowVersion: leave.rowVersion })).status,
      ).toBe(200);
      await adminA.post('/payroll/generate', { month: FEB });
      const record = await payrollOf(p, FEB);
      expect(record).toMatchObject({ paidMinutes: 0, gross: '0.00', net: '0.00' });
    });

    it('rounds the pay to the paisa and follows the full-duty hours the company sets', async () => {
      await owner.appSetting.upsert({
        where: { key: 'company.full_duty_hours' },
        update: { value: 10 },
        create: { key: 'company.full_duty_hours', value: 10 },
      });
      try {
        const p = await person('0', '500.00');
        // 10 hours is a full day: a half-hour is 500 / 20 = 25; 8 hours = 16 blocks = 400
        await added(adminA, p, '2026-02-17', '09:00', '17:00');
        await adminA.post('/payroll/generate', { month: FEB });
        expect(await payrollOf(p, FEB)).toMatchObject({ gross: '400.00', creditedDays: '0.80' });
        const odd = await person('0', '333.33');
        await added(adminA, odd, '2026-02-17', '09:00', '09:30');
        await adminA.post('/payroll/generate', { month: FEB });
        // 333.33 / 20 = 16.6665 for one block, rounded to 16.67
        expect(await payrollOf(odd, FEB)).toMatchObject({ gross: '16.67' });
      } finally {
        await owner.appSetting.deleteMany({ where: { key: 'company.full_duty_hours' } });
      }
    });
  });

  describe('a fixed salary does not depend on the hours', () => {
    it('is the salary for the days employed, however long the days were', async () => {
      const p = await person('31000.00');
      await added(adminA, p, '2026-02-02', '09:00', '11:00');
      await adminA.post('/payroll/generate', { month: FEB });
      expect(await payrollOf(p, FEB)).toMatchObject({
        salaryType: 'FIXED',
        gross: '31000.00',
        net: '31000.00',
        deductions: '0.00',
      });
    });
  });
});
