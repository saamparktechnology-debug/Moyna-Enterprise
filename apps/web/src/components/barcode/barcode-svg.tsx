import { useMemo } from 'react';
import { isValidEan13 } from '@erp/contracts';
import { ean13Modules } from './ean13';

const QUIET_ZONE = 9;
const BAR_HEIGHT = 50;
const TEXT_HEIGHT = 12;
const MODULES = 95;

function runsOf(modules: string): { x: number; width: number }[] {
  const runs: { x: number; width: number }[] = [];
  let start = -1;
  for (let index = 0; index <= modules.length; index += 1) {
    const bar = modules.charAt(index) === '1';
    if (bar && start < 0) start = index;
    if (!bar && start >= 0) {
      runs.push({ x: start, width: index - start });
      start = -1;
    }
  }
  return runs;
}

interface BarcodeSvgProps {
  value: string;
  className?: string;
}

/** Draws an EAN-13 barcode. Any other value is shown as plain text, because it cannot be drawn reliably here. */
export function BarcodeSvg({ value, className }: BarcodeSvgProps) {
  const runs = useMemo(() => (isValidEan13(value) ? runsOf(ean13Modules(value)) : null), [value]);
  if (!runs) return <span className="font-mono text-xs">{value}</span>;
  const width = MODULES + QUIET_ZONE * 2;
  const height = BAR_HEIGHT + TEXT_HEIGHT;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Barcode ${value}`}
      className={className}
    >
      <rect width={width} height={height} fill="#fff" />
      {runs.map((run) => (
        <rect
          key={run.x}
          x={run.x + QUIET_ZONE}
          y={0}
          width={run.width}
          height={BAR_HEIGHT}
          fill="#000"
        />
      ))}
      <text x={width / 2} y={height - 2} textAnchor="middle" fontSize="9" fontFamily="monospace">
        {`${value.slice(0, 1)} ${value.slice(1, 7)} ${value.slice(7)}`}
      </text>
    </svg>
  );
}
