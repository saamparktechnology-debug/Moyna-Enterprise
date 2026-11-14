//apps/api/test/integration/hr-holidays.int.test.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  HolidayListResponseSchema,
  HolidaySchema,
  LeaveSchema,
  MyAttendanceSchema,
  PayrollListResponseSchema,
  RosterSchema,
  StaffSchema,
} from '@erp/contracts';
import type { Payroll } from '@erp/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

const FEB = '2026-02';
const SETTINGS = ['company.weekly_off_days', 'company.pay_off_days_daily'];

describe('weekly offs, holidays and the roster of each employee', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let adminA2: TestClient;
  let adminB: TestClient;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;

  const setting = (key: string, value: string) =>
    owner.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  const person = async (salary = '28000.00', daily?: string) => {
    const username = unique('ho_');
    const userId = await addUser(owner, { username, role: 'STAFF', branchIds: [w.branchA] });
    const response = await adminA.post('/staff', {
      userId,
      branchId: w.branchA,
      employeeCode: unique('HO-'),
      department: null,
      designation: 'Fitter',
      joinDate: '2026-01-01',
      ...(daily ? { salaryType: 'DAILY', dailyRate: daily } : { monthlySalary: salary }),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return { userId, staff: StaffSchema.parse(response.body), username };
  };
  const punch = (staffId: string, day: string, from: string, to: string) =>
    adminA.post('/attendance/punches', {
      staffId,
      punchedInAt: `${day}T${from}:00+05:30`,
      punchedOutAt: `${day}T${to}:00+05:30`,
      reason: 'Forgot to punch',
    });
  const payrollOf = async (staffId: string): Promise<Payroll> => {
    const list = PayrollListResponseSchema.parse(
      (await adminA.get(`/payroll?month=${FEB}&staffId=${staffId}`)).body,
    );
    const found = list.items[0];
    if (!found) throw new Error('No payroll record');
    return found;
  };
  const roster = async (staffId: string) =>
    RosterSchema.parse((await adminA.get(`/staff/${staffId}/roster?year=2026`)).body);

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    adminB = await loggedIn(app, 'admin_b');
    await addUser(owner, { username: 'admin_ho2', role: 'ADMIN', branchIds: [w.branchA] });
    adminA2 = await loggedIn(app, 'admin_ho2');
    return async () => {
      await owner.appSetting.deleteMany({ where: { key: { in: SETTINGS } } });
      await owner.staffDayOff.deleteMany({});
      await owner.holiday.deleteMany({});
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('the company holidays', () => {
    it('are set by the Super Admin only, and read by anyone who may see HR', async () => {
      const added = await superAdmin.post('/holidays', {
        date: '2026-08-15',
        name: 'Independence Day',
      });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      const holiday = HolidaySchema.parse(added.body);
      expect(holiday).toMatchObject({ date: '2026-08-15', name: 'Independence Day' });
      expect((await adminA.post('/holidays', { date: '2026-08-16', name: 'No' })).status).toBe(403);
      expect((await adminA.delete(`/holidays/${holiday.id}`)).status).toBe(403);
      const list = HolidayListResponseSchema.parse((await adminA.get('/holidays?year=2026')).body);
      expect(list.items.map((item) => item.date)).toContain('2026-08-15');
      expect(list.weeklyOffDays).toEqual(['SUN']);
      expect(list.paidForDailyStaff).toBe(false);
      expect(
        HolidayListResponseSchema.parse((await adminA.get('/holidays?year=2027')).body).items,
      ).toHaveLength(0);
    });

    it('refuse the same day twice, a bad date and a blank name, and can be removed', async () => {
      const first = await superAdmin.post('/holidays', {
        date: '2026-10-02',
        name: 'Gandhi Jayanti',
      });
      expect(first.status).toBe(201);
      expect(
        (await superAdmin.post('/holidays', { date: '2026-10-02', name: 'Again' })).status,
      ).toBe(409);
      expect((await superAdmin.post('/holidays', { date: '2026-02-30', name: 'Bad' })).status).toBe(
        400,
      );
      expect((await superAdmin.post('/holidays', { date: '2026-10-03', name: '  ' })).status).toBe(
        400,
      );
      const id = HolidaySchema.parse(first.body).id;
      expect((await superAdmin.delete(`/holidays/${id}`)).status).toBe(200);
      expect((await superAdmin.delete(`/holidays/${id}`)).status).toBe(404);
      const actions = await owner.auditLog.findMany({
        where: { entityId: id },
        orderBy: { createdAt: 'asc' },
      });
      expect(actions.map((entry) => entry.action)).toEqual(['HOLIDAY_ADDED', 'HOLIDAY_REMOVED']);
    });

    it('accept only real weekly off days in the company setting', async () => {
      for (const bad of ['FUNDAY', 'SUN,SUN', 'SUN,']) {
        const response = await superAdmin.put('/settings/company.weekly_off_days', { value: bad });
        expect(response.status, bad).toBe(400);
      }
      const good = await superAdmin.put('/settings/company.weekly_off_days', {
        value: ' sat , sun ',
      });
      expect(good.status, JSON.stringify(good.body)).toBe(200);
      expect(
        HolidayListResponseSchema.parse((await adminA.get('/holidays?year=2026')).body)
          .weeklyOffDays,
      ).toEqual(['SAT', 'SUN']);
      await owner.appSetting.deleteMany({ where: { key: 'company.weekly_off_days' } });
    });
  });

  describe('pay for someone paid by the day', () => {
    it('is for the hours worked only when daily staff are not paid for off days, even on a Sunday', async () => {
      await setting('company.weekly_off_days', 'SUN');
      await setting('company.pay_off_days_daily', 'NO');
      const p = await person('0', '400.00');
      await punch(p.staff.id, '2026-02-02', '09:00', '17:00');
      await punch(p.staff.id, '2026-02-08', '09:00', '13:00');
      await adminA.post('/payroll/generate', { month: FEB });
      expect(await payrollOf(p.staff.id)).toMatchObject({ gross: '600.00', paidMinutes: 720 });
    });

    it('adds a full day for each weekly off and holiday not worked when the Super Admin pays daily staff for them', async () => {
      await setting('company.weekly_off_days', 'SUN');
      await setting('company.pay_off_days_daily', 'YES');
      const holiday = await superAdmin.post('/holidays', {
        date: '2026-02-26',
        name: 'Test holiday',
      });
      expect(holiday.status, JSON.stringify(holiday.body)).toBe(201);
      const p = await person('0', '400.00');
      await punch(p.staff.id, '2026-02-02', '09:00', '17:00'); // 400
      await punch(p.staff.id, '2026-02-08', '09:00', '13:00'); // a Sunday worked: 4 hours = 200
      await adminA.post('/payroll/generate', { month: FEB });
      const record = await payrollOf(p.staff.id);
      // Sundays 1, 15 and 22 are unworked (3 days) and 26 Feb is a holiday: 4 x 400 = 1600, plus 400 and 200
      expect(record).toMatchObject({ gross: '2200.00', net: '2200.00' });
      expect(record.deductionNote).toContain('including 4 weekly off or holiday days');
    });

    it('does not pay a person with a fixed salary any differently for off days', async () => {
      await setting('company.pay_off_days_daily', 'YES');
      const p = await person('28000.00');
      await adminA.post('/payroll/generate', { month: FEB });
      expect(await payrollOf(p.staff.id)).toMatchObject({ gross: '28000.00', deductions: '0.00' });
    });
  });

  describe('the roster of one employee', () => {
    it('is set by the Super Admin: their own weekly off days replace the company’s, and null hands them back', async () => {
      await setting('company.weekly_off_days', 'SUN');
      await setting('company.pay_off_days_daily', 'YES');
      await owner.holiday.deleteMany({});
      const p = await person('0', '400.00');
      const before = await roster(p.staff.id);
      expect(before).toMatchObject({
        ownWeeklyOff: null,
        weeklyOffDays: ['SUN'],
        companyWeeklyOffDays: ['SUN'],
      });
      const set = await superAdmin.put(`/staff/${p.staff.id}/roster/weekly-off`, {
        weeklyOffDays: ['SAT', 'WED'],
        rowVersion: before.rowVersion,
      });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      const after = RosterSchema.parse(set.body);
      expect(after).toMatchObject({ ownWeeklyOff: ['WED', 'SAT'], weeklyOffDays: ['WED', 'SAT'] });
      expect(
        StaffSchema.parse((await adminA.get(`/staff/${p.staff.id}`)).body).weeklyOffDays,
      ).toEqual(['WED', 'SAT']);
      // February 2026 has 4 Wednesdays (4, 11, 18, 25) and 4 Saturdays (7, 14, 21, 28): 8 days, none worked
      await adminA.post('/payroll/generate', { month: FEB });
      expect(await payrollOf(p.staff.id)).toMatchObject({ gross: '3200.00' });
      const stale = await superAdmin.put(`/staff/${p.staff.id}/roster/weekly-off`, {
        weeklyOffDays: null,
        rowVersion: before.rowVersion,
      });
      expect(stale.status).toBe(409);
      const none = await superAdmin.put(`/staff/${p.staff.id}/roster/weekly-off`, {
        weeklyOffDays: [],
        rowVersion: after.rowVersion,
      });
      expect(RosterSchema.parse(none.body)).toMatchObject({ ownWeeklyOff: [], weeklyOffDays: [] });
      const reset = await superAdmin.put(`/staff/${p.staff.id}/roster/weekly-off`, {
        weeklyOffDays: null,
        rowVersion: RosterSchema.parse(none.body).rowVersion,
      });
      expect(RosterSchema.parse(reset.body)).toMatchObject({
        ownWeeklyOff: null,
        weeklyOffDays: ['SUN'],
      });
      const actions = await owner.auditLog.findMany({
        where: { entityId: p.staff.id, action: 'STAFF_WEEKLY_OFF_SET' },
      });
      expect(actions).toHaveLength(3);
    });

    it('lets managers read it but not change it, and keeps other branches out', async () => {
      const p = await person();
      const current = await roster(p.staff.id);
      const body = { weeklyOffDays: ['MON'], rowVersion: current.rowVersion };
      expect((await adminA.put(`/staff/${p.staff.id}/roster/weekly-off`, body)).status).toBe(403);
      expect(
        (await adminA.post(`/staff/${p.staff.id}/roster/days-off`, { date: '2026-02-10' })).status,
      ).toBe(403);
      expect((await adminB.get(`/staff/${p.staff.id}/roster`)).status).toBe(404);
      const twice = await superAdmin.put(`/staff/${p.staff.id}/roster/weekly-off`, {
        weeklyOffDays: ['MON', 'MON'],
        rowVersion: current.rowVersion,
      });
      expect(RosterSchema.parse(twice.body).ownWeeklyOff).toEqual(['MON']);
      expect(
        (
          await superAdmin.put(`/staff/${p.staff.id}/roster/weekly-off`, {
            weeklyOffDays: ['FUN'],
            rowVersion: current.rowVersion,
          })
        ).status,
      ).toBe(400);
    });

    it('takes days off for this person only, which a daily-paid person is paid for when the setting says so', async () => {
      await setting('company.weekly_off_days', 'NONE');
      await setting('company.pay_off_days_daily', 'YES');
      await owner.holiday.deleteMany({});
      const p = await person('0', '400.00');
      const other = await person('0', '400.00');
      const added = await superAdmin.post(`/staff/${p.staff.id}/roster/days-off`, {
        date: '2026-02-11',
        name: 'Family function',
      });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      expect(RosterSchema.parse(added.body).daysOff).toMatchObject([
        { date: '2026-02-11', name: 'Family function' },
      ]);
      await adminA.post('/payroll/generate', { month: FEB });
      expect(await payrollOf(p.staff.id)).toMatchObject({ gross: '400.00' });
      expect(await payrollOf(other.staff.id)).toMatchObject({ gross: '0.00' });
    });

    it('refuses a day twice and a day before they joined', async () => {
      const p = await person();
      const first = await superAdmin.post(`/staff/${p.staff.id}/roster/days-off`, {
        date: '2026-03-04',
      });
      expect(first.status).toBe(201);
      expect(
        (await superAdmin.post(`/staff/${p.staff.id}/roster/days-off`, { date: '2026-03-04' }))
          .status,
      ).toBe(409);
      expect(
        (await superAdmin.post(`/staff/${p.staff.id}/roster/days-off`, { date: '2025-12-31' }))
          .status,
      ).toBe(400);
      const dayOff = RosterSchema.parse(first.body).daysOff[0];
      expect(
        (await superAdmin.delete(`/staff/${p.staff.id}/roster/days-off/${dayOff?.id}`)).status,
      ).toBe(200);
      expect(
        (await superAdmin.delete(`/staff/${p.staff.id}/roster/days-off/${dayOff?.id}`)).status,
      ).toBe(404);
    });

    it('cannot change the days off of a month whose pay is final', async () => {
      await setting('company.weekly_off_days', 'NONE');
      const p = await person();
      await adminA.post('/payroll/generate', { month: FEB });
      const record = await payrollOf(p.staff.id);
      expect(
        (await adminA2.post(`/payroll/${record.id}/finalize`, { rowVersion: record.rowVersion }))
          .status,
      ).toBe(200);
      const refused = await superAdmin.post(`/staff/${p.staff.id}/roster/days-off`, {
        date: '2026-02-12',
      });
      expect(refused.status).toBe(422);
    });
  });

  describe('fixed salary and leave', () => {
    it('does not count leave taken over a weekly off or a holiday as leave', async () => {
      await setting('company.weekly_off_days', 'SUN');
      await owner.holiday.deleteMany({});
      const own = await person('28000.00');
      const plain = await person('28000.00');
      for (const who of [own, plain]) {
        const leave = LeaveSchema.parse(
          (
            await adminA.post('/leave', {
              staffId: who.staff.id,
              fromDate: '2026-02-06',
              toDate: '2026-02-09',
              kind: 'UNPAID',
            })
          ).body,
        );
        expect(
          (await adminA2.post(`/leave/${leave.id}/approve`, { rowVersion: leave.rowVersion }))
            .status,
        ).toBe(200);
      }
      const current = await roster(own.staff.id);
      await superAdmin.put(`/staff/${own.staff.id}/roster/weekly-off`, {
        weeklyOffDays: ['SAT', 'SUN'],
        rowVersion: current.rowVersion,
      });
      await adminA.post('/payroll/generate', { month: FEB });
      // 6 to 9 February is Friday to Monday. With a Sunday off, 3 days are leave (Fri, Sat, Mon): 28000 / 28 = 1000 a day.
      expect(await payrollOf(plain.staff.id)).toMatchObject({
        unpaidLeaveDays: 3,
        deductions: '3000.00',
      });
      // With Saturday and Sunday off, only Friday and Monday are leave.
      expect(await payrollOf(own.staff.id)).toMatchObject({
        unpaidLeaveDays: 2,
        deductions: '2000.00',
      });
    });
  });

  describe('a person’s own day', () => {
    it('says when today is a weekly off, so the screen can tell them', async () => {
      const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
      await setting('company.weekly_off_days', 'NONE');
      await owner.holiday.deleteMany({});
      const p = await person();
      const client = await loggedIn(app, p.username);
      expect(MyAttendanceSchema.parse((await client.get('/attendance/me')).body).offDay).toBeNull();
      await superAdmin.post('/holidays', { date: today, name: 'Today only' });
      expect(MyAttendanceSchema.parse((await client.get('/attendance/me')).body).offDay).toEqual({
        kind: 'HOLIDAY',
        name: 'Today only',
      });
      await superAdmin.post(`/staff/${p.staff.id}/roster/days-off`, {
        date: today,
        name: 'Own day',
      });
      expect(MyAttendanceSchema.parse((await client.get('/attendance/me')).body).offDay).toEqual({
        kind: 'DAY_OFF',
        name: 'Own day',
      });
    });
  });
});
