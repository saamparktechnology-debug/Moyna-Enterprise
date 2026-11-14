//apps\web\src\features\billing\invoice-form-dialog.tsx
import { useState } from 'react';
import {
  CreateInvoiceRequestSchema,
  DISCOUNT_STAFF_LIMIT_PERCENT,
  INVOICE_TYPES,
} from '@erp/contracts';
import type {
  CreateInvoiceRequest,
  Invoice,
  InvoiceCommissionInput,
  InvoiceCommissionTypeName,
  InvoiceTypeName,
  Item,
} from '@erp/contracts';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { FormSection } from '@/components/form-section';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useCustomers } from '../customers/use-customers';
import {
  BranchField,
  ItemPicker,
  describeError,
  useBranchChoice,
} from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { TYPE_TEXT } from './billing-shared';
import { useAuth } from '@/features/auth/auth-provider';
import { ruleText } from '../brokers/brokers-shared';
import { useBrokers } from '../brokers/use-brokers';
import { useGstRates } from '../items/use-items';
import { useInvoiceMutations, useInvoicePreview, useSellableUnits } from './use-billing';

const SEARCH_DELAY_MS = 300;

interface LineState {
  key: number;
  item: Pick<Item, 'id' | 'itemCode' | 'name' | 'isSerialized'> | null;
  serialUnitId: string;
  qty: string;
  unitPrice: string;
  discount: string;
  /** The GST rate and HSN code this line is billed at on a GST invoice. They start as the item's own. */
  taxRate: string;
  hsnCode: string;
}

let nextKey = 1;
const blankLine = (): LineState => ({
  key: nextKey++,
  item: null,
  serialUnitId: '',
  qty: '1',
  unitPrice: '',
  discount: '',
  taxRate: '',
  hsnCode: '',
});

function linesOf(invoice: Invoice | null): LineState[] {
  if (!invoice) return [blankLine()];
  return invoice.lines.map((line) => ({
    key: nextKey++,
    item: {
      id: line.itemId,
      itemCode: line.itemCode,
      name: line.itemName,
      isSerialized: line.serialUnitId !== null,
    },
    serialUnitId: line.serialUnitId ?? '',
    qty: String(line.qty),
    unitPrice: line.unitPrice,
    discount: line.discountAmount === '0.00' ? '' : line.discountAmount,
    taxRate: line.taxRate ?? '',
    hsnCode: line.hsnCode ?? '',
  }));
}

function toRequest(
  customerId: string,
  type: InvoiceTypeName,
  dueDate: string,
  brokerId: string,
  branchId: string,
  lines: LineState[],
  commission: InvoiceCommissionInput | null,
): CreateInvoiceRequest {
  return {
    ...(branchId ? { branchId } : {}),
    customerId,
    type,
    dueDate: dueDate === '' ? null : dueDate,
    brokerId: brokerId === '' ? null : brokerId,
    ...(commission ? { commission } : {}),
    lines: lines.map((line) => ({
      itemId: line.item?.id ?? '',
      qty: Number(line.qty),
      unitPrice: line.unitPrice.trim(),
      discountAmount: line.discount.trim() === '' ? '0.00' : line.discount.trim(),
      ...(line.serialUnitId ? { serialUnitId: line.serialUnitId } : {}),
      // The type of the invoice decides whether GST is charged, so the rate and HSN code are sent only for GST.
      ...(type === 'GST'
        ? {
            taxRate: line.taxRate === '' ? null : line.taxRate,
            hsnCode: line.hsnCode.trim() === '' ? null : line.hsnCode.trim(),
          }
        : {}),
    })),
  };
}

/** Errors by the field they belong to, whether they came from this form's own checks or from the server. */
function fieldErrors(request: CreateInvoiceRequest): Record<string, string> {
  const result = CreateInvoiceRequestSchema.safeParse(request);
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.');
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

const overStaffLimit = (line: LineState): boolean => {
  const gross = Number(line.unitPrice) * Number(line.qty);
  return Number(line.discount) * 100 > gross * DISCOUNT_STAFF_LIMIT_PERCENT;
};

interface SerialSelectProps {
  itemId: string;
  branchId: string;
  value: string;
  taken: string[];
  error?: string | undefined;
  onChange: (id: string) => void;
}

function SerialSelect({ itemId, branchId, value, taken, error, onChange }: SerialSelectProps) {
  const units = useSellableUnits(itemId, branchId);
  return (
    <FormField label={`Serial number `} error={error}>
      {(props) => (
        <Select {...props} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Choose the unit being sold</option>
          {(units.data?.items ?? [])
            .filter((unit) => unit.id === value || !taken.includes(unit.id))
            .map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.serialNo}
              </option>
            ))}
        </Select>
      )}
    </FormField>
  );
}

interface InvoiceFormDialogProps {
  invoice: Invoice | null;
  onClose: () => void;
  onSaved: (invoice: Invoice, message: string) => void;
}

export function InvoiceFormDialog({ invoice, onClose, onSaved }: InvoiceFormDialogProps) {
  const { can } = useAuth();
  const choice = useBranchChoice();
  const { create, update } = useInvoiceMutations();
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(
    invoice ? { id: invoice.customerId, name: invoice.customerName } : null,
  );
  const [customerText, setCustomerText] = useState('');
  const [type, setType] = useState<InvoiceTypeName>(invoice?.type ?? 'GST');
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? '');
  const [brokerId, setBrokerId] = useState(invoice?.brokerId ?? '');
  // A new invoice starts with no commission, so an amount or a gift is always a choice. An older draft with nothing
  // agreed (`''`) keeps using the broker's standing rule until one is chosen.
  const [commissionType, setCommissionType] = useState<'' | InvoiceCommissionTypeName>(
    invoice ? (invoice.commission?.type ?? '') : 'NONE',
  );
  const [commissionAmount, setCommissionAmount] = useState(invoice?.commission?.amount ?? '');
  const [giftName, setGiftName] = useState(invoice?.commission?.giftName ?? '');
  const [lines, setLines] = useState<LineState[]>(() => linesOf(invoice));
  const [submitted, setSubmitted] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const typedCustomer = useDebouncedValue(customerText.trim(), SEARCH_DELAY_MS);
  const customers = useCustomers({ page: 1, pageSize: 10, search: typedCustomer, kycStatus: '' });
  const branchId = invoice?.branchId ?? choice.branchId;
  const agreed: InvoiceCommissionInput | null =
    brokerId === '' || commissionType === ''
      ? null
      : commissionType === 'NONE'
        ? { type: 'NONE' }
        : {
            type: commissionType,
            ...(commissionAmount.trim() === '' ? {} : { amount: commissionAmount.trim() }),
            ...(commissionType === 'GIFT' && giftName.trim() !== ''
              ? { giftName: giftName.trim() }
              : {}),
          };
  const request = toRequest(
    customer?.id ?? '',
    type,
    dueDate,
    brokerId,
    invoice ? '' : branchId,
    lines,
    agreed,
  );
  const checks = fieldErrors(request);
  const problems = { ...checks, ...problem?.fields };
  const previewRequest = Object.keys(checks).length === 0 ? request : null;
  const preview = useInvoicePreview(previewRequest);
  const saving = create.isPending || update.isPending;
  const brokers = useBrokers(
    { page: 1, pageSize: 100, search: '', status: 'active' },
    can('brokers.view'),
  );
  const usableBrokers = brokers.data?.items ?? [];
  const gstRates = useGstRates();

  const change = (key: number, patch: Partial<LineState>) =>
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );

  const save = async () => {
    setSubmitted(true);
    setProblem(null);
    if (Object.keys(checks).length > 0) return;
    try {
      const saved = invoice
        ? await update.mutateAsync({
            id: invoice.id,
            values: { ...request, rowVersion: invoice.rowVersion },
          })
        : await create.mutateAsync(request);
      onSaved(saved, invoice ? 'Draft saved' : 'Draft invoice created');
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const shown = (key: string): string | undefined =>
    submitted || problem?.fields[key] ? problems[key] : undefined;
  const taken = lines.flatMap((line) => (line.serialUnitId ? [line.serialUnitId] : []));
  const totals = preview.data;

  const initial = useState(() =>
    JSON.stringify([
      customer?.id ?? '',
      type,
      dueDate,
      brokerId,
      commissionType,
      commissionAmount,
      giftName,
      lines.map((line) => [
        line.item?.id ?? '',
        line.serialUnitId,
        line.qty,
        line.unitPrice,
        line.discount,
      ]),
    ]),
  )[0];
  const dirty =
    JSON.stringify([
      customer?.id ?? '',
      type,
      dueDate,
      brokerId,
      commissionType,
      commissionAmount,
      giftName,
      lines.map((line) => [
        line.item?.id ?? '',
        line.serialUnitId,
        line.qty,
        line.unitPrice,
        line.discount,
      ]),
    ]) !== initial;

  return (
    <FormDialog
      open
      size="xl"
      title={invoice ? 'Edit draft invoice' : 'New invoice'}
      description="Prices are typed here. The tax, the total and the invoice number are worked out by the system."
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      dirty={dirty}
      submitLabel={invoice ? 'Save changes' : 'Save draft'}
      error={
        problem ? (
          Object.keys(problem.fields).length === 0 ? (
            <>
              <p>{problem.message}</p>
              {problem.reasons.length > 0 ? (
                <ul className="mt-1 list-disc pl-5">
                  {problem.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            problem.message
          )
        ) : undefined
      }
    >
      <FormSection title="Invoice details">
        {invoice ? null : <BranchField choice={choice} error={shown('branchId')} />}
        <FormField
          label="Customer"
          error={shown('customerId')}
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
              {typedCustomer.length >= 2 && customers.data ? (
                customers.data.items.length > 0 ? (
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
                ) : (
                  <p className="text-sm text-muted-foreground">No customer matches.</p>
                )
              ) : null}
            </>
          )}
        </FormField>
        <FormField label="Kind of invoice">
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
        {can('brokers.view') && (usableBrokers.length > 0 || brokerId !== '') ? (
          <FormField
            label="Broker"
            error={shown('brokerId')}
            hint="Optional. Agree the commission for this sale below"
          >
            {(props) => (
              <Select
                {...props}
                value={brokerId}
                onChange={(event) => setBrokerId(event.target.value)}
              >
                <option value="">No broker</option>
                {brokerId !== '' && !usableBrokers.some((item) => item.id === brokerId) ? (
                  <option value={brokerId}>{invoice?.brokerName ?? 'Chosen broker'}</option>
                ) : null}
                {usableBrokers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.activeRule ? ` · ${ruleText(item.activeRule)}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        ) : null}
        {brokerId !== '' ? (
          <fieldset className="grid gap-4 rounded-md border p-3 sm:grid-cols-3">
            <legend className="px-1 text-sm font-medium">Commission agreed for this sale</legend>
            <FormField
              label="Commission"
              error={shown('commission.type')}
              hint="Optional. Decided with the broker now"
            >
              {(props) => (
                <Select
                  {...props}
                  value={commissionType}
                  onChange={(event) =>
                    setCommissionType(event.target.value as '' | InvoiceCommissionTypeName)
                  }
                >
                  {commissionType === '' ? (
                    <option value="">The broker’s standing rule</option>
                  ) : null}
                  <option value="NONE">No commission</option>
                  <option value="FIXED">Fixed amount</option>
                  <option value="GIFT">Gift</option>
                </Select>
              )}
            </FormField>
            {commissionType === 'FIXED' || commissionType === 'GIFT' ? (
              <FormField
                label={commissionType === 'GIFT' ? 'Value of the gift' : 'Amount'}
                error={shown('commission.amount')}
                hint="In rupees"
              >
                {(props) => (
                  <Input
                    {...props}
                    inputMode="decimal"
                    value={commissionAmount}
                    onChange={(event) => setCommissionAmount(event.target.value)}
                  />
                )}
              </FormField>
            ) : null}
            {commissionType === 'GIFT' ? (
              <FormField
                label="Gift"
                error={shown('commission.giftName')}
                hint="Save the draft, then add the gift photo from the invoice"
              >
                {(props) => (
                  <Input
                    {...props}
                    value={giftName}
                    onChange={(event) => setGiftName(event.target.value)}
                  />
                )}
              </FormField>
            ) : null}
          </fieldset>
        ) : null}
        <FormField label="Due date" error={shown('dueDate')} hint="Optional">
          {(props) => (
            <Input
              {...props}
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          )}
        </FormField>
      </FormSection>

      <div className="space-y-4">
        {lines.map((line, index) => {
          const at = (field: string) => shown(`lines.${index}.${field}`);
          return (
            <fieldset
              key={line.key}
              aria-label={`Line ${index + 1}`}
              className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-6"
            >
              <div className="sm:col-span-2">
                <ItemPicker
                  label={`Item`}
                  value={line.item}
                  error={at('itemId')}
                  onChange={(item) =>
                    change(line.key, {
                      item,
                      serialUnitId: '',
                      qty: '1',
                      taxRate: item?.taxRate ?? '',
                      hsnCode: item?.hsnCode ?? '',
                      // An item that was assembled has a selling price; the price starts from it unless one was typed.
                      unitPrice:
                        line.unitPrice !== '' ? line.unitPrice : (item?.sellingPrice ?? ''),
                    })
                  }
                />
              </div>
              {line.item?.isSerialized ? (
                <SerialSelect
                  itemId={line.item.id}
                  branchId={branchId}
                  value={line.serialUnitId}
                  taken={taken}
                  error={at('serialUnitId')}
                  onChange={(id) => change(line.key, { serialUnitId: id })}
                />
              ) : (
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
              )}
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
              <FormField
                label={`Discount`}
                error={at('discountAmount')}
                hint={
                  overStaffLimit(line)
                    ? `More than ${DISCOUNT_STAFF_LIMIT_PERCENT}%: a manager must issue this invoice`
                    : undefined
                }
              >
                {(props) => (
                  <Input
                    {...props}
                    inputMode="decimal"
                    value={line.discount}
                    onChange={(event) => change(line.key, { discount: event.target.value })}
                  />
                )}
              </FormField>
              {type === 'GST' ? (
                <div className="grid gap-3 sm:col-span-6 sm:grid-cols-2">
                  <FormField
                    label="GST rate"
                    error={at('taxRate')}
                    hint="Chosen on the bill. The item's rate is only the starting point"
                  >
                    {(props) => (
                      <Select
                        {...props}
                        value={line.taxRate}
                        onChange={(event) => change(line.key, { taxRate: event.target.value })}
                      >
                        <option value="">Choose the rate</option>
                        {(gstRates.data ?? []).map((rate) => (
                          <option key={rate.rate} value={rate.rate}>
                            {rate.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </FormField>
                  <FormField
                    label="HSN code"
                    error={at('hsnCode')}
                    hint="4 to 8 digits. Needed for a buyer with a GSTIN"
                  >
                    {(props) => (
                      <Input
                        {...props}
                        inputMode="numeric"
                        autoComplete="off"
                        value={line.hsnCode}
                        onChange={(event) => change(line.key, { hsnCode: event.target.value })}
                      />
                    )}
                  </FormField>
                </div>
              ) : null}
              {lines.length > 1 ? (
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove line ${index + 1}`}
                    onClick={() =>
                      setLines((previous) => previous.filter((l) => l.key !== line.key))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ) : null}
            </fieldset>
          );
        })}
        {shown('lines') ? <p className="text-sm text-destructive">{shown('lines')}</p> : null}
        <Button
          type="button"
          variant="secondary"
          onClick={() => setLines((previous) => [...previous, blankLine()])}
        >
          Add a line
        </Button>
      </div>

      <section
        aria-label="Invoice totals"
        className="tabular rounded-lg border bg-card p-4 text-sm"
      >
        {totals ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:ml-auto sm:max-w-xs">
            <dt>Subtotal</dt>
            <dd className="text-right">{totals.subtotal}</dd>
            <dt>Discount</dt>
            <dd className="text-right">{totals.discountTotal}</dd>
            <dt>Taxable value</dt>
            <dd className="text-right">{totals.taxableValue}</dd>
            {type === 'GST' ? (
              totals.interState ? (
                <>
                  <dt>IGST</dt>
                  <dd className="text-right">{totals.igstAmount}</dd>
                </>
              ) : (
                <>
                  <dt>CGST</dt>
                  <dd className="text-right">{totals.cgstAmount}</dd>
                  <dt>SGST</dt>
                  <dd className="text-right">{totals.sgstAmount}</dd>
                </>
              )
            ) : null}
            <dt>Round off</dt>
            <dd className="text-right">{totals.roundOff}</dd>
            <dt className="border-t pt-1 text-base font-semibold">Total</dt>
            <dd className="border-t pt-1 text-right text-base font-semibold">{totals.total}</dd>
          </dl>
        ) : preview.isError ? (
          <p role="alert" className="text-destructive">
            {describeError(preview.error).message}
          </p>
        ) : previewRequest ? (
          <p role="status">Working out the totals…</p>
        ) : (
          <p className="text-muted-foreground">
            The totals appear once the customer, items and prices are filled in.
          </p>
        )}
      </section>
    </FormDialog>
  );
}
