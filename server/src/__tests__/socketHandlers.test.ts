import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, CreateRoomResponse, JoinRoomResponse } from '@ccu/shared';
import { RoomManager } from '../RoomManager';
import { setupSocketHandlers } from '../socketHandlers';

// We need to test with actual socket.io connections
describe('Socket Handlers - Create and Join Room', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: Server<ClientToServerEvents, ServerToClientEvents>;
  let port: number;
  let clients: ClientSocket<ServerToClientEvents, ClientToServerEvents>[] = [];
  let roomManager: RoomManager;

  beforeEach(async () => {
    // Create fresh RoomManager for each test
    roomManager = new RoomManager();
    
    httpServer = createServer();
    io = new Server(httpServer);
    setupSocketHandlers(io, roomManager);

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

describe('Socket Handlers - Reconnect', () => {
  let httpServer: ReturnType<typeof createServer>;
  let io: Server<ClientToServerEvents, ServerToClientEvents>;
  let port: number;
  let clients: ClientSocket<ServerToClientEvents, ClientToServerEvents>[] = [];
  let roomManager: RoomManager;

  beforeEach(async () => {
    // Create fresh RoomManager for each test
    roomManager = new RoomManager();
    
    httpServer = createServer();
    io = new Server(httpServer);
    setupSocketHandlers(io, roomManager);

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

  // Helper to wait for socket connection
  function waitForConnect(socket: ClientSocket<ServerToClientEvents, ClientToServerEvents>): Promise<void> {
    return new Promise((resolve) => {
      if (socket.connected) {
        resolve();
      } else {
        socket.once('connect', () => resolve());
      }
    });
  }

  test('player can reconnect with correct playerSecret and reclaim same playerId', async () => {
    const host = createClient();
    await waitForConnect(host);
    
    // Host creates room
    const { roomCode } = await new Promise<CreateRoomResponse>((resolve, reject) => {
      host.emit('createRoom', { displayName: 'Host' }, (response) => {
        if ('error' in response) reject(new Error(response.error));
        else resolve(response as CreateRoomResponse);
      });
    });
    
    // Player 1 joins and gets credentials
    const player1 = createClient();
    await waitForConnect(player1);
    
    const { playerId: originalPlayerId, playerSecret } = await new Promise<JoinRoomResponse>((resolve, reject) => {
      player1.emit('joinRoom', { roomCode, displayName: 'Player1' }, (response) => {
        if ('error' in response) reject(new Error(response.error));
        else resolve(response as JoinRoomResponse);
      });
    });
    
    // Player 1 disconnects
    player1.close();
    // Remove from clients array so afterEach doesn't double-close
    clients = clients.filter(c => c !== player1);
    await new Promise(r => setTimeout(r, 100)); // Wait for disconnect to process
    
    // Player 1 reconnects with playerSecret
    const player1Reconnect = createClient();
    await waitForConnect(player1Reconnect);
    
    const reconnectResponse = await new Promise<JoinRoomResponse>((resolve, reject) => {
      player1Reconnect.emit('joinRoom', { 
        roomCode, 
        displayName: 'Player1', 
        playerSecret 
      }, (response) => {
        if ('error' in response) reject(new Error(response.error));
        else resolve(response as JoinRoomResponse);
      });
    });
    
    // Should get same playerId back
    expect(reconnectResponse.playerId).toBe(originalPlayerId);
    expect(reconnectResponse.playerSecret).toBe(playerSecret);
  });

  test('incorrect playerSecret does not hijack existing seat', async () => {
    const host = createClient();
    await waitForConnect(host);
    
    // Host creates room
    const { roomCode } = await new Promise<CreateRoomResponse>((resolve, reject) => {
      host.emit('createRoom', { displayName: 'Host' }, (response) => {
        if ('error' in response) reject(new Error(response.error));
        else resolve(response as CreateRoomResponse);
      });
    });
    
    // Player 1 joins
    const player1 = createClient();
    await waitForConnect(player1);
    
    const { playerId: originalPlayerId } = await new Promise<JoinRoomResponse>((resolve, reject) => {
      player1.emit('joinRoom', { roomCode, displayName: 'Player1' }, (response) => {
        if ('error' in response) reject(new Error(response.error));
        else resolve(response as JoinRoomResponse);
      });
    });
    
    // Attacker tries to join with wrong secret
    const attacker = createClient();
    await waitForConnect(attacker);
    
    const attackerResponse = await new Promise<JoinRoomResponse>((resolve, reject) => {
      attacker.emit('joinRoom', { 
        roomCode, 
        displayName: 'Attacker', 
        playerSecret: 'wrong-secret-12345' 
      }, (response) => {
        if ('error' in response) reject(new Error(response.error));
        else resolve(response as JoinRoomResponse);
      });
    });
    
    // Attacker should get a NEW playerId, not hijack original
    expect(attackerResponse.playerId).not.toBe(originalPlayerId);
  });

  test('disconnected player is marked as connected=false but seat is retained', async () => {
    const host = createClient();
    await waitForConnect(host);
    
    // Host creates room
    const { roomCode } = await new Promise<CreateRoomResponse>((resolve, reject) => {
      host.emit('createRoom', { displayName: 'Host' }, (response) => {
        if ('error' in response) reject(new Error(response.error));
        else resolve(response as CreateRoomResponse);
      });
    });
    
    // Player 1 joins
    const player1 = createClient();
    await waitForConnect(player1);
    
    const { playerId: player1Id } = await new Promise<JoinRoomResponse>((resolve, reject) => {
      player1.emit('joinRoom', { roomCode, displayName: 'Player1' }, (response) => {
        if ('error' in response) reject(new Error(response.error));
        else resolve(response as JoinRoomResponse);
      });
    });
    
    // Track playerLeft event on host
    const receivedPlayerIds: string[] = [];
    host.on('playerLeft', (playerId) => {
      receivedPlayerIds.push(playerId);
    });
    
    // Player 1 disconnects
    player1.close();
    // Remove from clients array so afterEach doesn't double-close
    clients = clients.filter(c => c !== player1);
    await new Promise(r => setTimeout(r, 150)); // Wait for disconnect
    
    // Host should have received playerLeft event with correct ID
    expect(receivedPlayerIds.length).toBe(1);
    expect(receivedPlayerIds[0]).toBe(player1Id);
  });
});
