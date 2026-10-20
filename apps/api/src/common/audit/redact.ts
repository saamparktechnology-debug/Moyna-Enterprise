const SENSITIVE_WORDS = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'csrf',
  'otp',
  'aadhaar',
  'aadhar',
  'pan',
  'passport',
  'cvv',
]);
const SENSITIVE_PAIRS: readonly (readonly [Set<string>, Set<string>])[] = [
  [new Set(['api']), new Set(['key'])],
  [new Set(['account', 'card', 'kyc']), new Set(['no', 'num', 'number'])],
];
const REDACTED = '[redacted]';
const MAX_DEPTH = 8;

function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isSensitiveKey(key: string): boolean {
  const parts = words(key);
  if (parts.some((part) => SENSITIVE_WORDS.has(part))) return true;
  return parts.some((part, index) => {
    const next = parts[index + 1];
    return (
      next !== undefined &&
      SENSITIVE_PAIRS.some(([first, second]) => first.has(part) && second.has(next))
    );
  });
}

export function redactSensitive(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((entry) => redactSensitive(entry, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : redactSensitive(entry, depth + 1);
  }
  return result;
}
