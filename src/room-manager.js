const { generateCode } = require('./code');

const EMPTY_ROOM_TIMEOUT = 30 * 60 * 1000;
const GRACE_PERIOD = 5 * 60 * 1000;
const RECONNECT_TIMEOUT = 30000;

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  /**
   * Creates a new room with the specified user as creator.
   * @param {string} uuid - Valid UUID v4 of the user
   * @param {Object} socket - Socket.IO socket instance
   * @returns {{success: boolean, code?: string, error?: string}} Room creation result
   */
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

  /**
   * Joins an existing room.
   * @param {string} code - 6-character room code
   * @param {string} uuid - Valid UUID v4 of the user
   * @param {Object} socket - Socket.IO socket instance
   * @returns {{success: boolean, code?: string, error?: string}} Join result
   */
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
    if (!code) return { success: false, error: 'no-current-room' };

    const room = this.rooms.get(code);
    if (!room) return { success: false, error: 'room-not-found' };

    const uuid = room.socketToUuid.get(socket.id);
    if (!uuid) return { success: false, error: 'slot-not-found' };

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
    if (!code) return { success: false, error: 'no-current-room' };

    const room = this.rooms.get(code);
    if (!room) {
      socket.currentRoom = null;
      return { success: false, error: 'room-not-found' };
    }

    const uuid = room.socketToUuid.get(socket.id);
    if (!uuid) {
      socket.currentRoom = null;
      return { success: false, error: 'slot-not-found' };
    }

    const slot = room.slots.get(uuid);
    if (!slot) {
      socket.currentRoom = null;
      return { success: false, error: 'slot-not-found' };
    }

    if (slot.socket && slot.socket.id !== socket.id) {
      socket.currentRoom = null;
      return { success: false, error: 'socket-mismatch' };
    }

    slot.socket = null;
    slot.connected = false;
    room.socketToUuid.delete(socket.id);
    socket.currentRoom = null;

    let otherSlot;
    for (const s of room.slots.values()) {
      if (s.uuid !== uuid) {
        otherSlot = s;
        break;
      }
    }
    if (otherSlot && otherSlot.socket) {
      otherSlot.socket.emit('peer-disconnected', { canReconnect: true });
    }

    if (slot.reconnectTimer) clearTimeout(slot.reconnectTimer);
    slot.reconnectTimer = setTimeout(() => {
      room.slots.delete(uuid);
      for (const s of room.slots.values()) {
        if (s.uuid !== uuid) {
          otherSlot = s;
          break;
        }
      }
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
    
    for (const slot of room.slots.values()) {
      if (slot.uuid !== uuid) {
        return slot.socket || null;
      }
    }
    return null;
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