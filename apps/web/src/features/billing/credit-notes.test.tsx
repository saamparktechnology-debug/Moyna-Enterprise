import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CreditNote, CreditNoteSummary, ReturnableLine } from '@erp/contracts';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { CASHIER, ISSUED, MANAGER, billingHandlers, makeInvoice, pageOf } from './test-data';

const APPROVER = [...MANAGER, 'credit_notes.create', 'credit_notes.approve'];
const REQUESTER = [...CASHIER, 'credit_notes.create'];

const note = (over: Partial<CreditNote> = {}): CreditNote => ({
  id: 'cn-1',
  creditNoteNo: null,
  status: 'PENDING',
  branchId: 'b-1',
  branchCode: 'HQ',
  invoiceId: 'inv-1',
  invoiceNo: 'HQ/GI/26-27/00001',
  customerName: 'Ravi Kumar',
  reason: 'Customer returned them',
  taxableValue: '1000.00',
  cgstAmount: '0.00',
  sgstAmount: '0.00',
  igstAmount: '180.00',
  amount: '1180.00',
  requestedByName: 'Asha Rao',
  createdAt: '2026-10-09T00:00:00.000Z',
  decidedByName: null,
  decidedAt: null,
  decisionNote: null,
  rowVersion: 3,
  lines: [
    {
      id: 'cl-1',
      invoiceLineId: 'l-1',
      itemId: 'i-1',
      itemCode: 'BATT-48V',
      itemName: '48V battery',
      serialUnitId: null,
      serialNo: null,
      qty: 1,
      taxableAmount: '1000.00',
      cgstAmount: '0.00',
      sgstAmount: '0.00',
      igstAmount: '180.00',
      amount: '1180.00',
    },
  ],
  ...over,
});
const summaryOf = (n: CreditNote): CreditNoteSummary => ({
  id: n.id,
  creditNoteNo: n.creditNoteNo,
  status: n.status,
  branchCode: n.branchCode,
  invoiceId: n.invoiceId,
  invoiceNo: n.invoiceNo,
  customerName: n.customerName,
  amount: n.amount,
  requestedByName: n.requestedByName,
  lineCount: n.lines.length,
  createdAt: n.createdAt,
});
const returnable: ReturnableLine[] = [
  {
    invoiceLineId: 'l-1',
    itemCode: 'BATT-48V',
    itemName: '48V battery',
    serialNo: null,
    soldQty: 4,
    creditedQty: 1,
    returnableQty: 3,
  },
  {
    invoiceLineId: 'l-2',
    itemCode: 'TOTO-X1',
    itemName: 'TOTO X1',
    serialNo: 'SN-1',
    soldQty: 1,
    creditedQty: 1,
    returnableQty: 0,
  },
];

const handlers = (
  permissions: string[],
  notes: CreditNote[] = [note()],
  extra: Record<string, RouteHandler> = {},
): Record<string, RouteHandler> => ({
  ...billingHandlers(permissions, [
    ISSUED(),
    makeInvoice({ id: 'inv-2', customerName: 'Draft Customer' }),
  ]),
  'GET /api/credit-notes?*': () => jsonResponse(pageOf(notes.map(summaryOf))),
  ...Object.fromEntries(notes.map((n) => [`GET /api/credit-notes/${n.id}`, () => jsonResponse(n)])),
  'GET /api/invoices/inv-1/returnable': () => jsonResponse(returnable),
  ...extra,
});
const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.find((call) => call.key === key)?.body as Record<string, unknown>;
const openTab = async (h: Record<string, RouteHandler>) => {
  const state = routeFetch(h);
  renderApp('/sales');
  await userEvent.click(await screen.findByRole('tab', { name: 'Credit notes' }));
  return state;
};
const openNote = async (
  permissions: string[],
  notes: CreditNote[] = [note()],
  extra: Record<string, RouteHandler> = {},
) => {
  const state = await openTab(handlers(permissions, notes, extra));
  const first = notes[0]!;
  await userEvent.click(
    await screen.findByRole('button', {
      name: `Open credit note ${first.creditNoteNo ?? `for ${first.customerName}`}`,
    }),
  );
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('table', { name: 'Credit note lines' });
  return { ...state, dialog };
};

describe('the credit notes list', () => {
  it('shows each credit note with its number, invoice, amount, status and who asked', async () => {
    await openTab(
      handlers(APPROVER, [
        note(),
        note({
          id: 'cn-2',
          creditNoteNo: 'HQ/CN/26-27/00001',
          status: 'APPROVED',
          amount: '500.00',
        }),
        note({ id: 'cn-3', status: 'REJECTED' }),
      ]),
    );
    const rows = within(await screen.findByRole('table', { name: 'Credit notes' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Not numbered');
    expect(rows[0]).toHaveTextContent('Waiting for approval');
    expect(rows[0]).toHaveTextContent('Asha Rao');
    expect(rows[1]).toHaveTextContent('HQ/CN/26-27/00001');
    expect(rows[1]).toHaveTextContent('Approved');
    expect(rows[2]).toHaveTextContent('Rejected');
  });

  it('explains an empty list and recovers from an error', async () => {
    let fail = true;
    await openTab(
      handlers(APPROVER, [], {
        'GET /api/credit-notes?*': () =>
          fail
            ? jsonResponse(
                { code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' },
                500,
              )
            : jsonResponse(pageOf([])),
      }),
    );
    expect(await screen.findByText('Could not load the credit notes.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('There are no credit notes yet.')).toBeInTheDocument();
  });

  it('asks the server for the search and status the user chose', async () => {
    const { calls } = await openTab(handlers(APPROVER));
    await screen.findByRole('table', { name: 'Credit notes' });
    await userEvent.type(screen.getByLabelText('Search credit notes'), 'ravi');
    await userEvent.selectOptions(screen.getByLabelText('Credit note status'), 'PENDING');
    await waitFor(() => {
      const last =
        calls.filter((c) => c.key.startsWith('GET /api/credit-notes?')).at(-1)?.key ?? '';
      expect(last).toContain('search=ravi');
      expect(last).toContain('status=PENDING');
    });
  });
});

describe('deciding on a credit note', () => {
  it('downloads the credit note as a PDF, even while it waits', async () => {
    const created = vi.fn(() => 'blob:credit-note');
    Object.assign(URL, { createObjectURL: created });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const { dialog, calls } = await openNote(APPROVER, [note()], {
      'GET /api/credit-notes/cn-1/pdf': () =>
        new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } }),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(created).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.key === 'GET /api/credit-notes/cn-1/pdf')).toHaveLength(1);
    click.mockRestore();
  });

  it('shows the lines, the tax and the total', async () => {
    const { dialog } = await openNote(APPROVER);
    const line = within(
      within(dialog).getByRole('table', { name: 'Credit note lines' }),
    ).getAllByRole('row')[1];
    expect(line).toHaveTextContent('BATT-48V · 48V battery');
    expect(line).toHaveTextContent('180.00');
    expect(within(dialog).getByText('Total credited: 1180.00')).toBeInTheDocument();
    expect(within(dialog).getByText('Customer returned them')).toBeInTheDocument();
  });

  it('lets an approver approve it with the version that was read, and says which number it got', async () => {
    const { dialog, calls } = await openNote(APPROVER, [note()], {
      'POST /api/credit-notes/cn-1/approve': () =>
        jsonResponse(note({ status: 'APPROVED', creditNoteNo: 'HQ/CN/26-27/00001' })),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Credit note HQ/CN/26-27/00001 approved')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/credit-notes/cn-1/approve')).toEqual({ rowVersion: 3 });
  });

  it('shows why the server refused, such as approving your own request', async () => {
    const { dialog } = await openNote(APPROVER, [note()], {
      'POST /api/credit-notes/cn-1/approve': () =>
        jsonResponse(
          {
            code: 'FORBIDDEN',
            message:
              'You cannot approve a credit note you asked for. Ask another approver to approve it',
            details: [],
            requestId: 'r',
          },
          403,
        ),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(
      await within(dialog).findByText(/cannot approve a credit note you asked for/),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('needs a reason to reject, then rejects with it', async () => {
    const { dialog, calls } = await openNote(APPROVER, [note()], {
      'POST /api/credit-notes/cn-1/reject': () =>
        jsonResponse(note({ status: 'REJECTED', decisionNote: 'Used' })),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(
      await within(dialog).findByText('Give a reason of at least 3 characters'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.key.endsWith('/reject'))).toBe(false);
    await userEvent.type(within(dialog).getByLabelText('Reason for rejecting'), 'Goods were used');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(
      await screen.findByText(/Credit note request for HQ\/GI\/26-27\/00001 rejected/),
    ).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/credit-notes/cn-1/reject')).toEqual({
      rowVersion: 3,
      reason: 'Goods were used',
    });
  });

  it('lets someone who may only ask withdraw their request but not approve it', async () => {
    const { dialog } = await openNote(REQUESTER);
    expect(within(dialog).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('shows a decided credit note with who decided it and no way to decide it again', async () => {
    const { dialog } = await openNote(APPROVER, [
      note({ status: 'APPROVED', creditNoteNo: 'HQ/CN/26-27/00001', decidedByName: 'Meera Das' }),
    ]);
    expect(within(dialog).getByText('Meera Das')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });
});

describe('asking for a credit note from an invoice', () => {
  const openRequest = async (permissions: string[], extra: Record<string, RouteHandler> = {}) => {
    const state = routeFetch(handlers(permissions, [note()], extra));
    renderApp('/sales');
    await userEvent.click(await screen.findByRole('button', { name: 'Open HQ/GI/26-27/00001' }));
    const detail = await screen.findByRole('dialog');
    await within(detail).findByRole('table', { name: 'Invoice lines' });
    await userEvent.click(within(detail).getByRole('button', { name: 'Raise credit note' }));
    const dialog = await screen.findByRole('dialog', { name: /Credit note for/ });
    await within(dialog).findByRole('table', { name: 'Lines to credit' });
    return { ...state, dialog };
  };

  it('shows what was sold and what can still be credited, and offers nothing for a line that is done', async () => {
    const { dialog } = await openRequest(REQUESTER);
    const [open, done] = within(within(dialog).getByRole('table', { name: 'Lines to credit' }))
      .getAllByRole('row')
      .slice(1);
    expect(open).toHaveTextContent('BATT-48V 48V battery');
    expect(within(open!).getByLabelText('Quantity to credit for BATT-48V')).toHaveAttribute(
      'placeholder',
      'up to 3',
    );
    expect(done).toHaveTextContent('TOTO-X1 TOTO X1 S/N: SN-1');
    expect(done).toHaveTextContent('Nothing left');
    expect(
      within(dialog).queryByLabelText('Quantity to credit for TOTO-X1'),
    ).not.toBeInTheDocument();
  });

  it('needs a line and a reason before it sends anything', async () => {
    const { dialog, calls } = await openRequest(REQUESTER);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request credit note' }));
    expect(
      await within(dialog).findByText('Choose at least one line to credit'),
    ).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Quantity to credit for BATT-48V'), '2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request credit note' }));
    expect(
      await within(dialog).findByText('Give a reason of at least 3 characters'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/credit-notes')).toBe(false);
  });

  it('sends the request and says it is waiting for approval', async () => {
    const { dialog, calls } = await openRequest(REQUESTER, {
      'POST /api/credit-notes': () => jsonResponse(note(), 201),
    });
    await userEvent.type(within(dialog).getByLabelText('Quantity to credit for BATT-48V'), '2');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Faulty cells');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request credit note' }));
    expect(
      await screen.findByText(
        'Credit note request for HQ/GI/26-27/00001 sent. It is waiting for approval.',
      ),
    ).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/credit-notes')).toEqual({
      invoiceId: 'inv-1',
      reason: 'Faulty cells',
      lines: [{ invoiceLineId: 'l-1', qty: 2 }],
    });
    expect(screen.getByRole('tab', { name: 'Credit notes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('shows the server’s reasons, such as crediting more than is left', async () => {
    const { dialog } = await openRequest(REQUESTER, {
      'POST /api/credit-notes': () =>
        jsonResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'The credit note has problems',
            details: [{ field: 'lines.0.qty', message: 'Only 1 can still be credited' }],
            requestId: 'r',
          },
          400,
        ),
    });
    await userEvent.type(within(dialog).getByLabelText('Quantity to credit for BATT-48V'), '3');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Faulty cells');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request credit note' }));
    expect(await within(dialog).findByText('The credit note has problems')).toBeInTheDocument();
    expect(within(dialog).getByText('Only 1 can still be credited')).toBeInTheDocument();
  });

  it('offers a credit note only for an issued invoice and only to people who may ask', async () => {
    routeFetch(handlers(CASHIER));
    renderApp('/sales');
    await userEvent.click(await screen.findByRole('button', { name: 'Open HQ/GI/26-27/00001' }));
    const detail = await screen.findByRole('dialog');
    await within(detail).findByRole('table', { name: 'Invoice lines' });
    expect(
      within(detail).queryByRole('button', { name: 'Raise credit note' }),
    ).not.toBeInTheDocument();
  });
});
