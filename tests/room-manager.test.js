import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from '../src/room-manager.js';

describe('RoomManager', () => {
  let roomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    roomManager = new RoomManager();
  });

  afterEach(() => {
    vi.useRealTimers();
    roomManager.cleanup();
  });

  it('should create a room with valid code and slot', () => {
    const uuid = 'user-uuid';
    const mockSocket = { id: 'socket-id', emit: vi.fn(), join: vi.fn() };
    
    const result = roomManager.createRoom(uuid, mockSocket);
    
    expect(result.success).toBe(true);
    expect(result.code).toBeDefined();
    expect(result.code.length).toBe(6);
    expect(roomManager.getRoom(result.code)).toBeDefined();
    expect(roomManager.getRoom(result.code).slots.size).toBe(1);
  });

  it('should not allow creating room when socket already in room', () => {
    const uuid = 'user-uuid';
    const mockSocket = { id: 'socket-id', currentRoom: 'ABC123', emit: vi.fn(), join: vi.fn() };
    
    const result = roomManager.createRoom(uuid, mockSocket);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('already-in-room');
  });

  it('should join existing room successfully', () => {
    const uuid1 = 'creator-uuid';
    const socket1 = { id: 'socket-1', emit: vi.fn(), join: vi.fn() };
    const { code } = roomManager.createRoom(uuid1, socket1);
    
    const uuid2 = 'joiner-uuid';
    const socket2 = { id: 'socket-2', emit: vi.fn(), join: vi.fn() };
    const result = roomManager.joinRoom(code, uuid2, socket2);
    
    expect(result.success).toBe(true);
    expect(roomManager.getRoom(code).slots.size).toBe(2);
  });

  it('should reject joining non-existent room', () => {
    const uuid = 'user-uuid';
    const mockSocket = { id: 'socket-id', emit: vi.fn(), join: vi.fn() };
    
    const result = roomManager.joinRoom('NONEXIST', uuid, mockSocket);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('room-not-found');
  });

  it('should reject joining full room', () => {
    const uuid1 = 'user-1';
    const uuid2 = 'user-2';
    const socket1 = { id: 'socket-1', emit: vi.fn(), join: vi.fn() };
    const socket2 = { id: 'socket-2', emit: vi.fn(), join: vi.fn() };
    const { code } = roomManager.createRoom(uuid1, socket1);
    roomManager.joinRoom(code, uuid2, socket2);
    
    const uuid3 = 'user-3';
    const socket3 = { id: 'socket-3', emit: vi.fn(), join: vi.fn() };
    const result = roomManager.joinRoom(code, uuid3, socket3);
    
    expect(result.success).toBe(false);
    expect(result.error).toBe('room-full');
  });
});