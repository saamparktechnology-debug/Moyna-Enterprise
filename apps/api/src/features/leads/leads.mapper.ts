import { Prisma } from '@prisma/client';
import type { Followup, FollowupStatusName, Lead, LeadNote, LeadSummary } from '@erp/contracts';

export const FOLLOWUP_INCLUDE = {
  branch: { select: { code: true } },
  lead: {
    select: {
      name: true,
      phone: true,
      stage: true,
      assignedToUser: { select: { fullName: true } },
    },
  },
} satisfies Prisma.LeadFollowupInclude;

export type FollowupRow = Prisma.LeadFollowupGetPayload<{ include: typeof FOLLOWUP_INCLUDE }>;

export const SUMMARY_INCLUDE = {
  branch: { select: { code: true } },
  leadSource: { select: { name: true } },
  assignedToUser: { select: { fullName: true } },
  leadFollowups: {
    where: { completedAt: null },
    orderBy: { dueAt: 'asc' },
    select: { dueAt: true },
  },
} satisfies Prisma.LeadInclude;

export const DETAIL_INCLUDE = {
  branch: { select: { code: true } },
  leadSource: { select: { name: true } },
  assignedToUser: { select: { fullName: true } },
  customer: { select: { name: true } },
  leadFollowups: { include: FOLLOWUP_INCLUDE, orderBy: [{ dueAt: 'asc' }, { id: 'asc' }] },
  leadNotes: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
} satisfies Prisma.LeadInclude;

export type LeadSummaryRow = Prisma.LeadGetPayload<{ include: typeof SUMMARY_INCLUDE }>;
export type LeadDetailRow = Prisma.LeadGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export function followupStatus(
  row: { completedAt: Date | null; dueAt: Date },
  now: Date,
): FollowupStatusName {
  if (row.completedAt) return 'COMPLETED';
  return row.dueAt.getTime() < now.getTime() ? 'OVERDUE' : 'PENDING';
}

export function toSummaryDto(row: LeadSummaryRow, now: Date): LeadSummary {
  const pending = row.leadFollowups;
  return {
    id: row.id,
    branchId: row.branchId,
    branchCode: row.branch.code,
    name: row.name,
    phone: row.phone,
    source: row.source,
    sourceName: row.leadSource.name,
    stage: row.stage,
    interest: row.interest,
    assignedTo: row.assignedTo,
    assignedToName: row.assignedToUser?.fullName ?? null,
    customerId: row.customerId,
    nextFollowupAt: pending[0]?.dueAt.toISOString() ?? null,
    overdueFollowups: pending.filter((f) => f.dueAt.getTime() < now.getTime()).length,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toFollowupDto(
  row: FollowupRow,
  names: ReadonlyMap<string, string>,
  now: Date,
): Followup {
  return {
    id: row.id,
    leadId: row.leadId,
    leadName: row.lead.name,
    leadPhone: row.lead.phone,
    leadStage: row.lead.stage,
    assignedToName: row.lead.assignedToUser?.fullName ?? null,
    branchCode: row.branch.code,
    dueAt: row.dueAt.toISOString(),
    note: row.note,
    status: followupStatus(row, now),
    completedAt: row.completedAt?.toISOString() ?? null,
    completedByName: row.completedBy ? (names.get(row.completedBy) ?? null) : null,
    completionNote: row.completionNote,
    createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
    rescheduledCount: row.rescheduledCount,
    rowVersion: row.rowVersion,
  };
}

export function toNoteDto(
  row: {
    id: string;
    body: string;
    fromStage: LeadNote['fromStage'];
    toStage: LeadNote['toStage'];
    createdBy: string | null;
    createdAt: Date;
  },
  names: ReadonlyMap<string, string>,
): LeadNote {
  return {
    id: row.id,
    body: row.body,
    fromStage: row.fromStage,
    toStage: row.toStage,
    createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toLeadDto(row: LeadDetailRow, names: ReadonlyMap<string, string>, now: Date): Lead {
  const pending = row.leadFollowups.filter((f) => !f.completedAt);
  return {
    id: row.id,
    branchId: row.branchId,
    branchCode: row.branch.code,
    name: row.name,
    phone: row.phone,
    source: row.source,
    sourceName: row.leadSource.name,
    stage: row.stage,
    interest: row.interest,
    assignedTo: row.assignedTo,
    assignedToName: row.assignedToUser?.fullName ?? null,
    customerId: row.customerId,
    customerName: row.customer?.name ?? null,
    nextFollowupAt: pending[0]?.dueAt.toISOString() ?? null,
    overdueFollowups: pending.filter((f) => f.dueAt.getTime() < now.getTime()).length,
    createdAt: row.createdAt.toISOString(),
    createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
    rowVersion: row.rowVersion,
    notes: row.leadNotes.map((note) => toNoteDto(note, names)),
    followups: row.leadFollowups.map((f) => toFollowupDto(f, names, now)),
  };
}

export function userIdsOf(row: LeadDetailRow): string[] {
  const ids = new Set<string>();
  if (row.createdBy) ids.add(row.createdBy);
  for (const note of row.leadNotes) if (note.createdBy) ids.add(note.createdBy);
  for (const f of row.leadFollowups) {
    if (f.createdBy) ids.add(f.createdBy);
    if (f.completedBy) ids.add(f.completedBy);
  }
  return [...ids];
}

export function leadSnapshot(row: {
  name: string;
  phone: string;
  source: string;
  stage: string;
  interest: string | null;
  assignedTo: string | null;
  customerId: string | null;
}): Record<string, unknown> {
  return {
    name: row.name,
    phone: row.phone,
    source: row.source,
    stage: row.stage,
    interest: row.interest,
    assignedTo: row.assignedTo,
    customerId: row.customerId,
  };
}
