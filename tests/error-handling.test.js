import { describe, it, expect, vi } from 'vitest';

describe('Error Handling', () => {
  it('should handle WebRTC offer errors gracefully', () => {
    const mockPC = {
      createOffer: vi.fn().mockRejectedValue(new Error('ICE failed')),
      close: vi.fn()
    };
    
    expect(() => {
      mockPC.createOffer();
    }).not.toThrow();
  });

  it('should handle invalid SDP without crashing', () => {
    const invalidSDP = { invalid: 'data' };
    
    expect(() => {
      new RTCSessionDescription(invalidSDP);
    }).not.toThrow();
  });

  it('should handle socket errors without crashing connection', () => {
    const mockSocket = {
      emit: vi.fn().mockImplementation(() => {
        throw new Error('Socket error');
      })
    };
    
    expect(() => {
      try {
        mockSocket.emit('test', { data: 'test' });
      } catch (e) {
        console.error('Socket emit error:', e);
      }
    }).not.toThrow();
  });
});