import { isValidEan13 } from '@erp/contracts';

const L_CODES = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
] as const;
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
] as const;
const GUARD = '101';
const CENTRE = '01010';

const invert = (bits: string): string => bits.replace(/[01]/g, (bit) => (bit === '1' ? '0' : '1'));
const reverse = (bits: string): string => [...bits].reverse().join('');

function pattern(digit: number): string {
  const found = L_CODES[digit];
  if (found === undefined) throw new Error('Not a digit');
  return found;
}

/** The 95 modules of an EAN-13 symbol, as a string of 1 (bar) and 0 (space). */
export function ean13Modules(code: string): string {
  if (!isValidEan13(code)) throw new Error('Not a valid EAN-13 number');
  const parity = PARITY[Number(code.charAt(0))];
  if (parity === undefined) throw new Error('Not a digit');
  const left = [...parity]
    .map((set, index) => {
      const base = pattern(Number(code.charAt(index + 1)));
      return set === 'L' ? base : reverse(invert(base));
    })
    .join('');
  const right = [...code.slice(7)].map((digit) => invert(pattern(Number(digit)))).join('');
  return `${GUARD}${left}${CENTRE}${right}${GUARD}`;
}
