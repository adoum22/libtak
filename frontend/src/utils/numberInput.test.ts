import { describe, expect, it } from 'vitest';

import { normalizeDecimalInput, parseDecimalInput } from './numberInput';

describe('number input helpers', () => {
  it('accepts French decimal separators and strips unsafe characters', () => {
    expect(normalizeDecimalInput(' 1 234,50 DH')).toBe('1234.50');
    expect(parseDecimalInput('12,75')).toBe(12.75);
  });

  it('keeps only one decimal separator', () => {
    expect(normalizeDecimalInput('1.2.3')).toBe('1.23');
  });
});
