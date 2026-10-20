import { SimpleTable } from '@/components/data-table/simple-table';
import { StatusBadge } from '@/components/status-badge';
import { useState } from 'react';
import { AddCommissionRuleRequestSchema, COMMISSION_RULE_TYPES } from '@erp/contracts';
import type { Broker, CommissionRuleTypeName } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { ProblemAlert } from '../payments/payments-shared';
import { formatWhen } from '../leads/leads-shared';
import { ruleText } from './brokers-shared';
import { useBroker, useBrokerMutations } from './use-brokers';

interface Props {
  brokerId: string;
  onClose: () => void;
  onEdit: (broker: Broker) => void;
  onLedger: (broker: Broker) => void;
}

const TYPE_TEXT: Record<CommissionRuleTypeName, string> = {
  PERCENT: 'Percentage of the taxable value',
  FIXED: 'Fixed amount a sale',
};

export function BrokerDetailDialog({ brokerId, onClose, onEdit, onLedger }: Props) {
  const { can } = useAuth();
  const query = useBroker(brokerId);
  const broker = query.data;
  const manage = can('brokers.manage');
  const { addRule, update } = useBrokerMutations();
  const [type, setType] = useState<CommissionRuleTypeName>('PERCENT');
  const [value, setValue] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const busy = addRule.isPending || update.isPending;

  const run = async (action: () => Promise<unknown>, done?: () => void) => {
    setProblem(null);
    setErrors({});
    try {
      await action();
      done?.();
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle>{broker ? broker.name : 'Broker'}</DialogTitle>
        <DialogDescription>
          {broker
            ? `${broker.isActive ? 'Active' : 'Switched off'}${broker.phone ? ` · ${broker.phone}` : ''}`
            : 'Loading the broker'}
        </DialogDescription>
        {query.isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading the broker…
          </p>
        ) : query.isError || !broker ? (
          <div role="alert" className="mt-4 flex items-center gap-3 text-destructive">
            <p>Could not load the broker.</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {problem ? (
              <div className="mt-3">
                <ProblemAlert problem={problem} />
              </div>
            ) : null}
            <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <dt className="text-muted-foreground">Rule in force</dt>
              <dd>{ruleText(broker.activeRule)}</dd>
              <dt className="text-muted-foreground">Commission to pay</dt>
              <dd>{broker.payable}</dd>
              <dt className="text-muted-foreground">To get back</dt>
              <dd>{broker.toRecover}</dd>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => onLedger(broker)}>
                Open ledger
              </Button>
              {manage ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => onEdit(broker)}>
                    Edit details
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        update.mutateAsync({
                          id: broker.id,
                          values: { isActive: !broker.isActive, rowVersion: broker.rowVersion },
                        }),
                      )
                    }
                  >
                    {broker.isActive ? 'Switch off' : 'Switch on'}
                  </Button>
                </>
              ) : null}
            </div>

            <h3 className="mt-6 text-sm font-semibold">Commission rules</h3>
            <p className="text-sm text-muted-foreground">
              A rule is never edited. A new rule replaces the one in force for invoices issued from
              now on; commissions already worked out keep the rule they were worked out on.
            </p>
            {broker.rules.length > 0 ? (
              <SimpleTable
                label="Commission rules"
                rows={broker.rules}
                getRowKey={(rule) => rule.id}
                className="mt-2"
                columns={[
                  { header: 'Rule', cell: (rule) => ruleText(rule) },
                  { header: 'Added', cell: (rule) => formatWhen(rule.createdAt) },
                  { header: 'Added by', cell: (rule) => rule.createdByName ?? '—' },
                  {
                    header: 'State',
                    cell: (rule) => (
                      <StatusBadge
                        status={rule.isActive ? 'ACTIVE' : 'INACTIVE'}
                        label={rule.isActive ? 'In force' : 'Replaced'}
                      />
                    ),
                  },
                ]}
              />
            ) : (
              <p className="mt-2 text-sm">
                This broker has no rule yet, so they cannot be put on an invoice.
              </p>
            )}

            {manage && broker.isActive ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
                <FormField label="Kind of rule" error={errors['type']}>
                  {(props) => (
                    <Select
                      {...props}
                      value={type}
                      onChange={(event) => setType(event.target.value as CommissionRuleTypeName)}
                    >
                      {COMMISSION_RULE_TYPES.map((item) => (
                        <option key={item} value={item}>
                          {TYPE_TEXT[item]}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField
                  label={type === 'PERCENT' ? 'Percentage' : 'Amount'}
                  error={errors['value']}
                >
                  {(props) => (
                    <Input
                      {...props}
                      inputMode="decimal"
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                    />
                  )}
                </FormField>
                <Button
                  disabled={busy}
                  onClick={() => {
                    const request = { type, value: value.trim() };
                    const parsed = AddCommissionRuleRequestSchema.safeParse(request);
                    if (!parsed.success) {
                      setErrors({ value: parsed.error.issues[0]?.message ?? 'Check the value' });
                      return;
                    }
                    void run(
                      () => addRule.mutateAsync({ id: broker.id, values: request }),
                      () => setValue(''),
                    );
                  }}
                >
                  {addRule.isPending ? 'Saving…' : 'Set new rule'}
                </Button>
              </div>
            ) : null}
            <div className="mt-6 flex justify-end">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Close
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
