import { useCallback, useSyncExternalStore } from 'react';

/**
 * Local user preferences: favourites, recently visited screens, theme, density and sidebar state.
 *
 * The backend has no preferences table and Stage 6 may not change the schema, so these live in the
 * browser, keyed by user id so two people sharing a computer never see each other's favourites.
 * Nothing here grants access: a favourite is only a path, and every consumer filters favourites
 * through the same permission check as the menu itself.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type DensityPreference = 'standard' | 'compact';

export interface Preferences {
  favourites: string[];
  recent: string[];
  theme: ThemePreference;
  density: DensityPreference;
  /** Unset means "decide from the screen width". */
  sidebarCollapsed?: boolean | undefined;
}

export const ANONYMOUS_SCOPE = 'anonymous';
export const MAX_RECENT = 5;
export const MAX_FAVOURITES = 12;

const KEY_PREFIX = 'erp.preferences.v1.';

export const DEFAULT_PREFERENCES: Preferences = {
  favourites: [],
  recent: [],
  theme: 'system',
  density: 'standard',
};

function paths(input: unknown, limit: number): string[] {
  if (!Array.isArray(input)) return [];
  const clean = input.filter((p): p is string => typeof p === 'string' && p.startsWith('/'));
  return [...new Set(clean)].slice(0, limit);
}

/** Reads whatever is stored and keeps only well-formed values, so damaged storage never breaks the app. */
export function sanitisePreferences(raw: unknown): Preferences {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const result: Preferences = {
    favourites: paths(value['favourites'], MAX_FAVOURITES),
    recent: paths(value['recent'], MAX_RECENT),
    theme:
      value['theme'] === 'light' || value['theme'] === 'dark' || value['theme'] === 'system'
        ? value['theme']
        : DEFAULT_PREFERENCES.theme,
    density: value['density'] === 'compact' ? 'compact' : 'standard',
  };
  if (typeof value['sidebarCollapsed'] === 'boolean')
    result.sidebarCollapsed = value['sidebarCollapsed'];
  return result;
}

/** Adds or removes a path. New favourites go to the end. */
export function toggleFavourite(list: readonly string[], path: string): string[] {
  if (list.includes(path)) return list.filter((entry) => entry !== path);
  return [...list, path].slice(0, MAX_FAVOURITES);
}

/** Moves the entry at `index` by `delta` places. Out-of-range moves return the list unchanged. */
export function moveEntry(list: readonly string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const copy = [...list];
  const [moved] = copy.splice(index, 1);
  copy.splice(target, 0, moved as string);
  return copy;
}

/** Puts a path first, without repeats, keeping at most MAX_RECENT. */
export function pushRecent(list: readonly string[], path: string): string[] {
  return [path, ...list.filter((entry) => entry !== path)].slice(0, MAX_RECENT);
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

interface Entry {
  snapshot: Preferences;
  listeners: Set<() => void>;
}

const cache = new Map<string, Entry>();

function entryFor(scope: string): Entry {
  let entry = cache.get(scope);
  if (!entry) {
    let snapshot = { ...DEFAULT_PREFERENCES };
    try {
      const text = storage()?.getItem(KEY_PREFIX + scope);
      if (text) snapshot = sanitisePreferences(JSON.parse(text));
    } catch {
      // Damaged or blocked storage: start from the defaults.
    }
    entry = { snapshot, listeners: new Set() };
    cache.set(scope, entry);
  }
  return entry;
}

/** Test helper: forget what was read, so the next read comes from storage again. */
export function resetPreferencesCache(): void {
  cache.clear();
}

function writePreferences(scope: string, change: Partial<Preferences>): void {
  const entry = entryFor(scope);
  entry.snapshot = sanitisePreferences({ ...entry.snapshot, ...change });
  try {
    storage()?.setItem(KEY_PREFIX + scope, JSON.stringify(entry.snapshot));
  } catch {
    // Storage is full or blocked: the choice still holds for this session.
  }
  entry.listeners.forEach((listener) => listener());
}

export function usePreferences(scope: string): {
  preferences: Preferences;
  update: (change: Partial<Preferences>) => void;
} {
  const subscribe = useCallback(
    (listener: () => void) => {
      const { listeners } = entryFor(scope);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [scope],
  );
  const read = useCallback(() => entryFor(scope).snapshot, [scope]);
  const preferences = useSyncExternalStore(subscribe, read, read);
  const update = useCallback(
    (change: Partial<Preferences>) => writePreferences(scope, change),
    [scope],
  );
  return { preferences, update };
}
