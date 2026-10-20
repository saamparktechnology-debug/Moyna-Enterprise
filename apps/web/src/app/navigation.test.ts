import { describe, expect, it } from 'vitest';
import {
  NAV_GROUPS,
  NAV_ITEMS,
  canSeeNavItem,
  navItemForLocation,
  searchNavItems,
} from './navigation';

describe('navigation model', () => {
  it('has one entry per path and puts every entry in a group', () => {
    const paths = NAV_ITEMS.map((item) => item.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const group of NAV_GROUPS) {
      for (const item of group.items) expect(item.group).toBe(group.label);
    }
  });

  it('applies the same permission rules the menu always had', () => {
    const settings = NAV_ITEMS.find((item) => item.path === '/settings');
    const inventory = NAV_ITEMS.find((item) => item.path === '/inventory');
    const dashboard = NAV_ITEMS.find((item) => item.path === '/');
    if (!settings || !inventory || !dashboard) throw new Error('missing items');
    expect(canSeeNavItem(dashboard, () => false)).toBe(true);
    expect(canSeeNavItem(inventory, (code) => code === 'stock.view')).toBe(true);
    expect(canSeeNavItem(inventory, () => false)).toBe(false);
    expect(canSeeNavItem(settings, (code) => code === 'audit.view')).toBe(true);
    expect(canSeeNavItem(settings, () => false)).toBe(false);
  });

  it('finds the menu entry a location belongs to', () => {
    expect(navItemForLocation('/')?.label).toBe('Dashboard');
    expect(navItemForLocation('/sales')?.label).toBe('Sales');
    expect(navItemForLocation('/sales/anything')?.label).toBe('Sales');
    expect(navItemForLocation('/nowhere')).toBeUndefined();
  });

  it('ranks label matches before group and keyword matches', () => {
    const labels = (text: string) => searchNavItems(NAV_ITEMS, text).map((item) => item.label);
    expect(labels('inv')[0]).toBe('Inventory');
    expect(labels('commission')).toContain('Brokers');
    expect(labels('stock and')).toContain('Items');
    expect(labels('  ')).toHaveLength(NAV_ITEMS.length);
    expect(labels('zzzzzz')).toEqual([]);
  });

  it('treats typed punctuation as plain text', () => {
    expect(searchNavItems(NAV_ITEMS, '%')).toEqual([]);
    expect(searchNavItems(NAV_ITEMS, '[')).toEqual([]);
  });
});
