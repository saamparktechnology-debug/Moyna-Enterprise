import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { api } from '@/lib/api';
import { toast } from '@/components/toast';
import { resetPreferencesCache } from '@/lib/preferences';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  api.setCsrfToken(null);
  window.localStorage.clear();
  resetPreferencesCache();
  toast.clear();
  document.documentElement.className = '';
});
