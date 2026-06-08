import { describe, it, expect } from 'vitest';
import { validateUUID, sanitizeUUID } from '../src/uuid-validator.js';

describe('UUID Validation', () => {
  describe('validateUUID', () => {
    it('should accept valid UUID v4', () => {
      expect(validateUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(validateUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      expect(validateUUID('')).toBe(false);
      expect(validateUUID(null)).toBe(false);
      expect(validateUUID(undefined)).toBe(false);
      expect(validateUUID('not-a-uuid')).toBe(false);
      expect(validateUUID('550e8400-e29b-41d4-a716')).toBe(false);
      expect(validateUUID('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false);
    });

    it('should reject non-v4 UUIDs', () => {
      expect(validateUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(false);
      expect(validateUUID('6ba7b810-9dad-21d1-80b4-00c04fd430c8')).toBe(false);
      expect(validateUUID('6ba7b810-9dad-31d1-80b4-00c04fd430c8')).toBe(false);
      expect(validateUUID('6ba7b810-9dad-51d1-80b4-00c04fd430c8')).toBe(false);
    });

    it('should reject malicious input', () => {
      expect(validateUUID('${构造}')).toBe(false);
      expect(validateUUID('<script>alert(1)</script>')).toBe(false);
      expect(validateUUID('SELECT * FROM users')).toBe(false);
    });
  });

  describe('sanitizeUUID', () => {
    it('should return valid UUID unchanged', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      expect(sanitizeUUID(uuid)).toBe(uuid);
    });

    it('should return empty string for invalid input', () => {
      expect(sanitizeUUID('')).toBe('');
      expect(sanitizeUUID(null)).toBe('');
      expect(sanitizeUUID(undefined)).toBe('');
      expect(sanitizeUUID('not-a-uuid')).toBe('');
    });
  });
});