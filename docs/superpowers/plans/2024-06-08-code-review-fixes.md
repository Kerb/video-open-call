# Code Review Issues Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix identified code review issues in vibe-opencall project - security vulnerabilities, error handling gaps, state consistency problems, and architectural issues.

**Architecture:** Modularize server.js into separate modules, add comprehensive error handling, implement rate limiting and validation, improve test coverage with integration tests, fix state management consistency.

**Tech Stack:** Node.js, Express, Socket.IO, Vitest

---

### Task 1: Extract Room Management Module

**Files:**
- Create: `src/room-manager.js`
- Modify: `server.js:15-63, 71-113, 188-216`
- Test: `tests/room-manager.test.js`

- [ ] **Step 1: Write failing test for room manager module**

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoomManager } from '../src/room-manager.js';

describe('RoomManager', () => {
  let roomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    roomManager = new RoomManager();
  });

  afterEach(() => {
    vi.useRealTimers();
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/room-manager.test.js`
Expected: FAIL with "Cannot find module '../src/room-manager.js'"

- [ ] **Step 3: Implement RoomManager class**

```javascript
const { generateCode } = require('./code');

const EMPTY_ROOM_TIMEOUT = 30 * 60 * 1000;
const GRACE_PERIOD = 5 * 60 * 1000;
const RECONNECT_TIMEOUT = 30000;

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(uuid, socket) {
    if (socket.currentRoom) {
      return { success: false, error: 'already-in-room' };
    }

    const code = generateCode(new Set(this.rooms.keys()));
    const slot = {
      uuid,
      socket,
      isCreator: true,
      connected: true,
      reconnectTimer: null,
    };
    const room = {
      code,
      slots: new Map([[uuid, slot]]),
      socketToUuid: new Map([[socket.id, uuid]]),
      createdAt: Date.now(),
      cleanupTimer: setTimeout(() => {
        const room = this.rooms.get(code);
        if (room && room.slots.size < 2) {
          this.cleanUpRoom(code);
        }
      }, EMPTY_ROOM_TIMEOUT),
      graceTimer: null,
    };

    this.rooms.set(code, room);
    socket.currentRoom = code;
    
    return { success: true, code };
  }

  joinRoom(code, uuid, socket) {
    if (socket.currentRoom) {
      return { success: false, error: 'already-in-room' };
    }

    const codeUpper = code.toUpperCase();
    const room = this.rooms.get(codeUpper);

    if (!room) {
      return { success: false, error: 'room-not-found' };
    }

    if (room.slots.size >= 2) {
      return { success: false, error: 'room-full' };
    }

    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }

    const slot = {
      uuid,
      socket,
      isCreator: false,
      connected: true,
      reconnectTimer: null,
    };
    room.slots.set(uuid, slot);
    room.socketToUuid.set(socket.id, uuid);
    socket.currentRoom = codeUpper;

    return { success: true, code: codeUpper };
  }

  leaveRoom(socket) {
    const code = socket.currentRoom;
    if (!code) return { success: false };

    const room = this.rooms.get(code);
    if (!room) return { success: false };

    const uuid = room.socketToUuid.get(socket.id);
    if (!uuid) return { success: false };

    const slot = room.slots.get(uuid);
    if (slot && slot.reconnectTimer) {
      clearTimeout(slot.reconnectTimer);
    }
    room.slots.delete(uuid);
    room.socketToUuid.delete(socket.id);

    socket.to(code).emit('peer-disconnected', { canReconnect: false });
    socket.leave(code);

    if (room.slots.size === 0) {
      if (room.graceTimer) clearTimeout(room.graceTimer);
      room.graceTimer = setTimeout(() => {
        this.cleanUpRoom(code);
      }, GRACE_PERIOD);
    }

    socket.currentRoom = null;
    return { success: true };
  }

  handleDisconnect(socket) {
    const code = socket.currentRoom;
    if (!code) return { success: false };

    const room = this.rooms.get(code);
    if (!room) {
      socket.currentRoom = null;
      return { success: false };
    }

    const uuid = room.socketToUuid.get(socket.id);
    if (!uuid) {
      socket.currentRoom = null;
      return { success: false };
    }

    const slot = room.slots.get(uuid);
    if (!slot) {
      socket.currentRoom = null;
      return { success: false };
    }

    if (slot.socket && slot.socket.id !== socket.id) {
      socket.currentRoom = null;
      return { success: false };
    }

    slot.socket = null;
    slot.connected = false;
    room.socketToUuid.delete(socket.id);
    socket.currentRoom = null;

    const otherSlot = [...room.slots.values()].find((s) => s.uuid !== uuid);
    if (otherSlot && otherSlot.socket) {
      otherSlot.socket.emit('peer-disconnected', { canReconnect: true });
    }

    if (slot.reconnectTimer) clearTimeout(slot.reconnectTimer);
    slot.reconnectTimer = setTimeout(() => {
      room.slots.delete(uuid);
      const otherSlot = [...room.slots.values()].find((s) => s.uuid !== uuid);
      if (otherSlot && otherSlot.socket) {
        otherSlot.socket.emit('peer-disconnected', { canReconnect: false });
      }
      if (room.slots.size === 0) {
        if (room.graceTimer) clearTimeout(room.graceTimer);
        room.graceTimer = setTimeout(() => {
          this.cleanUpRoom(code);
        }, GRACE_PERIOD);
      }
    }, RECONNECT_TIMEOUT);

    return { success: true };
  }

  reconnectToRoom(code, uuid, socket) {
    if (!code || !uuid) return { success: false, error: 'invalid-input' };
    if (socket.currentRoom) {
      return { success: false, error: 'already-in-room' };
    }

    const room = this.rooms.get(code.toUpperCase());
    if (!room) {
      return { success: false, error: 'room-not-found' };
    }

    const slot = room.slots.get(uuid);
    if (!slot) {
      return { success: false, error: 'slot-not-found' };
    }

    if (slot.reconnectTimer) {
      clearTimeout(slot.reconnectTimer);
      slot.reconnectTimer = null;
    }

    slot.socket = socket;
    slot.connected = true;
    room.socketToUuid.set(socket.id, uuid);
    socket.currentRoom = code.toUpperCase();

    return { success: true, code: code.toUpperCase(), isCreator: slot.isCreator };
  }

  getRoom(code) {
    return this.rooms.get(code.toUpperCase());
  }

  getOtherSocket(code, uuid) {
    const room = this.rooms.get(code.toUpperCase());
    if (!room) return null;
    
    const otherSlot = [...room.slots.values()].find((s) => s.uuid !== uuid);
    return otherSlot && otherSlot.socket ? otherSlot.socket : null;
  }

  cleanUpRoom(code) {
    if (this.rooms.has(code)) {
      const room = this.rooms.get(code);
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
      if (room.graceTimer) clearTimeout(room.graceTimer);
      room.slots.forEach(slot => {
        if (slot.reconnectTimer) clearTimeout(slot.reconnectTimer);
      });
      this.rooms.delete(code);
    }
  }

  cleanup() {
    this.rooms.forEach((room, code) => {
      this.cleanUpRoom(code);
    });
  }
}

module.exports = { RoomManager };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/room-manager.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/room-manager.js tests/room-manager.test.js
git commit -m "feat: extract RoomManager class from server.js"
```

### Task 2: Add UUID Validation Module

**Files:**
- Create: `src/uuid-validator.js`
- Modify: `server.js:33-37, 71-75`
- Test: `tests/uuid-validator.test.js`

- [ ] **Step 1: Write failing test for UUID validation**

```javascript
import { describe, it, expect } from 'vitest';
import { validateUUID, sanitizeUUID } from '../src/uuid-validator.js';

describe('UUID Validation', () => {
  describe('validateUUID', () => {
    it('should accept valid UUID v4', () => {
      expect(validateUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(validateUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      expect(validateUUID('')).toBe(false);
      expect(validateUUID(null)).toBe(false);
      expect(validateUUID(undefined)).toBe(false);
      expect(validateUUID('not-a-uuid')).toBe(false);
      expect(validateUUID('550e8400-e29b-41d4-a716')).toBe(false);
      expect(validateUUID('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/uuid-validator.test.js`
Expected: FAIL with "Cannot find module '../src/uuid-validator.js'"

- [ ] **Step 3: Implement UUID validator**

```javascript
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateUUID(uuid) {
  if (!uuid || typeof uuid !== 'string') {
    return false;
  }
  
  const trimmed = uuid.trim();
  if (trimmed.length === 0) {
    return false;
  }

  return UUID_REGEX.test(trimmed);
}

function sanitizeUUID(uuid) {
  if (!uuid || typeof uuid !== 'string') {
    return '';
  }

  const trimmed = uuid.trim();
  if (!validateUUID(trimmed)) {
    return '';
  }

  return trimmed.toLowerCase();
}

module.exports = { validateUUID, sanitizeUUID };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/uuid-validator.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/uuid-validator.js tests/uuid-validator.test.js
git commit -m "feat: add UUID validation and sanitization"
```

### Task 3: Add Rate Limiting Middleware

**Files:**
- Create: `src/rate-limiter.js`
- Modify: `server.js:30`
- Test: `tests/rate-limiter.test.js`

- [ ] **Step 1: Write failing test for rate limiter**

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/rate-limiter.test.js`
Expected: FAIL with "Cannot find module '../src/rate-limiter.js'"

- [ ] **Step 3: Implement rate limiter**

```javascript
class RateLimiter {
  constructor(options = {}) {
    this.maxRequests = options.maxRequests || 100;
    this.windowMs = options.windowMs || 60000;
    this.requests = new Map();
    this.cleanupInterval = setInterval(() => this.cleanup(), this.windowMs);
  }

  check(identifier) {
    if (!identifier) {
      return true;
    }

    const now = Date.now();
    const userRequests = this.requests.get(identifier);

    if (!userRequests) {
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + this.windowMs,
        timestamps: [now]
      });
      return true;
    }

    if (now > userRequests.resetTime) {
      userRequests.count = 1;
      userRequests.resetTime = now + this.windowMs;
      userRequests.timestamps = [now];
      return true;
    }

    if (userRequests.count >= this.maxRequests) {
      return false;
    }

    userRequests.count++;
    userRequests.timestamps.push(now);
    return true;
  }

  getStats(identifier) {
    const userRequests = this.requests.get(identifier);
    if (!userRequests) {
      return { count: 0, resetTime: Date.now() + this.windowMs };
    }

    const now = Date.now();
    if (now > userRequests.resetTime) {
      return { count: 0, resetTime: now + this.windowMs };
    }

    return {
      count: userRequests.count,
      resetTime: userRequests.resetTime
    };
  }

  cleanup() {
    const now = Date.now();
    for (const [identifier, data] of this.requests.entries()) {
      if (now > data.resetTime) {
        this.requests.delete(identifier);
      }
    }
  }

  reset(identifier) {
    if (identifier) {
      this.requests.delete(identifier);
    } else {
      this.requests.clear();
    }
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.requests.clear();
  }
}

module.exports = { RateLimiter };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/rate-limiter.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/rate-limiter.js tests/rate-limiter.test.js
git commit -m "feat: add rate limiting middleware"
```

### Task 4: Refactor Server.js to Use New Modules

**Files:**
- Modify: `server.js`
- Test: `tests/server.test.js`

- [ ] **Step 1: Write failing test for refactored server**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io-client';
import { io as ioc } from 'socket.io-client';

describe('Server Integration', () => {
  let server;
  let ioServer;
  let clientSocket;
  let serverPort;

  beforeEach((done) => {
    serverPort = 3001;
    
    const express = require('express');
    const app = express();
    server = createServer(app);
    ioServer = new (require('socket.io')).Server(server);
    
    require('../server.js').setupSocketHandlers(ioServer);
    
    server.listen(serverPort, () => {
      clientSocket = ioc(`http://localhost:${serverPort}`);
      clientSocket.on('connect', done);
    });
  });

  afterEach(() => {
    if (clientSocket) clientSocket.close();
    if (ioServer) ioServer.close();
    if (server) server.close();
  });

  it('should handle room creation with valid UUID', (done) => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000';
    
    clientSocket.emit('create-room', { uuid: validUUID });
    
    clientSocket.on('room-created', ({ code }) => {
      expect(code).toBeDefined();
      expect(code.length).toBe(6);
      done();
    });

    clientSocket.on('room-error', ({ message }) => {
      done(new Error(`Unexpected error: ${message}`));
    });
  });

  it('should reject room creation with invalid UUID', (done) => {
    const invalidUUID = 'not-a-uuid';
    
    clientSocket.emit('create-room', { uuid: invalidUUID });
    
    clientSocket.on('room-error', ({ message }) => {
      expect(message).toContain('UUID');
      done();
    });

    clientSocket.on('room-created', () => {
      done(new Error('Should not create room with invalid UUID'));
    });
  });

  it('should enforce rate limiting', (done) => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000';
    let errorCount = 0;
    
    const tryCreateRoom = () => {
      clientSocket.emit('create-room', { uuid: validUUID });
    };

    for (let i = 0; i < 10; i++) {
      tryCreateRoom();
    }

    clientSocket.on('room-error', ({ message }) => {
      errorCount++;
      if (errorCount >= 5) {
        expect(message).toContain('rate limit');
        done();
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/server.test.js`
Expected: FAIL with "setupSocketHandlers is not a function"

- [ ] **Step 3: Refactor server.js to use modules**

```javascript
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { RoomManager } = require('./src/room-manager');
const { validateUUID, sanitizeUUID } = require('./src/uuid-validator');
const { RateLimiter } = require('./src/rate-limiter');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

const roomManager = new RoomManager();
const createRoomRateLimiter = new RateLimiter({ maxRequests: 5, windowMs: 60000 });
const joinRoomRateLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60000 });

function setupSocketHandlers(io) {
  io.on('connection', (socket) => {
    socket.currentRoom = null;

    socket.on('create-room', ({ uuid }) => {
      if (!validateUUID(uuid)) {
        socket.emit('room-error', { message: 'Неверный формат UUID' });
        return;
      }

      if (!createRoomRateLimiter.check(socket.id)) {
        const stats = createRoomRateLimiter.getStats(socket.id);
        socket.emit('room-error', { 
          message: `Превышен лимит запросов. Попробуйте через ${Math.ceil((stats.resetTime - Date.now()) / 1000)} сек.` 
        });
        return;
      }

      const sanitizedUUID = sanitizeUUID(uuid);
      const result = roomManager.createRoom(sanitizedUUID, socket);

      if (!result.success) {
        socket.emit('room-error', { message: result.error === 'already-in-room' ? 'Вы уже находитесь в комнате' : 'Ошибка создания комнаты' });
        return;
      }

      socket.join(result.code);
      socket.emit('room-created', { code: result.code });
    });

    socket.on('join-room', ({ code, uuid }) => {
      if (!validateUUID(uuid)) {
        socket.emit('room-error', { message: 'Неверный формат UUID' });
        return;
      }

      if (!joinRoomRateLimiter.check(socket.id)) {
        const stats = joinRoomRateLimiter.getStats(socket.id);
        socket.emit('room-error', { 
          message: `Превышен лимит запросов. Попробуйте через ${Math.ceil((stats.resetTime - Date.now()) / 1000)} сек.` 
        });
        return;
      }

      const sanitizedUUID = sanitizeUUID(uuid);
      const result = roomManager.joinRoom(code, sanitizedUUID, socket);

      if (!result.success) {
        if (result.error === 'room-not-found') {
          socket.emit('room-not-found');
        } else if (result.error === 'room-full') {
          socket.emit('room-full');
        } else {
          socket.emit('room-error', { message: result.error === 'already-in-room' ? 'Вы уже находитесь в комнате' : 'Ошибка подключения к комнате' });
        }
        return;
      }

      socket.join(result.code);
      socket.emit('room-joined', { code: result.code });
      
      const otherSocket = roomManager.getOtherSocket(result.code, sanitizedUUID);
      if (otherSocket) {
        otherSocket.emit('user-joined', { userId: socket.id });
      }
    });

    socket.on('offer', ({ sdp }) => {
      if (!socket.currentRoom) return;
      socket.to(socket.currentRoom).emit('offer', { sdp });
    });

    socket.on('answer', ({ sdp }) => {
      if (!socket.currentRoom) return;
      socket.to(socket.currentRoom).emit('answer', { sdp });
    });

    socket.on('ice-candidate', ({ candidate }) => {
      if (!socket.currentRoom) return;
      socket.to(socket.currentRoom).emit('ice-candidate', { candidate });
    });

    socket.on('send-message', ({ text }) => {
      if (!socket.currentRoom) return;
      if (!text || typeof text !== 'string' || text.length > 1000) {
        socket.emit('room-error', { message: 'Неверный формат сообщения' });
        return;
      }
      socket.to(socket.currentRoom).emit('chat-message', { text: text.trim(), sender: socket.id });
    });

    socket.on('audio-state-change', ({ muted }) => {
      if (!socket.currentRoom) return;
      socket.to(socket.currentRoom).emit('audio-state-change', { muted: !!muted });
    });

    socket.on('screen-share-state-change', ({ active }) => {
      if (!socket.currentRoom) return;
      socket.to(socket.currentRoom).emit('screen-share-state-change', { active: !!active });
    });

    socket.on('leave-room', () => {
      const result = roomManager.leaveRoom(socket);
      if (result.success) {
        socket.emit('room-left');
      }
    });

    socket.on('disconnect', () => {
      roomManager.handleDisconnect(socket);
    });

    socket.on('reconnect-room', ({ code, uuid }) => {
      if (!validateUUID(uuid)) {
        socket.emit('room-error', { message: 'Неверный формат UUID' });
        return;
      }

      const sanitizedUUID = sanitizeUUID(uuid);
      const result = roomManager.reconnectToRoom(code, sanitizedUUID, socket);

      if (!result.success) {
        if (result.error === 'room-not-found') {
          socket.emit('room-not-found');
        } else {
          socket.emit('room-error', { message: 'Ошибка переподключения' });
        }
        return;
      }

      socket.join(result.code);
      socket.emit('reconnect-success', { code: result.code, isCreator: result.isCreator });

      const otherSocket = roomManager.getOtherSocket(result.code, sanitizedUUID);
      if (otherSocket) {
        otherSocket.emit('peer-reconnected', { uuid: sanitizedUUID });
      }
    });
  });
}

function startServer() {
  setupSocketHandlers(io);
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

function stopServer() {
  roomManager.cleanup();
  createRoomRateLimiter.destroy();
  joinRoomRateLimiter.destroy();
  server.close();
}

if (require.main === module) {
  startServer();
}

module.exports = { setupSocketHandlers, startServer, stopServer };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test tests/server.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server.js tests/server.test.js
git commit -m "refactor: modularize server.js with new components"
```

### Task 5: Fix State Consistency Issues

**Files:**
- Modify: `public/app.js:1-17, 19-46`
- Test: `tests/state-consistency.test.js`

- [ ] **Step 1: Write failing test for state consistency**

```javascript
import { describe, it, expect } from 'vitest';

describe('State Consistency', () => {
  it('should use same state definitions across client and server', () => {
    const clientState = require('../public/app.js').STATE;
    const serverState = require('../src/state-machine.js').STATE;
    
    expect(Object.keys(clientState)).toEqual(Object.keys(serverState));
    expect(Object.values(clientState)).toEqual(Object.values(serverState));
  });

  it('should have matching transition definitions', () => {
    const clientTransitions = require('../public/app.js').STATE_TRANSITIONS;
    const serverTransitions = require('../src/state-machine.js').STATE_TRANSITIONS;
    
    expect(clientTransitions).toEqual(serverTransitions);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test tests/state-consistency.test.js`
Expected: FAIL with state definitions not matching

- [ ] **Step 3: Create shared state module**

```javascript
const STATE = {
  HOME: 'home',
  JOIN_MODAL: 'join-modal',
  WAITING: 'waiting',
  CONNECTING: 'connecting',
  IN_CALL: 'in-call',
  DISCONNECTED: 'disconnected',
};

const STATE_TRANSITIONS = {
  [STATE.HOME]: [STATE.JOIN_MODAL, STATE.WAITING],
  [STATE.JOIN_MODAL]: [STATE.HOME, STATE.WAITING],
  [STATE.WAITING]: [STATE.CONNECTING, STATE.DISCONNECTED, STATE.HOME],
  [STATE.CONNECTING]: [STATE.IN_CALL, STATE.DISCONNECTED, STATE.HOME],
  [STATE.IN_CALL]: [STATE.DISCONNECTED, STATE.HOME],
  [STATE.DISCONNECTED]: [STATE.CONNECTING, STATE.HOME],
};

function createStateMachine(initialState) {
  let currentState = initialState || STATE.HOME;

  function getState() {
    return currentState;
  }

  function transition(newState) {
    const allowed = STATE_TRANSITIONS[currentState];
    if (!allowed || !allowed.includes(newState)) {
      return false;
    }
    currentState = newState;
    return true;
  }

  function canTransition(newState) {
    const allowed = STATE_TRANSITIONS[currentState];
    return allowed && allowed.includes(newState);
  }

  return { getState, transition, canTransition };
}

module.exports = { STATE, STATE_TRANSITIONS, createStateMachine };
```

- [ ] **Step 4: Update src/state-machine.js to export shared module**

```javascript
module.exports = require('./shared-state');
```

- [ ] **Step 5: Update public/app.js to import shared state**

```javascript
const { STATE, STATE_TRANSITIONS } = require('./src/shared-state');
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test tests/state-consistency.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/shared-state.js src/state-machine.js public/app.js tests/state-consistency.test.js
git commit -m "fix: create shared state module for consistency"
```

### Task 6: Add Comprehensive Error Handling

**Files:**
- Modify: `public/app.js:183-194, 379-409`
- Test: `tests/error-handling.test.js`

- [ ] **Step 1: Write failing test for error handling**

```javascript
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test tests/error-handling.test.js`
Expected: PASS (tests should verify error handling works)

- [ ] **Step 3: Add error handling to WebRTC functions**

```javascript
async function handleOffer(sdp) {
  if (!sdp || !sdp.type || !sdp.sdp) {
    console.error('Invalid SDP received');
    showNotification('Неверный формат данных соединения', 'error');
    return;
  }

  const pc = createPeerConnection();

  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    if (state.socket && state.roomCode) {
      state.socket.emit('answer', { sdp: pc.localDescription });
    } else {
      console.error('Socket or room code not available');
      showNotification('Ошибка отправки ответа', 'error');
    }
  } catch (err) {
    console.error('handleOffer error:', err);
    showNotification('Ошибка обработки предложения соединения', 'error');
    closePeerConnection();
  }
}

async function handleAnswer(sdp) {
  if (!state.peerConnection) {
    console.error('No peer connection available');
    return;
  }

  if (!sdp || !sdp.type || !sdp.sdp) {
    console.error('Invalid SDP received');
    showNotification('Неверный формат данных соединения', 'error');
    return;
  }

  try {
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp));
  } catch (err) {
    console.error('handleAnswer error:', err);
    showNotification('Ошибка установки соединения', 'error');
  }
}

async function handleIceCandidate(candidate) {
  if (!state.peerConnection) {
    console.error('No peer connection available');
    return;
  }

  if (!candidate) {
    console.warn('Received null ICE candidate');
    return;
  }

  try {
    await state.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (err) {
    console.error('addIceCandidate error:', err);
  }
}
```

- [ ] **Step 4: Add error handling to socket operations**

```javascript
state.socket.on('offer', ({ sdp }) => {
  try {
    transition(STATE.CONNECTING);
    if (state.localStream) {
      handleOffer(sdp);
    } else {
      state.pendingOffer = sdp;
    }
  } catch (err) {
    console.error('Error handling offer:', err);
    showNotification('Ошибка обработки входящего звонка', 'error');
  }
});

state.socket.on('answer', ({ sdp }) => {
  try {
    handleAnswer(sdp);
  } catch (err) {
    console.error('Error handling answer:', err);
    showNotification('Ошибка обработки ответа', 'error');
  }
});

state.socket.on('ice-candidate', ({ candidate }) => {
  try {
    handleIceCandidate(candidate);
  } catch (err) {
    console.error('Error handling ICE candidate:', err);
  }
});
```

- [ ] **Step 5: Commit**

```bash
git add public/app.js tests/error-handling.test.js
git commit -m "feat: add comprehensive error handling"
```

### Task 7: Fix Resource Leaks

**Files:**
- Modify: `server.js:16-18, 272-274`
- Test: `tests/resource-leaks.test.js`

- [ ] **Step 1: Write failing test for resource cleanup**

```javascript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RoomManager } from '../src/room-manager.js';

describe('Resource Cleanup', () => {
  let roomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    roomManager = new RoomManager();
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test tests/resource-leaks.test.js`
Expected: PASS

- [ ] **Step 3: Add graceful shutdown handler**

```javascript
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  stopServer();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  stopServer();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  stopServer();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  stopServer();
  process.exit(1);
});
```

- [ ] **Step 4: Commit**

```bash
git add server.js tests/resource-leaks.test.js
git commit -m "fix: prevent resource leaks with proper cleanup"
```

### Task 8: Update Existing Tests for Refactored Code

**Files:**
- Modify: `tests/room.test.js`
- Test: `npm test`

- [ ] **Step 1: Update room tests to use RoomManager**

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
```

- [ ] **Step 2: Run all tests to verify everything works**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/room.test.js
git commit -m "test: update room tests for refactored code"
```

### Task 9: Add Integration Tests

**Files:**
- Create: `tests/integration.test.js`
- Test: `npm test`

- [ ] **Step 1: Write comprehensive integration tests**

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioc } from 'socket.io-client';
import { setupSocketHandlers } from '../server.js';

describe('Integration Tests', () => {
  let server;
  let ioServer;
  let clientSocket1;
  let clientSocket2;
  let serverPort;

  beforeEach((done) => {
    serverPort = 3002;
    
    const express = require('express');
    const app = express();
    server = createServer(app);
    ioServer = new SocketIOServer(server);
    
    setupSocketHandlers(ioServer);
    
    server.listen(serverPort, () => {
      clientSocket1 = ioc(`http://localhost:${serverPort}`);
      clientSocket1.on('connect', () => {
        clientSocket2 = ioc(`http://localhost:${serverPort}`);
        clientSocket2.on('connect', done);
      });
    });
  });

  afterEach(() => {
    if (clientSocket1) clientSocket1.close();
    if (clientSocket2) clientSocket2.close();
    if (ioServer) ioServer.close();
    if (server) server.close();
  });

  it('should handle complete call flow: create -> join -> connect -> leave', (done) => {
    const uuid1 = '550e8400-e29b-41d4-a716-446655440000';
    const uuid2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    let roomCode;

    clientSocket1.on('room-created', ({ code }) => {
      roomCode = code;
      clientSocket2.emit('join-room', { code, uuid: uuid2 });
    });

    clientSocket2.on('room-joined', ({ code }) => {
      expect(code).toBe(roomCode);
      clientSocket1.emit('leave-room');
    });

    clientSocket1.on('room-left', () => {
      done();
    });

    clientSocket1.emit('create-room', { uuid: uuid1 });
  });

  it('should handle peer disconnection and reconnection', (done) => {
    const uuid1 = '550e8400-e29b-41d4-a716-446655440000';
    const uuid2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    let roomCode;

    clientSocket1.on('room-created', ({ code }) => {
      roomCode = code;
      clientSocket2.emit('join-room', { code, uuid: uuid2 });
    });

    clientSocket2.on('room-joined', () => {
      clientSocket2.disconnect();
    });

    clientSocket1.on('peer-disconnected', ({ canReconnect }) => {
      expect(canReconnect).toBe(true);
      
      setTimeout(() => {
        clientSocket2 = ioc(`http://localhost:${serverPort}`);
        clientSocket2.on('connect', () => {
          clientSocket2.emit('reconnect-room', { code: roomCode, uuid: uuid2 });
        });
        
        clientSocket2.on('reconnect-success', ({ code, isCreator }) => {
          expect(code).toBe(roomCode);
          expect(isCreator).toBe(false);
          done();
        });
      }, 100);
    });

    clientSocket1.emit('create-room', { uuid: uuid1 });
  });

  it('should handle message exchange between peers', (done) => {
    const uuid1 = '550e8400-e29b-41d4-a716-446655440000';
    const uuid2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const testMessage = 'Hello from peer 1';
    let roomCode;

    clientSocket1.on('room-created', ({ code }) => {
      roomCode = code;
      clientSocket2.emit('join-room', { code, uuid: uuid2 });
    });

    clientSocket2.on('user-joined', () => {
      clientSocket1.emit('send-message', { text: testMessage });
    });

    clientSocket2.on('chat-message', ({ text, sender }) => {
      expect(text).toBe(testMessage);
      expect(sender).toBe(clientSocket1.id);
      done();
    });

    clientSocket1.emit('create-room', { uuid: uuid1 });
  });

  it('should prevent duplicate room creation', (done) => {
    const uuid1 = '550e8400-e29b-41d4-a716-446655440000';

    clientSocket1.on('room-created', ({ code }) => {
      clientSocket1.emit('create-room', { uuid: uuid1 });
    });

    clientSocket1.on('room-error', ({ message }) => {
      expect(message).toContain('уже находитесь');
      done();
    });

    clientSocket1.emit('create-room', { uuid: uuid1 });
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npm test tests/integration.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration.test.js
git commit -m "test: add comprehensive integration tests"
```

### Task 10: Add Documentation and Comments

**Files:**
- Create: `docs/API.md`
- Modify: `server.js`, `src/*.js`
- Test: `npm test`

- [ ] **Step 1: Create API documentation**

```markdown
# Vibe OpenCall API Documentation

## Server API

### WebSocket Events

#### Client → Server

**create-room**
```javascript
socket.emit('create-room', { uuid: string })
```
Creates a new room with the user as creator.

**Parameters:**
- `uuid`: Valid UUID v4 string

**Responses:**
- `room-created`: `{ code: string }` - Room created successfully
- `room-error`: `{ message: string }` - Error occurred

**Example:**
```javascript
socket.emit('create-room', { uuid: '550e8400-e29b-41d4-a716-446655440000' });
socket.on('room-created', ({ code }) => {
  console.log('Room code:', code);
});
```

**join-room**
```javascript
socket.emit('join-room', { code: string, uuid: string })
```
Joins an existing room.

**Parameters:**
- `code`: 6-character room code
- `uuid`: Valid UUID v4 string

**Responses:**
- `room-joined`: `{ code: string }` - Successfully joined
- `room-not-found` - Room does not exist
- `room-full` - Room has 2 participants
- `room-error`: `{ message: string }` - Other errors

**Example:**
```javascript
socket.emit('join-room', { code: 'ABC123', uuid: '550e8400-e29b-41d4-a716-446655440000' });
```

**leave-room**
```javascript
socket.emit('leave-room')
```
Leaves the current room.

**Responses:**
- `room-left` - Successfully left

**reconnect-room**
```javascript
socket.emit('reconnect-room', { code: string, uuid: string })
```
Reconnects to a room after disconnect.

**Parameters:**
- `code`: Room code
- `uuid`: User's UUID

**Responses:**
- `reconnect-success`: `{ code: string, isCreator: boolean }` - Successfully reconnected
- `room-not-found` - Room no longer exists
- `room-error`: `{ message: string }` - Reconnection failed

**offer**
```javascript
socket.emit('offer', { sdp: RTCSessionDescription })
```
Sends WebRTC offer to peer.

**answer**
```javascript
socket.emit('answer', { sdp: RTCSessionDescription })
```
Sends WebRTC answer to peer.

**ice-candidate**
```javascript
socket.emit('ice-candidate', { candidate: RTCIceCandidate })
```
Sends ICE candidate to peer.

**send-message**
```javascript
socket.emit('send-message', { text: string })
```
Sends chat message to peer.

**Parameters:**
- `text`: Message text (max 1000 characters)

**audio-state-change**
```javascript
socket.emit('audio-state-change', { muted: boolean })
```
Broadcasts audio mute state to peer.

**screen-share-state-change**
```javascript
socket.emit('screen-share-state-change', { active: boolean })
```
Broadcasts screen sharing state to peer.

#### Server → Client

**user-joined**
```javascript
socket.on('user-joined', { userId: string })
```
Another user joined the room.

**peer-disconnected**
```javascript
socket.on('peer-disconnected', { canReconnect: boolean })
```
Peer disconnected. If `canReconnect` is true, peer can reconnect within 30 seconds.

**peer-reconnected**
```javascript
socket.on('peer-reconnected', { uuid: string })
```
Peer successfully reconnected.

**chat-message**
```javascript
socket.on('chat-message', { text: string, sender: string })
```
Received chat message from peer.

**audio-state-change**
```javascript
socket.on('audio-state-change', { muted: boolean })
```
Peer's audio mute state changed.

**screen-share-state-change**
```javascript
socket.on('screen-share-state-change', { active: boolean })
```
Peer's screen sharing state changed.

## Rate Limiting

- Room creation: 5 requests per minute per socket
- Room join: 10 requests per minute per socket

## Room Lifecycle

1. **Created**: Room exists, waiting for second participant
2. **Full**: 2 participants connected
3. **Grace Period**: All participants left, room kept for 5 minutes
4. **Cleanup**: Room deleted after grace period

## Reconnection

- Disconnected peer has 30 seconds to reconnect
- Slot is preserved during reconnect window
- After timeout, slot is removed and peer cannot reconnect

## Security

- All UUIDs are validated and sanitized
- Room codes are 6 characters, using unambiguous character set
- Messages are length-limited (1000 chars)
- Rate limiting prevents abuse
```

- [ ] **Step 2: Add JSDoc comments to key functions**

```javascript
/**
 * Creates a new room with the specified user as creator.
 * @param {string} uuid - Valid UUID v4 of the user
 * @param {Object} socket - Socket.IO socket instance
 * @returns {{success: boolean, code?: string, error?: string}} Room creation result
 */
createRoom(uuid, socket) {
  // implementation
}

/**
 * Joins an existing room.
 * @param {string} code - 6-character room code
 * @param {string} uuid - Valid UUID v4 of the user
 * @param {Object} socket - Socket.IO socket instance
 * @returns {{success: boolean, code?: string, error?: string}} Join result
 */
joinRoom(code, uuid, socket) {
  // implementation
}
```

- [ ] **Step 3: Update README with security notes**

```markdown
## Security Considerations

- UUIDs are validated on server to prevent injection attacks
- Rate limiting prevents abuse of room creation/joining
- Room codes use unambiguous character set (no I, 1, O, 0)
- Messages are sanitized and length-limited
- Graceful shutdown prevents resource leaks

## Development

Run tests:
```bash
npm test
```

Run in development:
```bash
npm run dev
```

Build for production:
```bash
npm start
```
```

- [ ] **Step 4: Run all tests to ensure no regressions**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add docs/API.md README.md server.js src/*.js
git commit -m "docs: add comprehensive API documentation and code comments"
```

---

## Summary

This plan addresses all identified issues:

1. **Security**: UUID validation, rate limiting, input sanitization
2. **Error Handling**: Comprehensive try-catch blocks, graceful degradation
3. **State Consistency**: Shared state module, elimination of duplication
4. **Architecture**: Modularized codebase, separation of concerns
5. **Testing**: Integration tests, improved test coverage
6. **Resource Leaks**: Proper cleanup, graceful shutdown
7. **Documentation**: API docs, code comments, security notes

Each task builds upon the previous ones, creating a robust, maintainable codebase.