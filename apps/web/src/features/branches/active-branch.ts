import { useSyncExternalStore } from 'react';
import type { SessionUser } from '@erp/contracts';
import { api } from '@/lib/api';

type Listener = () => void;

const listeners = new Set<Listener>();
let current: string | null = null;

const storageKey = (userId: string): string => `erp.activeBranch.${userId}`;

function set(branchId: string | null): void {
  current = branchId;
  api.setActiveBranch(branchId);
  for (const listener of [...listeners]) listener();
}

function readStored(userId: string): string | null {
  try {
    return window.sessionStorage.getItem(storageKey(userId));
  } catch {
    return null;
  }
}

/** Puts back the branch a user chose earlier in this browser tab, if it is still one of theirs. */
export function restoreActiveBranch(user: SessionUser): string | null {
  const stored = readStored(user.id);
  const valid =
    stored !== null && user.branches.some((branch) => branch.id === stored) ? stored : null;
  set(valid);
  return valid;
}

export function chooseActiveBranch(user: SessionUser, branchId: string | null): void {
  try {
    if (branchId) window.sessionStorage.setItem(storageKey(user.id), branchId);
    else window.sessionStorage.removeItem(storageKey(user.id));
  } catch {
    // The choice then lasts only until the page is reloaded.
  }
  set(branchId);
}

/** Forgets the working branch for the current screen without erasing the stored preference. */
export function clearActiveBranch(): void {
  set(null);
}

export function useActiveBranch(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
    () => null,
  );
}
