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

  beforeEach(async () => {
    serverPort = 3002;
    
    const express = require('express');
    const app = express();
    server = createServer(app);
    ioServer = new SocketIOServer(server);
    
    setupSocketHandlers(ioServer);
    
    await new Promise((resolve) => {
      server.listen(serverPort, () => {
        clientSocket1 = ioc(`http://localhost:${serverPort}`);
        clientSocket1.on('connect', () => {
          clientSocket2 = ioc(`http://localhost:${serverPort}`);
          clientSocket2.on('connect', resolve);
        });
      });
    });
  });

  afterEach(async () => {
    if (clientSocket1 && clientSocket1.connected) {
      await new Promise(resolve => {
        clientSocket1.disconnect();
        setTimeout(resolve, 50);
      });
    }
    if (clientSocket2 && clientSocket2.connected) {
      await new Promise(resolve => {
        clientSocket2.disconnect();
        setTimeout(resolve, 50);
      });
    }
    if (ioServer) {
      await new Promise(resolve => ioServer.close(resolve));
    }
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('should handle complete call flow: create -> join -> connect -> leave', (done) => {
    const uuid1 = '550e8400-e29b-41d4-a716-446655440000';
    const uuid2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    let roomCode;

    clientSocket1.on('room-created', ({ code }) => {
      roomCode = code;
      clientSocket2.emit('join-room', { code, uuid: uuid2 });
    });

    clientSocket2.on('room-joined', ({ code, peerUuid }) => {
      expect(code).toBe(roomCode);
      expect(peerUuid).toBe(uuid1);
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
        
        clientSocket2.on('reconnect-success', ({ code, peerUuid, reconnectWindow }) => {
          expect(code).toBe(roomCode);
          expect(peerUuid).toBe(uuid1);
          expect(typeof reconnectWindow).toBe('number');
          expect(reconnectWindow).toBeGreaterThan(0);
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

    clientSocket2.on('user-joined', ({ uuid }) => {
      expect(uuid).toBe(uuid2);
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

  it('should send peer-reconnected when disconnected peer reconnects', (done) => {
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

    let peerReconnected = false;

    clientSocket1.on('peer-disconnected', ({ canReconnect }) => {
      expect(canReconnect).toBe(true);

      setTimeout(() => {
        clientSocket2 = ioc(`http://localhost:${serverPort}`);
        clientSocket2.on('connect', () => {
          clientSocket2.emit('reconnect-room', { code: roomCode, uuid: uuid2 });
        });

        clientSocket2.on('reconnect-success', () => {
          expect(peerReconnected).toBe(true);
          done();
        });
      }, 100);
    });

    clientSocket1.on('peer-reconnected', ({ uuid }) => {
      expect(uuid).toBe(uuid2);
      peerReconnected = true;
    });

    clientSocket1.emit('create-room', { uuid: uuid1 });
  });

  it('should handle both users disconnecting and reconnecting', (done) => {
    const uuid1 = '550e8400-e29b-41d4-a716-446655440000';
    const uuid2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    let roomCode;

    clientSocket1.on('room-created', ({ code }) => {
      roomCode = code;
      clientSocket2.emit('join-room', { code, uuid: uuid2 });
    });

    clientSocket2.on('room-joined', () => {
      clientSocket1.disconnect();
      clientSocket2.disconnect();
    });

    let socket1Reconnected = false;
    let socket2Reconnected = false;

    const checkBothReconnected = () => {
      if (socket1Reconnected && socket2Reconnected) {
        done();
      }
    };

    setTimeout(() => {
      clientSocket1 = ioc(`http://localhost:${serverPort}`);
      clientSocket2 = ioc(`http://localhost:${serverPort}`);

      Promise.all([
        new Promise(resolve => clientSocket1.on('connect', resolve)),
        new Promise(resolve => clientSocket2.on('connect', resolve)),
      ]).then(() => {
        clientSocket1.emit('reconnect-room', { code: roomCode, uuid: uuid1 });
        clientSocket2.emit('reconnect-room', { code: roomCode, uuid: uuid2 });

        clientSocket1.on('reconnect-success', ({ code, peerUuid, reconnectWindow }) => {
          expect(code).toBe(roomCode);
          expect(peerUuid).toBe(uuid2);
          expect(reconnectWindow).toBeGreaterThan(0);
          socket1Reconnected = true;
          checkBothReconnected();
        });

        clientSocket2.on('reconnect-success', ({ code, peerUuid, reconnectWindow }) => {
          expect(code).toBe(roomCode);
          expect(peerUuid).toBe(uuid1);
          expect(reconnectWindow).toBeGreaterThan(0);
          socket2Reconnected = true;
          checkBothReconnected();
        });
      });
    }, 200);
  });

  it('should send room-not-found when reconnecting to expired room', (done) => {
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

    clientSocket1.on('peer-disconnected', () => {
      setTimeout(() => {
        clientSocket2 = ioc(`http://localhost:${serverPort}`);
        clientSocket2.on('connect', () => {
          clientSocket2.emit('reconnect-room', { code: 'INVALID', uuid: uuid2 });
        });

        clientSocket2.on('room-not-found', () => {
          done();
        });
      }, 100);
    });

    clientSocket1.emit('create-room', { uuid: uuid1 });
  });
});