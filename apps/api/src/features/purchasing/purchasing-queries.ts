import type { PurchaseOrderStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';

export interface LineProgress {
  /** Good units accepted when the goods arrived. */
  acceptedAtReceipt: number;
  /** Damaged or excess units accepted afterwards. */
  acceptedLater: number;
  /** Units settled by writing them off, which will never arrive. */
  writtenOff: number;
  /** The part of those written-off units that was damaged, so the company bears the cost. */
  writtenOffDamaged: number;
}

const EMPTY: LineProgress = {
  acceptedAtReceipt: 0,
  acceptedLater: 0,
  writtenOff: 0,
  writtenOffDamaged: 0,
};

export const acceptedOf = (progress: LineProgress | undefined): number =>
  (progress?.acceptedAtReceipt ?? 0) + (progress?.acceptedLater ?? 0);

export const remainingOf = (ordered: number, progress: LineProgress | undefined): number =>
  Math.max(0, ordered - acceptedOf(progress) - (progress?.writtenOff ?? 0));

/** The units the company pays for: everything accepted, plus damaged units it chose to write off. */
export const chargedQtyOf = (progress: LineProgress | undefined): number =>
  acceptedOf(progress) + (progress?.writtenOffDamaged ?? 0);

/** How much of each line of the given purchase orders has been received, settled or written off. */
export async function lineProgress(
  tx: TxClient,
  poIds: readonly string[],
): Promise<Map<string, LineProgress>> {
  const result = new Map<string, LineProgress>();
  if (poIds.length === 0) return result;
  const rows = await tx.$queryRaw<
    {
      po_line_id: string;
      at_receipt: number;
      later: number;
      written_off: number;
      written_off_damaged: number;
    }[]
  >`
    SELECT pl.id AS po_line_id,
      COALESCE((SELECT SUM(rl.qty_accepted) FROM receipt_lines rl WHERE rl.po_line_id = pl.id), 0)::int AS at_receipt,
      COALESCE((SELECT SUM(d.qty) FROM discrepancies d JOIN receipt_lines rl ON rl.id = d.receipt_line_id
                WHERE rl.po_line_id = pl.id AND d.status = 'RESOLVED' AND d.resolution = 'ACCEPT'), 0)::int AS later,
      COALESCE((SELECT SUM(d.qty) FROM discrepancies d JOIN receipt_lines rl ON rl.id = d.receipt_line_id
                WHERE rl.po_line_id = pl.id AND d.status = 'RESOLVED' AND d.resolution = 'WRITE_OFF'
                  AND d.type IN ('DAMAGED', 'SHORT')), 0)::int AS written_off,
      COALESCE((SELECT SUM(d.qty) FROM discrepancies d JOIN receipt_lines rl ON rl.id = d.receipt_line_id
                WHERE rl.po_line_id = pl.id AND d.status = 'RESOLVED' AND d.resolution = 'WRITE_OFF'
                  AND d.type = 'DAMAGED'), 0)::int AS written_off_damaged
    FROM po_lines pl WHERE pl.po_id = ANY(${[...poIds]}::uuid[])`;
  for (const row of rows)
    result.set(row.po_line_id, {
      acceptedAtReceipt: row.at_receipt,
      acceptedLater: row.later,
      writtenOff: row.written_off,
      writtenOffDamaged: row.written_off_damaged,
    });
  return result;
}

export const progressOrEmpty = (map: Map<string, LineProgress>, lineId: string): LineProgress =>
  map.get(lineId) ?? EMPTY;

/** Moves an approved order between Approved, Partially received and Received as goods arrive and discrepancies close. */
export async function refreshPoStatus(tx: TxClient, poId: string): Promise<PurchaseOrderStatus> {
  const po = await tx.purchaseOrder.findUniqueOrThrow({
    where: { id: poId },
    include: { poLines: true },
  });
  if (po.status === 'DRAFT' || po.status === 'CANCELLED') return po.status;
  const progress = await lineProgress(tx, [poId]);
  const remaining = po.poLines.reduce(
    (sum, line) => sum + remainingOf(line.qtyOrdered, progress.get(line.id)),
    0,
  );
  const receipts = await tx.goodsReceipt.count({ where: { poId } });
  const next: PurchaseOrderStatus =
    remaining === 0 && receipts > 0 ? 'RECEIVED' : receipts > 0 ? 'PARTIALLY_RECEIVED' : 'APPROVED';
  if (next !== po.status)
    await tx.purchaseOrder.update({ where: { id: poId }, data: { status: next } });
  return next;
}

export interface SupplierBalanceRow {
  charged: Prisma.Decimal;
  credited: Prisma.Decimal;
  paid: Prisma.Decimal;
  outstanding: Prisma.Decimal;
}

/** What the company owes a supplier in the branches the caller can see: accepted goods less returns and payments. */
export async function supplierBalance(
  tx: TxClient,
  supplierId: string,
): Promise<SupplierBalanceRow> {
  const [charged] = await tx.$queryRaw<{ total: string }[]>`
    SELECT COALESCE(SUM(pl.unit_cost * (
      COALESCE((SELECT SUM(rl.qty_accepted) FROM receipt_lines rl WHERE rl.po_line_id = pl.id), 0) +
      COALESCE((SELECT SUM(d.qty) FROM discrepancies d JOIN receipt_lines rl ON rl.id = d.receipt_line_id
                WHERE rl.po_line_id = pl.id AND d.status = 'RESOLVED'
                  AND (d.resolution = 'ACCEPT' OR (d.resolution = 'WRITE_OFF' AND d.type = 'DAMAGED'))), 0))), 0)::text AS total
    FROM po_lines pl JOIN purchase_orders po ON po.id = pl.po_id
    WHERE po.supplier_id = ${supplierId}::uuid`;
  const [credited] = await tx.$queryRaw<{ total: string }[]>`
    SELECT COALESCE(SUM(prl.qty * prl.unit_cost), 0)::text AS total
    FROM purchase_return_lines prl JOIN purchase_returns pr ON pr.id = prl.return_id
    WHERE pr.supplier_id = ${supplierId}::uuid`;
  const [paid] = await tx.$queryRaw<{ total: string }[]>`
    SELECT COALESCE(SUM(amount), 0)::text AS total FROM supplier_payments WHERE supplier_id = ${supplierId}::uuid`;
  const c = new Prisma.Decimal(charged?.total ?? '0');
  const r = new Prisma.Decimal(credited?.total ?? '0');
  const p = new Prisma.Decimal(paid?.total ?? '0');
  return { charged: c, credited: r, paid: p, outstanding: c.minus(r).minus(p) };
}

export interface LedgerRow {
  at: Date;
  kind: 'RECEIPT' | 'ACCEPTED_LATER' | 'WRITTEN_OFF' | 'RETURN' | 'PAYMENT';
  doc_no: string;
  branch_code: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
  total: bigint;
}

/** The supplier ledger, newest first, with a running balance that is worked out oldest first. */
export async function supplierLedger(
  tx: TxClient,
  supplierId: string,
  skip: number,
  take: number,
): Promise<LedgerRow[]> {
  return tx.$queryRaw<LedgerRow[]>`
    WITH events AS (
      SELECT gr.received_at AS at, 'RECEIPT' AS kind, gr.grn_no AS doc_no, b.code AS branch_code,
             'Goods received against ' || po.po_no AS description,
             SUM(rl.qty_accepted * pl.unit_cost) AS debit, 0::numeric AS credit, gr.id::text AS tie
      FROM goods_receipts gr
      JOIN purchase_orders po ON po.id = gr.po_id
      JOIN branches b ON b.id = gr.branch_id
      JOIN receipt_lines rl ON rl.receipt_id = gr.id
      JOIN po_lines pl ON pl.id = rl.po_line_id
      WHERE po.supplier_id = ${supplierId}::uuid
      GROUP BY gr.id, gr.received_at, gr.grn_no, b.code, po.po_no
      HAVING SUM(rl.qty_accepted * pl.unit_cost) > 0
      UNION ALL
      SELECT d.resolved_at, CASE WHEN d.resolution = 'ACCEPT' THEN 'ACCEPTED_LATER' ELSE 'WRITTEN_OFF' END,
             gr.grn_no, b.code,
             CASE WHEN d.resolution = 'ACCEPT' THEN 'Accepted ' || d.qty || ' ' || lower(d.type::text) || ' unit(s)'
                  ELSE 'Wrote off ' || d.qty || ' damaged unit(s)' END,
             d.qty * pl.unit_cost, 0::numeric, d.id::text
      FROM discrepancies d
      JOIN receipt_lines rl ON rl.id = d.receipt_line_id
      JOIN goods_receipts gr ON gr.id = rl.receipt_id
      JOIN po_lines pl ON pl.id = rl.po_line_id
      JOIN purchase_orders po ON po.id = pl.po_id
      JOIN branches b ON b.id = d.branch_id
      WHERE po.supplier_id = ${supplierId}::uuid AND d.status = 'RESOLVED'
        AND (d.resolution = 'ACCEPT' OR (d.resolution = 'WRITE_OFF' AND d.type = 'DAMAGED'))
      UNION ALL
      SELECT pr.created_at, 'RETURN', pr.return_no, b.code, 'Returned to the supplier',
             0::numeric, SUM(prl.qty * prl.unit_cost), pr.id::text
      FROM purchase_returns pr
      JOIN branches b ON b.id = pr.branch_id
      JOIN purchase_return_lines prl ON prl.return_id = pr.id
      WHERE pr.supplier_id = ${supplierId}::uuid
      GROUP BY pr.id, pr.created_at, pr.return_no, b.code
      HAVING SUM(prl.qty * prl.unit_cost) > 0
      UNION ALL
      SELECT sp.created_at, 'PAYMENT', COALESCE(sp.reference, 'Payment'), b.code,
             'Paid on ' || to_char(sp.paid_on, 'YYYY-MM-DD') || ' by ' || sp.mode,
             0::numeric, sp.amount, sp.id::text
      FROM supplier_payments sp JOIN branches b ON b.id = sp.branch_id
      WHERE sp.supplier_id = ${supplierId}::uuid
    ), running AS (
      SELECT at, kind, doc_no, branch_code, description, debit, credit, tie,
             SUM(debit - credit) OVER (ORDER BY at, tie ROWS UNBOUNDED PRECEDING) AS balance
      FROM events
    )
    SELECT at, kind, doc_no, branch_code, description, debit::text, credit::text, balance::text,
           COUNT(*) OVER () AS total
    FROM running ORDER BY at DESC, tie DESC LIMIT ${take} OFFSET ${skip}`;
}
