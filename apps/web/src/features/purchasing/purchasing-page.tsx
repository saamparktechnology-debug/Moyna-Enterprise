import { useState } from 'react';
import type { ReactNode } from 'react';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { SectionPanel, SectionTabs } from '@/components/section-tabs';
import { useAuth } from '@/features/auth/auth-provider';
import { DiscrepanciesTab } from './discrepancies-tab';
import { OrdersTab } from './orders-tab';
import { ReceiptsTab } from './receipts-tab';
import { ReturnsTab } from './returns-tab';
import { SuppliersTab } from './suppliers-tab';

interface Tab {
  id: string;
  label: string;
  permission: string;
  render: () => ReactNode;
}

const TABS: Tab[] = [
  { id: 'orders', label: 'Orders', permission: 'purchases.view', render: () => <OrdersTab /> },
  {
    id: 'receipts',
    label: 'Receipts',
    permission: 'purchases.view',
    render: () => <ReceiptsTab />,
  },
  {
    id: 'discrepancies',
    label: 'Discrepancies',
    permission: 'discrepancies.view',
    render: () => <DiscrepanciesTab />,
  },
  { id: 'returns', label: 'Returns', permission: 'purchases.view', render: () => <ReturnsTab /> },
  {
    id: 'suppliers',
    label: 'Suppliers',
    permission: 'suppliers.view',
    render: () => <SuppliersTab />,
  },
];

export function PurchasingPage() {
  const { can } = useAuth();
  const visible = TABS.filter((tab) => can(tab.permission));
  const [active, setActive] = useState(visible[0]?.id ?? 'orders');
  const current = visible.find((tab) => tab.id === active) ?? visible[0];
  return (
    <PageContainer>
      <PageHeader
        title="Purchasing"
        description="Orders to suppliers, goods received line by line, and what to do about differences."
      />
      <SectionTabs
        label="Purchasing sections"
        idPrefix="purchasing"
        tabs={visible}
        value={current?.id ?? active}
        onChange={setActive}
      />
      {current ? (
        <SectionPanel idPrefix="purchasing" id={current.id}>
          {current.render()}
        </SectionPanel>
      ) : null}
    </PageContainer>
  );
}
