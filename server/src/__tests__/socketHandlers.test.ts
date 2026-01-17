import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, CreateRoomResponse, JoinRoomResponse } from '@ccu/shared';

// We need to test with actual socket.io connections
describe('Socket Handlers - Create and Join Room', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: Server<ClientToServerEvents, ServerToClientEvents>;
  let port: number;
  let clients: ClientSocket<ServerToClientEvents, ClientToServerEvents>[] = [];

  beforeEach(async () => {
    // Import fresh module each time to reset state
    const { setupSocketHandlers } = await import('../socketHandlers');
    
    httpServer = createServer();
    io = new Server(httpServer);
    setupSocketHandlers(io);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address();
        port = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      });
    });
    
    clients = [];
  });

  afterEach(() => {
    // Close all clients
    for (const client of clients) {
      client.close();
    }
    io.close();
    httpServer.close();
  });

  function createClient(): ClientSocket<ServerToClientEvents, ClientToServerEvents> {
    const client = ioc(`http://localhost:${port}`, {
      transports: ['websocket'],
      forceNew: true
    });
    clients.push(client);
    return client;
  }

  test('createRoom returns room code and player credentials', async () => {
    const client = createClient();
    
    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => {
        client.emit('createRoom', { displayName: 'Host Player' }, (response) => {
          try {
            expect('error' in response).toBe(false);
            const res = response as CreateRoomResponse;
            expect(res.roomCode).toMatch(/^[A-Z0-9]{6}$/);
            expect(res.playerId).toBeTruthy();
            expect(res.playerSecret).toBeTruthy();
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });
  });

  test('joinRoom succeeds for existing room', async () => {
    const host = createClient();
    
    // First wait for host to connect and create room
    const roomCode = await new Promise<string>((resolve, reject) => {
      host.on('connect', () => {
        host.emit('createRoom', { displayName: 'Host' }, (createResponse) => {
          if ('error' in createResponse) {
            reject(new Error(createResponse.error));
            return;
          }
          resolve((createResponse as CreateRoomResponse).roomCode);
        });
      });
      host.on('connect_error', reject);
    });
    
    // Now create joiner and join the room
    const joiner = createClient();
    
    await new Promise<void>((resolve, reject) => {
      joiner.on('connect', () => {
        joiner.emit('joinRoom', { 
          roomCode, 
          displayName: 'Joiner' 
        }, (joinResponse) => {
          try {
            expect('error' in joinResponse).toBe(false);
            const jres = joinResponse as JoinRoomResponse;
            expect(jres.playerId).toBeTruthy();
            expect(jres.playerSecret).toBeTruthy();
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
      joiner.on('connect_error', reject);
    });
  });

  test('joinRoom fails for non-existent room', async () => {
    const client = createClient();

    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => {
        client.emit('joinRoom', { 
          roomCode: 'XXXXXX', 
          displayName: 'Player' 
        }, (response) => {
          try {
            expect('error' in response).toBe(true);
            expect((response as { error: string }).error).toBe('Room not found');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });
  });

  test('createRoom rejects empty display name', async () => {
    const client = createClient();

    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => {
        client.emit('createRoom', { displayName: '   ' }, (response) => {
          try {
            expect('error' in response).toBe(true);
            expect((response as { error: string }).error).toBe('Display name is required');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });
  });

  test('createRoom rejects display name over 24 chars', async () => {
    const client = createClient();

    await new Promise<void>((resolve, reject) => {
      client.on('connect', () => {
        client.emit('createRoom', { 
          displayName: 'This is a very long display name that exceeds the limit' 
        }, (response) => {
          try {
            expect('error' in response).toBe(true);
            expect((response as { error: string }).error).toBe('Display name must be 24 characters or less');
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });
  });
});
