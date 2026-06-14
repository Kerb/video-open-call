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
      socket.emit('room-joined', { code: result.code, peerUuid: roomManager.getPeerUuid(result.code, sanitizedUUID) });
      
      const otherSocket = roomManager.getOtherSocket(result.code, sanitizedUUID);
      if (otherSocket) {
        otherSocket.emit('user-joined', { uuid: sanitizedUUID, userId: socket.id });
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
      socket.emit('reconnect-success', {
        code: result.code,
        peerUuid: result.peerUuid,
        reconnectWindow: result.reconnectWindow,
      });

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
}

module.exports = { setupSocketHandlers, startServer, stopServer };