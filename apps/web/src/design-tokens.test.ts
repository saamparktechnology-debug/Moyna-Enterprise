import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Every screen takes its colours from the design tokens, so a theme change reaches all of them. */
const ROOT = join(import.meta.dirname);
const RAW_PALETTE =
  /\b(bg|text|border|ring|fill|stroke|from|to|via)-(red|green|blue|gray|grey|slate|zinc|amber|yellow|orange|emerald|sky|stone|teal|cyan|indigo|violet|purple|pink|rose|lime|fuchsia)-\d{2,3}\b/;
/** A barcode must be black on white in every theme, or scanners cannot read it. */
const FIXED_COLOUR_FILES = ['/components/barcode/barcode-svg.tsx'];
const RAW_COLOUR_VALUE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('design tokens', () => {
  it('no screen or component uses a raw Tailwind palette class', () => {
    const offenders = sources(ROOT).filter((file) => RAW_PALETTE.test(readFileSync(file, 'utf8')));
    expect(offenders.map((file) => file.slice(ROOT.length))).toEqual([]);
  });

  it('no screen or component hard-codes a colour value', () => {
    const offenders = sources(ROOT)
      .filter((file) => !FIXED_COLOUR_FILES.some((fixed) => file.endsWith(fixed)))
      .filter((file) =>
        RAW_COLOUR_VALUE.test(readFileSync(file, 'utf8').replace(/&#\d+;|&#x[0-9a-f]+;/gi, '')),
      );
    expect(offenders.map((file) => file.slice(ROOT.length))).toEqual([]);
  });
});
