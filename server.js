const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

const rooms = new Map();

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const EMPTY_ROOM_TIMEOUT = 30 * 60 * 1000;
const GRACE_PERIOD = 5 * 60 * 1000;

function generateCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
  } while (rooms.has(code));
  return code;
}

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

  socket.on('create-room', () => {
    if (socket.currentRoom) {
      socket.emit('room-error', { message: 'Вы уже находитесь в комнате' });
      return;
    }

    const code = generateCode();
    const room = {
      code,
      sockets: new Map([[socket.id, socket]]),
      createdAt: Date.now(),
      cleanupTimer: setTimeout(() => {
        const room = rooms.get(code);
        if (room && room.sockets.size < 2) {
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

  socket.on('join-room', ({ code }) => {
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

    if (room.sockets.size >= 2) {
      socket.emit('room-full');
      return;
    }

    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = null;
    }

    room.sockets.set(socket.id, socket);
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

  socket.on('leave-room', () => {
    leaveRoom(socket);
  });

  socket.on('disconnect', () => {
    leaveRoom(socket);
  });
});

function leaveRoom(socket) {
  const code = socket.currentRoom;
  if (!code) return;

  const room = rooms.get(code);
  if (room) {
    socket.to(code).emit('peer-disconnected');
    socket.leave(code);
    room.sockets.delete(socket.id);

    if (room.sockets.size === 0) {
      if (room.graceTimer) clearTimeout(room.graceTimer);
      room.graceTimer = setTimeout(() => {
        cleanUpRoom(code);
      }, GRACE_PERIOD);
    }
  }

  socket.currentRoom = null;
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
