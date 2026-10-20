import { useState } from 'react';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { SectionPanel, SectionTabs } from '@/components/section-tabs';
import { AdjustmentsTab } from './adjustments-tab';
import { LowStockTab, MovementsTab, SerialUnitsTab, StockTab } from './stock-tabs';

const TABS = [
  { id: 'stock', label: 'Stock', render: () => <StockTab /> },
  { id: 'low', label: 'Low stock', render: () => <LowStockTab /> },
  { id: 'movements', label: 'Movements', render: () => <MovementsTab /> },
  { id: 'serial', label: 'Serial numbers', render: () => <SerialUnitsTab /> },
  { id: 'adjustments', label: 'Adjustments', render: () => <AdjustmentsTab /> },
] as const;

export function InventoryPage() {
  const [active, setActive] = useState<(typeof TABS)[number]['id']>('stock');
  const current = TABS.find((tab) => tab.id === active) ?? TABS[0];
  return (
    <PageContainer>
      <PageHeader
        title="Inventory"
        description="Stock by branch and state, with every movement, serial number and adjustment."
      />
      <SectionTabs
        label="Inventory sections"
        idPrefix="inventory"
        tabs={TABS}
        value={active}
        onChange={setActive}
      />
      <SectionPanel idPrefix="inventory" id={current.id}>
        {current.render()}
      </SectionPanel>
    </PageContainer>
  );
}
