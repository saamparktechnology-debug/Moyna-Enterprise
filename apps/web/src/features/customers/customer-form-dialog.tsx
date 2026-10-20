import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PhoneSchema, gstinProblem } from '@erp/contracts';
import type { Customer } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api-client';
import { useStates } from '../branches/use-branches';
import { useCustomerMutations } from './use-customers';

const FormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Enter at least 2 characters')
      .max(120, 'Use at most 120 characters'),
    phone: PhoneSchema,
    email: z.string().trim(),
    address: z.string().trim().max(300, 'Use at most 300 characters'),
    stateCode: z.string(),
    gstin: z.string().trim().toUpperCase(),
  })
  .superRefine((values, context) => {
    if (values.email !== '' && !z.email().safeParse(values.email).success)
      context.addIssue({ code: 'custom', path: ['email'], message: 'Enter a valid email address' });
    if (values.gstin !== '') {
      const problem = gstinProblem(values.gstin, values.stateCode || undefined);
      if (problem) context.addIssue({ code: 'custom', path: ['gstin'], message: problem });
    }
  });
type FormValues = z.input<typeof FormSchema>;

const FIELDS = ['name', 'phone', 'email', 'address', 'stateCode', 'gstin'] as const;
type FieldName = (typeof FIELDS)[number];
const isField = (name: string): name is FieldName => (FIELDS as readonly string[]).includes(name);

interface CustomerFormDialogProps {
  customer: Customer | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function CustomerFormDialog({ customer, onClose, onSaved }: CustomerFormDialogProps) {
  const states = useStates();
  const { create, update } = useCustomerMutations();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      email: customer?.email ?? '',
      address: customer?.address ?? '',
      stateCode: customer?.stateCode ?? '',
      gstin: customer?.gstin ?? '',
    },
  });

  const onSubmit = handleSubmit(async (raw) => {
    setServerError(null);
    const values = FormSchema.parse(raw);
    const body = {
      name: values.name,
      phone: values.phone,
      email: values.email === '' ? null : values.email,
      address: values.address === '' ? null : values.address,
      stateCode: values.stateCode === '' ? null : values.stateCode,
      gstin: values.gstin === '' ? null : values.gstin,
    };
    try {
      if (customer) {
        await update.mutateAsync({
          id: customer.id,
          values: { ...body, rowVersion: customer.rowVersion },
        });
        onSaved(`Customer ${values.name} saved`);
      } else {
        await create.mutateAsync(body);
        onSaved(`Customer ${values.name} created`);
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setServerError('Something went wrong. Try again.');
        return;
      }
      let placed = false;
      for (const detail of error.details) {
        if (isField(detail.field)) {
          setError(detail.field, { message: detail.message });
          placed = true;
        }
      }
      if (!placed) setServerError(error.message);
    }
  });

  return (
    <Dialog open onOpenChange={(next) => (next || isSubmitting ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogTitle>{customer ? `Edit ${customer.name}` : 'New customer'}</DialogTitle>
        <DialogDescription>
          Customers are shared by every branch. A phone number or GSTIN belongs to one customer
          only.
        </DialogDescription>
        <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
          {serverError ? <Alert tone="error">{serverError}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name" error={errors.name?.message}>
              {(props) => <Input {...props} autoComplete="off" {...register('name')} />}
            </FormField>
            <FormField label="Phone" error={errors.phone?.message} hint="10-digit mobile number">
              {(props) => (
                <Input {...props} inputMode="numeric" autoComplete="off" {...register('phone')} />
              )}
            </FormField>
            <FormField label="Email" error={errors.email?.message}>
              {(props) => (
                <Input {...props} type="email" autoComplete="off" {...register('email')} />
              )}
            </FormField>
            <FormField label="State" error={errors.stateCode?.message}>
              {(props) => (
                <Select {...props} {...register('stateCode')}>
                  <option value="">No state</option>
                  {states.data?.map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.code} · {state.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField
              label="GSTIN"
              error={errors.gstin?.message}
              hint="Optional. Must belong to the chosen state"
            >
              {(props) => (
                <Input {...props} autoComplete="off" className="uppercase" {...register('gstin')} />
              )}
            </FormField>
            <FormField label="Address" error={errors.address?.message}>
              {(props) => <Input {...props} autoComplete="off" {...register('address')} />}
            </FormField>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : customer ? 'Save changes' : 'Create customer'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
