const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

const { generateCode } = require('./src/code');

const rooms = new Map();

const EMPTY_ROOM_TIMEOUT = 30 * 60 * 1000;
const GRACE_PERIOD = 5 * 60 * 1000;
const RECONNECT_TIMEOUT = 30000;

function cleanUpRoom(code) {
  if (rooms.has(code)) {
    const room = rooms.get(code);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    if (room.graceTimer) clearTimeout(room.graceTimer);
    rooms.delete(code);
  }
}

io.on('connection', (socket) => {
  socket.currentRoom = null;

  socket.on('create-room', ({ uuid }) => {
    if (!uuid) {
      socket.emit('room-error', { message: 'UUID не указан' });
      return;
    }
    if (socket.currentRoom) {
      socket.emit('room-error', { message: 'Вы уже находитесь в комнате' });
      return;
    }

    const code = generateCode(new Set(rooms.keys()));
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
        const room = rooms.get(code);
        if (room && room.slots.size < 2) {
          cleanUpRoom(code);
        }
      }, EMPTY_ROOM_TIMEOUT),
      graceTimer: null,
    };

    rooms.set(code, room);
    socket.currentRoom = code;
    socket.join(code);
    socket.emit('room-created', { code });
  });

  socket.on('join-room', ({ code, uuid }) => {
    if (!uuid) {
      socket.emit('room-error', { message: 'UUID не указан' });
      return;
    }
    if (socket.currentRoom) {
      socket.emit('room-error', { message: 'Вы уже находитесь в комнате' });
      return;
    }

    const codeUpper = code.toUpperCase();
    const room = rooms.get(codeUpper);

    if (!room) {
      socket.emit('room-not-found');
      return;
    }

    if (room.slots.size >= 2) {
      socket.emit('room-full');
      return;
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
    socket.join(codeUpper);

    socket.emit('room-joined', { code: codeUpper });
    socket.to(codeUpper).emit('user-joined', { userId: socket.id });
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
    socket.to(socket.currentRoom).emit('chat-message', { text, sender: socket.id });
  });

  socket.on('audio-state-change', ({ muted }) => {
    if (!socket.currentRoom) return;
    socket.to(socket.currentRoom).emit('audio-state-change', { muted });
  });

  socket.on('screen-share-state-change', ({ active }) => {
    if (!socket.currentRoom) return;
    socket.to(socket.currentRoom).emit('screen-share-state-change', { active });
  });

  socket.on('leave-room', () => {
    leaveRoom(socket);
  });

  socket.on('disconnect', () => {
    handleSocketDisconnect(socket);
  });

  socket.on('reconnect-room', ({ code, uuid }) => {
    if (!code || !uuid) return;
    if (socket.currentRoom) {
      socket.emit('room-error', { message: 'Вы уже находитесь в комнате' });
      return;
    }
    const room = rooms.get(code.toUpperCase());
    if (!room) {
      socket.emit('room-not-found');
      return;
    }
    const slot = room.slots.get(uuid);
    if (!slot) {
      socket.emit('room-error', { message: 'Слот не найден' });
      return;
    }
    if (slot.reconnectTimer) {
      clearTimeout(slot.reconnectTimer);
      slot.reconnectTimer = null;
    }
    slot.socket = socket;
    slot.connected = true;
    room.socketToUuid.set(socket.id, uuid);
    socket.currentRoom = code.toUpperCase();
    socket.join(code.toUpperCase());

    socket.emit('reconnect-success', { code: code.toUpperCase(), isCreator: slot.isCreator });

    const otherSlot = [...room.slots.values()].find((s) => s.uuid !== uuid);
    if (otherSlot && otherSlot.socket) {
      otherSlot.socket.emit('peer-reconnected', { uuid });
    }
  });
});

function leaveRoom(socket) {
  const code = socket.currentRoom;
  if (!code) return;

  const room = rooms.get(code);
  if (room) {
    const uuid = room.socketToUuid.get(socket.id);
    if (uuid) {
      const slot = room.slots.get(uuid);
      if (slot && slot.reconnectTimer) {
        clearTimeout(slot.reconnectTimer);
      }
      room.slots.delete(uuid);
      room.socketToUuid.delete(socket.id);
    }

    socket.to(code).emit('peer-disconnected', { canReconnect: false });
    socket.leave(code);

    if (room.slots.size === 0) {
      if (room.graceTimer) clearTimeout(room.graceTimer);
      room.graceTimer = setTimeout(() => {
        cleanUpRoom(code);
      }, GRACE_PERIOD);
    }
  }

  socket.currentRoom = null;
}

function handleSocketDisconnect(socket) {
  const code = socket.currentRoom;
  if (!code) return;

  const room = rooms.get(code);
  if (!room) {
    socket.currentRoom = null;
    return;
  }

  const uuid = room.socketToUuid.get(socket.id);
  if (!uuid) {
    socket.currentRoom = null;
    return;
  }

  const slot = room.slots.get(uuid);
  if (!slot) {
    socket.currentRoom = null;
    return;
  }

  // Ignore stale disconnect if slot was already reassigned to a different socket
  if (slot.socket && slot.socket.id !== socket.id) {
    socket.currentRoom = null;
    return;
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
        cleanUpRoom(code);
      }, GRACE_PERIOD);
    }
  }, RECONNECT_TIMEOUT);
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
