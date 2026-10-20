import { useEffect } from 'react';
import type { DensityPreference, ThemePreference } from './preferences';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Applies the chosen theme and density to the page, following the system theme when asked to. */
export function useAppearance(theme: ThemePreference, density: DensityPreference): void {
  useEffect(() => {
    const root = document.documentElement;
    const media = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media?.matches === true);
      root.classList.toggle('dark', dark);
    };
    apply();
    media?.addEventListener('change', apply);
    return () => media?.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset['density'] = density;
  }, [density]);

  useEffect(
    () => () => {
      document.documentElement.classList.remove('dark');
      delete document.documentElement.dataset['density'];
    },
    [],
  );
}
