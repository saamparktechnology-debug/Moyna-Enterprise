import { Prisma } from '@prisma/client';
import { multiplyMoney, roundMoney } from '../../common/money/money.js';
import type { Money } from '../../common/money/money.js';

/** Who is looking. A Super Admin sees profit worked out on the real cost; everyone else on the shown cost. */
export interface ProfitViewer {
  isSuperAdmin: boolean;
}

export interface ProfitLine {
  qty: number;
  taxableAmount: Prisma.Decimal;
  unitCostActual: Prisma.Decimal | null;
  unitCostDisplay: Prisma.Decimal | null;
}

/** The unit cost this viewer is allowed to know, or `null` when none was recorded for them. */
export function unitCostFor(line: ProfitLine, viewer: ProfitViewer): Prisma.Decimal | null {
  return viewer.isSuperAdmin ? line.unitCostActual : line.unitCostDisplay;
}

/** Sale value before GST and after discount, less what the units cost. `null` when no cost is known. */
export function lineProfit(line: ProfitLine, viewer: ProfitViewer): Money | null {
  const cost = unitCostFor(line, viewer);
  if (cost === null) return null;
  return roundMoney(line.taxableAmount.minus(multiplyMoney(cost, line.qty)));
}

/** The sum over all lines, or `null` when there are none or any line has no cost (a partial total would mislead). */
export function invoiceProfit(lines: readonly ProfitLine[], viewer: ProfitViewer): Money | null {
  if (lines.length === 0) return null;
  let total = new Prisma.Decimal(0);
  for (const line of lines) {
    const profit = lineProfit(line, viewer);
    if (profit === null) return null;
    total = total.plus(profit);
  }
  return total;
}
