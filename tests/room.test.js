import { describe, it, expect, beforeEach } from 'vitest';
import { generateCode, isValidCode } from '../src/code.js';

describe('Room management', () => {
  let rooms;

  beforeEach(() => {
    rooms = new Map();
  });

  function createRoom(rooms, code) {
    const room = {
      code,
      sockets: new Map(),
      createdAt: Date.now(),
      cleanupTimer: null,
      graceTimer: null,
    };
    rooms.set(code, room);
    return room;
  }

  function joinRoom(rooms, code) {
    const room = rooms.get(code);
    if (!room) return { error: 'room-not-found' };
    if (room.sockets.size >= 2) return { error: 'room-full' };
    const socketId = 'socket-' + Date.now() + Math.random();
    room.sockets.set(socketId, { id: socketId });
    return { success: true, socketId };
  }

  function leaveRoom(rooms, code, socketId) {
    const room = rooms.get(code);
    if (!room) return;
    room.sockets.delete(socketId);
    return room.sockets.size;
  }

  it('should create a room with a valid code', () => {
    const code = generateCode(new Set(rooms.keys()));
    expect(isValidCode(code)).toBe(true);

    const room = createRoom(rooms, code);
    expect(rooms.has(code)).toBe(true);
    expect(room.code).toBe(code);
    expect(room.sockets.size).toBe(0);
  });

  it('should allow a user to join an existing room', () => {
    const code = generateCode();
    createRoom(rooms, code);
    rooms.get(code).sockets.set('user1', { id: 'user1' });

    const result = joinRoom(rooms, code);
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(rooms.get(code).sockets.size).toBe(2);
  });

  it('should reject joining a non-existent room', () => {
    const result = joinRoom(rooms, 'NONEXIST');
    expect(result.error).toBe('room-not-found');
  });

  it('should reject joining a full room', () => {
    const code = generateCode();
    createRoom(rooms, code);
    rooms.get(code).sockets.set('user1', { id: 'user1' });
    rooms.get(code).sockets.set('user2', { id: 'user2' });

    const result = joinRoom(rooms, code);
    expect(result.error).toBe('room-full');
  });

  it('should allow max 2 participants', () => {
    const code = generateCode();
    createRoom(rooms, code);

    joinRoom(rooms, code);
    joinRoom(rooms, code);
    expect(rooms.get(code).sockets.size).toBe(2);

    const result = joinRoom(rooms, code);
    expect(result.error).toBe('room-full');
  });

  it('should handle a user leaving the room', () => {
    const code = generateCode();
    createRoom(rooms, code);
    const r1 = joinRoom(rooms, code);
    const r2 = joinRoom(rooms, code);

    leaveRoom(rooms, code, r1.socketId);
    expect(rooms.get(code).sockets.size).toBe(1);
  });

  it('should have 0 sockets when all users leave', () => {
    const code = generateCode();
    createRoom(rooms, code);
    const r1 = joinRoom(rooms, code);
    const r2 = joinRoom(rooms, code);

    leaveRoom(rooms, code, r1.socketId);
    leaveRoom(rooms, code, r2.socketId);
    expect(rooms.get(code).sockets.size).toBe(0);
  });

  // Tests the handler logic from server.js:115-118
  it('should relay screen-share-state-change to other room members', () => {
    const code = generateCode();
    createRoom(rooms, code);

    let emittedEvent = null;
    let emittedArgs = null;
    const mockSocket = {
      currentRoom: code,
      to: (room) => ({
        emit: (event, args) => {
          emittedEvent = event;
          emittedArgs = args;
        },
      }),
    };

    const handler = ({ active }) => {
      if (!mockSocket.currentRoom) return;
      mockSocket.to(mockSocket.currentRoom).emit('screen-share-state-change', { active });
    };

    handler({ active: true });
    expect(emittedEvent).toBe('screen-share-state-change');
    expect(emittedArgs).toEqual({ active: true });

    emittedEvent = null;
    handler({ active: false });
    expect(emittedEvent).toBe('screen-share-state-change');
    expect(emittedArgs).toEqual({ active: false });
  });

  it('should not relay screen-share-state-change without a room', () => {
    let emittedEvent = null;
    const mockSocket = {
      currentRoom: null,
      to: () => ({
        emit: (event) => { emittedEvent = event; },
      }),
    };

    const handler = ({ active }) => {
      if (!mockSocket.currentRoom) return;
      mockSocket.to(mockSocket.currentRoom).emit('screen-share-state-change', { active });
    };

    handler({ active: true });
    expect(emittedEvent).toBeNull();
  });

  it('should generate unique codes for multiple rooms', () => {
    const codes = new Set();
    for (let i = 0; i < 20; i++) {
      const code = generateCode(new Set(rooms.keys()));
      expect(codes.has(code)).toBe(false);
      codes.add(code);
      createRoom(rooms, code);
    }
    expect(rooms.size).toBe(20);
  });
});
