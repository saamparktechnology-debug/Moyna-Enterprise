import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { CATEGORIES, CATEGORY_CHILD, CATEGORY_ROOT, itemHandlers } from './test-data';

const openDialog = async (extra: Record<string, RouteHandler> = {}) => {
  const state = routeFetch({ ...itemHandlers(), ...extra });
  renderApp('/items');
  await userEvent.click(await screen.findByRole('button', { name: 'Categories' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('table', { name: 'Categories' });
  return { ...state, dialog };
};

describe('item categories', () => {
  it('lists categories with their path, item count and status', async () => {
    const { dialog } = await openDialog();
    const rows = within(dialog).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Spare Parts');
    expect(rows[0]).toHaveTextContent('4');
    expect(rows[1]).toHaveTextContent('Spare Parts › Tyres');
    expect(rows[1]).toHaveTextContent('Active');
  });

  it('adds a category inside another and says so', async () => {
    const { dialog, calls } = await openDialog({
      'POST /api/item-categories': () =>
        jsonResponse({ ...CATEGORIES[1], id: 'c-3', name: 'Tubes' }, 201),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'New category' }));
    await userEvent.type(within(dialog).getByLabelText('Category name'), 'Tubes');
    await userEvent.selectOptions(within(dialog).getByLabelText('Inside'), CATEGORY_ROOT);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add category' }));
    expect(await within(dialog).findByText('Category Tubes created')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/item-categories')?.body).toEqual({
      name: 'Tubes',
      parentId: CATEGORY_ROOT,
    });
  });

  it('refuses a too-short name before calling the server', async () => {
    const { dialog, calls } = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'New category' }));
    await userEvent.type(within(dialog).getByLabelText('Category name'), 'a');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add category' }));
    expect(await within(dialog).findByText('Enter at least 2 characters')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/item-categories')).toBe(false);
  });

  it('shows a duplicate-name refusal', async () => {
    const { dialog } = await openDialog({
      'POST /api/item-categories': () =>
        jsonResponse(
          {
            code: 'CONFLICT',
            message: 'A category with this name already exists here',
            details: [{ field: 'name', message: 'Another category at this level has this name' }],
            requestId: 'r',
          },
          409,
        ),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'New category' }));
    await userEvent.type(within(dialog).getByLabelText('Category name'), 'Tyres');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add category' }));
    expect(await within(dialog).findByText(/already exists here/)).toBeInTheDocument();
  });

  it('renames a category using its row version', async () => {
    const { dialog, calls } = await openDialog({
      [`PATCH /api/item-categories/${CATEGORY_CHILD}`]: () =>
        jsonResponse({ ...CATEGORIES[1], name: 'Tubes and tyres', rowVersion: 2 }),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Edit Tyres' }));
    const name = within(dialog).getByLabelText('Category name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Tubes and tyres');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save category' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.key === `PATCH /api/item-categories/${CATEGORY_CHILD}`)?.body,
      ).toMatchObject({
        name: 'Tubes and tyres',
        parentId: CATEGORY_ROOT,
        rowVersion: 1,
      }),
    );
  });

  it('explains why a category in use cannot be deactivated', async () => {
    const { dialog } = await openDialog({
      [`PATCH /api/item-categories/${CATEGORY_ROOT}`]: () =>
        jsonResponse(
          {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'This category cannot be deactivated yet',
            details: [{ field: 'isActive', message: '4 active items use this category' }],
            requestId: 'r',
          },
          422,
        ),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate Spare Parts' }));
    expect(await within(dialog).findByText(/4 active items use this category/)).toBeInTheDocument();
  });
});
