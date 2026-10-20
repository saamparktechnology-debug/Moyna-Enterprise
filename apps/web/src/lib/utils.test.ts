import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('joins class names and drops falsy values', () => {
    const hidden: boolean = false;
    expect(cn('a', hidden && 'b', undefined, 'c')).toBe('a c');
  });

  it('lets later Tailwind utilities override earlier conflicting ones', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4');
  });
});
