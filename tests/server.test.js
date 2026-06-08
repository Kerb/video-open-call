import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'http';
import { io as ioc } from 'socket.io-client';

describe('Server Integration', () => {
  let server;
  let ioServer;
  let clientSocket;
  let serverPort;

  beforeEach(async () => {
    serverPort = 3001;
    
    const express = require('express');
    const app = express();
    server = createServer(app);
    ioServer = new (require('socket.io')).Server(server);
    
    require('../server.js').setupSocketHandlers(ioServer);
    
    await new Promise((resolve) => {
      server.listen(serverPort, () => {
        clientSocket = ioc(`http://localhost:${serverPort}`);
        clientSocket.on('connect', resolve);
      });
    });
  });

  afterEach(async () => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    if (ioServer) {
      await new Promise(resolve => ioServer.close(resolve));
    }
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  });

  it('should handle room creation with valid UUID', async () => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000';
    
    const roomCreated = new Promise((resolve) => {
      clientSocket.on('room-created', resolve);
    });

    const roomError = new Promise((_, reject) => {
      clientSocket.on('room-error', (err) => {
        reject(new Error(`Unexpected error: ${err.message}`));
      });
    });

    clientSocket.emit('create-room', { uuid: validUUID });
    
    const { code } = await Promise.race([roomCreated, roomError]);
    
    expect(code).toBeDefined();
    expect(code.length).toBe(6);
  });

  it('should reject room creation with invalid UUID', async () => {
    const invalidUUID = 'not-a-uuid';
    
    const roomError = new Promise((resolve) => {
      clientSocket.on('room-error', resolve);
    });

    const roomCreated = new Promise((_, reject) => {
      clientSocket.on('room-created', () => {
        reject(new Error('Should not create room with invalid UUID'));
      });
    });

    clientSocket.emit('create-room', { uuid: invalidUUID });
    
    const { message } = await Promise.race([roomError, roomCreated]);
    
    expect(message).toContain('UUID');
  });

  it('should enforce rate limiting', async () => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000';
    let rateLimitReached = false;
    
    const tryCreateRoom = () => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          clientSocket.off('room-created');
          clientSocket.off('room-error');
          resolve('timeout');
        }, 1000);
        
        const handleCreated = () => {
          clearTimeout(timeout);
          clientSocket.off('room-created', handleCreated);
          clientSocket.off('room-error', handleError);
          resolve('created');
        };
        
        const handleError = (err) => {
          clearTimeout(timeout);
          clientSocket.off('room-created', handleCreated);
          clientSocket.off('room-error', handleError);
          if (err.message.includes('лимит') || err.message.includes('limit')) {
            rateLimitReached = true;
          }
          resolve(err.message);
        };
        
        clientSocket.once('room-created', handleCreated);
        clientSocket.once('room-error', handleError);
        clientSocket.emit('create-room', { uuid: validUUID });
      });
    };

    const results = [];
    for (let i = 0; i < 10; i++) {
      const result = await tryCreateRoom();
      results.push(result);
    }
    
    expect(rateLimitReached).toBe(true);
  });
});