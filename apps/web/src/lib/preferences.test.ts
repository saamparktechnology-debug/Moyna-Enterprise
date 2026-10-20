import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ANONYMOUS_SCOPE,
  MAX_FAVOURITES,
  MAX_RECENT,
  moveEntry,
  pushRecent,
  resetPreferencesCache,
  sanitisePreferences,
  toggleFavourite,
  usePreferences,
} from './preferences';

beforeEach(() => {
  window.localStorage.clear();
  resetPreferencesCache();
});

describe('list helpers', () => {
  it('pins to the end and unpins, without changing the input', () => {
    const start = ['/items'];
    expect(toggleFavourite(start, '/sales')).toEqual(['/items', '/sales']);
    expect(toggleFavourite(['/items', '/sales'], '/items')).toEqual(['/sales']);
    expect(start).toEqual(['/items']);
  });

  it('never keeps more than the favourites limit', () => {
    const many = Array.from({ length: MAX_FAVOURITES }, (_, i) => `/p${i}`);
    expect(toggleFavourite(many, '/extra')).toHaveLength(MAX_FAVOURITES);
  });

  it('moves an entry up or down and ignores moves off either end', () => {
    expect(moveEntry(['/a', '/b', '/c'], 2, -1)).toEqual(['/a', '/c', '/b']);
    expect(moveEntry(['/a', '/b', '/c'], 0, 1)).toEqual(['/b', '/a', '/c']);
    expect(moveEntry(['/a', '/b'], 0, -1)).toEqual(['/a', '/b']);
    expect(moveEntry(['/a', '/b'], 1, 1)).toEqual(['/a', '/b']);
    expect(moveEntry(['/a', '/b'], -1, 1)).toEqual(['/a', '/b']);
  });

  it('keeps recent screens newest first, without repeats, up to the limit', () => {
    let recent: string[] = [];
    for (let i = 0; i < MAX_RECENT + 3; i++) recent = pushRecent(recent, `/p${i}`);
    recent = pushRecent(recent, '/p6');
    expect(recent).toHaveLength(MAX_RECENT);
    expect(recent[0]).toBe('/p6');
    expect(new Set(recent).size).toBe(MAX_RECENT);
  });
});

describe('sanitisePreferences', () => {
  it('drops anything that is not an app path or a known choice', () => {
    expect(
      sanitisePreferences({
        favourites: ['/ok', 'javascript:alert(1)', 5, '/ok'],
        theme: 'neon',
        density: 'compact',
        sidebarCollapsed: 'yes',
      }),
    ).toEqual({ favourites: ['/ok'], recent: [], theme: 'system', density: 'compact' });
  });

  it('copes with null and non-objects', () => {
    expect(sanitisePreferences(null).theme).toBe('system');
    expect(sanitisePreferences('text').favourites).toEqual([]);
  });
});

describe('usePreferences', () => {
  it('saves a change under the user and restores it later', () => {
    const first = renderHook(() => usePreferences('user-1'));
    act(() => first.result.current.update({ favourites: ['/items'], sidebarCollapsed: true }));
    expect(first.result.current.preferences.favourites).toEqual(['/items']);
    expect(
      JSON.parse(window.localStorage.getItem('erp.preferences.v1.user-1') ?? '{}'),
    ).toMatchObject({
      favourites: ['/items'],
      sidebarCollapsed: true,
    });

    resetPreferencesCache();
    const again = renderHook(() => usePreferences('user-1'));
    expect(again.result.current.preferences.favourites).toEqual(['/items']);
  });

  it('keeps users apart', () => {
    const a = renderHook(() => usePreferences('a'));
    act(() => a.result.current.update({ favourites: ['/items'] }));
    const b = renderHook(() => usePreferences('b'));
    expect(b.result.current.preferences.favourites).toEqual([]);
    expect(
      renderHook(() => usePreferences(ANONYMOUS_SCOPE)).result.current.preferences.favourites,
    ).toEqual([]);
  });

  it('starts from defaults when storage is damaged', () => {
    window.localStorage.setItem('erp.preferences.v1.a', '{not json');
    const { result } = renderHook(() => usePreferences('a'));
    expect(result.current.preferences).toMatchObject({ theme: 'system', density: 'standard' });
  });

  it('updates every component using the same user', () => {
    const one = renderHook(() => usePreferences('a'));
    const two = renderHook(() => usePreferences('a'));
    act(() => one.result.current.update({ theme: 'dark' }));
    expect(two.result.current.preferences.theme).toBe('dark');
  });
});
