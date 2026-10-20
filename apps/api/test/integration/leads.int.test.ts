import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ConvertLeadResponseSchema,
  FollowupCountsSchema,
  FollowupListResponseSchema,
  FollowupSchema,
  LeadSourceAdminListResponseSchema,
  LeadSourceAdminSchema,
  LeadAssigneeListResponseSchema,
  LeadListResponseSchema,
  LeadSchema,
} from '@erp/contracts';
import type { Lead } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

describe('leads and follow-ups', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let staffA: TestClient;
  let staffA2: TestClient;
  let staffB: TestClient;
  let viewer: TestClient;
  let worker: TestClient;
  const owner = createOwnerPrisma();
  let counter = 0;
  const phone = (): string => `9${(counter += 1).toString().padStart(9, '0')}`;
  const IN = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString();

  const newLead = async (
    over: Record<string, unknown> = {},
    client: TestClient = staffA,
  ): Promise<Lead> => {
    const response = await client.post('/leads', {
      name: `Lead ${counter + 1}`,
      phone: phone(),
      source: 'WALK_IN',
      ...over,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return LeadSchema.parse(response.body);
  };
  const stage = (client: TestClient, lead: Lead, to: string, note?: string) =>
    client.post(`/leads/${lead.id}/stage`, {
      stage: to,
      rowVersion: lead.rowVersion,
      ...(note ? { note } : {}),
    });
  const moved = async (
    client: TestClient,
    lead: Lead,
    to: string,
    note?: string,
  ): Promise<Lead> => {
    const response = await stage(client, lead, to, note);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return LeadSchema.parse(response.body);
  };
  const fetchLead = async (id: string, client: TestClient = staffA): Promise<Lead> =>
    LeadSchema.parse((await client.get(`/leads/${id}`)).body);
  const audits = (action: string, entityId: string) =>
    owner.auditLog.findMany({ where: { action, entityId } });
  const schedule = (client: TestClient, lead: Lead, dueAt: string, note?: string) =>
    client.post(`/leads/${lead.id}/followups`, { dueAt, ...(note ? { note } : {}) });
  const lateFollowup = (lead: Lead, hoursAgo = 3) =>
    owner.leadFollowup.create({
      data: {
        branchId: lead.branchId,
        leadId: lead.id,
        dueAt: new Date(Date.now() - hoursAgo * 3_600_000),
        note: 'Was due',
      },
    });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    staffA = await loggedIn(app, 'staff_a');
    staffA2 = await loggedIn(app, 'staff_a2');
    staffB = await loggedIn(app, 'staff_b');
    const roleOf = async (name: string, permissionCodes: string[]) =>
      expect(
        (await superAdmin.post('/roles', { name, tier: 'STAFF', permissionCodes })).status,
      ).toBe(201);
    await roleOf('Lead Viewer', ['leads.view']);
    await roleOf('Lead Worker', ['leads.view', 'leads.manage']);
    await addUser(owner, { username: 'lead_viewer', role: 'Lead Viewer', branchIds: [w.branchA] });
    await addUser(owner, { username: 'lead_worker', role: 'Lead Worker', branchIds: [w.branchA] });
    viewer = await loggedIn(app, 'lead_viewer');
    worker = await loggedIn(app, 'lead_worker');
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
        http().get('/leads'),
        http().get('/leads/assignees'),
        http().get(`/leads/${id}`),
        http().get('/followups'),
        http().get('/followups/counts'),
        http().get('/reference/lead-sources'),
        http().post('/leads').set('Origin', origin).send({}),
        http().patch(`/leads/${id}`).set('Origin', origin).send({}),
        http().post(`/leads/${id}/stage`).set('Origin', origin).send({}),
        http().post(`/leads/${id}/assign`).set('Origin', origin).send({}),
        http().post(`/leads/${id}/notes`).set('Origin', origin).send({}),
        http().post(`/leads/${id}/convert`).set('Origin', origin).send({}),
        http().post(`/leads/${id}/followups`).set('Origin', origin).send({}),
        http().post(`/followups/${id}/complete`).set('Origin', origin).send({}),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('lets a viewer read but not change anything', async () => {
      const lead = await newLead();
      expect((await viewer.get('/leads')).status).toBe(200);
      expect((await viewer.get(`/leads/${lead.id}`)).status).toBe(200);
      expect((await viewer.get('/followups')).status).toBe(200);
      expect(
        (await viewer.post('/leads', { name: 'Nope Nope', phone: phone(), source: 'WALK_IN' }))
          .status,
      ).toBe(403);
      expect((await stage(viewer, lead, 'CONTACTED')).status).toBe(403);
      expect((await viewer.post(`/leads/${lead.id}/notes`, { body: 'x' })).status).toBe(403);
      expect((await schedule(viewer, lead, IN(60))).status).toBe(403);
      expect(
        (await viewer.post(`/leads/${lead.id}/convert`, { rowVersion: lead.rowVersion })).status,
      ).toBe(403);
    });

    it('lists the active lead sources', async () => {
      const sources = (await staffA.get('/reference/lead-sources')).body as { code: string }[];
      expect(sources.map((s) => s.code)).toContain('WALK_IN');
    });
  });

  describe('creating and editing a lead', () => {
    it('creates a new lead with its details, an opening note and an audit row', async () => {
      const lead = await newLead({
        name: 'Ravi Kumar',
        interest: 'Two TOTO X1 for a school',
        note: 'Walked in today',
      });
      expect(lead).toMatchObject({
        name: 'Ravi Kumar',
        stage: 'NEW',
        source: 'WALK_IN',
        sourceName: 'Walk-in',
        interest: 'Two TOTO X1 for a school',
        assignedTo: null,
        customerId: null,
        nextFollowupAt: null,
        overdueFollowups: 0,
        createdByName: 'Person staff_a',
      });
      expect(lead.notes.map((n) => n.body)).toEqual(['Walked in today']);
      expect((await audits('LEAD_CREATED', lead.id)).length).toBe(1);
      expect(
        await owner.outboxEvent.count({
          where: { eventType: 'lead.created', payload: { path: ['leadId'], equals: lead.id } },
        }),
      ).toBe(1);
    });

    it('refuses a bad phone, a short name, an unknown source and an unknown assignee', async () => {
      const base = { name: 'Asha Rao', phone: phone(), source: 'WALK_IN' };
      expect((await staffA.post('/leads', { ...base, phone: '12345' })).status).toBe(400);
      expect((await staffA.post('/leads', { ...base, name: 'A' })).status).toBe(400);
      const source = await staffA.post('/leads', { ...base, source: 'CARRIER_PIGEON' });
      expect(source.status).toBe(400);
      expect(source.body.details[0].field).toBe('source');
      const nobody = await staffA.post('/leads', { ...base, assignedTo: w.customerId });
      expect(nobody.status).toBe(400);
    });

    it('refuses a second open lead with the same phone number in the branch, until the first is closed', async () => {
      const number = phone();
      const first = await newLead({ phone: number, name: 'First Caller' });
      const second = await staffA.post('/leads', {
        name: 'Second Caller',
        phone: number,
        source: 'PHONE',
      });
      expect(second.status).toBe(409);
      expect(second.body.details[0].field).toBe('phone');
      expect(second.body.details[0].message).toContain('First Caller');
      const other = await newLead({ phone: number, name: 'Other Branch' }, staffB);
      expect(other.branchId).not.toBe(first.branchId);
      await moved(staffA, first, 'LOST', 'Bought from a competitor');
      expect(
        (await staffA.post('/leads', { name: 'Second Caller', phone: number, source: 'PHONE' }))
          .status,
      ).toBe(201);
    });

    it('records one lead when the same enquiry is sent many times at once', async () => {
      const number = phone();
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          staffA.post('/leads', { name: 'Double Click', phone: number, source: 'WALK_IN' }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await owner.lead.count({ where: { phone: number, branchId: w.branchA } })).toBe(1);
    });

    it('edits an open lead, refuses a stale edit, and refuses editing a lead that is closed', async () => {
      const lead = await newLead();
      const edited = await staffA.patch(`/leads/${lead.id}`, {
        name: 'Renamed Person',
        interest: 'Spare parts',
        rowVersion: lead.rowVersion,
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(LeadSchema.parse(edited.body)).toMatchObject({
        name: 'Renamed Person',
        interest: 'Spare parts',
      });
      expect((await audits('LEAD_UPDATED', lead.id)).length).toBe(1);

      const stale = await staffA.patch(`/leads/${lead.id}`, {
        name: 'Stale Name',
        rowVersion: lead.rowVersion,
      });
      expect(stale.status).toBe(409);

      const fresh = await fetchLead(lead.id);
      const lost = await moved(staffA, fresh, 'LOST', 'No budget this year');
      const closed = await staffA.patch(`/leads/${lead.id}`, {
        name: 'Late Edit',
        rowVersion: lost.rowVersion,
      });
      expect(closed.status).toBe(422);
    });

    it('refuses moving a lead to a phone number another open lead has', async () => {
      const a = await newLead();
      const b = await newLead();
      const clash = await staffA.patch(`/leads/${b.id}`, {
        phone: a.phone,
        rowVersion: b.rowVersion,
      });
      expect(clash.status).toBe(409);
    });
  });

  describe('stages', () => {
    it('moves forward, even skipping stages, and records each move on the lead', async () => {
      const lead = await newLead();
      const contacted = await moved(staffA, lead, 'CONTACTED');
      const qualified = await moved(staffA, contacted, 'QUALIFIED', 'Has the budget');
      const quoted = await moved(staffA, qualified, 'NEGOTIATION');
      expect(quoted.stage).toBe('NEGOTIATION');
      expect(quoted.notes.map((n) => [n.fromStage, n.toStage, n.body])).toEqual([
        ['QUALIFIED', 'NEGOTIATION', 'Moved from Qualified to In negotiation'],
        ['CONTACTED', 'QUALIFIED', 'Has the budget'],
        ['NEW', 'CONTACTED', 'Moved from New to Contacted'],
      ]);
      expect((await audits('LEAD_STAGE_CHANGED', lead.id)).length).toBe(3);
      const skip = await newLead();
      expect((await moved(staffA, skip, 'QUOTED')).stage).toBe('QUOTED');
    });

    it('refuses going backwards, staying put, and every move out of WON or into WON by hand', async () => {
      const lead = await moved(staffA, await newLead(), 'QUALIFIED');
      for (const to of ['NEW', 'CONTACTED', 'QUALIFIED']) {
        const response = await stage(staffA, lead, to);
        expect(response.status, to).toBe(409);
        expect(response.body.code).toBe('INVALID_STATE');
      }
      expect((await stage(staffA, lead, 'WON')).status).toBe(400);
      const negotiating = await moved(staffA, lead, 'NEGOTIATION');
      expect((await moved(staffA, negotiating, 'QUOTED')).stage).toBe('QUOTED');
    });

    it('needs a reason to lose a lead, refuses leaving LOST except by reopening, and needs a reason to reopen', async () => {
      const lead = await newLead();
      expect((await stage(staffA, lead, 'LOST')).status).toBe(400);
      const lost = await moved(staffA, lead, 'LOST', 'Bought from a competitor');
      expect(lost.notes[0]).toMatchObject({
        body: 'Bought from a competitor',
        fromStage: 'NEW',
        toStage: 'LOST',
      });
      for (const to of ['NEW', 'QUALIFIED', 'LOST'])
        expect((await stage(staffA, lost, to, 'Trying')).status).toBe(409);
      const noReason = await stage(staffA, lost, 'CONTACTED');
      expect(noReason.status).toBe(400);
      expect(noReason.body.details[0].field).toBe('note');
      expect((await moved(staffA, lost, 'CONTACTED', 'They called back')).stage).toBe('CONTACTED');
    });

    it('refuses a stale stage change and an unknown lead', async () => {
      const lead = await newLead();
      await moved(staffA, lead, 'CONTACTED');
      expect((await stage(staffA, lead, 'QUALIFIED')).status).toBe(409);
      const missing = await staffA.post('/leads/0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59/stage', {
        stage: 'CONTACTED',
        rowVersion: 1,
      });
      expect(missing.status).toBe(404);
    });

    it('lets two people race to move one lead and applies only one of the moves', async () => {
      const lead = await newLead();
      const results = await Promise.all([
        stage(staffA, lead, 'CONTACTED'),
        stage(staffA2, lead, 'QUALIFIED'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await fetchLead(lead.id)).notes.filter((n) => n.toStage)).toHaveLength(1);
    });
  });

  describe('the database guards', () => {
    it('refuses an impossible stage change, a win without a customer, and editing a won lead', async () => {
      const lead = await moved(staffA, await newLead(), 'QUALIFIED');
      await expect(
        owner.lead.update({ where: { id: lead.id }, data: { stage: 'NEW' } }),
      ).rejects.toThrow(/cannot move from/);
      await expect(
        owner.lead.update({ where: { id: lead.id }, data: { stage: 'WON' } }),
      ).rejects.toThrow(/converting/);
      const converted = ConvertLeadResponseSchema.parse(
        (
          await staffA.post(`/leads/${lead.id}/convert`, {
            rowVersion: (await fetchLead(lead.id)).rowVersion,
          })
        ).body,
      );
      await expect(
        owner.lead.update({ where: { id: lead.id }, data: { name: 'Edited After Win' } }),
      ).rejects.toThrow(/converted lead/);
      await expect(
        owner.lead.update({ where: { id: lead.id }, data: { stage: 'LOST' } }),
      ).rejects.toThrow(/converted lead/);
      expect(converted.lead.stage).toBe('WON');
    });

    it('refuses to change or delete notes, to change a completed follow-up, or to put a note in another branch', async () => {
      const lead = await newLead({ note: 'First note' });
      const noteId = lead.notes[0]?.id ?? '';
      await expect(
        owner.$executeRaw`UPDATE lead_notes SET body = 'changed' WHERE id = ${noteId}::uuid`,
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        owner.$executeRaw`DELETE FROM lead_notes WHERE id = ${noteId}::uuid`,
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        owner.leadNote.create({
          data: { branchId: w.branchB, leadId: lead.id, body: 'Wrong branch' },
        }),
      ).rejects.toThrow(/branch of its lead/);

      const followup = FollowupSchema.parse((await schedule(staffA, lead, IN(30))).body);
      await staffA.post(`/followups/${followup.id}/complete`, {});
      await expect(
        owner.$executeRaw`UPDATE lead_followups SET note = 'edited' WHERE id = ${followup.id}::uuid`,
      ).rejects.toThrow(/completed follow-up/);
      await expect(
        owner.$executeRaw`DELETE FROM lead_followups WHERE id = ${followup.id}::uuid`,
      ).rejects.toThrow(/cannot be deleted/);
      const open = FollowupSchema.parse((await schedule(staffA, lead, IN(40))).body);
      await expect(
        owner.$executeRaw`UPDATE lead_followups SET due_at = now() WHERE id = ${open.id}::uuid`,
      ).rejects.toThrow(/must be counted/);
    });
  });

  describe('assigning a lead', () => {
    it('assigns, reassigns and unassigns, with a note and an audit row each time', async () => {
      const lead = await newLead();
      const people = LeadAssigneeListResponseSchema.parse(
        (await staffA.get('/leads/assignees')).body,
      );
      const asha = people.find((p) => p.fullName === 'Person staff_a2');
      expect(asha).toBeDefined();
      const assigned = LeadSchema.parse(
        (
          await staffA.post(`/leads/${lead.id}/assign`, {
            assignedTo: asha?.id,
            rowVersion: lead.rowVersion,
          })
        ).body,
      );
      expect(assigned).toMatchObject({ assignedTo: asha?.id, assignedToName: 'Person staff_a2' });
      expect(assigned.notes[0]?.body).toBe('Assigned to Person staff_a2');
      const same = await staffA.post(`/leads/${lead.id}/assign`, {
        assignedTo: asha?.id,
        rowVersion: assigned.rowVersion,
      });
      expect(same.status).toBe(422);
      const freed = LeadSchema.parse(
        (
          await staffA.post(`/leads/${lead.id}/assign`, {
            assignedTo: null,
            rowVersion: assigned.rowVersion,
          })
        ).body,
      );
      expect(freed.assignedTo).toBeNull();
      expect(freed.notes[0]?.body).toBe('Unassigned');
      expect((await audits('LEAD_ASSIGNED', lead.id)).length).toBe(2);
    });

    it('offers only active people who work in the branch, and Super Admins', async () => {
      await addUser(owner, {
        username: 'gone_a',
        role: 'STAFF',
        branchIds: [w.branchA],
        status: 'INACTIVE',
      });
      const names = LeadAssigneeListResponseSchema.parse(
        (await staffA.get('/leads/assignees')).body,
      ).map((p) => p.fullName);
      expect(names).toContain('Person staff_a');
      expect(names).toContain('Person admin_a');
      expect(names).not.toContain('Person staff_b');
      expect(names).not.toContain('Person gone_a');
      expect(names.some((n) => n.includes('Super') || n === 'Super Admin')).toBe(true);
    });

    it('refuses someone from another branch or an inactive person, on create and on assign', async () => {
      const lead = await newLead();
      const people = await owner.user.findMany({
        where: { username: { in: ['staff_b', 'gone_a'] } },
      });
      for (const person of people) {
        const direct = await staffA.post('/leads', {
          name: 'Assign Test',
          phone: phone(),
          source: 'WALK_IN',
          assignedTo: person.id,
        });
        expect(direct.status, person.username).toBe(400);
        const later = await staffA.post(`/leads/${lead.id}/assign`, {
          assignedTo: person.id,
          rowVersion: lead.rowVersion,
        });
        expect(later.status, person.username).toBe(400);
      }
    });
  });

  describe('notes', () => {
    it('adds a note to the lead, newest first', async () => {
      const lead = await newLead({ note: 'Opening note' });
      const added = await staffA.post(`/leads/${lead.id}/notes`, {
        body: 'Called, asked to ring back Friday',
      });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      expect(added.body).toMatchObject({
        body: 'Called, asked to ring back Friday',
        createdByName: 'Person staff_a',
        fromStage: null,
      });
      expect((await fetchLead(lead.id)).notes.map((n) => n.body)).toEqual([
        'Called, asked to ring back Friday',
        'Opening note',
      ]);
      expect((await staffA.post(`/leads/${lead.id}/notes`, { body: '   ' })).status).toBe(400);
      expect(
        (await staffA.post(`/leads/${lead.id}/notes`, { body: 'x'.repeat(1001) })).status,
      ).toBe(400);
    });
  });

  describe('follow-ups', () => {
    it('schedules a follow-up and shows it on the lead as the next one', async () => {
      const lead = await newLead();
      const due = IN(120);
      const response = await schedule(staffA, lead, due, 'Ring about the quote');
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const followup = FollowupSchema.parse(response.body);
      expect(followup).toMatchObject({
        leadId: lead.id,
        status: 'PENDING',
        note: 'Ring about the quote',
        completedAt: null,
      });
      const after = await fetchLead(lead.id);
      expect(after.nextFollowupAt).toBe(new Date(due).toISOString());
      expect(after.followups).toHaveLength(1);
      expect((await audits('FOLLOWUP_SCHEDULED', followup.id)).length).toBe(1);
    });

    it('refuses a time that has passed, a date with no time, and a closed lead', async () => {
      const lead = await newLead();
      const past = await schedule(staffA, lead, IN(-60));
      expect(past.status).toBe(400);
      expect(past.body.details[0].field).toBe('dueAt');
      expect((await schedule(staffA, lead, '2099-01-01')).status).toBe(400);
      expect((await schedule(staffA, lead, IN(-2))).status).toBe(201);
      const lost = await moved(staffA, lead, 'LOST', 'Not interested');
      const closed = await schedule(staffA, lost, IN(60));
      expect(closed.status).toBe(422);
    });

    it('tells overdue, today and upcoming apart, and counts them without overlap', async () => {
      const lead = await newLead({ assignedTo: null });
      await lateFollowup(lead);
      await schedule(staffA, lead, IN(3 * 24 * 60));
      const dueSoon = FollowupSchema.parse((await schedule(staffA, lead, IN(10), 'Soon')).body);

      const rows = (scope: string) =>
        staffA.get(`/followups?scope=${scope}&leadId=${lead.id}&pageSize=50`);
      const overdue = FollowupListResponseSchema.parse((await rows('overdue')).body).items;
      expect(overdue).toHaveLength(1);
      expect(overdue[0]).toMatchObject({ status: 'OVERDUE', note: 'Was due' });
      const upcoming = FollowupListResponseSchema.parse((await rows('upcoming')).body).items;
      const today = FollowupListResponseSchema.parse((await rows('today')).body).items;
      expect(upcoming.length + today.length).toBe(2);
      expect(
        upcoming.some((f) => f.id === dueSoon.id) || today.some((f) => f.id === dueSoon.id),
      ).toBe(true);
      expect(FollowupListResponseSchema.parse((await rows('open')).body).items).toHaveLength(3);
      expect(FollowupListResponseSchema.parse((await rows('all')).body).items).toHaveLength(3);

      const counts = FollowupCountsSchema.parse((await staffA.get('/followups/counts')).body);
      const all = FollowupListResponseSchema.parse(
        (await staffA.get('/followups?scope=open&pageSize=100')).body,
      );
      expect(counts.overdue + counts.today + counts.upcoming).toBe(all.total);
      expect(counts.overdue).toBeGreaterThanOrEqual(1);
    });

    it('completes a follow-up once, with who did it and what came of it', async () => {
      const lead = await newLead();
      const followup = FollowupSchema.parse((await schedule(staffA, lead, IN(20))).body);
      const done = await staffA2.post(`/followups/${followup.id}/complete`, {
        note: 'Spoke to him, wants a demo',
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(FollowupSchema.parse(done.body)).toMatchObject({
        status: 'COMPLETED',
        completedByName: 'Person staff_a2',
        completionNote: 'Spoke to him, wants a demo',
      });
      expect((await staffA.post(`/followups/${followup.id}/complete`, {})).status).toBe(409);
      const stillOpen = FollowupListResponseSchema.parse(
        (await staffA.get(`/followups?scope=open&leadId=${lead.id}`)).body,
      );
      expect(stillOpen.items).toHaveLength(0);
      const finished = FollowupListResponseSchema.parse(
        (await staffA.get(`/followups?scope=done&leadId=${lead.id}`)).body,
      );
      expect(finished.items.map((f) => f.id)).toEqual([followup.id]);
      expect((await audits('FOLLOWUP_COMPLETED', followup.id)).length).toBe(1);
    });

    it('lets two people complete the same follow-up together and completes it once', async () => {
      const lead = await newLead();
      const followup = FollowupSchema.parse((await schedule(staffA, lead, IN(20))).body);
      const results = await Promise.all([
        staffA.post(`/followups/${followup.id}/complete`, {}),
        staffA2.post(`/followups/${followup.id}/complete`, {}),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it("filters to the caller's own leads and flags leads with late follow-ups on the lead list", async () => {
      const mine = await newLead({
        assignedTo: (await owner.user.findUniqueOrThrow({ where: { username: 'staff_a' } })).id,
      });
      const theirs = await newLead({
        assignedTo: (await owner.user.findUniqueOrThrow({ where: { username: 'staff_a2' } })).id,
      });
      await lateFollowup(mine);
      await lateFollowup(theirs);
      const own = FollowupListResponseSchema.parse(
        (await staffA.get('/followups?scope=overdue&mine=true&pageSize=100')).body,
      );
      expect(own.items.map((f) => f.leadId)).toContain(mine.id);
      expect(own.items.map((f) => f.leadId)).not.toContain(theirs.id);

      const late = LeadListResponseSchema.parse(
        (await staffA.get('/leads?overdue=true&pageSize=100')).body,
      );
      expect(late.items.map((l) => l.id)).toEqual(expect.arrayContaining([mine.id, theirs.id]));
      const flagged = late.items.find((l) => l.id === mine.id);
      expect(flagged?.overdueFollowups).toBe(1);
      expect(flagged?.nextFollowupAt).not.toBeNull();
    });

    it('closes pending follow-ups when the lead is lost', async () => {
      const lead = await newLead();
      await schedule(staffA, lead, IN(60));
      await lateFollowup(lead);
      const lost = await moved(staffA, lead, 'LOST', 'Not interested');
      expect(lost.followups.every((f) => f.status === 'COMPLETED')).toBe(true);
      expect(lost.followups.map((f) => f.completionNote)).toEqual([
        'The lead was lost',
        'The lead was lost',
      ]);
      expect(lost.nextFollowupAt).toBeNull();
      expect(lost.overdueFollowups).toBe(0);
    });
  });

  describe('converting a lead to a customer', () => {
    it('creates the customer from the lead, marks the lead won and closes its follow-ups', async () => {
      const lead = await newLead({ name: 'Meera Nair', interest: 'Battery set' });
      await schedule(staffA, lead, IN(60));
      const response = await staffA.post(`/leads/${lead.id}/convert`, {
        rowVersion: (await fetchLead(lead.id)).rowVersion,
        email: 'Meera@Example.com',
        address: '12 Park Road',
        stateCode: '27',
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const result = ConvertLeadResponseSchema.parse(response.body);
      expect(result).toMatchObject({ customerCreated: true, customerName: 'Meera Nair' });
      expect(result.lead).toMatchObject({
        stage: 'WON',
        customerId: result.customerId,
        customerName: 'Meera Nair',
      });
      expect(result.lead.notes[0]).toMatchObject({ fromStage: 'NEW', toStage: 'WON' });
      expect(result.lead.followups.every((f) => f.status === 'COMPLETED')).toBe(true);
      const customer = await owner.customer.findUniqueOrThrow({ where: { id: result.customerId } });
      expect(customer).toMatchObject({
        name: 'Meera Nair',
        phone: lead.phone,
        email: 'meera@example.com',
        address: '12 Park Road',
        stateCode: '27',
      });
      expect((await audits('LEAD_CONVERTED', lead.id)).length).toBe(1);
      expect((await audits('CUSTOMER_CREATED', result.customerId)).length).toBe(1);
      expect(
        await owner.outboxEvent.count({
          where: { eventType: 'lead.converted', payload: { path: ['leadId'], equals: lead.id } },
        }),
      ).toBe(1);
    });

    it('links the customer who already has the phone number instead of creating another', async () => {
      const number = phone();
      const existing = await owner.customer.create({
        data: { name: 'Old Customer', phone: number },
      });
      const lead = await newLead({ phone: number, name: 'Same Person' });
      const result = ConvertLeadResponseSchema.parse(
        (await staffA.post(`/leads/${lead.id}/convert`, { rowVersion: lead.rowVersion })).body,
      );
      expect(result).toMatchObject({
        customerId: existing.id,
        customerName: 'Old Customer',
        customerCreated: false,
      });
      expect(await owner.customer.count({ where: { phone: number } })).toBe(1);
      expect((await audits('CUSTOMER_CREATED', existing.id)).length).toBe(0);
    });

    it('links a customer chosen by id, and refuses an unknown one or details sent with it', async () => {
      const chosen = await owner.customer.create({ data: { name: 'Chosen One', phone: phone() } });
      const lead = await newLead();
      expect(
        (
          await staffA.post(`/leads/${lead.id}/convert`, {
            rowVersion: lead.rowVersion,
            customerId: chosen.id,
            address: 'x',
          })
        ).status,
      ).toBe(400);
      const unknown = await staffA.post(`/leads/${lead.id}/convert`, {
        rowVersion: lead.rowVersion,
        customerId: '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59',
      });
      expect(unknown.status).toBe(400);
      const linked = ConvertLeadResponseSchema.parse(
        (
          await staffA.post(`/leads/${lead.id}/convert`, {
            rowVersion: lead.rowVersion,
            customerId: chosen.id,
          })
        ).body,
      );
      expect(linked).toMatchObject({ customerId: chosen.id, customerCreated: false });
    });

    it('leaves the lead open and creates nothing when the customer details are refused', async () => {
      const taken = '27AAPFU0939F1ZV';
      await owner.customer.create({
        data: { name: 'Has The GSTIN', phone: phone(), gstin: taken, stateCode: '27' },
      });
      const lead = await newLead();
      const clash = await staffA.post(`/leads/${lead.id}/convert`, {
        rowVersion: lead.rowVersion,
        gstin: taken,
        stateCode: '27',
      });
      expect(clash.status).toBe(409);
      expect(clash.body.details[0].field).toBe('gstin');
      const badState = await staffA.post(`/leads/${lead.id}/convert`, {
        rowVersion: lead.rowVersion,
        stateCode: '98',
      });
      expect(badState.status).toBe(400);
      const after = await fetchLead(lead.id);
      expect(after).toMatchObject({ stage: 'NEW', customerId: null, rowVersion: lead.rowVersion });
      expect(await owner.customer.count({ where: { phone: lead.phone } })).toBe(0);
    });

    it('refuses converting a lead twice, a lost lead, and a stale lead', async () => {
      const lead = await newLead();
      const stale = await staffA.post(`/leads/${lead.id}/convert`, {
        rowVersion: lead.rowVersion + 5,
      });
      expect(stale.status).toBe(409);
      expect(
        (await staffA.post(`/leads/${lead.id}/convert`, { rowVersion: lead.rowVersion })).status,
      ).toBe(200);
      const again = await staffA.post(`/leads/${lead.id}/convert`, {
        rowVersion: (await fetchLead(lead.id)).rowVersion,
      });
      expect(again.status).toBe(409);
      expect((await stage(staffA, await fetchLead(lead.id), 'CONTACTED')).status).toBe(409);
      expect(
        (
          await staffA.patch(`/leads/${lead.id}`, {
            name: 'After Win',
            rowVersion: (await fetchLead(lead.id)).rowVersion,
          })
        ).status,
      ).toBe(422);

      const lost = await moved(staffA, await newLead(), 'LOST', 'Gone cold');
      const converted = await staffA.post(`/leads/${lost.id}/convert`, {
        rowVersion: lost.rowVersion,
      });
      expect(converted.status).toBe(422);
    });

    it('creates one customer when two leads with the same phone, in two branches, are converted at once', async () => {
      const number = phone();
      const a = await newLead({ phone: number, name: 'Shared Number' });
      const b = await newLead({ phone: number, name: 'Shared Number' }, staffB);
      const results = await Promise.all([
        staffA.post(`/leads/${a.id}/convert`, { rowVersion: a.rowVersion }),
        staffB.post(`/leads/${b.id}/convert`, { rowVersion: b.rowVersion }),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const parsed = results.map((r) => ConvertLeadResponseSchema.parse(r.body));
      expect(parsed[0]?.customerId).toBe(parsed[1]?.customerId);
      expect(parsed.filter((r) => r.customerCreated)).toHaveLength(1);
      expect(await owner.customer.count({ where: { phone: number } })).toBe(1);
    });

    it('converts a lead once when it is sent twice at once', async () => {
      const lead = await newLead();
      const results = await Promise.all([
        staffA.post(`/leads/${lead.id}/convert`, { rowVersion: lead.rowVersion }),
        staffA2.post(`/leads/${lead.id}/convert`, { rowVersion: lead.rowVersion }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await owner.customer.count({ where: { phone: lead.phone } })).toBe(1);
    });

    it('lets someone without customer rights link a customer but not create one', async () => {
      const lead = await newLead({}, worker);
      const denied = await worker.post(`/leads/${lead.id}/convert`, {
        rowVersion: lead.rowVersion,
      });
      expect(denied.status).toBe(403);
      expect((await fetchLead(lead.id, worker)).stage).toBe('NEW');
      const number = lead.phone;
      await owner.customer.create({ data: { name: 'Already Here', phone: number } });
      const linked = await worker.post(`/leads/${lead.id}/convert`, {
        rowVersion: lead.rowVersion,
      });
      expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    });
  });

  describe('finding leads', () => {
    it('filters by stage, source, assignee and search, and pages the result', async () => {
      const me = (await owner.user.findUniqueOrThrow({ where: { username: 'staff_a' } })).id;
      const tag = `Filterable${(counter += 1)}`;
      const a = await newLead({
        name: `${tag} One`,
        source: 'REFERRAL',
        assignedTo: me,
        interest: 'Rickshaw for hire',
      });
      const b = await newLead({ name: `${tag} Two`, source: 'WEBSITE' });
      await moved(staffA, b, 'LOST', 'No reply');
      const ids = async (qs: string) =>
        LeadListResponseSchema.parse(
          (await staffA.get(`/leads?search=${tag}&${qs}`)).body,
        ).items.map((l) => l.id);
      expect(await ids('')).toEqual(expect.arrayContaining([a.id, b.id]));
      expect(await ids('stage=open')).toEqual([a.id]);
      expect(await ids('stage=LOST')).toEqual([b.id]);
      expect(await ids('source=REFERRAL')).toEqual([a.id]);
      expect(await ids('assignedTo=me')).toEqual([a.id]);
      expect(await ids('assignedTo=unassigned')).toEqual([b.id]);
      expect((await ids('')).length).toBe(2);
      const byInterest = LeadListResponseSchema.parse(
        (await staffA.get('/leads?search=Rickshaw for hire')).body,
      );
      expect(byInterest.items.map((l) => l.id)).toContain(a.id);
      const byPhone = LeadListResponseSchema.parse(
        (await staffA.get(`/leads?search=${a.phone}`)).body,
      );
      expect(byPhone.items.map((l) => l.id)).toEqual([a.id]);
      const paged = LeadListResponseSchema.parse(
        (await staffA.get(`/leads?search=${tag}&pageSize=1&page=2&sortBy=name&sortOrder=asc`)).body,
      );
      expect(paged).toMatchObject({ page: 2, total: 2, totalPages: 2 });
      expect(paged.items[0]?.id).toBe(b.id);
      expect((await staffA.get('/leads?sortBy=phone')).status).toBe(400);
      expect((await staffA.get('/leads?stage=DONE')).status).toBe(400);
    });
  });

  describe('branch isolation', () => {
    it("hides a branch's leads and follow-ups from another branch and refuses every change", async () => {
      const lead = await newLead({ note: 'Private to A' });
      const followup = FollowupSchema.parse((await schedule(staffA, lead, IN(60))).body);
      expect((await staffB.get(`/leads/${lead.id}`)).status).toBe(404);
      expect(
        LeadListResponseSchema.parse((await staffB.get(`/leads?search=${lead.phone}`)).body).items,
      ).toHaveLength(0);
      expect(
        FollowupListResponseSchema.parse((await staffB.get(`/followups?leadId=${lead.id}`)).body)
          .items,
      ).toHaveLength(0);
      expect((await staffB.post(`/followups/${followup.id}/complete`, {})).status).toBe(404);
      const attempts = [
        stage(staffB, lead, 'CONTACTED'),
        staffB.patch(`/leads/${lead.id}`, { name: 'Hijacked', rowVersion: lead.rowVersion }),
        staffB.post(`/leads/${lead.id}/assign`, { assignedTo: null, rowVersion: lead.rowVersion }),
        staffB.post(`/leads/${lead.id}/notes`, { body: 'Intruder' }),
        staffB.post(`/leads/${lead.id}/convert`, { rowVersion: lead.rowVersion }),
        schedule(staffB, lead, IN(60)),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(404);
      expect((await adminA.get(`/leads/${lead.id}`)).status).toBe(200);
      expect(await fetchLead(lead.id)).toMatchObject({ stage: 'NEW', name: lead.name });
    });

    it('refuses creating a lead in a branch the user does not work in, and makes a Super Admin choose', async () => {
      const intoB = await staffA.post('/leads', {
        name: 'Wrong Branch',
        phone: phone(),
        source: 'WALK_IN',
        branchId: w.branchB,
      });
      expect(intoB.status).toBe(403);
      const none = await superAdmin.post('/leads', {
        name: 'No Branch',
        phone: phone(),
        source: 'WALK_IN',
      });
      expect(none.status).toBe(400);
      const chosen = await superAdmin.post('/leads', {
        name: 'In Branch B',
        phone: phone(),
        source: 'WALK_IN',
        branchId: w.branchB,
      });
      expect(chosen.status, JSON.stringify(chosen.body)).toBe(201);
      expect(chosen.body.branchId).toBe(w.branchB);
      expect((await staffB.get(`/leads/${chosen.body.id}`)).status).toBe(200);
      expect((await staffA.get(`/leads/${chosen.body.id}`)).status).toBe(404);
    });
  });

  describe('rescheduling a follow-up', () => {
    const move = (
      client: TestClient,
      followup: { id: string; rowVersion: number },
      dueAt: string,
      reason = 'Customer asked to call later',
    ) =>
      client.post(`/followups/${followup.id}/reschedule`, {
        dueAt,
        rowVersion: followup.rowVersion,
        reason,
      });
    const reload = async (leadId: string, id: string) => {
      const found = LeadSchema.parse((await staffA.get(`/leads/${leadId}`)).body).followups.find(
        (f) => f.id === id,
      );
      if (!found) throw new Error('No such follow-up');
      return found;
    };
    const planned = async (minutes = 60) => {
      const lead = await newLead();
      const made = FollowupSchema.parse((await schedule(staffA, lead, IN(minutes))).body);
      return { lead, made };
    };

    it('moves a waiting follow-up, counts the move, and keeps the old and new times with the reason', async () => {
      const { made } = await planned(60);
      expect(made.rescheduledCount).toBe(0);
      const target = IN(60 * 24);
      const moved = FollowupSchema.parse((await move(staffA, made, target)).body);
      expect(moved).toMatchObject({ rescheduledCount: 1, status: 'PENDING' });
      expect(new Date(moved.dueAt).getTime()).toBe(new Date(target).getTime());
      const again = FollowupSchema.parse(
        (await move(staffA, moved, IN(60 * 48), 'Out of town until then')).body,
      );
      expect(again.rescheduledCount).toBe(2);
      const log = await owner.auditLog.findMany({
        where: { action: 'FOLLOWUP_RESCHEDULED', entityId: made.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(log).toHaveLength(2);
      expect(log[0]?.oldValue).toMatchObject({ dueAt: made.dueAt });
      expect(log[0]?.newValue).toMatchObject({ reason: 'Customer asked to call later', moves: 1 });
      expect(log[1]?.newValue).toMatchObject({ reason: 'Out of town until then', moves: 2 });
    });

    it('lets an overdue follow-up be moved forward, so it stops being overdue', async () => {
      const lead = await newLead();
      const late = await lateFollowup(lead, 5);
      const row = await reload(lead.id, late.id);
      expect(row.status).toBe('OVERDUE');
      const moved = FollowupSchema.parse((await move(staffA, row, IN(120))).body);
      expect(moved.status).toBe('PENDING');
    });

    it('refuses a time that has passed, the same time, a missing reason and a stale version', async () => {
      const { lead, made } = await planned(60);
      const past = await move(staffA, made, new Date(Date.now() - 3_600_000).toISOString());
      expect(past.status).toBe(400);
      expect(past.body.details[0].field).toBe('dueAt');
      expect((await move(staffA, made, made.dueAt)).status).toBe(400);
      expect((await move(staffA, made, IN(300), 'no')).status).toBe(400);
      expect(
        (await move(staffA, { id: made.id, rowVersion: made.rowVersion + 5 }, IN(300))).status,
      ).toBe(409);
      expect((await reload(lead.id, made.id)).rescheduledCount).toBe(0);
    });

    it('refuses to move a completed follow-up or one whose lead is closed', async () => {
      const { lead, made } = await planned(60);
      const done = FollowupSchema.parse(
        (await staffA.post(`/followups/${made.id}/complete`, {})).body,
      );
      expect((await move(staffA, done, IN(300))).status).toBe(409);
      const other = await planned(90);
      await owner.$executeRaw`UPDATE leads SET stage = 'LOST' WHERE id = ${other.lead.id}::uuid`;
      const closed = await move(staffA, other.made, IN(300));
      expect(closed.status).toBe(422);
      expect(JSON.stringify(closed.body.details)).toContain('Reopen the lead');
      expect(lead.id).not.toBe(other.lead.id);
    });

    it('is for people who may manage leads, and is kept to the branch', async () => {
      const { made } = await planned(60);
      expect((await move(viewer, made, IN(300))).status).toBe(403);
      expect((await move(staffB, made, IN(300))).status).toBe(404);
      expect(
        (await move(staffA, { id: '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59', rowVersion: 1 }, IN(300)))
          .status,
      ).toBe(404);
    });

    it('takes one move when two arrive together', async () => {
      const { lead, made } = await planned(60);
      const results = await Promise.all([
        move(staffA, made, IN(300)),
        move(staffA2, made, IN(400)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await reload(lead.id, made.id)).rescheduledCount).toBe(1);
    });

    it('is protected by the database: the time moves only with its count, never with completion, and nothing else is writable', async () => {
      const { made } = await planned(60);
      await expect(
        owner.$executeRaw`UPDATE lead_followups SET due_at = due_at + interval '1 day' WHERE id = ${made.id}::uuid`,
      ).rejects.toThrow(/must be counted/);
      await expect(
        owner.$executeRaw`UPDATE lead_followups SET rescheduled_count = 5 WHERE id = ${made.id}::uuid`,
      ).rejects.toThrow(/only when the time does/);
      await expect(
        owner.$executeRaw`UPDATE lead_followups SET due_at = due_at + interval '1 day', rescheduled_count = 1, completed_at = now() WHERE id = ${made.id}::uuid`,
      ).rejects.toThrow(/not both/);
      await expect(
        owner.$executeRaw`UPDATE lead_followups SET note = 'edited' WHERE id = ${made.id}::uuid`,
      ).rejects.toThrow(/completion or the time/);
      await owner.$executeRaw`UPDATE lead_followups SET due_at = due_at + interval '1 day', rescheduled_count = rescheduled_count + 1 WHERE id = ${made.id}::uuid`;
    });
  });

  describe('managing the lead sources', () => {
    const code = (): string => `SRC_${Date.now().toString(36).toUpperCase()}${(counter += 1)}`;
    const sources = async (client: TestClient = adminA) =>
      LeadSourceAdminListResponseSchema.parse((await client.get('/lead-sources')).body);
    const add = (client: TestClient, over: Record<string, unknown> = {}) =>
      client.post('/lead-sources', { code: code(), name: `Source ${code()}`, ...over });

    it('is read by anyone who sees leads, and changed only by a manager', async () => {
      const made = await add(adminA);
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      expect((await viewer.get('/lead-sources')).status).toBe(200);
      expect((await staffA.get('/lead-sources')).status).toBe(200);
      expect((await add(staffA)).status).toBe(403);
      expect((await add(viewer)).status).toBe(403);
      expect(
        (await staffA.patch('/lead-sources/WALK_IN', { name: 'Hacked', rowVersion: 1 })).status,
      ).toBe(403);
    });

    it('adds a source that leads can then use, with its code in capitals, and lists it with how many leads came from it', async () => {
      const newCode = code();
      const made = LeadSourceAdminSchema.parse(
        (await add(adminA, { code: newCode.toLowerCase(), name: ' Trade show ' })).body,
      );
      expect(made).toMatchObject({
        code: newCode,
        name: 'Trade show',
        isActive: true,
        leadCount: 0,
      });
      const lead = await newLead({ source: newCode });
      expect(lead.source).toBe(newCode);
      expect((await sources()).find((s) => s.code === newCode)).toMatchObject({ leadCount: 1 });
      expect(
        (await staffA.get('/reference/lead-sources')).body.map((s: { code: string }) => s.code),
      ).toContain(newCode);
      expect(
        await owner.auditLog.count({ where: { action: 'LEAD_SOURCE_CREATED' } }),
      ).toBeGreaterThan(0);
    });

    it('refuses a bad code, a used code and a used name', async () => {
      for (const bad of ['a', '1ABC', 'HAS SPACE', 'bad-dash', 'X'.repeat(31)])
        expect((await add(adminA, { code: bad })).status, bad).toBe(400);
      const taken = await add(adminA, { code: 'WALK_IN', name: 'Another name' });
      expect(taken.status).toBe(409);
      expect(taken.body.details[0].field).toBe('code');
      const name = (await sources()).find((s) => s.code === 'WALK_IN')?.name ?? '';
      const same = await add(adminA, { name: name.toUpperCase() });
      expect(same.status).toBe(409);
      expect(same.body.details[0].field).toBe('name');
      expect((await add(adminA, { name: 'x' })).status).toBe(400);
    });

    it('renames a source and keeps the old and new name in the audit trail, and refuses a stale edit', async () => {
      const made = LeadSourceAdminSchema.parse((await add(adminA)).body);
      const renamed = LeadSourceAdminSchema.parse(
        (
          await adminA.patch(`/lead-sources/${made.code}`, {
            name: 'Renamed source',
            rowVersion: made.rowVersion,
          })
        ).body,
      );
      expect(renamed.name).toBe('Renamed source');
      expect(
        (
          await adminA.patch(`/lead-sources/${made.code}`, {
            name: 'Again',
            rowVersion: made.rowVersion,
          })
        ).status,
      ).toBe(409);
      expect(
        (await adminA.patch(`/lead-sources/${made.code}`, { rowVersion: renamed.rowVersion }))
          .status,
      ).toBe(400);
      const log = await owner.auditLog.findMany({
        where: { action: 'LEAD_SOURCE_UPDATED' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      expect(log[0]?.oldValue).toMatchObject({ code: made.code, name: made.name });
      expect(log[0]?.newValue).toMatchObject({ code: made.code, name: 'Renamed source' });
      expect(
        (await adminA.patch('/lead-sources/NO_SUCH', { name: 'Nope', rowVersion: 1 })).status,
      ).toBe(404);
    });

    it('switches a source off so new leads cannot use it, while leads that have it keep it, and back on', async () => {
      const newCode = code();
      const made = LeadSourceAdminSchema.parse((await add(adminA, { code: newCode })).body);
      const lead = await newLead({ source: newCode });
      const off = LeadSourceAdminSchema.parse(
        (
          await adminA.patch(`/lead-sources/${newCode}`, {
            isActive: false,
            rowVersion: made.rowVersion,
          })
        ).body,
      );
      expect(off.isActive).toBe(false);
      const refused = await staffA.post('/leads', {
        name: 'Late',
        phone: phone(),
        source: newCode,
      });
      expect(refused.status).toBe(400);
      expect((await staffA.get(`/leads/${lead.id}`)).body.source).toBe(newCode);
      expect(
        (await staffA.get('/reference/lead-sources')).body.map((s: { code: string }) => s.code),
      ).not.toContain(newCode);
      expect((await sources()).find((s) => s.code === newCode)).toMatchObject({
        isActive: false,
        leadCount: 1,
      });
      const on = await adminA.patch(`/lead-sources/${newCode}`, {
        isActive: true,
        rowVersion: off.rowVersion,
      });
      expect(on.status).toBe(200);
      expect(
        (await staffA.post('/leads', { name: 'On again', phone: phone(), source: newCode })).status,
      ).toBe(201);
    });

    it('never lets the last source be switched off', async () => {
      const original = await sources();
      const keep = original.find((s) => s.isActive);
      for (const s of original.filter((x) => x.isActive && x.code !== keep?.code))
        await owner.leadSource.update({ where: { code: s.code }, data: { isActive: false } });
      try {
        const last = (await sources()).find((s) => s.code === keep?.code);
        const refused = await adminA.patch(`/lead-sources/${keep?.code}`, {
          isActive: false,
          rowVersion: last?.rowVersion ?? 1,
        });
        expect(refused.status).toBe(422);
        expect(refused.body.details[0].field).toBe('isActive');
      } finally {
        for (const s of original)
          await owner.leadSource.update({
            where: { code: s.code },
            data: { isActive: s.isActive },
          });
      }
    });

    it('takes one source when two with the same code arrive together', async () => {
      const newCode = code();
      const results = await Promise.all([
        add(adminA, { code: newCode, name: `A ${newCode}` }),
        add(adminA, { code: newCode, name: `B ${newCode}` }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });
  });
});
