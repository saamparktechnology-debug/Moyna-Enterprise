import { vi } from 'vitest';

/** Makes `matchMedia` answer as a screen `width` pixels wide would. Undone by `vi.unstubAllGlobals()`. */
export function setViewport(
  width: number,
  options: { dark?: boolean; coarse?: boolean } = {},
): void {
  const answer = (query: string): boolean => {
    const min = /\(min-width:\s*(\d+)px\)/.exec(query);
    if (min) return width >= Number(min[1]);
    if (query.includes('prefers-color-scheme: dark')) return options.dark === true;
    if (query.includes('pointer: coarse')) return options.coarse === true;
    return false;
  };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: answer(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}
