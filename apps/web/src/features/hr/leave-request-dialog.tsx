import { useState } from 'react';
import { CreateLeaveRequestSchema, LEAVE_KINDS, todayInIndia } from '@erp/contracts';
import type { CreateLeaveRequest, LeaveKindName } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { FormDialog } from '@/components/form-dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { LEAVE_KIND_TEXT } from './hr-shared';
import { useHrMutations, useStaffList } from './use-hr';

interface Props {
  onClose: () => void;
  onRequested: (message: string) => void;
}

export function LeaveRequestDialog({ onClose, onRequested }: Props) {
  const { can } = useAuth();
  const manager = can('hr.manage');
  const { requestLeave } = useHrMutations();
  const people = useStaffList(
    { page: 1, pageSize: 100, search: '', status: 'ACTIVE', department: '' },
    manager,
  );
  const [staffId, setStaffId] = useState('');
  const [fromDate, setFromDate] = useState(todayInIndia());
  const [toDate, setToDate] = useState(todayInIndia());
  const [kind, setKind] = useState<LeaveKindName>('PAID');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    setProblem(null);
    const values: CreateLeaveRequest = {
      fromDate,
      toDate,
      kind,
      ...(reason.trim() ? { reason: reason.trim() } : {}),
      ...(manager && staffId !== '' ? { staffId } : {}),
    };
    const parsed = CreateLeaveRequestSchema.safeParse(values);
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
      const leave = await requestLeave.mutateAsync(values);
      onRequested(`Leave from ${leave.fromDate} to ${leave.toDate} is waiting for a decision`);
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <FormDialog
      open
      size="md"
      title="Ask for leave"
      description="Both the first and the last day are counted."
      onClose={onClose}
      onSubmit={submit}
      saving={requestLeave.isPending}
      savingLabel="Asking…"
      submitLabel="Ask for leave"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {manager ? (
          <div className="sm:col-span-2">
            <FormField
              label="For"
              error={errors['staffId']}
              hint="Leave yourself blank to ask for your own"
            >
              {(props) => (
                <Select
                  {...props}
                  value={staffId}
                  onChange={(event) => setStaffId(event.target.value)}
                >
                  <option value="">Myself</option>
                  {(people.data?.items ?? []).map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName} · {person.employeeCode}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
        ) : null}
        <FormField label="First day" error={errors['fromDate']}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Last day" error={errors['toDate']}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Kind of leave" error={errors['kind']}>
          {(props) => (
            <Select
              {...props}
              value={kind}
              onChange={(event) => setKind(event.target.value as LeaveKindName)}
            >
              {LEAVE_KINDS.map((value) => (
                <option key={value} value={value}>
                  {LEAVE_KIND_TEXT[value]}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="Reason" error={errors['reason']} hint="Optional">
          {(props) => (
            <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} />
          )}
        </FormField>
      </div>
    </FormDialog>
  );
}
