import { useState } from 'react';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { SectionPanel, SectionTabs } from '@/components/section-tabs';
import { useAuth } from '@/features/auth/auth-provider';
import { AuditSection } from './audit-section';
import { CompanySection } from './company-section';
import { RatesSection } from './rates-section';
import { SeriesSection } from './series-section';

const TABS = [
  { id: 'company', label: 'Company and limits', permission: 'settings.manage' },
  { id: 'series', label: 'Document numbers', permission: 'settings.manage' },
  { id: 'rates', label: 'Tax rates', permission: 'settings.manage' },
  { id: 'audit', label: 'Audit log', permission: 'audit.view' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function SettingsPage() {
  const { can } = useAuth();
  const tabs = TABS.filter((tab) => can(tab.permission));
  const [chosen, setChosen] = useState<TabId | null>(null);
  const current = tabs.find((tab) => tab.id === chosen) ?? tabs[0];

  if (tabs.length === 0)
    return (
      <PageContainer>
        <PageHeader
          title="You do not have access"
          description="Ask an administrator if you need to use this part of the system."
        />
      </PageContainer>
    );

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Branch details such as address and GSTIN are edited under Branches."
      />
      <SectionTabs
        label="Settings sections"
        idPrefix="settings"
        tabs={tabs}
        value={current?.id ?? 'company'}
        onChange={setChosen}
      />
      {current ? (
        <SectionPanel idPrefix="settings" id={current.id}>
          {current.id === 'company' ? <CompanySection /> : null}
          {current.id === 'series' ? <SeriesSection /> : null}
          {current.id === 'rates' ? <RatesSection /> : null}
          {current.id === 'audit' ? <AuditSection /> : null}
        </SectionPanel>
      ) : null}
    </PageContainer>
  );
}
