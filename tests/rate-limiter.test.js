import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RateLimiter } from '../src/rate-limiter.js';

describe('RateLimiter', () => {
  let rateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    rateLimiter = new RateLimiter({
      maxRequests: 5,
      windowMs: 60000
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests within limit', () => {
    const identifier = 'user-123';
    
    for (let i = 0; i < 5; i++) {
      expect(rateLimiter.check(identifier)).toBe(true);
    }
  });

  it('should block requests exceeding limit', () => {
    const identifier = 'user-123';
    
    for (let i = 0; i < 5; i++) {
      rateLimiter.check(identifier);
    }
    
    expect(rateLimiter.check(identifier)).toBe(false);
  });

  it('should reset after window expires', () => {
    const identifier = 'user-123';
    
    for (let i = 0; i < 5; i++) {
      rateLimiter.check(identifier);
    }
    expect(rateLimiter.check(identifier)).toBe(false);
    
    vi.advanceTimersByTime(60001);
    expect(rateLimiter.check(identifier)).toBe(true);
  });

  it('should handle multiple identifiers independently', () => {
    const user1 = 'user-1';
    const user2 = 'user-2';
    
    for (let i = 0; i < 5; i++) {
      rateLimiter.check(user1);
    }
    
    expect(rateLimiter.check(user1)).toBe(false);
    expect(rateLimiter.check(user2)).toBe(true);
  });

  it('should clean up old entries', () => {
    const identifier = 'user-123';
    
    rateLimiter.check(identifier);
    vi.advanceTimersByTime(60001);
    rateLimiter.cleanup();
    
    expect(rateLimiter.getStats(identifier)).toEqual({
      count: 0,
      resetTime: expect.any(Number)
    });
  });

  describe('input validation', () => {
    it('should throw error for negative maxRequests', () => {
      expect(() => {
        new RateLimiter({ maxRequests: -1, windowMs: 60000 });
      }).toThrow('maxRequests must be a positive number (>= 1)');
    });

    it('should throw error for zero maxRequests', () => {
      expect(() => {
        new RateLimiter({ maxRequests: 0, windowMs: 60000 });
      }).toThrow('maxRequests must be a positive number (>= 1)');
    });

    it('should throw error for non-number maxRequests', () => {
      expect(() => {
        new RateLimiter({ maxRequests: 'not a number', windowMs: 60000 });
      }).toThrow('maxRequests must be a positive number (>= 1)');
    });

    it('should throw error for NaN maxRequests', () => {
      expect(() => {
        new RateLimiter({ maxRequests: NaN, windowMs: 60000 });
      }).toThrow('maxRequests must be a positive number (>= 1)');
    });

    it('should throw error for negative windowMs', () => {
      expect(() => {
        new RateLimiter({ maxRequests: 100, windowMs: -1 });
      }).toThrow('windowMs must be a positive number (>= 1)');
    });

    it('should throw error for zero windowMs', () => {
      expect(() => {
        new RateLimiter({ maxRequests: 100, windowMs: 0 });
      }).toThrow('windowMs must be a positive number (>= 1)');
    });

    it('should throw error for non-number windowMs', () => {
      expect(() => {
        new RateLimiter({ maxRequests: 100, windowMs: 'not a number' });
      }).toThrow('windowMs must be a positive number (>= 1)');
    });

    it('should throw error for NaN windowMs', () => {
      expect(() => {
        new RateLimiter({ maxRequests: 100, windowMs: NaN });
      }).toThrow('windowMs must be a positive number (>= 1)');
    });
  });
});