import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AttendanceListResponseSchema,
  AttendanceSchema,
  GeneratePayrollResponseSchema,
  LeaveListResponseSchema,
  LeaveSchema,
  MyAttendanceSchema,
  PayrollListResponseSchema,
  PayrollSchema,
  StaffCandidateListResponseSchema,
  StaffListResponseSchema,
  StaffSchema,
  addDays,
  todayInIndia,
} from '@erp/contracts';
import type { Leave, Payroll, Staff } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

const MARCH = '2026-03';
const FEB = '2026-02';

describe('staff and HR', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let adminA2: TestClient;
  let adminB: TestClient;
  let staffB: TestClient;
  let viewer: TestClient;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;
  const today = (): string => todayInIndia();
  const shift = (days: number): string => addDays(today(), days);
  const iso = (instant: Date): string => instant.toISOString();

  interface Person {
    userId: string;
    staffId: string;
    username: string;
    client: TestClient;
    staff: Staff;
  }

  /** A person with a login and a staff profile, made by a manager the way a real one would be. */
  const person = async (
    over: {
      role?: string;
      joinDate?: string;
      salary?: string;
      branchId?: string;
      department?: string | null;
    } = {},
  ): Promise<Person> => {
    const username = unique('hr_');
    const branchId = over.branchId ?? w.branchA;
    const userId = await addUser(owner, {
      username,
      role: over.role ?? 'STAFF',
      branchIds: [branchId],
    });
    const maker = branchId === w.branchB ? adminB : adminA;
    const response = await maker.post('/staff', {
      userId,
      branchId,
      employeeCode: unique('EMP-'),
      department: over.department ?? null,
      designation: 'Fitter',
      joinDate: over.joinDate ?? '2026-01-01',
      monthlySalary: over.salary ?? '31000.00',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const staff = StaffSchema.parse(response.body);
    return { userId, staffId: staff.id, username, client: await loggedIn(app, username), staff };
  };

  const askLeave = (
    client: TestClient,
    from: string,
    to: string,
    extra: Record<string, unknown> = {},
  ) => client.post('/leave', { fromDate: from, toDate: to, ...extra });
  const asked = async (
    client: TestClient,
    from: string,
    to: string,
    extra: Record<string, unknown> = {},
  ): Promise<Leave> => {
    const response = await askLeave(client, from, to, extra);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return LeaveSchema.parse(response.body);
  };
  const decide = (
    client: TestClient,
    leave: Leave,
    action: 'approve' | 'reject' | 'cancel',
    note?: string,
  ) =>
    client.post(`/leave/${leave.id}/${action}`, {
      rowVersion: leave.rowVersion,
      ...(note ? { note } : {}),
    });
  const approved = async (client: TestClient, leave: Leave): Promise<Leave> => {
    const response = await decide(client, leave, 'approve');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return LeaveSchema.parse(response.body);
  };
  /** Leave in the past, recorded and approved by managers. */
  const pastLeave = async (
    p: Person,
    from: string,
    to: string,
    kind: 'PAID' | 'UNPAID' = 'UNPAID',
  ): Promise<Leave> => {
    const made = await asked(adminA, from, to, { staffId: p.staffId, kind });
    return approved(adminA2, made);
  };
  const correct = (
    client: TestClient,
    p: Person,
    day: string,
    inAt: string,
    outAt: string | null = null,
    reason = 'Forgot to mark',
  ) =>
    client.put('/attendance/correct', {
      staffId: p.staffId,
      workDate: day,
      checkIn: inAt,
      checkOut: outAt,
      reason,
    });
  const generate = (client: TestClient, month: string, branchId?: string) =>
    client.post('/payroll/generate', { month, ...(branchId ? { branchId } : {}) });
  const payrollOf = async (p: Person, month: string): Promise<Payroll> => {
    const list = PayrollListResponseSchema.parse(
      (await adminA.get(`/payroll?month=${month}&staffId=${p.staffId}`)).body,
    );
    const found = list.items[0];
    if (!found) throw new Error('No payroll record');
    return found;
  };
  const audits = (action: string, entityId: string) =>
    owner.auditLog.findMany({ where: { action, entityId } });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    adminB = await loggedIn(app, 'admin_b');
    staffB = await loggedIn(app, 'staff_b');
    await addUser(owner, { username: 'admin_a2', role: 'ADMIN', branchIds: [w.branchA] });
    adminA2 = await loggedIn(app, 'admin_a2');
    expect(
      (
        await superAdmin.post('/roles', {
          name: 'HR Viewer',
          tier: 'STAFF',
          permissionCodes: ['hr.view'],
        })
      ).status,
    ).toBe(201);
    await addUser(owner, { username: 'hr_viewer', role: 'HR Viewer', branchIds: [w.branchA] });
    viewer = await loggedIn(app, 'hr_viewer');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('who may call what', () => {
    it('answers every endpoint with 401 when signed out', async () => {
      const origin = 'http://localhost:5173';
      const http = () => request(app.getHttpServer());
      const id = w.customerId;
      const attempts = [
        http().get('/staff'),
        http().get('/staff/me'),
        http().get('/staff/departments'),
        http().get('/staff/candidates'),
        http().get(`/staff/${id}`),
        http().get('/attendance/me'),
        http().get('/attendance?month=2026-03'),
        http().get('/leave'),
        http().get(`/leave/${id}`),
        http().get('/payroll'),
        http().get(`/payroll/${id}`),
        http().post('/staff').set('Origin', origin).send({}),
        http().patch(`/staff/${id}`).set('Origin', origin).send({}),
        ...['deactivate', 'reactivate'].map((a) =>
          http().post(`/staff/${id}/${a}`).set('Origin', origin).send({}),
        ),
        http().post('/attendance/check-in').set('Origin', origin).send({}),
        http().post('/attendance/check-out').set('Origin', origin).send({}),
        http().put('/attendance/correct').set('Origin', origin).send({}),
        http().post('/leave').set('Origin', origin).send({}),
        ...['approve', 'reject', 'cancel'].map((a) =>
          http().post(`/leave/${id}/${a}`).set('Origin', origin).send({}),
        ),
        http().post('/payroll/generate').set('Origin', origin).send({}),
        http().patch(`/payroll/${id}`).set('Origin', origin).send({}),
        http().post(`/payroll/${id}/finalize`).set('Origin', origin).send({}),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it("lets Staff see only their own HR records, and a manager see everyone's", async () => {
      const a = await person();
      const b = await person();
      const own = StaffListResponseSchema.parse((await a.client.get('/staff')).body);
      expect(own.items.map((s) => s.id)).toEqual([a.staffId]);
      expect((await a.client.get(`/staff/${a.staffId}`)).status).toBe(200);
      expect((await a.client.get(`/staff/${b.staffId}`)).status).toBe(404);
      expect(StaffSchema.parse((await a.client.get('/staff/me')).body).id).toBe(a.staffId);
      const all = StaffListResponseSchema.parse((await adminA.get('/staff?pageSize=100')).body);
      expect(all.items.map((s) => s.id)).toEqual(expect.arrayContaining([a.staffId, b.staffId]));
    });

    it("keeps changing anything to managers, except a person's own attendance and leave", async () => {
      const a = await person();
      expect((await a.client.post('/staff', {})).status).toBe(403);
      expect(
        (await a.client.patch(`/staff/${a.staffId}`, { designation: 'Boss', rowVersion: 1 }))
          .status,
      ).toBe(403);
      expect((await a.client.get('/staff/candidates')).status).toBe(403);
      expect((await a.client.put('/attendance/correct', {})).status).toBe(403);
      expect((await a.client.post('/payroll/generate', { month: FEB })).status).toBe(403);
      expect((await viewer.post('/leave', { fromDate: shift(3), toDate: shift(4) })).status).toBe(
        403,
      );
      expect((await viewer.post('/attendance/check-in', {})).status).toBe(403);
      expect((await viewer.get('/staff')).status).toBe(200);
    });

    it('answers a person with no staff profile politely instead of failing', async () => {
      const username = unique('nostaff_');
      await addUser(owner, { username, role: 'STAFF', branchIds: [w.branchA] });
      const client = await loggedIn(app, username);
      expect((await client.get('/staff/me')).status).toBe(404);
      const checkIn = await client.post('/attendance/check-in', {});
      expect(checkIn.status).toBe(422);
      expect(JSON.stringify(checkIn.body.details)).toContain('Ask a manager');
      expect((await askLeave(client, shift(3), shift(4))).status).toBe(422);
      expect(
        AttendanceListResponseSchema.parse((await client.get('/attendance?month=2026-03')).body)
          .items,
      ).toEqual([]);
    });
  });

  describe('staff profiles', () => {
    it('makes a person staff, records the salary in the audit trail, and lists them', async () => {
      const p = await person({ department: 'SALES', salary: '25000.50' });
      expect(p.staff).toMatchObject({
        status: 'ACTIVE',
        department: 'SALES',
        departmentName: 'Sales',
        designation: 'Fitter',
        joinDate: '2026-01-01',
        leftOn: null,
        monthlySalary: '25000.50',
        fullName: `Person ${p.username}`,
        branchCode: expect.any(String),
      });
      const log = await audits('STAFF_CREATED', p.staffId);
      expect(log).toHaveLength(1);
      expect(log[0]?.newValue).toMatchObject({ monthlySalary: '25000.50' });
      const found = StaffListResponseSchema.parse(
        (await adminA.get(`/staff?search=${p.staff.employeeCode}`)).body,
      );
      expect(found.items.map((s) => s.id)).toEqual([p.staffId]);
      const sales = StaffListResponseSchema.parse(
        (await adminA.get('/staff?department=SALES&pageSize=100')).body,
      );
      expect(sales.items.map((s) => s.id)).toContain(p.staffId);
    });

    it('offers as candidates only active people of the branch who are not staff yet', async () => {
      const free = await addUser(owner, {
        username: unique('cand_'),
        role: 'STAFF',
        branchIds: [w.branchA],
      });
      const away = await addUser(owner, {
        username: unique('cand_'),
        role: 'STAFF',
        branchIds: [w.branchB],
      });
      const gone = await addUser(owner, {
        username: unique('cand_'),
        role: 'STAFF',
        branchIds: [w.branchA],
        status: 'INACTIVE',
      });
      const taken = await person();
      const list = StaffCandidateListResponseSchema.parse(
        (await adminA.get(`/staff/candidates?branchId=${w.branchA}`)).body,
      );
      const ids = list.map((c) => c.userId);
      expect(ids).toContain(free);
      for (const excluded of [away, gone, taken.userId]) expect(ids).not.toContain(excluded);
      expect((await adminA.get(`/staff/candidates?branchId=${w.branchB}`)).status).toBe(403);
    });

    it('refuses a person who is already staff, from another branch or not active, a used code and an unknown department', async () => {
      const p = await person();
      const post = (userId: string, over: Record<string, unknown> = {}) =>
        adminA.post('/staff', {
          userId,
          branchId: w.branchA,
          employeeCode: unique('EMP-'),
          joinDate: '2026-01-01',
          monthlySalary: '1000.00',
          ...over,
        });
      const again = await post(p.userId);
      expect(again.status).toBe(409);
      const elsewhere = await addUser(owner, {
        username: unique('cand_'),
        role: 'STAFF',
        branchIds: [w.branchB],
      });
      expect((await post(elsewhere)).status).toBe(400);
      const inactive = await addUser(owner, {
        username: unique('cand_'),
        role: 'STAFF',
        branchIds: [w.branchA],
        status: 'INACTIVE',
      });
      expect((await post(inactive)).status).toBe(400);
      const free = await addUser(owner, {
        username: unique('cand_'),
        role: 'STAFF',
        branchIds: [w.branchA],
      });
      const clash = await post(free, { employeeCode: p.staff.employeeCode.toLowerCase() });
      expect(clash.status).toBe(409);
      expect(clash.body.details[0].field).toBe('employeeCode');
      const dept = await post(free, { department: 'PIRATES' });
      expect(dept.status).toBe(400);
      expect((await post(free, { employeeCode: 'x' })).status).toBe(400);
      expect((await post(free, { monthlySalary: '-5' })).status).toBe(400);
    });

    it('edits a profile, keeps the old salary in the audit trail, and refuses a stale edit', async () => {
      const p = await person({ salary: '20000.00' });
      const response = await adminA.patch(`/staff/${p.staffId}`, {
        monthlySalary: '22000.00',
        designation: 'Senior fitter',
        rowVersion: p.staff.rowVersion,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const after = StaffSchema.parse(response.body);
      expect(after).toMatchObject({ monthlySalary: '22000.00', designation: 'Senior fitter' });
      const log = await audits('STAFF_UPDATED', p.staffId);
      expect(log[0]?.oldValue).toMatchObject({ monthlySalary: '20000.00' });
      expect(log[0]?.newValue).toMatchObject({ monthlySalary: '22000.00' });
      expect(
        (
          await adminA.patch(`/staff/${p.staffId}`, {
            designation: 'Stale',
            rowVersion: p.staff.rowVersion,
          })
        ).status,
      ).toBe(409);
      expect(
        (await adminA.patch(`/staff/${p.staffId}`, { rowVersion: after.rowVersion })).status,
      ).toBe(400);
    });

    it('is protected by the database: a profile keeps its person and its branch', async () => {
      const p = await person();
      const other = await addUser(owner, {
        username: unique('cand_'),
        role: 'STAFF',
        branchIds: [w.branchA],
      });
      await expect(
        owner.$executeRaw`UPDATE staff SET user_id = ${other}::uuid WHERE id = ${p.staffId}::uuid`,
      ).rejects.toThrow(/another person or branch/);
      await expect(
        owner.$executeRaw`UPDATE staff SET branch_id = ${w.branchB}::uuid WHERE id = ${p.staffId}::uuid`,
      ).rejects.toThrow(/another person or branch/);
      await expect(
        owner.$executeRaw`UPDATE staff SET left_on = '2025-12-31' WHERE id = ${p.staffId}::uuid`,
      ).rejects.toThrow();
    });
  });

  describe('leaving and returning', () => {
    it('deactivates from a day, keeps everything they did, withdraws leave that cannot happen, and refuses a second time', async () => {
      const p = await person({ joinDate: '2026-01-01' });
      const waiting = await asked(p.client, shift(40), shift(42));
      const later = await approved(adminA2, await asked(p.client, shift(50), shift(52)));
      const spanning = await approved(adminA2, await asked(p.client, shift(20), shift(30)));
      const leftOn = shift(25);
      const response = await adminA.post(`/staff/${p.staffId}/deactivate`, {
        leftOn,
        rowVersion: p.staff.rowVersion,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(StaffSchema.parse(response.body)).toMatchObject({ status: 'INACTIVE', leftOn });
      const leave = LeaveListResponseSchema.parse(
        (await adminA.get(`/leave?staffId=${p.staffId}&pageSize=50`)).body,
      ).items;
      const byId = (id: string) => leave.find((l) => l.id === id);
      expect(byId(waiting.id)).toMatchObject({
        status: 'CANCELLED',
        decisionNote: 'The staff member left',
      });
      expect(byId(later.id)?.status).toBe('CANCELLED');
      expect(byId(spanning.id)?.status).toBe('APPROVED');
      expect((await audits('STAFF_DEACTIVATED', p.staffId)).length).toBe(1);
      const again = await adminA.post(`/staff/${p.staffId}/deactivate`, { leftOn, rowVersion: 99 });
      expect(again.status).toBe(409);
    });

    it('refuses a leaving day before they joined, or with attendance or final payroll after it', async () => {
      const p = await person({ joinDate: '2026-03-10' });
      const before = await adminA.post(`/staff/${p.staffId}/deactivate`, {
        leftOn: '2026-03-09',
        rowVersion: p.staff.rowVersion,
      });
      expect(before.status).toBe(400);
      await correct(
        adminA,
        p,
        '2026-03-20',
        '2026-03-20T09:00:00+05:30',
        '2026-03-20T17:00:00+05:30',
      );
      const worked = await adminA.post(`/staff/${p.staffId}/deactivate`, {
        leftOn: '2026-03-15',
        rowVersion: p.staff.rowVersion,
      });
      expect(worked.status).toBe(422);
      expect(JSON.stringify(worked.body.details)).toContain('2026-03-15');
      const q = await person({ joinDate: '2026-01-01' });
      await generate(adminA, FEB);
      const record = await payrollOf(q, FEB);
      await adminA2.post(`/payroll/${record.id}/finalize`, { rowVersion: record.rowVersion });
      const final = await adminA.post(`/staff/${q.staffId}/deactivate`, {
        leftOn: '2026-01-31',
        rowVersion: q.staff.rowVersion,
      });
      expect(final.status).toBe(422);
      expect(JSON.stringify(final.body.details)).toContain('2026-02');
    });

    it('stops a deactivated person marking attendance or asking for leave, whatever else they can still do', async () => {
      const p = await person({ joinDate: '2026-01-01' });
      await adminA.post(`/staff/${p.staffId}/deactivate`, {
        leftOn: shift(-1),
        rowVersion: p.staff.rowVersion,
      });
      const checkIn = await p.client.post('/attendance/check-in', {});
      expect(checkIn.status).toBe(422);
      expect(JSON.stringify(checkIn.body.details)).toContain(shift(-1));
      expect((await p.client.post('/attendance/check-out', {})).status).toBe(422);
      expect((await askLeave(p.client, shift(3), shift(4))).status).toBe(422);
      expect((await askLeave(adminA, shift(3), shift(4), { staffId: p.staffId })).status).toBe(422);
      expect((await p.client.get('/staff/me')).status).toBe(200);
    });

    it('lets a manager correct attendance only up to the day they left, and nothing after', async () => {
      const p = await person({ joinDate: '2026-01-01' });
      await adminA.post(`/staff/${p.staffId}/deactivate`, {
        leftOn: '2026-03-10',
        rowVersion: p.staff.rowVersion,
      });
      expect(
        (
          await correct(
            adminA,
            p,
            '2026-03-10',
            '2026-03-10T09:00:00+05:30',
            '2026-03-10T17:00:00+05:30',
          )
        ).status,
      ).toBe(200);
      const after = await correct(adminA, p, '2026-03-11', '2026-03-11T09:00:00+05:30');
      expect(after.status).toBe(400);
      expect(JSON.stringify(after.body.details)).toContain('left on 2026-03-10');
    });

    it('brings someone back on a later date, keeping what was recorded before', async () => {
      const p = await person({ joinDate: '2026-01-01' });
      await correct(
        adminA,
        p,
        '2026-01-12',
        '2026-01-12T09:00:00+05:30',
        '2026-01-12T17:00:00+05:30',
      );
      const left = StaffSchema.parse(
        (
          await adminA.post(`/staff/${p.staffId}/deactivate`, {
            leftOn: '2026-01-31',
            rowVersion: p.staff.rowVersion,
          })
        ).body,
      );
      expect(
        (
          await adminA.post(`/staff/${p.staffId}/reactivate`, {
            joinDate: '2026-01-31',
            rowVersion: left.rowVersion,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await adminA.post(`/staff/${p.staffId}/reactivate`, {
            joinDate: '2026-02-10',
            rowVersion: 1,
          })
        ).status,
      ).toBe(409);
      const back = await adminA.post(`/staff/${p.staffId}/reactivate`, {
        joinDate: '2026-02-10',
        rowVersion: left.rowVersion,
      });
      expect(StaffSchema.parse(back.body)).toMatchObject({
        status: 'ACTIVE',
        leftOn: null,
        joinDate: '2026-02-10',
      });
      expect((await audits('STAFF_REACTIVATED', p.staffId))[0]?.oldValue).toMatchObject({
        joinDate: '2026-01-01',
        leftOn: '2026-01-31',
      });
      const list = AttendanceListResponseSchema.parse(
        (await adminA.get(`/attendance?month=2026-01&staffId=${p.staffId}`)).body,
      );
      expect(list.items).toHaveLength(1);
      expect(
        (
          await adminA.post(`/staff/${p.staffId}/reactivate`, {
            joinDate: '2026-03-01',
            rowVersion: 99,
          })
        ).status,
      ).toBe(409);
    });
  });

  describe('marking attendance', () => {
    it('checks in and out, and shows the day', async () => {
      const p = await person();
      const before = MyAttendanceSchema.parse((await p.client.get('/attendance/me')).body);
      expect(before).toMatchObject({ staffId: p.staffId, today: today(), current: null });
      const inResponse = await p.client.post('/attendance/check-in', {});
      expect(inResponse.status, JSON.stringify(inResponse.body)).toBe(201);
      const open = AttendanceSchema.parse(inResponse.body);
      expect(open).toMatchObject({
        workDate: today(),
        state: 'OPEN',
        checkOut: null,
        hoursWorked: null,
        staffId: p.staffId,
      });
      expect(
        MyAttendanceSchema.parse((await p.client.get('/attendance/me')).body).current?.id,
      ).toBe(open.id);
      const outResponse = await p.client.post('/attendance/check-out', {});
      expect(outResponse.status, JSON.stringify(outResponse.body)).toBe(200);
      const done = AttendanceSchema.parse(outResponse.body);
      expect(done).toMatchObject({ id: open.id, state: 'COMPLETE' });
      expect(done.checkOut).not.toBeNull();
      expect(done.hoursWorked).toMatch(/^\d+\.\d{2}$/);
    });

    it('refuses to check in twice, to check out without checking in, and to check in again after a finished day', async () => {
      const p = await person();
      expect((await p.client.post('/attendance/check-out', {})).status).toBe(422);
      expect((await p.client.post('/attendance/check-in', {})).status).toBe(201);
      const twice = await p.client.post('/attendance/check-in', {});
      expect(twice.status).toBe(409);
      expect(JSON.stringify(twice.body.details)).toContain('Check out');
      await p.client.post('/attendance/check-out', {});
      const again = await p.client.post('/attendance/check-in', {});
      expect(again.status).toBe(409);
      expect((await p.client.post('/attendance/check-out', {})).status).toBe(422);
      expect(await owner.attendance.count({ where: { staffId: p.staffId } })).toBe(1);
    });

    it('takes one record when the same person checks in many times at once', async () => {
      const p = await person();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => p.client.post('/attendance/check-in', {})),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await owner.attendance.count({ where: { staffId: p.staffId } })).toBe(1);
    });

    it('will not let someone check in before they have joined, or on a day of approved leave', async () => {
      const future = await person({ joinDate: shift(5) });
      const early = await future.client.post('/attendance/check-in', {});
      expect(early.status).toBe(422);
      expect(JSON.stringify(early.body.details)).toContain(shift(5));
      const p = await person();
      await approved(adminA2, await asked(p.client, today(), shift(2)));
      const onLeave = await p.client.post('/attendance/check-in', {});
      expect(onLeave.status).toBe(422);
      expect(JSON.stringify(onLeave.body.details)).toContain('Cancel the leave');
    });

    it('lets a night shift end after midnight and stay on the day it began', async () => {
      const p = await person();
      const startedAt = new Date(Date.now() - 10 * 3_600_000);
      const day = todayInIndia(startedAt);
      await owner.attendance.create({
        data: {
          branchId: w.branchA,
          staffId: p.staffId,
          workDate: new Date(`${day}T00:00:00Z`),
          checkIn: startedAt,
        },
      });
      const mine = MyAttendanceSchema.parse((await p.client.get('/attendance/me')).body);
      expect(mine.current).toMatchObject({ workDate: day, state: 'OPEN' });
      const blocked = day === today() ? await p.client.post('/attendance/check-in', {}) : null;
      if (blocked) expect(blocked.status).toBe(409);
      const out = AttendanceSchema.parse((await p.client.post('/attendance/check-out', {})).body);
      expect(out).toMatchObject({ workDate: day, state: 'COMPLETE' });
      expect(Number(out.hoursWorked)).toBeGreaterThan(9.9);
    });

    it('asks for a manager when a shift was left open too long, and asks for the old shift to be closed first', async () => {
      const p = await person();
      const longAgo = new Date(Date.now() - 30 * 3_600_000);
      const day = todayInIndia(longAgo);
      await owner.attendance.create({
        data: {
          branchId: w.branchA,
          staffId: p.staffId,
          workDate: new Date(`${day}T00:00:00Z`),
          checkIn: longAgo,
        },
      });
      const out = await p.client.post('/attendance/check-out', {});
      expect(out.status).toBe(422);
      expect(JSON.stringify(out.body.details)).toContain('ask a manager');
      expect((await p.client.post('/attendance/check-in', {})).status).toBe(201);
      const fixed = await correct(
        adminA,
        p,
        day,
        iso(longAgo),
        iso(new Date(longAgo.getTime() + 9 * 3_600_000)),
        'Left without checking out',
      );
      expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
      expect(AttendanceSchema.parse(fixed.body)).toMatchObject({
        hoursWorked: '9.00',
        correctionReason: 'Left without checking out',
      });
    });
  });

  describe('correcting attendance', () => {
    it('sets a past day, then corrects it, with the reason, who and the old times in the audit trail', async () => {
      const p = await person();
      const made = await correct(
        adminA,
        p,
        '2026-03-12',
        '2026-03-12T09:30:00+05:30',
        '2026-03-12T18:00:00+05:30',
        'Entered from the register',
      );
      expect(made.status, JSON.stringify(made.body)).toBe(200);
      const first = AttendanceSchema.parse(made.body);
      expect(first).toMatchObject({
        workDate: '2026-03-12',
        hoursWorked: '8.50',
        correctedByName: 'Person admin_a',
        correctionReason: 'Entered from the register',
      });
      const changed = await correct(
        adminA2,
        p,
        '2026-03-12',
        '2026-03-12T09:00:00+05:30',
        '2026-03-12T18:00:00+05:30',
        'Came earlier',
      );
      const second = AttendanceSchema.parse(changed.body);
      expect(second).toMatchObject({
        id: first.id,
        hoursWorked: '9.00',
        correctedByName: 'Person admin_a2',
      });
      expect(await owner.attendance.count({ where: { staffId: p.staffId } })).toBe(1);
      const log = await audits('ATTENDANCE_CORRECTED', first.id);
      expect(log).toHaveLength(2);
      expect(log.find((l) => l.oldValue !== null)?.oldValue).toMatchObject({
        checkIn: '2026-03-12T04:00:00.000Z',
      });
    });

    it('refuses a day before they joined, after they left, in the future, or with times that do not fit', async () => {
      const p = await person({ joinDate: '2026-03-05' });
      const early = await correct(adminA, p, '2026-03-04', '2026-03-04T09:00:00+05:30');
      expect(early.status).toBe(400);
      expect(JSON.stringify(early.body.details)).toContain('joined on 2026-03-05');
      const future = await correct(adminA, p, shift(1), `${shift(1)}T09:00:00+05:30`);
      expect(future.status).toBe(400);
      expect((await correct(adminA, p, '2026-03-12', '2026-03-11T09:00:00+05:30')).status).toBe(
        400,
      );
      expect(
        (
          await correct(
            adminA,
            p,
            '2026-03-12',
            '2026-03-12T09:00:00+05:30',
            '2026-03-12T08:00:00+05:30',
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await correct(
            adminA,
            p,
            '2026-03-12',
            '2026-03-12T09:00:00+05:30',
            '2026-03-13T09:30:00+05:30',
          )
        ).status,
      ).toBe(400);
      expect(
        (await correct(adminA, p, '2026-03-12', '2026-03-12T09:00:00+05:30', null, 'no')).status,
      ).toBe(400);
      for (const garbage of ['garbage', '', '2026-99-99T99:99:99Z'])
        expect((await correct(adminA, p, '2026-03-12', garbage)).status, garbage).toBe(400);
      expect(
        (await correct(adminA, p, '2026-03-12', '2026-03-12T09:00:00+05:30', 'later')).status,
      ).toBe(400);
    });

    it('will not record attendance on a day of approved leave, and says which leave', async () => {
      const p = await person();
      await pastLeave(p, '2026-03-16', '2026-03-18', 'PAID');
      const blocked = await correct(adminA, p, '2026-03-17', '2026-03-17T09:00:00+05:30');
      expect(blocked.status).toBe(422);
      expect(JSON.stringify(blocked.body.details)).toContain('2026-03-16 to 2026-03-18');
      expect((await correct(adminA, p, '2026-03-19', '2026-03-19T09:00:00+05:30')).status).toBe(
        200,
      );
    });

    it('does not let a manager correct their own attendance, except a Super Admin, and lets another manager', async () => {
      const boss = await person({ role: 'ADMIN' });
      const refused = await correct(boss.client, boss, '2026-03-12', '2026-03-12T09:00:00+05:30');
      expect(refused.status).toBe(403);
      expect((await correct(adminA, boss, '2026-03-12', '2026-03-12T09:00:00+05:30')).status).toBe(
        200,
      );
      const chief = await person({ role: 'SUPER_ADMIN' });
      expect(
        (await correct(chief.client, chief, '2026-03-13', '2026-03-13T09:00:00+05:30')).status,
      ).toBe(200);
    });

    it('lists a month, counts the days present, and puts each record in the month it began in', async () => {
      const p = await person();
      await correct(
        adminA,
        p,
        '2026-02-28',
        '2026-02-28T22:00:00+05:30',
        '2026-03-01T06:00:00+05:30',
        'Night shift',
      );
      await correct(
        adminA,
        p,
        '2026-03-01',
        '2026-03-01T22:00:00+05:30',
        '2026-03-02T06:00:00+05:30',
        'Night shift',
      );
      await correct(
        adminA,
        p,
        '2026-03-31',
        '2026-03-31T09:00:00+05:30',
        '2026-03-31T17:00:00+05:30',
      );
      const month = async (m: string) =>
        AttendanceListResponseSchema.parse(
          (await adminA.get(`/attendance?month=${m}&staffId=${p.staffId}&pageSize=100`)).body,
        );
      const feb = await month(FEB);
      const mar = await month(MARCH);
      expect(feb.items.map((r) => r.workDate)).toEqual(['2026-02-28']);
      expect(mar.items.map((r) => r.workDate)).toEqual(['2026-03-31', '2026-03-01']);
      expect(mar.daysPresent).toBe(2);
      expect(feb.items[0]?.hoursWorked).toBe('8.00');
      expect((await adminA.get('/attendance')).status).toBe(400);
      expect((await adminA.get('/attendance?month=2026-13')).status).toBe(400);
    });

    it('shows a person only their own attendance', async () => {
      const a = await person();
      const b = await person();
      await correct(adminA, a, '2026-03-12', '2026-03-12T09:00:00+05:30');
      await correct(adminA, b, '2026-03-12', '2026-03-12T09:00:00+05:30');
      const own = AttendanceListResponseSchema.parse(
        (await a.client.get(`/attendance?month=${MARCH}&staffId=${b.staffId}`)).body,
      );
      expect(own.items.map((r) => r.staffId)).toEqual([a.staffId]);
    });

    it('is protected by the database: before joining, after leaving, on leave, over a day, and a record keeps its day', async () => {
      const p = await person({ joinDate: '2026-03-05' });
      await pastLeave(p, '2026-03-20', '2026-03-21', 'PAID');
      const base = { branchId: w.branchA, staffId: p.staffId };
      const day = (d: string) => new Date(`${d}T00:00:00Z`);
      await expect(
        owner.attendance.create({ data: { ...base, workDate: day('2026-03-04') } }),
      ).rejects.toThrow(/before the staff member joined/);
      await expect(
        owner.attendance.create({
          data: { ...base, workDate: day('2026-03-20'), checkIn: new Date('2026-03-20T04:00:00Z') },
        }),
      ).rejects.toThrow(/approved leave/);
      await expect(
        owner.attendance.create({
          data: {
            ...base,
            workDate: day('2026-03-10'),
            checkIn: new Date('2026-03-10T04:00:00Z'),
            checkOut: new Date('2026-03-11T04:00:01Z'),
          },
        }),
      ).rejects.toThrow();
      await expect(
        owner.attendance.create({
          data: {
            ...base,
            workDate: day('2026-03-10'),
            checkOut: new Date('2026-03-10T04:00:00Z'),
          },
        }),
      ).rejects.toThrow();
      await expect(
        owner.attendance.create({
          data: { branchId: w.branchB, staffId: p.staffId, workDate: day('2026-03-10') },
        }),
      ).rejects.toThrow(/branch/);
      const row = await owner.attendance.create({
        data: { ...base, workDate: day('2026-03-10'), checkIn: new Date('2026-03-10T04:00:00Z') },
      });
      await expect(
        owner.$executeRaw`UPDATE attendance SET work_date = '2026-03-11' WHERE id = ${row.id}::uuid`,
      ).rejects.toThrow(/keeps its person and its day/);
      await adminA.post(`/staff/${p.staffId}/deactivate`, {
        leftOn: '2026-03-25',
        rowVersion: p.staff.rowVersion,
      });
      await expect(
        owner.attendance.create({ data: { ...base, workDate: day('2026-03-26') } }),
      ).rejects.toThrow(/after the staff member left/);
    });
  });

  describe('asking for leave', () => {
    it('is asked for oneself and waits for a manager', async () => {
      const p = await person();
      const leave = await asked(p.client, shift(3), shift(5), { reason: 'Family function' });
      expect(leave).toMatchObject({
        status: 'PENDING',
        kind: 'PAID',
        days: 3,
        reason: 'Family function',
        staffId: p.staffId,
        createdByName: `Person ${p.username}`,
        decidedByName: null,
      });
      expect((await audits('LEAVE_REQUESTED', leave.id)).length).toBe(1);
      expect(
        await owner.outboxEvent.count({
          where: { eventType: 'leave.requested', payload: { path: ['leaveId'], equals: leave.id } },
        }),
      ).toBe(1);
    });

    it('lets a manager ask for someone else, including in the past, but not a person for someone else', async () => {
      const p = await person();
      const q = await person();
      const back = await asked(adminA, '2026-03-02', '2026-03-03', {
        staffId: p.staffId,
        kind: 'UNPAID',
      });
      expect(back).toMatchObject({
        staffId: p.staffId,
        kind: 'UNPAID',
        createdByName: 'Person admin_a',
      });
      const refused = await askLeave(q.client, shift(3), shift(4), { staffId: p.staffId });
      expect(refused.status).toBe(403);
      const past = await askLeave(p.client, shift(-3), shift(-2));
      expect(past.status).toBe(400);
      expect(past.body.details[0].field).toBe('fromDate');
    });

    it('refuses leave before they joined, with the dates the wrong way round, or over a year long', async () => {
      const p = await person({ joinDate: '2026-03-05' });
      const early = await askLeave(adminA, '2026-03-01', '2026-03-02', { staffId: p.staffId });
      expect(early.status).toBe(400);
      expect(JSON.stringify(early.body.details)).toContain('2026-03-05');
      expect((await askLeave(p.client, shift(5), shift(4))).status).toBe(400);
      expect((await askLeave(p.client, shift(1), shift(400))).status).toBe(400);
      expect((await askLeave(p.client, shift(1), shift(2), { kind: 'SICK' })).status).toBe(400);
    });

    it('never lets two live requests of one person share a day, and says which', async () => {
      const p = await person();
      const first = await asked(p.client, shift(10), shift(14));
      for (const [from, to] of [
        [shift(10), shift(10)],
        [shift(14), shift(16)],
        [shift(8), shift(10)],
        [shift(11), shift(12)],
        [shift(9), shift(20)],
      ] as const) {
        const clash = await askLeave(p.client, from, to);
        expect(clash.status, `${from} to ${to}`).toBe(409);
        expect(JSON.stringify(clash.body.details)).toContain(`${shift(10)} to ${shift(14)}`);
      }
      expect((await askLeave(p.client, shift(15), shift(16))).status).toBe(201);
      expect((await askLeave(p.client, shift(8), shift(9))).status).toBe(201);
      await approved(adminA2, first);
      expect((await askLeave(p.client, shift(12), shift(12))).status).toBe(409);
    });

    it('frees the days when leave is rejected or cancelled, and lets another person have the same days', async () => {
      const p = await person();
      const q = await person();
      const first = await asked(p.client, shift(20), shift(22));
      expect((await askLeave(q.client, shift(20), shift(22))).status).toBe(201);
      expect((await decide(adminA2, first, 'reject', 'Busy season')).status).toBe(200);
      const second = await asked(p.client, shift(20), shift(22));
      expect((await decide(p.client, second, 'cancel')).status).toBe(200);
      expect((await askLeave(p.client, shift(20), shift(22))).status).toBe(201);
    });

    it('takes one request when two overlapping ones arrive together', async () => {
      const p = await person();
      const results = await Promise.all([
        askLeave(p.client, shift(30), shift(33)),
        askLeave(adminA, shift(32), shift(35), { staffId: p.staffId }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await owner.leaveRequest.count({ where: { staffId: p.staffId } })).toBe(1);
    });

    it('is protected by the database: overlaps, closed requests and attendance on approved days', async () => {
      const p = await person();
      const base = { branchId: w.branchA, staffId: p.staffId, kind: 'PAID' };
      const day = (d: string) => new Date(`${d}T00:00:00Z`);
      await owner.leaveRequest.create({
        data: { ...base, fromDate: day(shift(40)), toDate: day(shift(42)), status: 'PENDING' },
      });
      await expect(
        owner.leaveRequest.create({
          data: { ...base, fromDate: day(shift(42)), toDate: day(shift(44)), status: 'PENDING' },
        }),
      ).rejects.toThrow(/overlap/);
      await expect(
        owner.leaveRequest.create({
          data: { ...base, fromDate: day(shift(45)), toDate: day(shift(44)), status: 'PENDING' },
        }),
      ).rejects.toThrow();
      const closed = await owner.leaveRequest.create({
        data: {
          ...base,
          fromDate: day(shift(50)),
          toDate: day(shift(51)),
          status: 'REJECTED',
          decidedAt: new Date(),
        },
      });
      await expect(
        owner.$executeRaw`UPDATE leave_requests SET status = 'APPROVED' WHERE id = ${closed.id}::uuid`,
      ).rejects.toThrow(/cannot move from REJECTED/);
      await expect(
        owner.$executeRaw`UPDATE leave_requests SET to_date = to_date + 1 WHERE id = ${closed.id}::uuid`,
      ).rejects.toThrow(/terms of a leave request/);
      const worked = await owner.leaveRequest.create({
        data: {
          ...base,
          fromDate: day('2026-03-24'),
          toDate: day('2026-03-25'),
          status: 'PENDING',
        },
      });
      await owner.attendance.create({
        data: {
          branchId: w.branchA,
          staffId: p.staffId,
          workDate: day('2026-03-24'),
          checkIn: new Date('2026-03-24T04:00:00Z'),
        },
      });
      await expect(
        owner.$executeRaw`UPDATE leave_requests SET status = 'APPROVED' WHERE id = ${worked.id}::uuid`,
      ).rejects.toThrow(/Attendance has been recorded/);
    });
  });

  describe('deciding leave', () => {
    it('approves with the version that was read, records who and when, and refuses a second decision or a stale one', async () => {
      const p = await person();
      const leave = await asked(p.client, shift(3), shift(5));
      expect(
        (await decide(adminA, { ...leave, rowVersion: leave.rowVersion + 4 }, 'approve')).status,
      ).toBe(409);
      const done = await approved(adminA, leave);
      expect(done).toMatchObject({ status: 'APPROVED', decidedByName: 'Person admin_a' });
      expect(done.decidedAt).not.toBeNull();
      expect((await decide(adminA2, done, 'approve')).status).toBe(409);
      expect((await decide(adminA2, done, 'reject', 'Changed my mind')).status).toBe(409);
      expect((await audits('LEAVE_APPROVED', leave.id)).length).toBe(1);
      expect(
        await owner.outboxEvent.count({
          where: { eventType: 'leave.approved', payload: { path: ['leaveId'], equals: leave.id } },
        }),
      ).toBe(1);
    });

    it('needs a reason to reject, and lets only a manager decide', async () => {
      const p = await person();
      const leave = await asked(p.client, shift(3), shift(5));
      expect((await decide(adminA, leave, 'reject')).status).toBe(400);
      expect((await decide(p.client, leave, 'approve')).status).toBe(403);
      expect((await decide(viewer, leave, 'approve')).status).toBe(403);
      const rejected = LeaveSchema.parse(
        (await decide(adminA, leave, 'reject', 'Busy season')).body,
      );
      expect(rejected).toMatchObject({
        status: 'REJECTED',
        decisionNote: 'Busy season',
      });
    });

    it('does not let a manager decide their own leave, except a Super Admin, and lets another manager', async () => {
      const boss = await person({ role: 'ADMIN' });
      const leave = await asked(boss.client, shift(3), shift(4));
      const refused = await decide(boss.client, leave, 'approve');
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/your own leave/);
      expect((await decide(boss.client, leave, 'reject', 'Not now')).status).toBe(403);
      expect((await decide(adminA, leave, 'approve')).status).toBe(200);
      const chief = await person({ role: 'SUPER_ADMIN' });
      const own = await asked(chief.client, shift(3), shift(4));
      expect((await decide(chief.client, own, 'approve')).status).toBe(200);
    });

    it('refuses to approve leave over days that were worked, and names them', async () => {
      const p = await person();
      const leave = await asked(adminA, '2026-03-16', '2026-03-18', { staffId: p.staffId });
      await correct(
        adminA,
        p,
        '2026-03-17',
        '2026-03-17T09:00:00+05:30',
        '2026-03-17T17:00:00+05:30',
      );
      const refused = await decide(adminA2, leave, 'approve');
      expect(refused.status).toBe(422);
      expect(JSON.stringify(refused.body.details)).toContain('2026-03-17');
      expect((await decide(adminA2, leave, 'reject', 'Worked those days')).status).toBe(200);
    });

    it("cancels: the person their waiting or coming leave, a manager anyone's, and not other people's", async () => {
      const p = await person();
      const q = await person();
      const waiting = await asked(p.client, shift(3), shift(4));
      expect((await decide(q.client, waiting, 'cancel')).status).toBe(404);
      const gone = LeaveSchema.parse(
        (await decide(p.client, waiting, 'cancel', 'Plans changed')).body,
      );
      expect(gone).toMatchObject({ status: 'CANCELLED', decisionNote: 'Plans changed' });
      expect((await decide(p.client, gone, 'cancel')).status).toBe(409);
      const coming = await approved(adminA2, await asked(p.client, shift(6), shift(7)));
      expect((await decide(p.client, coming, 'cancel')).status).toBe(200);
      expect((await audits('LEAVE_CANCELLED', coming.id)).length).toBe(1);
    });

    it('lets only a manager cancel leave that has started or passed', async () => {
      const p = await person();
      const started = await pastLeave(p, shift(-4), shift(-1), 'PAID');
      const refused = await decide(p.client, started, 'cancel');
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/already started/);
      expect((await decide(adminA, started, 'cancel', 'Entered by mistake')).status).toBe(200);
    });

    it('lists leave by status and by month, so leave across a month end shows in both months and no others', async () => {
      const p = await person();
      const across = await pastLeave(p, '2026-02-27', '2026-03-02', 'PAID');
      const ids = async (qs: string) =>
        LeaveListResponseSchema.parse(
          (await adminA.get(`/leave?staffId=${p.staffId}&${qs}`)).body,
        ).items.map((l) => l.id);
      expect(across.days).toBe(4);
      expect(await ids(`month=${FEB}`)).toEqual([across.id]);
      expect(await ids(`month=${MARCH}`)).toEqual([across.id]);
      expect(await ids('month=2026-01')).toEqual([]);
      expect(await ids('month=2026-04')).toEqual([]);
      expect(await ids('status=APPROVED')).toEqual([across.id]);
      expect(await ids('status=PENDING')).toEqual([]);
      const mine = LeaveListResponseSchema.parse(
        (await p.client.get(`/leave?month=${MARCH}`)).body,
      );
      expect(mine.items.map((l) => l.id)).toEqual([across.id]);
      expect((await adminA.get('/leave?month=2026-13')).status).toBe(400);
      expect((await adminA.get('/leave?status=DONE')).status).toBe(400);
    });
  });

  describe('monthly payroll', () => {
    it('makes a draft for everyone employed, in full for a whole month and by days for a joiner and a leaver', async () => {
      const full = await person({ salary: '31000.00' });
      const joiner = await person({ salary: '31000.00', joinDate: '2026-03-16' });
      const leaver = await person({ salary: '31000.00' });
      await adminA.post(`/staff/${leaver.staffId}/deactivate`, {
        leftOn: '2026-03-10',
        rowVersion: leaver.staff.rowVersion,
      });
      const later = await person({ salary: '31000.00', joinDate: '2026-04-01' });
      const gone = await person({ salary: '31000.00' });
      await adminA.post(`/staff/${gone.staffId}/deactivate`, {
        leftOn: '2026-02-28',
        rowVersion: gone.staff.rowVersion,
      });
      const response = await generate(adminA, MARCH, w.branchA);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const result = GeneratePayrollResponseSchema.parse(response.body);
      expect(result.month).toBe(MARCH);
      expect(result.created).toBeGreaterThanOrEqual(3);
      expect(await payrollOf(full, MARCH)).toMatchObject({
        status: 'DRAFT',
        monthlySalary: '31000.00',
        daysInMonth: 31,
        daysEmployed: 31,
        gross: '31000.00',
        deductions: '0.00',
        net: '31000.00',
      });
      expect(await payrollOf(joiner, MARCH)).toMatchObject({
        daysEmployed: 16,
        gross: '16000.00',
        net: '16000.00',
      });
      expect(await payrollOf(leaver, MARCH)).toMatchObject({ daysEmployed: 10, gross: '10000.00' });
      for (const absent of [later, gone])
        expect(
          PayrollListResponseSchema.parse(
            (await adminA.get(`/payroll?month=${MARCH}&staffId=${absent.staffId}`)).body,
          ).items,
        ).toEqual([]);
      expect((await audits('PAYROLL_GENERATED', w.branchA)).length).toBeGreaterThanOrEqual(1);
    });

    it('works on a short February and rounds to the paisa', async () => {
      const p = await person({ salary: '10000.00', joinDate: '2026-02-28' });
      await generate(adminA, FEB, w.branchA);
      expect(await payrollOf(p, FEB)).toMatchObject({
        daysInMonth: 28,
        daysEmployed: 1,
        gross: '357.14',
      });
      const q = await person({ salary: '10000.00', joinDate: '2026-03-31' });
      await generate(adminA, MARCH, w.branchA);
      expect(await payrollOf(q, MARCH)).toMatchObject({
        daysInMonth: 31,
        daysEmployed: 1,
        gross: '322.58',
      });
    });

    it('does nothing the second time, and only for a month that has ended', async () => {
      const p = await person();
      const first = GeneratePayrollResponseSchema.parse(
        (await generate(adminA, MARCH, w.branchA)).body,
      );
      expect(first.created).toBeGreaterThanOrEqual(1);
      const second = GeneratePayrollResponseSchema.parse(
        (await generate(adminA, MARCH, w.branchA)).body,
      );
      expect(second.created).toBe(0);
      expect(second.alreadyHad).toBeGreaterThanOrEqual(first.created);
      const current = await generate(adminA, today().slice(0, 7), w.branchA);
      expect(current.status).toBe(422);
      expect(JSON.stringify(current.body.details)).toContain('over');
      const next = await generate(adminA, addDays(today(), 40).slice(0, 7), w.branchA);
      expect(next.status).toBe(422);
      expect(await owner.payrollRecord.count({ where: { staffId: p.staffId, month: MARCH } })).toBe(
        1,
      );
    });

    it('records one payroll record when two runs arrive together', async () => {
      const p = await person();
      const results = await Promise.all([
        generate(adminA, FEB, w.branchA),
        generate(adminA2, FEB, w.branchA),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(await owner.payrollRecord.count({ where: { staffId: p.staffId, month: FEB } })).toBe(
        1,
      );
    });

    it('counts days present and leave, and starts the deductions at the share for unpaid leave', async () => {
      const p = await person({ salary: '31000.00' });
      await correct(
        adminA,
        p,
        '2026-03-02',
        '2026-03-02T09:00:00+05:30',
        '2026-03-02T17:00:00+05:30',
      );
      await correct(adminA, p, '2026-03-03', '2026-03-03T09:00:00+05:30');
      await pastLeave(p, '2026-03-05', '2026-03-07', 'UNPAID');
      await pastLeave(p, '2026-03-10', '2026-03-11', 'PAID');
      await generate(adminA, MARCH, w.branchA);
      expect(await payrollOf(p, MARCH)).toMatchObject({
        daysPresent: 2,
        paidLeaveDays: 2,
        unpaidLeaveDays: 3,
        gross: '31000.00',
        deductions: '3000.00',
        deductionNote: 'Unpaid leave: 3 days',
        net: '28000.00',
      });
    });

    it('counts leave across a month end in each month by the days that fall in it', async () => {
      const p = await person({ salary: '28000.00' });
      await pastLeave(p, '2026-02-27', '2026-03-02', 'UNPAID');
      await generate(adminA, FEB, w.branchA);
      await generate(adminA, MARCH, w.branchA);
      expect(await payrollOf(p, FEB)).toMatchObject({
        unpaidLeaveDays: 2,
        deductions: '2000.00',
        net: '26000.00',
      });
      expect(await payrollOf(p, MARCH)).toMatchObject({
        unpaidLeaveDays: 2,
        deductions: '1806.45',
        net: '26193.55',
      });
    });

    it('keeps the salary a record was worked out on, whatever happens to the salary afterwards', async () => {
      const p = await person({ salary: '20000.00' });
      await generate(adminA, FEB, w.branchA);
      await adminA.patch(`/staff/${p.staffId}`, {
        monthlySalary: '40000.00',
        rowVersion: p.staff.rowVersion,
      });
      expect(await payrollOf(p, FEB)).toMatchObject({
        monthlySalary: '20000.00',
        gross: '20000.00',
      });
    });

    it('changes the deductions of a draft, with the net following, and refuses deductions above the pay', async () => {
      const p = await person({ salary: '31000.00' });
      await generate(adminA, MARCH, w.branchA);
      const draft = await payrollOf(p, MARCH);
      const over = await adminA.patch(`/payroll/${draft.id}`, {
        deductions: '31000.01',
        rowVersion: draft.rowVersion,
      });
      expect(over.status).toBe(400);
      expect(over.body.details[0].field).toBe('deductions');
      const updated = PayrollSchema.parse(
        (
          await adminA.patch(`/payroll/${draft.id}`, {
            deductions: '1500.50',
            deductionNote: 'Advance recovered',
            rowVersion: draft.rowVersion,
          })
        ).body,
      );
      expect(updated).toMatchObject({
        deductions: '1500.50',
        net: '29499.50',
        deductionNote: 'Advance recovered',
      });
      expect(
        (
          await adminA.patch(`/payroll/${draft.id}`, {
            deductions: '0.00',
            rowVersion: draft.rowVersion,
          })
        ).status,
      ).toBe(409);
      expect((await audits('PAYROLL_UPDATED', draft.id)).length).toBe(1);
    });

    it("finalizes, after which nothing about it, or about that person's month, can change", async () => {
      const p = await person({ salary: '31000.00' });
      await correct(
        adminA,
        p,
        '2026-03-04',
        '2026-03-04T09:00:00+05:30',
        '2026-03-04T17:00:00+05:30',
      );
      const leave = await pastLeave(p, '2026-03-20', '2026-03-21', 'PAID');
      await generate(adminA, MARCH, w.branchA);
      const draft = await payrollOf(p, MARCH);
      const done = PayrollSchema.parse(
        (await adminA2.post(`/payroll/${draft.id}/finalize`, { rowVersion: draft.rowVersion }))
          .body,
      );
      expect(done).toMatchObject({ status: 'FINALIZED', finalizedByName: 'Person admin_a2' });
      expect(done.finalizedAt).not.toBeNull();
      expect(
        (
          await adminA.patch(`/payroll/${draft.id}`, {
            deductions: '1.00',
            rowVersion: done.rowVersion,
          })
        ).status,
      ).toBe(409);
      expect(
        (await adminA.post(`/payroll/${draft.id}/finalize`, { rowVersion: done.rowVersion }))
          .status,
      ).toBe(409);
      const attendance = await correct(
        adminA,
        p,
        '2026-03-04',
        '2026-03-04T09:30:00+05:30',
        '2026-03-04T17:00:00+05:30',
      );
      expect(attendance.status).toBe(422);
      expect(JSON.stringify(attendance.body.details)).toContain(MARCH);
      expect((await correct(adminA, p, '2026-03-09', '2026-03-09T09:00:00+05:30')).status).toBe(
        422,
      );
      expect((await decide(adminA, leave, 'cancel')).status).toBe(422);
      expect(
        (await askLeave(adminA, '2026-03-25', '2026-03-26', { staffId: p.staffId })).status,
      ).toBe(422);
      expect((await audits('PAYROLL_FINALIZED', draft.id)).length).toBe(1);
      await expect(
        owner.$executeRaw`UPDATE payroll_records SET deductions = 1, net = gross - 1 WHERE id = ${draft.id}::uuid`,
      ).rejects.toThrow(/final payroll record/);
      await expect(
        owner.$executeRaw`UPDATE payroll_records SET gross = 1, net = 1 WHERE id = ${draft.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        owner.attendance.create({
          data: {
            branchId: w.branchA,
            staffId: p.staffId,
            workDate: new Date('2026-03-12T00:00:00Z'),
          },
        }),
      ).rejects.toThrow(/payroll for this month is final/);
      const other = await correct(adminA, p, '2026-04-06', '2026-04-06T09:00:00+05:30');
      expect(other.status, 'the next month is still open').toBe(200);
    });

    it('waits for leave still undecided in the month before it is finalized', async () => {
      const p = await person();
      const waiting = await asked(adminA, '2026-03-26', '2026-03-27', { staffId: p.staffId });
      await generate(adminA, MARCH, w.branchA);
      const draft = await payrollOf(p, MARCH);
      const refused = await adminA2.post(`/payroll/${draft.id}/finalize`, {
        rowVersion: draft.rowVersion,
      });
      expect(refused.status).toBe(422);
      expect(JSON.stringify(refused.body.details)).toContain('2026-03-26');
      await decide(adminA2, waiting, 'reject', 'Not needed');
      expect(
        (await adminA2.post(`/payroll/${draft.id}/finalize`, { rowVersion: draft.rowVersion }))
          .status,
      ).toBe(200);
    });

    it('does not let a manager finalize their own pay, except a Super Admin, and lets another manager', async () => {
      const boss = await person({ role: 'ADMIN' });
      const chief = await person({ role: 'SUPER_ADMIN' });
      await generate(adminA, MARCH, w.branchA);
      const own = await payrollOf(boss, MARCH);
      const refused = await boss.client.post(`/payroll/${own.id}/finalize`, {
        rowVersion: own.rowVersion,
      });
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/your own pay/);
      expect(
        (await adminA.post(`/payroll/${own.id}/finalize`, { rowVersion: own.rowVersion })).status,
      ).toBe(200);
      const top = await payrollOf(chief, MARCH);
      expect(
        (await chief.client.post(`/payroll/${top.id}/finalize`, { rowVersion: top.rowVersion }))
          .status,
      ).toBe(200);
    });

    it('lists with totals over everything that matches, filters, and shows a person only their own pay', async () => {
      const a = await person({ salary: '10000.00' });
      const b = await person({ salary: '20000.00' });
      await generate(adminA, FEB, w.branchA);
      const both = PayrollListResponseSchema.parse(
        (await adminA.get(`/payroll?month=${FEB}&pageSize=100`)).body,
      );
      expect(both.items.map((r) => r.staffId)).toEqual(
        expect.arrayContaining([a.staffId, b.staffId]),
      );
      const mine = PayrollListResponseSchema.parse(
        (await a.client.get(`/payroll?month=${FEB}&staffId=${b.staffId}`)).body,
      );
      expect(mine.items.map((r) => r.staffId)).toEqual([a.staffId]);
      expect(mine.totals).toMatchObject({ gross: expect.any(String) });
      const ownRecord = await payrollOf(a, FEB);
      expect((await a.client.get(`/payroll/${ownRecord.id}`)).status).toBe(200);
      const theirs = await payrollOf(b, FEB);
      expect((await a.client.get(`/payroll/${theirs.id}`)).status).toBe(404);
      const paged = PayrollListResponseSchema.parse(
        (await adminA.get(`/payroll?month=${FEB}&pageSize=1&page=2`)).body,
      );
      expect(paged.page).toBe(2);
      expect(Number(paged.totals.gross)).toBeGreaterThanOrEqual(30000);
      const none = PayrollListResponseSchema.parse(
        (await adminA.get(`/payroll?month=${FEB}&status=FINALIZED&staffId=${a.staffId}`)).body,
      );
      expect(none.items).toEqual([]);
      expect((await adminA.get('/payroll?status=DONE')).status).toBe(400);
      expect((await adminA.get('/payroll?sortBy=gross')).status).toBe(400);
    });
  });

  describe('branch isolation', () => {
    it("hides one branch's staff, attendance, leave and payroll from another and refuses every change", async () => {
      const p = await person();
      await correct(adminA, p, '2026-03-12', '2026-03-12T09:00:00+05:30');
      const leave = await asked(p.client, shift(3), shift(4));
      await generate(adminA, FEB, w.branchA);
      const record = await payrollOf(p, FEB);
      expect((await adminB.get(`/staff/${p.staffId}`)).status).toBe(404);
      expect(
        StaffListResponseSchema.parse(
          (await adminB.get(`/staff?search=${p.staff.employeeCode}`)).body,
        ).items,
      ).toEqual([]);
      expect((await adminB.get(`/leave/${leave.id}`)).status).toBe(404);
      expect(
        AttendanceListResponseSchema.parse(
          (await adminB.get(`/attendance?month=${MARCH}&staffId=${p.staffId}`)).body,
        ).items,
      ).toEqual([]);
      expect(
        PayrollListResponseSchema.parse(
          (await adminB.get(`/payroll?month=${FEB}&staffId=${p.staffId}`)).body,
        ).items,
      ).toEqual([]);
      const attempts = [
        adminB.patch(`/staff/${p.staffId}`, {
          designation: 'Hijack',
          rowVersion: p.staff.rowVersion,
        }),
        adminB.post(`/staff/${p.staffId}/deactivate`, {
          leftOn: today(),
          rowVersion: p.staff.rowVersion,
        }),
        correct(adminB, p, '2026-03-13', '2026-03-13T09:00:00+05:30'),
        decide(adminB, leave, 'approve'),
        adminB.patch(`/payroll/${record.id}`, {
          deductions: '1.00',
          rowVersion: record.rowVersion,
        }),
        adminB.post(`/payroll/${record.id}/finalize`, { rowVersion: record.rowVersion }),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(404);
      expect((await generate(adminB, FEB, w.branchA)).status).toBe(403);
      expect((await adminB.get(`/staff/candidates?branchId=${w.branchA}`)).status).toBe(403);
      expect((await staffB.get(`/staff/${p.staffId}`)).status).toBe(404);
    });

    it('works the same in another branch, and lets a Super Admin choose the branch', async () => {
      const q = await person({ branchId: w.branchB });
      expect((await adminB.get(`/staff/${q.staffId}`)).status).toBe(200);
      expect((await adminA.get(`/staff/${q.staffId}`)).status).toBe(404);
      expect((await generate(superAdmin, FEB)).status).toBe(400);
      expect((await generate(superAdmin, FEB, w.branchB)).status).toBe(200);
      expect(
        PayrollListResponseSchema.parse(
          (await adminB.get(`/payroll?month=${FEB}&staffId=${q.staffId}`)).body,
        ).items,
      ).toHaveLength(1);
      const noBranch = await superAdmin.post('/staff', {
        userId: q.userId,
        employeeCode: unique('EMP-'),
        joinDate: '2026-01-01',
        monthlySalary: '1.00',
      });
      expect(noBranch.status).toBe(400);
    });
  });

  describe('departments', () => {
    it('lists the active departments', async () => {
      const response = await viewer.get('/staff/departments');
      expect(response.status).toBe(200);
      expect((response.body as { code: string }[]).map((d) => d.code)).toEqual(
        expect.arrayContaining(['SALES', 'WORKSHOP']),
      );
    });
  });
});
