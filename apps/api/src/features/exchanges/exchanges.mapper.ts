import { Prisma } from '@prisma/client';
import type {
  Exchange,
  ExchangeDispositionName,
  ExchangeKindName,
  ExchangeSummary,
  ExchangeUnit,
} from '@erp/contracts';
import { settlementOf } from '@erp/contracts';

const UNIT_SELECT = {
  id: true,
  serialNo: true,
  chassisNo: true,
  motorNo: true,
  state: true,
  item: { select: { itemCode: true, name: true } },
  installedBatteries: {
    select: { serialUnit: { select: { id: true, serialNo: true } } },
    orderBy: { serialUnitId: 'asc' },
  },
} satisfies Prisma.SerialUnitSelect;

export const EXCHANGE_INCLUDE = {
  branch: { select: { code: true } },
  invoice: { select: { invoiceNo: true, customerId: true, customer: { select: { name: true } } } },
  originalInvoice: { select: { invoiceNo: true } },
  oldSerialUnit: { select: UNIT_SELECT },
  newSerialUnit: { select: UNIT_SELECT },
  tradeInPayment: {
    select: {
      id: true,
      receiptNo: true,
      amount: true,
      paymentAllocations: { select: { invoiceId: true, amount: true } },
    },
  },
} satisfies Prisma.ExchangeInclude;

export type ExchangeRow = Prisma.ExchangeGetPayload<{ include: typeof EXCHANGE_INCLUDE }>;

type UnitRow = ExchangeRow['oldSerialUnit'];

function toUnit(unit: UnitRow): ExchangeUnit {
  return {
    id: unit.id,
    serialNo: unit.serialNo,
    itemCode: unit.item.itemCode,
    itemName: unit.item.name,
    chassisNo: unit.chassisNo,
    motorNo: unit.motorNo,
    state: unit.state,
    batteries: unit.installedBatteries.map((b) => ({
      id: b.serialUnit.id,
      serialNo: b.serialUnit.serialNo,
    })),
  };
}

export function toSummaryDto(row: ExchangeRow): ExchangeSummary {
  const difference = row.differenceAmount.toFixed(2);
  return {
    id: row.id,
    exchangeNo: row.exchangeNo,
    status: row.status,
    kind: row.kind as ExchangeKindName,
    branchId: row.branchId,
    branchCode: row.branch.code,
    customerId: row.invoice.customerId,
    customerName: row.invoice.customer.name,
    invoiceId: row.invoiceId,
    invoiceNo: row.invoice.invoiceNo,
    originalInvoiceId: row.originalInvoiceId,
    originalInvoiceNo: row.originalInvoice.invoiceNo,
    oldSerialNo: row.oldSerialUnit.serialNo,
    newSerialNo: row.newSerialUnit.serialNo,
    valuationAmount: row.valuationAmount.toFixed(2),
    newAmount: row.newAmount.toFixed(2),
    differenceAmount: difference,
    settlement: settlementOf(difference),
    disposition: row.disposition as ExchangeDispositionName,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toExchangeDto(row: ExchangeRow, names: ReadonlyMap<string, string>): Exchange {
  const payment = row.tradeInPayment;
  return {
    ...toSummaryDto(row),
    reason: row.reason,
    returnedAmount: row.returnedAmount.toFixed(2),
    decisionNote: row.decisionNote,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedByName: row.decidedBy ? (names.get(row.decidedBy) ?? null) : null,
    createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
    rowVersion: row.rowVersion,
    oldUnit: toUnit(row.oldSerialUnit),
    newUnit: toUnit(row.newSerialUnit),
    tradeInPayment: payment
      ? {
          id: payment.id,
          receiptNo: payment.receiptNo,
          amount: payment.amount.toFixed(2),
          appliedToInvoice: payment.paymentAllocations
            .filter((a) => a.invoiceId === row.invoiceId)
            .reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0))
            .toFixed(2),
        }
      : null,
  };
}

export function userIdsOf(row: ExchangeRow): string[] {
  return [row.createdBy, row.decidedBy].flatMap((id) => (id ? [id] : []));
}
