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

  it('should set disconnectedAt on handleDisconnect', () => {
    const socket1 = createMockSocket('socket-1');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    
    const before = Date.now();
    roomManager.handleDisconnect(socket1);
    const room = roomManager.getRoom(code);
    const disconnectedAt = room.slots.get('uuid-1').disconnectedAt;
    
    expect(disconnectedAt).toBeGreaterThanOrEqual(before);
    expect(disconnectedAt).toBeLessThanOrEqual(Date.now());
  });

  it('should return reconnectWindow on successful reconnect', () => {
    const socket1 = createMockSocket('socket-1');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    
    roomManager.handleDisconnect(socket1);
    
    const newSocket = createMockSocket('socket-new');
    const result = roomManager.reconnectToRoom(code, 'uuid-1', newSocket);
    
    expect(result.success).toBe(true);
    expect(result).toHaveProperty('reconnectWindow');
    expect(typeof result.reconnectWindow).toBe('number');
    expect(result.reconnectWindow).toBeGreaterThan(0);
    expect(result.reconnectWindow).toBeLessThanOrEqual(30000);
  });

  it('should decrease reconnectWindow after delay', () => {
    const socket1 = createMockSocket('socket-1');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    
    roomManager.handleDisconnect(socket1);
    
    vi.advanceTimersByTime(5000);
    
    const newSocket = createMockSocket('socket-new');
    const result = roomManager.reconnectToRoom(code, 'uuid-1', newSocket);
    
    expect(result.success).toBe(true);
    expect(result.reconnectWindow).toBeGreaterThan(0);
    expect(result.reconnectWindow).toBeLessThan(30000);
  });

  it('should return isCreator flag on reconnect', () => {
    const socket1 = createMockSocket('socket-1');
    const socket2 = createMockSocket('socket-2');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    roomManager.joinRoom(code, 'uuid-2', socket2);
    
    roomManager.handleDisconnect(socket1);
    const result1 = roomManager.reconnectToRoom(code, 'uuid-1', createMockSocket('socket-new-1'));
    expect(result1.isCreator).toBe(true);
    
    roomManager.handleDisconnect(socket2);
    const result2 = roomManager.reconnectToRoom(code, 'uuid-2', createMockSocket('socket-new-2'));
    expect(result2.isCreator).toBe(false);
  });

  it('should send peer-disconnected with canReconnect true on disconnect', () => {
    const socket1 = createMockSocket('socket-1');
    const socket2 = createMockSocket('socket-2');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    roomManager.joinRoom(code, 'uuid-2', socket2);
    
    roomManager.handleDisconnect(socket1);
    
    expect(socket2.emit).toHaveBeenCalledWith('peer-disconnected', { canReconnect: true });
  });

  it('should restore slot connection on reconnect', () => {
    const socket1 = createMockSocket('socket-1');
    const socket2 = createMockSocket('socket-2');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    roomManager.joinRoom(code, 'uuid-2', socket2);
    
    roomManager.handleDisconnect(socket1);
    
    const newSocket = createMockSocket('socket-new-1');
    const result = roomManager.reconnectToRoom(code, 'uuid-1', newSocket);
    
    expect(result.success).toBe(true);
    const room = roomManager.getRoom(code);
    expect(room.slots.get('uuid-1').connected).toBe(true);
    expect(room.slots.get('uuid-1').socket).toBe(newSocket);
    expect(room.slots.get('uuid-2').connected).toBe(true);
  });

  it('should send peer-disconnected with canReconnect false after timer expires', () => {
    const socket1 = createMockSocket('socket-1');
    const socket2 = createMockSocket('socket-2');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    roomManager.joinRoom(code, 'uuid-2', socket2);
    
    roomManager.handleDisconnect(socket1);
    socket2.emit.mockClear();
    
    vi.advanceTimersByTime(30000);
    
    expect(socket2.emit).toHaveBeenCalledWith('peer-disconnected', { canReconnect: false });
  });

  it('should delete slot after reconnect timer expires', () => {
    const socket1 = createMockSocket('socket-1');
    const socket2 = createMockSocket('socket-2');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    roomManager.joinRoom(code, 'uuid-2', socket2);
    
    roomManager.handleDisconnect(socket1);
    
    vi.advanceTimersByTime(30000);
    
    const room = roomManager.getRoom(code);
    expect(room.slots.has('uuid-1')).toBe(false);
    expect(room.slots.has('uuid-2')).toBe(true);
  });

  it('should not allow reconnect after timer expires', () => {
    const socket1 = createMockSocket('socket-1');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    
    roomManager.handleDisconnect(socket1);
    vi.advanceTimersByTime(30000);
    
    const newSocket = createMockSocket('socket-new');
    const result = roomManager.reconnectToRoom(code, 'uuid-1', newSocket);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('slot-not-found');
  });

  it('should handle both users disconnecting and reconnecting', () => {
    const socket1 = createMockSocket('socket-1');
    const socket2 = createMockSocket('socket-2');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    roomManager.joinRoom(code, 'uuid-2', socket2);
    
    roomManager.handleDisconnect(socket1);
    roomManager.handleDisconnect(socket2);
    
    const result1 = roomManager.reconnectToRoom(code, 'uuid-1', createMockSocket('socket-new-1'));
    expect(result1.success).toBe(true);
    expect(result1.isCreator).toBe(true);
    
    const result2 = roomManager.reconnectToRoom(code, 'uuid-2', createMockSocket('socket-new-2'));
    expect(result2.success).toBe(true);
    expect(result2.isCreator).toBe(false);
    
    const room = roomManager.getRoom(code);
    expect(room.slots.get('uuid-1').connected).toBe(true);
    expect(room.slots.get('uuid-2').connected).toBe(true);
  });

  it('should clear reconnectTimer on successful reconnect', () => {
    const socket1 = createMockSocket('socket-1');
    const { code } = roomManager.createRoom('uuid-1', socket1);
    
    roomManager.handleDisconnect(socket1);
    const room = roomManager.getRoom(code);
    expect(room.slots.get('uuid-1').reconnectTimer).not.toBeNull();
    
    const newSocket = createMockSocket('socket-new');
    roomManager.reconnectToRoom(code, 'uuid-1', newSocket);
    
    expect(room.slots.get('uuid-1').reconnectTimer).toBeNull();
  });
});