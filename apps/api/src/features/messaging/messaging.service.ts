import { Inject, Injectable } from '@nestjs/common';
import {
  AddOptOutRequestSchema,
  CreateBulkMessageRequestSchema,
  MessageCampaignListQuerySchema,
  PreviewBulkRequestSchema,
  SendDocumentRequestSchema,
} from '@erp/contracts';
import type {
  Audience,
  BulkPreview,
  MessageCampaign,
  MessageCampaignListResponse,
  MessageChannel,
  MessageDelivery,
  MessageOptOut,
  MessageOptOutListResponse,
  MessageTemplateKey,
  MessagingStatus,
} from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import type { Env } from '../../common/config/env.js';
import {
  BusinessRuleError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { buildPage, toSkipTake } from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { BillingService } from '../billing/billing.service.js';
import { inr } from '../billing/pdf-kit.js';
import { balancesSql } from '../payments/balances.js';
import { PaymentsService } from '../payments/payments.service.js';
import { loadCompanyProfile } from '../settings/company-profile.js';
import { userNames } from '../hr/hr.shared.js';
import {
  MAIL_CLIENT,
  OutsideWindowError,
  PermanentSendError,
  TEMPLATE_SETTINGS,
  WHATSAPP_CLIENT,
  isEmailAddress,
  toWhatsAppNumber,
} from './clients.js';
import type { MailClient, WhatsAppClient } from './clients.js';

/** How many people one "send" call reaches. The screen calls again until everyone is done. */
export const BATCH_SIZE = 20;
/** A temporary failure is tried this many times in all before the delivery is marked failed. */
export const MAX_ATTEMPTS = 3;

type CampaignRow = Prisma.MessageCampaignGetPayload<{ include: { deliveries: true } }>;

const deliveryDto = (row: CampaignRow['deliveries'][number]): MessageDelivery => ({
  id: row.id,
  recipientName: row.recipientName,
  toAddress: row.toAddress,
  status: row.status as MessageDelivery['status'],
  via: row.via as MessageDelivery['via'],
  error: row.error,
  attempts: row.attempts,
  sentAt: row.sentAt?.toISOString() ?? null,
});

function campaignDto(
  row: Omit<CampaignRow, 'deliveries'>,
  counts: { sent: number; failed: number; pending: number },
  creator: string | null,
  deliveries?: CampaignRow['deliveries'],
): MessageCampaign {
  return {
    id: row.id,
    kind: row.kind as MessageCampaign['kind'],
    channel: row.channel as MessageChannel,
    subject: row.subject,
    body: row.body,
    audience: row.audience,
    templateKey: row.templateKey as MessageTemplateKey,
    createdAt: row.createdAt.toISOString(),
    createdByName: creator,
    total: counts.sent + counts.failed + counts.pending,
    ...counts,
    ...(deliveries ? { deliveries: deliveries.map(deliveryDto) } : {}),
  };
}

/** Fills {{name}}, {{due}} and {{shop}} for one person. */
export function renderMessage(
  text: string,
  values: { name: string; due: string; shop: string },
): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    if (key === 'name') return values.name;
    if (key === 'due') return values.due;
    if (key === 'shop') return values.shop;
    return '';
  });
}

/**
 * Messages to customers by WhatsApp and email. A bulk message goes to each person as their own ordinary message (never a
 * broadcast or marketing list). WhatsApp allows a free message only to someone who wrote to the business in the last 24
 * hours; for anyone else the message goes as the template for its purpose (WHATSAPP_TEMPLATE_NAME, _INVOICE, _RECEIPT or
 * _REMINDER), and without one it fails for that person with the reason. Customers on the opt-out list get no bulk message. An invoice or receipt goes as a PDF, by email or as a WhatsApp document.
 */
@Injectable()
export class MessagingService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
    @Inject(WHATSAPP_CLIENT) private readonly whatsapp: WhatsAppClient,
    @Inject(MAIL_CLIENT) private readonly mail: MailClient,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(APP_CONFIG) private readonly env: Env,
  ) {}

  status(): MessagingStatus {
    return {
      whatsapp: {
        configured: this.whatsapp.configured,
        templates: {
          general: this.whatsapp.hasTemplate('GENERAL'),
          invoice: this.whatsapp.hasTemplate('INVOICE'),
          receipt: this.whatsapp.hasTemplate('RECEIPT'),
          reminder: this.whatsapp.hasTemplate('REMINDER'),
        },
      },
      email: { configured: this.mail.configured, from: this.mail.from },
    };
  }

  // ---------- bulk ----------

  /** How many people a bulk message would reach, before it is sent. */
  async preview(body: unknown): Promise<BulkPreview> {
    const input = PreviewBulkRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const { people, optedOut } = await this.audience(tx, input.audience);
      const reachable = people.filter((person) => this.addressOf(person, input.channel) !== null);
      return {
        count: reachable.length,
        withoutContact: people.length - reachable.length,
        optedOut,
        sampleNames: reachable.slice(0, 5).map((person) => person.name),
      };
    });
  }

  /** Makes the campaign and one delivery for each person. Nothing is sent until `send` is called. */
  async createBulk(auth: AuthContext, body: unknown): Promise<MessageCampaign> {
    const input = CreateBulkMessageRequestSchema.parse(body);
    const branchId = this.resolveBranch(input.branchId);
    return this.transactions.run(async (tx) => {
      const { people, optedOut } = await this.audience(tx, input.audience);
      const reachable = people.filter((person) => this.addressOf(person, input.channel) !== null);
      if (reachable.length === 0)
        throw new BusinessRuleError('There is no one to send this to', [
          {
            field: 'audience',
            message:
              optedOut > 0 && people.length === 0
                ? 'These customers asked not to get bulk messages'
                : input.channel === 'WHATSAPP'
                  ? 'None of these customers has a phone number'
                  : 'None of these customers has an email address',
          },
        ]);
      const company = await loadCompanyProfile(tx, 'Our shop');
      const campaign = await tx.messageCampaign.create({
        data: {
          branchId,
          kind: 'BULK',
          channel: input.channel,
          subject: input.subject ?? null,
          body: input.body,
          audience: this.describe(input.audience, reachable.length),
          // A reminder to people who owe money has its own template; everything else uses the general one.
          templateKey: input.audience.kind === 'DUES' ? 'REMINDER' : 'GENERAL',
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await tx.messageDelivery.createMany({
        data: reachable.map((person) => ({
          branchId,
          campaignId: campaign.id,
          customerId: person.id,
          recipientName: person.name,
          toAddress: this.addressOf(person, input.channel) as string,
          text: renderMessage(input.body, {
            name: person.name,
            due: inr(person.due),
            shop: company.name,
          }),
          createdBy: auth.userId,
          updatedBy: auth.userId,
        })),
      });
      await this.audit.record(tx, {
        action: 'MESSAGE_BULK_CREATED',
        entityType: 'MessageCampaign',
        entityId: campaign.id,
        branchId,
        newValue: {
          channel: input.channel,
          audience: input.audience.kind,
          recipients: reachable.length,
          withoutContact: people.length - reachable.length,
          optedOut,
        },
      });
      return this.present(tx, campaign.id);
    });
  }

  /**
   * Sends the next few waiting messages of a campaign and reports where it stands. The screen calls this again until
   * nothing is waiting, so a long list never holds one request for long.
   */
  async send(auth: AuthContext, id: string): Promise<MessageCampaign> {
    const { campaign, waiting } = await this.transactions.run(async (tx) => {
      const found = await tx.messageCampaign.findUnique({ where: { id } });
      if (!found) throw new NotFoundError('Message campaign', id);
      const rows = await tx.messageDelivery.findMany({
        where: { campaignId: id, status: 'PENDING' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: BATCH_SIZE,
      });
      return { campaign: found, waiting: rows };
    });
    for (const delivery of waiting) {
      const result = await this.attempt(campaign, delivery);
      await this.transactions.run(async (tx) => {
        await tx.messageDelivery.update({
          where: { id: delivery.id },
          data: {
            attempts: { increment: 1 },
            updatedBy: auth.userId,
            ...(result.ok
              ? {
                  status: 'SENT',
                  via: result.via,
                  providerMessageId: result.messageId,
                  error: null,
                  sentAt: new Date(),
                }
              : {
                  error: result.error.slice(0, 500),
                  status:
                    result.permanent || delivery.attempts + 1 >= MAX_ATTEMPTS
                      ? 'FAILED'
                      : 'PENDING',
                }),
          },
        });
      });
    }
    return this.transactions.run((tx) => this.present(tx, id));
  }

  /** Puts the failed deliveries of a campaign back to waiting, to be sent again. */
  async retryFailed(auth: AuthContext, id: string): Promise<MessageCampaign> {
    return this.transactions.run(async (tx) => {
      if (!(await tx.messageCampaign.findUnique({ where: { id }, select: { id: true } })))
        throw new NotFoundError('Message campaign', id);
      await tx.messageDelivery.updateMany({
        where: { campaignId: id, status: 'FAILED' },
        data: { status: 'PENDING', error: null, attempts: 0, updatedBy: auth.userId },
      });
      return this.present(tx, id);
    });
  }

  async listCampaigns(rawQuery: unknown): Promise<MessageCampaignListResponse> {
    const query = MessageCampaignListQuerySchema.parse(rawQuery);
    return this.transactions.run(async (tx) => {
      const where: Prisma.MessageCampaignWhereInput = query.kind ? { kind: query.kind } : {};
      const [rows, total] = await Promise.all([
        tx.messageCampaign.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
        }),
        tx.messageCampaign.count({ where }),
      ]);
      const counts = await this.counts(
        tx,
        rows.map((row) => row.id),
      );
      const names = await userNames(
        tx,
        rows.map((row) => row.createdBy),
      );
      return buildPage(
        rows.map((row) =>
          campaignDto(
            row,
            counts.get(row.id) ?? { sent: 0, failed: 0, pending: 0 },
            row.createdBy ? (names.get(row.createdBy) ?? null) : null,
          ),
        ),
        total,
        query,
      );
    });
  }

  async get(id: string): Promise<MessageCampaign> {
    return this.transactions.run((tx) => this.present(tx, id));
  }

  // ---------- an invoice or a receipt ----------

  /** Sends an invoice or a receipt to the customer as a PDF and says how it went. */
  async sendDocument(auth: AuthContext, body: unknown): Promise<MessageCampaign> {
    const input = SendDocumentRequestSchema.parse(body);
    // The PDF is made first: each of these opens its own transaction.
    const file =
      input.kind === 'INVOICE'
        ? await this.billing.pdf(input.id)
        : await this.payments.receipt(input.id);
    const created = await this.transactions.run(async (tx) => {
      const found =
        input.kind === 'INVOICE'
          ? await tx.invoice.findUnique({
              where: { id: input.id },
              select: {
                branchId: true,
                invoiceNo: true,
                total: true,
                customer: { select: { id: true, name: true, phone: true, email: true } },
              },
            })
          : await tx.payment.findUnique({
              where: { id: input.id },
              select: {
                branchId: true,
                receiptNo: true,
                amount: true,
                customer: { select: { id: true, name: true, phone: true, email: true } },
              },
            });
      if (!found)
        throw new NotFoundError(input.kind === 'INVOICE' ? 'Invoice' : 'Payment', input.id);
      const number = 'invoiceNo' in found ? found.invoiceNo : found.receiptNo;
      const amount = 'total' in found ? found.total : found.amount;
      const customer = found.customer;
      const to = this.checkAddress(
        input.channel,
        input.to ?? (input.channel === 'WHATSAPP' ? customer.phone : customer.email),
      );
      const company = await loadCompanyProfile(tx, 'Our shop');
      const text =
        input.message ??
        `Dear ${customer.name}, thank you. Your ${input.kind === 'INVOICE' ? 'invoice' : 'receipt'} ${number ?? ''} for Rs. ${inr(amount.toFixed(2))} from ${company.name} is attached.`;
      const campaign = await tx.messageCampaign.create({
        data: {
          branchId: found.branchId,
          kind: input.kind,
          channel: input.channel,
          subject:
            input.channel === 'EMAIL'
              ? `${input.kind === 'INVOICE' ? 'Invoice' : 'Receipt'} ${number ?? ''} from ${company.name}`.trim()
              : null,
          body: text,
          audience: `${customer.name} (${to})`,
          templateKey: input.kind,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      const delivery = await tx.messageDelivery.create({
        data: {
          branchId: found.branchId,
          campaignId: campaign.id,
          customerId: customer.id,
          recipientName: customer.name,
          toAddress: to,
          text,
          documentKind: input.kind,
          documentId: input.id,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'MESSAGE_DOCUMENT_SENT',
        entityType: 'MessageCampaign',
        entityId: campaign.id,
        branchId: found.branchId,
        newValue: { kind: input.kind, documentId: input.id, channel: input.channel, to },
      });
      return { campaign, delivery };
    });
    const result = await this.attempt(created.campaign, created.delivery, {
      bytes: file.body,
      fileName: file.fileName,
      mimeType: 'application/pdf',
    });
    await this.transactions.run(async (tx) => {
      await tx.messageDelivery.update({
        where: { id: created.delivery.id },
        data: {
          attempts: { increment: 1 },
          updatedBy: auth.userId,
          ...(result.ok
            ? {
                status: 'SENT',
                via: result.via,
                providerMessageId: result.messageId,
                error: null,
                sentAt: new Date(),
              }
            : { status: 'FAILED', error: result.error.slice(0, 500) }),
        },
      });
    });
    return this.transactions.run((tx) => this.present(tx, created.campaign.id));
  }

  // ---------- opt-outs ----------

  async listOptOuts(): Promise<MessageOptOutListResponse> {
    return this.transactions.run(async (tx) => {
      const rows = await tx.messageOptOut.findMany({
        include: { customer: { select: { name: true, phone: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1000,
      });
      return {
        items: rows.map((row): MessageOptOut => ({
          customerId: row.customerId,
          customerName: row.customer.name,
          phone: row.customer.phone,
          reason: row.reason,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    });
  }

  /** Puts a customer on the list of people who get no bulk messages. Asking twice does no harm. */
  async addOptOut(auth: AuthContext, body: unknown): Promise<MessageOptOut> {
    const input = AddOptOutRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: input.customerId },
        select: { id: true, name: true, phone: true },
      });
      if (!customer) throw new NotFoundError('Customer', input.customerId);
      const existing = await tx.messageOptOut.findUnique({ where: { customerId: customer.id } });
      const row =
        existing ??
        (await tx.messageOptOut.create({
          data: {
            customerId: customer.id,
            reason: input.reason ?? null,
            createdBy: auth.userId,
            updatedBy: auth.userId,
          },
        }));
      if (!existing)
        await this.audit.record(tx, {
          action: 'MESSAGE_OPT_OUT_ADDED',
          entityType: 'Customer',
          entityId: customer.id,
          newValue: { reason: input.reason ?? null },
        });
      return {
        customerId: customer.id,
        customerName: customer.name,
        phone: customer.phone,
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async removeOptOut(customerId: string): Promise<MessageOptOutListResponse> {
    await this.transactions.run(async (tx) => {
      const existing = await tx.messageOptOut.findUnique({ where: { customerId } });
      if (!existing) throw new NotFoundError('Opt-out', customerId);
      await tx.messageOptOut.delete({ where: { customerId } });
      await this.audit.record(tx, {
        action: 'MESSAGE_OPT_OUT_REMOVED',
        entityType: 'Customer',
        entityId: customerId,
        oldValue: { reason: existing.reason },
      });
    });
    return this.listOptOuts();
  }

  // ---------- helpers ----------

  /** One send, by the channel of the campaign. Never throws: the result says what happened. */
  private async attempt(
    campaign: { channel: string; subject: string | null; templateKey: string },
    delivery: { toAddress: string; text: string },
    document?: { bytes: Buffer; fileName: string; mimeType: string },
  ): Promise<
    | { ok: true; via: 'TEXT' | 'DOCUMENT' | 'TEMPLATE' | 'EMAIL'; messageId: string }
    | { ok: false; error: string; permanent: boolean }
  > {
    try {
      if (campaign.channel === 'EMAIL') {
        const sent = await this.mail.send({
          to: delivery.toAddress,
          subject: campaign.subject ?? 'Message',
          text: delivery.text,
          ...(document ? { attachment: document } : {}),
        });
        return { ok: true, via: 'EMAIL', messageId: sent.messageId };
      }
      const to = toWhatsAppNumber(delivery.toAddress, this.env.WHATSAPP_COUNTRY_CODE);
      try {
        if (document) {
          const sent = await this.whatsapp.sendDocument(to, document, delivery.text);
          return { ok: true, via: 'DOCUMENT', messageId: sent.messageId };
        }
        const sent = await this.whatsapp.sendText(to, delivery.text);
        return { ok: true, via: 'TEXT', messageId: sent.messageId };
      } catch (error) {
        if (!(error instanceof OutsideWindowError)) throw error;
        // The customer has not written in the last 24 hours: only a template may be sent to them.
        const key = campaign.templateKey as MessageTemplateKey;
        if (!this.whatsapp.hasTemplate(key))
          return {
            ok: false,
            permanent: true,
            error: `The customer has not written to you on WhatsApp in the last 24 hours, so only a template message can be sent, and no template is set up (${TEMPLATE_SETTINGS[key]})`,
          };
        const sent = await this.whatsapp.sendTemplate(to, delivery.text, key);
        return { ok: true, via: 'TEMPLATE', messageId: sent.messageId };
      }
    } catch (error) {
      return {
        ok: false,
        permanent: error instanceof PermanentSendError,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** The customers an audience means, each with what they owe. */
  private async audience(
    tx: TxClient,
    audience: Audience,
  ): Promise<{
    people: { id: string; name: string; phone: string; email: string | null; due: string }[];
    optedOut: number;
  }> {
    const dues = await tx.$queryRaw<{ customer_id: string; due: Prisma.Decimal }[]>(Prisma.sql`
      SELECT b.customer_id, SUM(b.outstanding_value) AS due
      FROM (${balancesSql(Prisma.sql`TRUE`)}) b
      WHERE b.outstanding_value > 0 GROUP BY b.customer_id`);
    const owed = new Map(
      dues.map((row) => [row.customer_id, new Prisma.Decimal(row.due).toFixed(2)]),
    );
    const customers = await tx.customer.findMany({
      where: {
        ...(audience.kind === 'SELECTED' ? { id: { in: audience.customerIds } } : {}),
        ...(audience.kind === 'DUES' ? { id: { in: [...owed.keys()] } } : {}),
      },
      select: { id: true, name: true, phone: true, email: true },
      orderBy: { name: 'asc' },
    });
    if (audience.kind === 'SELECTED' && customers.length !== new Set(audience.customerIds).size)
      throw new ValidationFailedError('Some of the customers were not found', [
        { field: 'audience', message: 'One or more chosen customers do not exist' },
      ]);
    const stopped = new Set(
      (
        await tx.messageOptOut.findMany({
          where: { customerId: { in: customers.map((customer) => customer.id) } },
          select: { customerId: true },
        })
      ).map((row) => row.customerId),
    );
    const seen = new Set<string>();
    const people = customers
      .filter((customer) => !stopped.has(customer.id))
      .map((customer) => ({ ...customer, due: owed.get(customer.id) ?? '0.00' }))
      .filter((customer) => {
        // One person with two records, or two people sharing a number, is messaged once.
        const key = customer.phone.replace(/\D/g, '').slice(-10) || customer.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return { people, optedOut: stopped.size };
  }

  private addressOf(
    person: { phone: string; email: string | null },
    channel: MessageChannel,
  ): string | null {
    if (channel === 'EMAIL')
      return person.email && isEmailAddress(person.email) ? person.email : null;
    try {
      toWhatsAppNumber(person.phone, this.env.WHATSAPP_COUNTRY_CODE);
      return person.phone;
    } catch {
      return null;
    }
  }

  private checkAddress(channel: MessageChannel, value: string | null): string {
    if (!value)
      throw new ValidationFailedError('There is nowhere to send this', [
        {
          field: 'to',
          message:
            channel === 'WHATSAPP'
              ? 'The customer has no phone number. Enter one'
              : 'The customer has no email address. Enter one',
        },
      ]);
    if (channel === 'EMAIL' && !isEmailAddress(value))
      throw new ValidationFailedError('That is not an email address', [
        { field: 'to', message: 'Enter an email address such as name@example.com' },
      ]);
    if (channel === 'WHATSAPP') {
      try {
        toWhatsAppNumber(value, this.env.WHATSAPP_COUNTRY_CODE);
      } catch (error) {
        throw new ValidationFailedError('That is not a phone number', [
          { field: 'to', message: (error as Error).message },
        ]);
      }
    }
    return value;
  }

  private describe(audience: Audience, reached: number): string {
    const who =
      audience.kind === 'ALL'
        ? 'All customers'
        : audience.kind === 'DUES'
          ? 'Customers who owe money'
          : 'Chosen customers';
    return `${who} (${reached})`;
  }

  private resolveBranch(requested: string | undefined): string {
    if (requested) return requested;
    const context = this.contexts.require();
    const only = context.branchIds[0];
    if (!context.isSuperAdmin && context.branchIds.length === 1 && only) return only;
    throw new ValidationFailedError('Choose the branch', [
      { field: 'branchId', message: 'Choose a branch' },
    ]);
  }

  private async counts(
    tx: TxClient,
    ids: string[],
  ): Promise<Map<string, { sent: number; failed: number; pending: number }>> {
    const result = new Map<string, { sent: number; failed: number; pending: number }>();
    if (ids.length === 0) return result;
    const grouped = await tx.messageDelivery.groupBy({
      by: ['campaignId', 'status'],
      where: { campaignId: { in: ids } },
      _count: { _all: true },
    });
    for (const row of grouped) {
      const entry = result.get(row.campaignId) ?? { sent: 0, failed: 0, pending: 0 };
      if (row.status === 'SENT') entry.sent = row._count._all;
      else if (row.status === 'FAILED') entry.failed = row._count._all;
      else entry.pending = row._count._all;
      result.set(row.campaignId, entry);
    }
    return result;
  }

  private async present(tx: TxClient, id: string): Promise<MessageCampaign> {
    const row = await tx.messageCampaign.findUnique({
      where: { id },
      include: { deliveries: { orderBy: [{ recipientName: 'asc' }, { id: 'asc' }], take: 2000 } },
    });
    if (!row) throw new NotFoundError('Message campaign', id);
    const counts = await this.counts(tx, [id]);
    const names = await userNames(tx, [row.createdBy]);
    const { deliveries, ...campaign } = row;
    return campaignDto(
      campaign,
      counts.get(id) ?? { sent: 0, failed: 0, pending: 0 },
      row.createdBy ? (names.get(row.createdBy) ?? null) : null,
      deliveries,
    );
  }
}
