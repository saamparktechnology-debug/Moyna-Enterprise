import { useState } from 'react';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { SectionPanel, SectionTabs } from '@/components/section-tabs';
import { useAuth } from '@/features/auth/auth-provider';
import { AttendanceTab } from './attendance-tab';
import { LeaveTab } from './leave-tab';
import { MyDayTab } from './my-day-tab';
import { PayrollTab } from './payroll-tab';
import { StaffTab } from './staff-tab';

type TabId = 'my-day' | 'leave' | 'attendance' | 'payroll' | 'staff';

/** Staff and HR. Everyone sees their own day, leave, attendance and pay; managers see everyone in their branches. */
export function HrPage() {
  const { can } = useAuth();
  const tabs: { id: TabId; label: string }[] = [
    ...(can('attendance.mark') ? [{ id: 'my-day' as const, label: 'My day' }] : []),
    { id: 'leave', label: 'Leave' },
    { id: 'attendance', label: 'Attendance' },
    { id: 'payroll', label: 'Payroll' },
    { id: 'staff', label: 'Staff' },
  ];
  const [active, setActive] = useState<TabId>(tabs[0]?.id ?? 'leave');

  return (
    <PageContainer>
      <PageHeader
        title="Staff and HR"
        description="Your day, leave, attendance and pay. Managers see everyone in their branches."
      />
      <SectionTabs
        label="HR sections"
        idPrefix="hr"
        tabs={tabs}
        value={active}
        onChange={setActive}
      />
      <SectionPanel idPrefix="hr" id={active}>
        {active === 'my-day' ? <MyDayTab /> : null}
        {active === 'leave' ? <LeaveTab /> : null}
        {active === 'attendance' ? <AttendanceTab /> : null}
        {active === 'payroll' ? <PayrollTab /> : null}
        {active === 'staff' ? <StaffTab /> : null}
      </SectionPanel>
    </PageContainer>
  );
}
