import { useState } from 'react';
import {
  CreateQuotationRequestSchema,
  INVOICE_TYPES,
  UpdateQuotationRequestSchema,
  todayInIndia,
} from '@erp/contracts';
import type { CreateQuotationRequest, InvoiceTypeName, Item, Quotation } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { TYPE_TEXT } from '../billing/billing-shared';
import { ruleText } from '../brokers/brokers-shared';
import { useBrokers } from '../brokers/use-brokers';
import { useCustomers } from '../customers/use-customers';
import { ProblemAlert } from '../payments/payments-shared';
import {
  BranchField,
  ItemPicker,
  describeError,
  useBranchChoice,
} from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { useQuotationMutations } from './use-quotations';

const SEARCH_DELAY_MS = 300;
const VALID_DAYS = 14;

interface LineState {
  key: number;
  item: Pick<Item, 'id' | 'itemCode' | 'name' | 'isSerialized'> | null;
  qty: string;
  unitPrice: string;
  discount: string;
}

let nextKey = 1;
const blankLine = (): LineState => ({
  key: nextKey++,
  item: null,
  qty: '1',
  unitPrice: '',
  discount: '',
});

function inDays(days: number): string {
  const start = new Date(`${todayInIndia()}T00:00:00Z`);
  return new Date(start.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

interface Props {
  /** Edit this draft; leave out to write a new quotation. */
  quotation?: Quotation;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function QuotationFormDialog({ quotation, onClose, onSaved }: Props) {
  const { can } = useAuth();
  const { create, update } = useQuotationMutations();
  const choice = useBranchChoice();
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(
    quotation ? { id: quotation.customerId, name: quotation.customerName } : null,
  );
  const [customerText, setCustomerText] = useState('');
  const [type, setType] = useState<InvoiceTypeName>(quotation?.type ?? 'GST');
  const [validUntil, setValidUntil] = useState(quotation?.validUntil ?? inDays(VALID_DAYS));
  const [brokerId, setBrokerId] = useState(quotation?.brokerId ?? '');
  const [custom, setCustom] = useState(quotation?.isCustomBuild ?? false);
  const [specification, setSpecification] = useState(quotation?.specification ?? '');
  const [lines, setLines] = useState<LineState[]>(() =>
    quotation
      ? quotation.lines.map((line) => ({
          key: nextKey++,
          item: {
            id: line.itemId,
            itemCode: line.itemCode,
            name: line.itemName,
            isSerialized: line.isSerialized,
          },
          qty: String(line.qty),
          unitPrice: line.unitPrice,
          discount: line.discountAmount === '0.00' ? '' : line.discountAmount,
        }))
      : [blankLine()],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const typed = useDebouncedValue(customerText.trim(), SEARCH_DELAY_MS);
  const customers = useCustomers({ page: 1, pageSize: 10, search: typed, kycStatus: '' });
  const brokers = useBrokers(
    { page: 1, pageSize: 100, search: '', status: 'active' },
    can('brokers.view'),
  );
  const usable = (brokers.data?.items ?? []).filter((item) => item.activeRule !== null);
  const busy = create.isPending || update.isPending;

  const change = (key: number, patch: Partial<LineState>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const submit = async () => {
    setProblem(null);
    const body: CreateQuotationRequest = {
      customerId: customer?.id ?? '',
      type,
      validUntil,
      brokerId: brokerId === '' ? null : brokerId,
      isCustomBuild: custom,
      specification: custom && specification.trim() !== '' ? specification.trim() : null,
      lines: lines.map((line) => ({
        itemId: line.item?.id ?? '',
        qty: Number(line.qty),
        unitPrice: line.unitPrice.trim(),
        discountAmount: line.discount.trim() === '' ? '0.00' : line.discount.trim(),
      })),
      ...(quotation || !choice.mustChoose ? {} : { branchId: choice.branchId }),
    };
    const parsed = quotation
      ? UpdateQuotationRequestSchema.safeParse({ ...body, rowVersion: quotation.rowVersion })
      : CreateQuotationRequestSchema.safeParse(body);
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join('.') || 'form';
        if (!found[field]) found[field] = issue.message;
      }
      setErrors(found);
      return;
    }
    setErrors({});
    try {
      if (quotation)
        await update.mutateAsync({
          id: quotation.id,
          values: { ...body, rowVersion: quotation.rowVersion },
        });
      else await create.mutateAsync(body);
      onSaved(quotation ? `${quotation.quotationNo} saved` : 'Quotation written');
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogTitle>{quotation ? `Edit ${quotation.quotationNo}` : 'New quotation'}</DialogTitle>
        <DialogDescription>
          Prices are fixed once the quotation is sent. The customer pays at these prices; tax
          follows the rate in force on delivery.
        </DialogDescription>
        {problem ? (
          <div className="mt-3">
            <ProblemAlert problem={problem} />
          </div>
        ) : null}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormField
              label="Customer"
              error={errors['customerId']}
              hint={customer ? `Chosen: ${customer.name}` : 'Type a name or phone number'}
            >
              {(props) => (
                <>
                  <Input
                    {...props}
                    autoComplete="off"
                    value={customerText}
                    onChange={(event) => setCustomerText(event.target.value)}
                  />
                  {typed.length >= 2 && customers.data && customers.data.items.length > 0 ? (
                    <Select
                      aria-label="Matching customers"
                      value={customer?.id ?? ''}
                      onChange={(event) => {
                        const found = customers.data?.items.find(
                          (item) => item.id === event.target.value,
                        );
                        setCustomer(found ? { id: found.id, name: found.name } : null);
                      }}
                    >
                      <option value="">Choose a customer</option>
                      {customers.data.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.phone}
                        </option>
                      ))}
                    </Select>
                  ) : null}
                </>
              )}
            </FormField>
          </div>
          <FormField label="Type" error={errors['type']}>
            {(props) => (
              <Select
                {...props}
                value={type}
                onChange={(event) => setType(event.target.value as InvoiceTypeName)}
              >
                {INVOICE_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {TYPE_TEXT[value]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Valid until" error={errors['validUntil']}>
            {(props) => (
              <Input
                {...props}
                type="date"
                min={todayInIndia()}
                value={validUntil}
                onChange={(event) => setValidUntil(event.target.value)}
              />
            )}
          </FormField>
          {can('brokers.view') && (usable.length > 0 || brokerId !== '') ? (
            <FormField label="Broker" error={errors['brokerId']} hint="Optional">
              {(props) => (
                <Select
                  {...props}
                  value={brokerId}
                  onChange={(event) => setBrokerId(event.target.value)}
                >
                  <option value="">No broker</option>
                  {brokerId !== '' && !usable.some((item) => item.id === brokerId) ? (
                    <option value={brokerId}>{quotation?.brokerName ?? 'Chosen broker'}</option>
                  ) : null}
                  {usable.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {ruleText(item.activeRule)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          <BranchField
            choice={quotation ? { ...choice, mustChoose: false } : choice}
            error={errors['branchId']}
          />
          <div className="flex items-center gap-2 sm:col-span-2">
            <input
              id="custom-build"
              type="checkbox"
              checked={custom}
              onChange={(event) => setCustom(event.target.checked)}
            />
            <label htmlFor="custom-build" className="text-sm font-medium">
              A customized build
            </label>
          </div>
          {custom ? (
            <div className="sm:col-span-2">
              <FormField label="What is to be built" error={errors['specification']}>
                {(props) => (
                  <Input
                    {...props}
                    value={specification}
                    onChange={(event) => setSpecification(event.target.value)}
                  />
                )}
              </FormField>
            </div>
          ) : null}
        </div>

        <div className="mt-6 space-y-4">
          {lines.map((line, index) => {
            const at = (field: string) => errors[`lines.${index}.${field}`];
            return (
              <fieldset
                key={line.key}
                aria-label={`Line ${index + 1}`}
                className="grid gap-3 rounded-md border p-3 sm:grid-cols-6"
              >
                <div className="sm:col-span-2">
                  <ItemPicker
                    label={`Item`}
                    value={line.item}
                    error={at('itemId')}
                    onChange={(item) => change(line.key, { item })}
                  />
                </div>
                <FormField label={`Quantity`} error={at('qty')}>
                  {(props) => (
                    <Input
                      {...props}
                      inputMode="numeric"
                      value={line.qty}
                      onChange={(event) => change(line.key, { qty: event.target.value })}
                    />
                  )}
                </FormField>
                <FormField label={`Price`} error={at('unitPrice')}>
                  {(props) => (
                    <Input
                      {...props}
                      inputMode="decimal"
                      value={line.unitPrice}
                      onChange={(event) => change(line.key, { unitPrice: event.target.value })}
                    />
                  )}
                </FormField>
                <FormField label={`Discount`} error={at('discountAmount')}>
                  {(props) => (
                    <Input
                      {...props}
                      inputMode="decimal"
                      value={line.discount}
                      onChange={(event) => change(line.key, { discount: event.target.value })}
                    />
                  )}
                </FormField>
                <div className="flex items-end">
                  {lines.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove line ${index + 1}`}
                      onClick={() =>
                        setLines((current) => current.filter((item) => item.key !== line.key))
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </fieldset>
            );
          })}
          {errors['lines'] ? <p className="text-sm text-destructive">{errors['lines']}</p> : null}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setLines((current) => [...current, blankLine()])}
          >
            Add a line
          </Button>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : quotation ? 'Save changes' : 'Save draft'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
