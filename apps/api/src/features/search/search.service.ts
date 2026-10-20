import { Inject, Injectable } from '@nestjs/common';
import { SearchQuerySchema } from '@erp/contracts';
import type { SearchResponse, SearchResult, SearchType } from '@erp/contracts';
import type { Prisma } from '@prisma/client';
import { escapeLike } from '../../common/pagination/pagination.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import type { AuthContext } from '../auth/auth.types.js';

type Tx = TxClient;

/** The permission needed to search each kind of record. */
const NEEDS: Record<SearchType, string> = {
  ITEM: 'items.view',
  SERIAL: 'stock.view',
  INVOICE: 'invoices.view',
  CUSTOMER: 'customers.view',
};
const ORDER: SearchType[] = ['ITEM', 'SERIAL', 'INVOICE', 'CUSTOMER'];

const rupees = (value: Prisma.Decimal | string): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value));

/**
 * One box that finds an item by barcode or code, a serial number, an invoice by its number, or a customer by name
 * or phone. Only the kinds of record the caller may view are searched, and row-level security limits the rest to the
 * caller's branches. Exact matches come first.
 */
@Injectable()
export class SearchService {
  constructor(@Inject(TransactionService) private readonly transactions: TransactionService) {}

  async search(auth: AuthContext, rawQuery: unknown): Promise<SearchResponse> {
    const query = SearchQuerySchema.parse(rawQuery);
    const term = query.q;
    const allowed = ORDER.filter(
      (type) =>
        (!query.types || query.types.includes(type)) &&
        (auth.isSuperAdmin || auth.permissions.includes(NEEDS[type])),
    );

    return this.transactions.run(async (tx) => {
      const results: SearchResult[] = [];
      for (const type of allowed) {
        const found =
          type === 'ITEM'
            ? await this.items(tx, term, query.limit)
            : type === 'SERIAL'
              ? await this.serials(tx, term, query.limit)
              : type === 'INVOICE'
                ? await this.invoices(tx, term, query.limit)
                : await this.customers(tx, term, query.limit);
        results.push(...found);
      }
      return { query: term, results, searched: allowed };
    });
  }

  private async items(tx: Tx, term: string, limit: number): Promise<SearchResult[]> {
    const byBarcode = await tx.itemBarcode.findMany({
      where: { barcode: { equals: term, mode: 'insensitive' } },
      include: { item: true },
      take: limit,
    });
    const exactIds = new Set<string>();
    const out: SearchResult[] = [];
    for (const row of byBarcode) {
      exactIds.add(row.item.id);
      out.push({
        type: 'ITEM',
        id: row.item.id,
        title: `${row.item.itemCode} · ${row.item.name}`,
        subtitle: `Barcode ${row.barcode}${row.item.isActive ? '' : ' · inactive'}`,
        link: '/items',
        matchedOn: 'BARCODE',
        exact: true,
        branchCode: null,
      });
    }
    const rows = await tx.item.findMany({
      where: {
        id: { notIn: [...exactIds] },
        OR: [
          { itemCode: { contains: escapeLike(term), mode: 'insensitive' } },
          { name: { contains: escapeLike(term), mode: 'insensitive' } },
        ],
      },
      orderBy: [{ itemCode: 'asc' }],
      take: Math.max(limit - out.length, 0) + 5,
    });
    const exactCode = rows.filter((row) => row.itemCode.toLowerCase() === term.toLowerCase());
    const rest = rows.filter((row) => !exactCode.includes(row));
    for (const row of [...exactCode, ...rest].slice(0, Math.max(limit - out.length, 0))) {
      const exact = row.itemCode.toLowerCase() === term.toLowerCase();
      const codeHit = row.itemCode.toLowerCase().includes(term.toLowerCase());
      out.push({
        type: 'ITEM',
        id: row.id,
        title: `${row.itemCode} · ${row.name}`,
        subtitle: row.isActive ? 'Item' : 'Item · inactive',
        link: '/items',
        matchedOn: codeHit ? 'ITEM_CODE' : 'NAME',
        exact,
        branchCode: null,
      });
    }
    return out;
  }

  private async serials(tx: Tx, term: string, limit: number): Promise<SearchResult[]> {
    const upper = term.toUpperCase();
    const rows = await tx.serialUnit.findMany({
      where: { serialNo: { contains: escapeLike(upper), mode: 'insensitive' } },
      include: { item: true, branch: true },
      orderBy: [{ serialNo: 'asc' }],
      take: limit + 20,
    });
    rows.sort((a, b) => Number(b.serialNo === upper) - Number(a.serialNo === upper));
    return rows.slice(0, limit).map((row) => ({
      type: 'SERIAL',
      id: row.id,
      title: row.serialNo,
      subtitle: `${row.item.itemCode} · ${row.state.toLowerCase().replaceAll('_', ' ')} · ${row.branch.code}`,
      link: '/inventory',
      matchedOn: 'SERIAL',
      exact: row.serialNo === upper,
      branchCode: row.branch.code,
    }));
  }

  private async invoices(tx: Tx, term: string, limit: number): Promise<SearchResult[]> {
    const rows = await tx.invoice.findMany({
      where: { invoiceNo: { contains: escapeLike(term), mode: 'insensitive' } },
      include: { customer: true, branch: true },
      orderBy: [{ issuedOn: 'desc' }, { id: 'asc' }],
      take: limit + 20,
    });
    const isExact = (no: string | null): boolean => no?.toLowerCase() === term.toLowerCase();
    rows.sort((a, b) => Number(isExact(b.invoiceNo)) - Number(isExact(a.invoiceNo)));
    return rows.slice(0, limit).map((row) => ({
      type: 'INVOICE',
      id: row.id,
      title: row.invoiceNo ?? 'Draft invoice',
      subtitle: `${row.customer.name} · ${rupees(row.total.toString())} · ${row.status.toLowerCase()}`,
      link: '/sales',
      matchedOn: 'INVOICE_NO',
      exact: isExact(row.invoiceNo),
      branchCode: row.branch.code,
    }));
  }

  private async customers(tx: Tx, term: string, limit: number): Promise<SearchResult[]> {
    const digits = term.replace(/\D/g, '');
    // Only something that looks like a phone number (digits and the usual separators) searches phone numbers.
    const phoneLike = /^[\d\s+()-]+$/.test(term) && digits.length >= 2;
    const rows = await tx.customer.findMany({
      where: {
        OR: [
          { name: { contains: escapeLike(term), mode: 'insensitive' } },
          ...(phoneLike ? [{ phone: { contains: digits } }] : []),
        ],
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: limit + 20,
    });
    const exactPhone = (phone: string): boolean => phoneLike && phone === digits;
    rows.sort((a, b) => Number(exactPhone(b.phone)) - Number(exactPhone(a.phone)));
    return rows.slice(0, limit).map((row) => {
      const byName = row.name.toLowerCase().includes(term.toLowerCase());
      return {
        type: 'CUSTOMER',
        id: row.id,
        title: row.name,
        subtitle: row.phone,
        link: '/customers',
        matchedOn: byName ? 'NAME' : 'PHONE',
        exact: exactPhone(row.phone) || row.name.toLowerCase() === term.toLowerCase(),
        branchCode: null,
      } satisfies SearchResult;
    });
  }
}
