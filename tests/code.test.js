import { describe, it, expect } from 'vitest';
import { generateCode, isValidCode, sanitizeCodeInput, getRawInput, CODE_ALPHABET, CODE_LENGTH } from '../src/code.js';

describe('generateCode', () => {
  it('should return a string of correct length', () => {
    const code = generateCode();
    expect(code).toHaveLength(CODE_LENGTH);
  });

  it('should only contain characters from the alphabet', () => {
    const code = generateCode();
    for (const ch of code) {
      expect(CODE_ALPHABET).toContain(ch);
    }
  });

  it('should not contain ambiguous characters (0, O, 1, I)', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateCode();
      expect(code).not.toMatch(/[0O1I]/);
    }
  });

  it('should generate unique codes when existing set is provided', () => {
    const existing = new Set(['ABC234', 'XYZ789']);
    const code = generateCode(existing);
    expect(existing.has(code)).toBe(false);
  });

  it('should generate different codes on successive calls', () => {
    const codes = new Set();
    for (let i = 0; i < 50; i++) {
      codes.add(generateCode());
    }
    expect(codes.size).toBe(50);
  });

  it('should be uppercase', () => {
    const code = generateCode();
    expect(code).toBe(code.toUpperCase());
  });
});

describe('isValidCode', () => {
  it('should accept a valid code', () => {
    expect(isValidCode('ABC234')).toBe(true);
    expect(isValidCode('XYZ789')).toBe(true);
    expect(isValidCode('LMNPQR')).toBe(true);
  });

  it('should reject a code with ambiguous chars (0, O, 1, I)', () => {
    expect(isValidCode('0ABC23')).toBe(false);
    expect(isValidCode('OABC23')).toBe(false);
    expect(isValidCode('1ABC23')).toBe(false);
    expect(isValidCode('IABC23')).toBe(false);
  });

  it('should reject wrong length', () => {
    expect(isValidCode('ABC23')).toBe(false);
    expect(isValidCode('ABC2345')).toBe(false);
  });

  it('should reject empty or null', () => {
    expect(isValidCode('')).toBe(false);
    expect(isValidCode(null)).toBe(false);
  });

  it('should reject lowercase', () => {
    expect(isValidCode('abc234')).toBe(false);
  });
});

describe('sanitizeCodeInput', () => {
  it('should convert to uppercase', () => {
    expect(sanitizeCodeInput('abc234')).toBe('ABC234');
  });

  it('should strip characters outside A-Z and 0-9', () => {
    expect(sanitizeCodeInput('AB$C@12!')).toBe('ABC12');
  });

  it('should truncate to CODE_LENGTH (6)', () => {
    expect(sanitizeCodeInput('ABCDEFGH')).toBe('ABCDEF');
  });

  it('should return empty string for empty input', () => {
    expect(sanitizeCodeInput('')).toBe('');
  });

  it('should return empty string for null/undefined', () => {
    expect(sanitizeCodeInput(null)).toBe('');
    expect(sanitizeCodeInput(undefined)).toBe('');
  });

  it('should keep valid characters', () => {
    expect(sanitizeCodeInput('ABC234')).toBe('ABC234');
  });
});

describe('getRawInput', () => {
  it('should strip spaces', () => {
    expect(getRawInput('ABC 234')).toBe('ABC234');
  });

  it('should strip dashes', () => {
    expect(getRawInput('ABC-234')).toBe('ABC234');
  });

  it('should strip dots', () => {
    expect(getRawInput('AB.C2.34')).toBe('ABC234');
  });

  it('should strip mixed separators', () => {
    expect(getRawInput('A-B C.2 34')).toBe('ABC234');
  });

  it('should handle already clean input', () => {
    expect(getRawInput('XYZ789')).toBe('XYZ789');
  });

  it('should return empty for all-separator input', () => {
    expect(getRawInput('- - . -')).toBe('');
  });
});
