import { X } from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';
import { Alert } from '@/components/alert';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const AUTO_DISMISS_MS = 6000;
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function show(tone: ToastTone, message: string): number {
  const id = nextId++;
  items = [...items, { id, tone, message }].slice(-4);
  emit();
  return id;
}

export function dismissToast(id: number): void {
  items = items.filter((item) => item.id !== id);
  emit();
}

/** Short feedback that goes away by itself. Errors stay until dismissed, so they are never missed. */
export const toast = {
  success: (message: string) => show('success', message),
  info: (message: string) => show('info', message),
  warning: (message: string) => show('warning', message),
  error: (message: string) => show('error', message),
  clear: () => {
    items = [];
    emit();
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function ToastView({ item }: { item: ToastItem }) {
  useEffect(() => {
    if (item.tone === 'error') return undefined;
    const timer = setTimeout(() => dismissToast(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.id, item.tone]);
  return (
    <div className="pointer-events-auto flex items-start gap-1 rounded-lg bg-card shadow-md">
      <Alert tone={item.tone} className="flex-1">
        {item.message}
      </Alert>
      <button
        type="button"
        aria-label="Dismiss message"
        className="m-1 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => dismissToast(item.id)}
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/** Mount once, in the application shell. */
export function Toaster() {
  const current = useSyncExternalStore(
    subscribe,
    () => items,
    () => items,
  );
  return (
    <div
      role="region"
      aria-label="Messages"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-[70] flex flex-col items-end gap-2 sm:left-auto sm:w-96"
    >
      {current.map((item) => (
        <ToastView key={item.id} item={item} />
      ))}
    </div>
  );
}
