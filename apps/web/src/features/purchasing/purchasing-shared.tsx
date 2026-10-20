import { useState } from 'react';
import type { Item, PurchaseOrder, Supplier } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { useActiveBranch } from '@/features/branches/active-branch';
import { useAuth } from '@/features/auth/auth-provider';
import { useItems } from '@/features/items/use-items';
import { ApiError } from '@/lib/api-client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useSuppliers } from './use-purchasing';

const SEARCH_DELAY_MS = 250;

export interface Problem {
  message: string;
  reasons: string[];
  fields: Record<string, string>;
}

/** What the server said, in a form every dialog can show: a headline, the reasons, and the message for each field. */
export function describeError(error: unknown): Problem {
  if (!(error instanceof ApiError))
    return { message: 'Something went wrong. Try again.', reasons: [], fields: {} };
  const fields: Record<string, string> = {};
  for (const detail of error.details)
    if (!fields[detail.field]) fields[detail.field] = detail.message;
  return { message: error.message, reasons: error.details.map((detail) => detail.message), fields };
}

export const STATUS_TEXT: Record<PurchaseOrder['status'], string> = {
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  PARTIALLY_RECEIVED: 'Partly received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

export const label = (value: string): string => value.toLowerCase().replaceAll('_', ' ');

/** The branch a document is for: the branch the user is working in, the only branch they have, or one they choose. */
export function useBranchChoice() {
  const { user } = useAuth();
  const active = useActiveBranch();
  const branches = user?.branches ?? [];
  const only = branches.length === 1 ? branches[0]?.id : undefined;
  const [branchId, setBranchId] = useState(active ?? only ?? '');
  return { branches, branchId, setBranchId, mustChoose: branches.length > 1 };
}

interface BranchFieldProps {
  choice: ReturnType<typeof useBranchChoice>;
  error?: string | undefined;
}

export function BranchField({ choice, error }: BranchFieldProps) {
  if (!choice.mustChoose) return null;
  return (
    <FormField label="Branch" error={error}>
      {(props) => (
        <Select
          {...props}
          value={choice.branchId}
          onChange={(event) => choice.setBranchId(event.target.value)}
        >
          <option value="">Choose a branch</option>
          {choice.branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.code} · {branch.name}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  );
}

interface ItemPickerProps {
  label: string;
  value: Pick<Item, 'id' | 'itemCode' | 'name' | 'isSerialized'> | null;
  onChange: (item: Item | null) => void;
  error?: string | undefined;
}

/** Type two characters of a code, name or barcode, then choose from what matches. Only active items are offered. */
export function ItemPicker({ label: text, value, onChange, error }: ItemPickerProps) {
  const [search, setSearch] = useState('');
  const typed = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const found = useItems(
    { page: 1, pageSize: 10, search: typed, categoryId: '', status: 'active', tracking: 'any' },
    typed.length >= 2,
  );
  return (
    <FormField
      label={text}
      error={error}
      hint={value ? `Chosen: ${value.itemCode} · ${value.name}` : 'Type at least 2 characters'}
    >
      {(props) => (
        <>
          <Input
            {...props}
            autoComplete="off"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {found.data && found.data.items.length > 0 ? (
            <Select
              aria-label={`Matching items for ${text}`}
              value={value?.id ?? ''}
              onChange={(event) =>
                onChange(found.data?.items.find((item) => item.id === event.target.value) ?? null)
              }
            >
              <option value="">Choose an item</option>
              {found.data.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.itemCode} · {item.name}
                </option>
              ))}
            </Select>
          ) : null}
          {found.data && found.data.items.length === 0 ? <p>No active item matches.</p> : null}
        </>
      )}
    </FormField>
  );
}

interface SupplierPickerProps {
  value: Pick<Supplier, 'id' | 'name'> | null;
  onChange: (supplier: Supplier | null) => void;
  error?: string | undefined;
}

export function SupplierPicker({ value, onChange, error }: SupplierPickerProps) {
  const [search, setSearch] = useState('');
  const typed = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const found = useSuppliers({ page: 1, pageSize: 10, search: typed, status: 'active' });
  return (
    <FormField
      label="Find the supplier"
      error={error}
      hint={value ? `Chosen: ${value.name}` : 'Type part of the name'}
    >
      {(props) => (
        <>
          <Input
            {...props}
            autoComplete="off"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {found.data && found.data.items.length > 0 ? (
            <Select
              aria-label="Matching suppliers"
              value={value?.id ?? ''}
              onChange={(event) =>
                onChange(found.data?.items.find((item) => item.id === event.target.value) ?? null)
              }
            >
              <option value="">Choose a supplier</option>
              {found.data.items.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </Select>
          ) : null}
          {found.data && found.data.items.length === 0 ? <p>No supplier matches.</p> : null}
        </>
      )}
    </FormField>
  );
}
