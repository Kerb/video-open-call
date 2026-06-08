import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from '../src/room-manager.js';

describe('Room management', () => {
  let roomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    roomManager = new RoomManager();
  });

  afterEach(() => {
    vi.useRealTimers();
    roomManager.cleanup();
  });

  function createMockSocket(id) {
    return {
      id,
      emit: vi.fn(),
      join: vi.fn(),
      to: vi.fn().mockReturnThis(),
      leave: vi.fn(),
      currentRoom: null
    };
  }

  it('should create a room with a valid code', () => {
    const socket = createMockSocket('socket-1');
    const result = roomManager.createRoom('uuid-1', socket);
    
    expect(result.success).toBe(true);
    expect(result.code).toBeDefined();
    expect(roomManager.getRoom(result.code)).toBeDefined();
  });

  it('should allow a user to join an existing room', () => {
    const socket1 = createMockSocket('socket-1');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    
    const socket2 = createMockSocket('socket-2');
    const result = roomManager.joinRoom(code, 'uuid-2', socket2);
    
    expect(result.success).toBe(true);
    expect(roomManager.getRoom(code).slots.size).toBe(2);
  });

  it('should reject joining a non-existent room', () => {
    const socket = createMockSocket('socket-1');
    const result = roomManager.joinRoom('NONEXIST', 'uuid-1', socket);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('room-not-found');
  });

  it('should reject joining a full room', () => {
    const socket1 = createMockSocket('socket-1');
    const socket2 = createMockSocket('socket-2');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    roomManager.joinRoom(code, 'uuid-2', socket2);
    
    const socket3 = createMockSocket('socket-3');
    const result = roomManager.joinRoom(code, 'uuid-3', socket3);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('room-full');
  });

  it('should allow max 2 participants', () => {
    const socket1 = createMockSocket('socket-1');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    
    const socket2 = createMockSocket('socket-2');
    roomManager.joinRoom(code, 'uuid-2', socket2);
    expect(roomManager.getRoom(code).slots.size).toBe(2);
    
    const socket3 = createMockSocket('socket-3');
    const result = roomManager.joinRoom(code, 'uuid-3', socket3);
    expect(result.success).toBe(false);
  });

  it('should handle a user leaving the room', () => {
    const socket1 = createMockSocket('socket-1');
    const socket2 = createMockSocket('socket-2');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    roomManager.joinRoom(code, 'uuid-2', socket2);
    
    roomManager.leaveRoom(socket1);
    expect(roomManager.getRoom(code).slots.size).toBe(1);
  });

  it('should handle reconnection', () => {
    const socket1 = createMockSocket('socket-1');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    
    roomManager.handleDisconnect(socket1);
    const room = roomManager.getRoom(code);
    expect(room.slots.get('uuid-1').connected).toBe(false);
    
    const newSocket = createMockSocket('socket-new');
    const result = roomManager.reconnectToRoom(code, 'uuid-1', newSocket);
    
    expect(result.success).toBe(true);
    expect(room.slots.get('uuid-1').connected).toBe(true);
  });
});