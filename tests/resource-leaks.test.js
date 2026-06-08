import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from '../src/room-manager.js';

describe('Resource Cleanup', () => {
  let roomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    roomManager = new RoomManager();
    vi.spyOn(global, 'clearTimeout');
  });

  afterEach(() => {
    vi.useRealTimers();
    roomManager.cleanup();
  });

  it('should cleanup all timers when room is deleted', () => {
    const uuid = 'user-uuid';
    const mockSocket = { 
      id: 'socket-id', 
      emit: vi.fn(), 
      join: vi.fn(),
      to: vi.fn().mockReturnThis(),
      leave: vi.fn()
    };
    
    const { code } = roomManager.createRoom(uuid, mockSocket);
    const room = roomManager.getRoom(code);
    
    expect(room.cleanupTimer).not.toBeNull();
    
    roomManager.cleanUpRoom(code);
    
    expect(roomManager.getRoom(code)).toBeUndefined();
    expect(clearTimeout).toHaveBeenCalled();
  });

  it('should cleanup all rooms on shutdown', () => {
    const socket1 = { id: 'socket-1', emit: vi.fn(), join: vi.fn() };
    const socket2 = { id: 'socket-2', emit: vi.fn(), join: vi.fn() };
    
    roomManager.createRoom('uuid-1', socket1);
    roomManager.createRoom('uuid-2', socket2);
    
    expect(roomManager.rooms.size).toBe(2);
    
    roomManager.cleanup();
    
    expect(roomManager.rooms.size).toBe(0);
  });

  it('should handle cleanup of orphaned timers', () => {
    const uuid = 'user-uuid';
    const mockSocket = { 
      id: 'socket-id', 
      emit: vi.fn(), 
      join: vi.fn(),
      to: vi.fn().mockReturnThis(),
      leave: vi.fn()
    };
    
    const { code } = roomManager.createRoom(uuid, mockSocket);
    roomManager.handleDisconnect(mockSocket);
    
    vi.advanceTimersByTime(31000);
    
    const room = roomManager.getRoom(code);
    expect(room.slots.size).toBe(0);
  });
});