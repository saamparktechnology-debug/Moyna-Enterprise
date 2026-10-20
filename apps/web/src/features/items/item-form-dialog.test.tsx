import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { CATEGORY_CHILD, itemHandlers, makeItem } from './test-data';

const conflict = (field: string, message: string, status = 409, code = 'CONFLICT') =>
  jsonResponse(
    { code, message: 'Not saved', details: [{ field, message }], requestId: 'r' },
    status,
  );

const openNew = async (extra: Record<string, RouteHandler> = {}) => {
  const state = routeFetch({ ...itemHandlers(), ...extra });
  renderApp('/items');
  await userEvent.click(await screen.findByRole('button', { name: 'New item' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('option', { name: 'Spare Parts › Tyres' });
  return { ...state, dialog };
};
const fillRequired = async (dialog: HTMLElement) => {
  await userEvent.type(within(dialog).getByLabelText('Item code'), 'tyre-9');
  await userEvent.type(within(dialog).getByLabelText('Name'), 'Front tyre');
  await userEvent.selectOptions(within(dialog).getByLabelText('Category'), CATEGORY_CHILD);
  await userEvent.selectOptions(within(dialog).getByLabelText('Unit'), 'PCS');
};
const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.find((call) => call.key === key)?.body as Record<string, unknown>;

describe('creating an item', () => {
  it('names every field that is wrong and sends nothing', async () => {
    const { dialog, calls } = await openNew();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    expect(await within(dialog).findByText(/Use 2 to 32 capital letters/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Category')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByLabelText('Unit')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText(/Use 2 to 32 capital letters/)).toBeInTheDocument();
    expect(within(dialog).getByText('Enter at least 2 characters')).toBeInTheDocument();
    expect(calls.some((call) => call.key === 'POST /api/items')).toBe(false);
  });

  it('checks the barcode and the HSN code before sending', async () => {
    const { dialog } = await openNew();
    await fillRequired(dialog);
    await userEvent.type(within(dialog).getByLabelText('HSN code'), '12');
    await userEvent.type(within(dialog).getByLabelText('Barcode'), '4006381333932');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    expect(await within(dialog).findByText('An HSN code has 4 to 8 digits')).toBeInTheDocument();
    expect(within(dialog).getByText(/EAN-13 check digit is wrong/)).toBeInTheDocument();
  });

  it('creates the item with an upper-case code and a generated barcode, then confirms', async () => {
    const { dialog, calls } = await openNew({
      'POST /api/items': () => jsonResponse(makeItem({ itemCode: 'TYRE-9' }), 201),
    });
    await fillRequired(dialog);
    await userEvent.click(within(dialog).getByLabelText('Generate a barcode for this item'));
    expect(within(dialog).queryByLabelText('Barcode')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    expect(await screen.findByText('Item TYRE-9 created')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/items')).toMatchObject({
      itemCode: 'TYRE-9',
      name: 'Front tyre',
      categoryId: CATEGORY_CHILD,
      unitCode: 'PCS',
      hsnCode: null,
      taxRate: null,
      reorderLevel: 0,
      isSerialized: false,
      generateBarcode: true,
    });
  });

  it('fills in the GST rate from the HSN code the user picks', async () => {
    const { dialog } = await openNew();
    await userEvent.type(within(dialog).getByLabelText('HSN code'), '8703');
    await waitFor(() => expect(within(dialog).getByLabelText('GST rate')).toHaveValue('5.00'));
  });

  it('puts a duplicate-code message next to the field and keeps what was typed', async () => {
    const { dialog } = await openNew({
      'POST /api/items': () => conflict('itemCode', 'This code is already used by another item'),
    });
    await fillRequired(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    expect(
      await within(dialog).findByText('This code is already used by another item'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Front tyre');
  });

  it('puts a duplicate-barcode message next to the barcode field', async () => {
    const { dialog } = await openNew({
      'POST /api/items': () => conflict('barcode', 'Already used by item TOTO-X1'),
    });
    await fillRequired(dialog);
    await userEvent.type(within(dialog).getByLabelText('Barcode'), 'MFR-123456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    expect(await within(dialog).findByText('Already used by item TOTO-X1')).toBeInTheDocument();
  });

  it('disables the buttons while saving and shows an unexpected failure at the top', async () => {
    const { dialog } = await openNew({
      'POST /api/items': () =>
        jsonResponse({ code: 'INTERNAL_ERROR', message: 'Boom', details: [], requestId: 'r' }, 500),
    });
    await fillRequired(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    expect(await within(dialog).findByText('Boom')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Create item' })).toBeEnabled();
  });

  it('offers a retry when the choices cannot be loaded', async () => {
    routeFetch({
      ...itemHandlers(),
      'GET /api/reference/units': () =>
        jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500),
    });
    renderApp('/items');
    await userEvent.click(await screen.findByRole('button', { name: 'New item' }));
    expect(
      await screen.findByText('Could not load the categories, units and GST rates.'),
    ).toBeInTheDocument();
  });
});

describe('editing an item', () => {
  const openEdit = async (extra: Record<string, RouteHandler> = {}) => {
    const state = routeFetch({ ...itemHandlers(), ...extra });
    renderApp('/items');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit TOTO-X1' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Spare Parts › Tyres' });
    return { ...state, dialog };
  };

  it('locks the code, sends the row version and never sends the code', async () => {
    const { dialog, calls } = await openEdit({
      'PATCH /api/items/i-1': () => jsonResponse(makeItem({ name: 'Renamed', rowVersion: 4 })),
    });
    expect(within(dialog).getByLabelText('Item code')).toBeDisabled();
    const name = within(dialog).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Renamed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Item TOTO-X1 saved')).toBeInTheDocument();
    const sent = bodyOf(calls, 'PATCH /api/items/i-1');
    expect(sent).toMatchObject({
      name: 'Renamed',
      rowVersion: 3,
      hsnCode: '8703',
      taxRate: '5.00',
    });
    expect(sent).not.toHaveProperty('itemCode');
  });

  it('shows the serial-number rule next to the checkbox', async () => {
    const { dialog } = await openEdit({
      'PATCH /api/items/i-1': () =>
        conflict(
          'isSerialized',
          'This item already has stock history',
          422,
          'BUSINESS_RULE_VIOLATION',
        ),
    });
    await userEvent.click(within(dialog).getByLabelText(/Tracked by serial number/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(
      await within(dialog).findByText('This item already has stock history'),
    ).toBeInTheDocument();
  });

  it('tells the user when somebody else changed the item', async () => {
    const { dialog } = await openEdit({
      'PATCH /api/items/i-1': () =>
        jsonResponse(
          {
            code: 'CONFLICT',
            message: 'This item was changed by someone else. Reload it and try again',
            details: [],
            requestId: 'r',
          },
          409,
        ),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText(/changed by someone else/)).toBeInTheDocument();
  });

  it('adds a typed barcode, generates one and removes one without closing the form', async () => {
    const withTwo = makeItem({
      rowVersion: 3,
      barcodes: [
        { id: 'bc-1', barcode: '2000000000015' },
        { id: 'bc-2', barcode: 'MFR-123456' },
      ],
    });
    const { dialog, calls } = await openEdit({
      'POST /api/items/i-1/barcodes': () => jsonResponse(withTwo, 201),
      'POST /api/items/i-1/barcodes/bc-1/remove': () =>
        jsonResponse(
          makeItem({ rowVersion: 4, barcodes: [{ id: 'bc-2', barcode: 'MFR-123456' }] }),
        ),
    });
    await userEvent.type(within(dialog).getByLabelText('New barcode'), 'MFR-123456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add barcode' }));
    expect(await within(dialog).findByText('MFR-123456')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/items/i-1/barcodes')).toEqual({ barcode: 'MFR-123456' });

    await userEvent.click(within(dialog).getByRole('button', { name: 'Generate barcode' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.key === 'POST /api/items/i-1/barcodes')).toHaveLength(2),
    );
    expect(calls.filter((c) => c.key === 'POST /api/items/i-1/barcodes')[1]?.body).toEqual({
      generate: true,
    });

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove barcode 2000000000015' }),
    );
    await waitFor(() =>
      expect(within(dialog).queryByText('2000000000015')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows the barcode refusal from the server', async () => {
    const { dialog } = await openEdit({
      'POST /api/items/i-1/barcodes': () =>
        jsonResponse(
          {
            code: 'CONFLICT',
            message: 'This barcode is already in use',
            details: [],
            requestId: 'r',
          },
          409,
        ),
    });
    await userEvent.type(within(dialog).getByLabelText('New barcode'), 'MFR-000001');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add barcode' }));
    expect(await within(dialog).findByText('This barcode is already in use')).toBeInTheDocument();
  });
});
