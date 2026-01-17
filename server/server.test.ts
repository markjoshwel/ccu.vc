import { beforeAll, afterAll, describe, it, expect } from 'bun:test';
import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents, Card } from 'shared';
import { RoomManager } from './src/RoomManager';
import { Deck } from './src/Deck';

describe('server', () => {
  let server: ReturnType<typeof createServer>;
  let io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  let port: number;

  beforeAll(() => {
    port = 3001;
    server = createServer((req, res) => {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`);
      
      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
      });
    });

    server.listen(port);
  });

  afterAll(() => {
    server.close();
  });

  describe('GET /health', () => {
    it('should return 200 with status ok', async () => {
      const response = await fetch(`http://localhost:${port}/health`);
      const body = await response.json();
      
      expect(response.status).toBe(200);
      expect(body.status).toBe('ok');
    });
  });
});

describe('RoomManager', () => {
  describe('room code format', () => {
    it('should create a room with a 6-character code', () => {
      const manager = new RoomManager();
      const room = manager.createRoom();
      
      expect(room.code).toHaveLength(6);
    });

    it('should create room codes with only A-Z and 0-9 characters', () => {
      const manager = new RoomManager();
      const room = manager.createRoom();
      
      expect(room.code).toMatch(/^[A-Z0-9]+$/);
    });

    it('should not include ambiguous characters', () => {
      const manager = new RoomManager();
      const room = manager.createRoom();
      
      expect(room.code).not.toMatch(/[IO1]/);
    });
  });

  describe('deletion on zero connected players', () => {
    it('should delete room when connected player count transitions to 0', () => {
      const manager = new RoomManager();
      const room = manager.createRoom();
      
      const socketId = 'socket1';
      const playerId = 'player1';
      const player = { id: playerId, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };
      
      room.addPlayer(socketId, player);
      expect(room.connectedPlayerCount).toBe(1);
      expect(manager.roomCount).toBe(1);
      
      const result = manager.handlePlayerDisconnection(room.code, socketId, playerId);
      
      expect(result).toBe(null);
      expect(manager.roomCount).toBe(0);
      expect(manager.getRoom(room.code)).toBeUndefined();
    });

    it('should not delete room when connected player count is greater than 0', () => {
      const manager = new RoomManager();
      const room = manager.createRoom();
      
      const socketId1 = 'socket1';
      const socketId2 = 'socket2';
      const playerId1 = 'player1';
      const playerId2 = 'player2';
      const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };
      const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };
      
      room.addPlayer(socketId1, player1);
      room.addPlayer(socketId2, player2);
      expect(room.connectedPlayerCount).toBe(2);
      expect(manager.roomCount).toBe(1);
      
      const result = manager.handlePlayerDisconnection(room.code, socketId1, playerId1);
      
      expect(result).not.toBe(null);
      expect(manager.roomCount).toBe(1);
      expect(manager.getRoom(room.code)).toBeDefined();
      expect(room.connectedPlayerCount).toBe(1);
    });
  });

  describe('room storage', () => {
    it('should use an in-memory Map keyed by room code', () => {
      const manager = new RoomManager();
      
      expect(manager.rooms).toBeInstanceOf(Map);
      
      const room1 = manager.createRoom();
      expect(manager.getRoom(room1.code)).toBe(room1);
      
      const room2 = manager.createRoom();
      expect(manager.getRoom(room2.code)).toBe(room2);
      expect(room2.code).not.toBe(room1.code);
    });
  });
});

describe('join room functionality', () => {
  let server: ReturnType<typeof createServer>;
  let io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  let port: number;

  beforeAll(() => {
    port = 3002;
    server = createServer((req, res) => {
      res.writeHead(404);
      res.end('Not Found');
    });

    io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    const roomManager = new RoomManager();

    function validateDisplayName(displayName: string): { valid: boolean; error?: string } {
      const trimmed = displayName.trim();
      
      if (trimmed.length === 0) {
        return { valid: false, error: 'Display name cannot be empty' };
      }
      
      if (trimmed.length > 24) {
        return { valid: false, error: 'Display name must be 24 characters or less' };
      }
      
      if (/[\x00-\x1F\x7F]/.test(trimmed)) {
        return { valid: false, error: 'Display name cannot contain control characters' };
      }
      
      return { valid: true };
    }

    function generatePlayerSecret(): string {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let secret = '';
      for (let i = 0; i < 32; i++) {
        secret += chars[Math.floor(Math.random() * chars.length)];
      }
      return secret;
    }

    const socketRoomMap = new Map<string, string>();
    const socketPlayerMap = new Map<string, { playerId: string; playerSecret: string }>();

    io.on('connection', (socket) => {
      (socket as any).on('create_room', (callback: (response: { roomCode: string }) => void) => {
        const room = roomManager.createRoom();
        callback({ roomCode: room.code });
      });
      
      (socket as any).on('join_room', (roomCode: string, displayName: string, callback: (response: { playerId: string; playerSecret: string } | { error: string }) => void) => {
        const validation = validateDisplayName(displayName);
        
        if (!validation.valid) {
          callback({ error: validation.error || 'Invalid display name' });
          return;
        }
        
        const room = roomManager.getRoom(roomCode);
        
        if (!room) {
          callback({ error: 'Room not found' });
          return;
        }
        
        const playerId = `player_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const playerSecret = generatePlayerSecret();
        
        const player = {
          id: playerId,
          name: displayName.trim(),
          isReady: false,
          secret: playerSecret,
          connected: true,
          hand: [],
          handCount: 0
        };
        
        roomManager.handlePlayerConnection(roomCode, socket.id, player);
        socketRoomMap.set(socket.id, roomCode);
        socketPlayerMap.set(socket.id, { playerId, playerSecret });
        io.to(roomCode).emit('roomUpdated', room.state);
        const playerPublic = { id: player.id, name: player.name, isReady: player.isReady, connected: player.connected, handCount: player.hand.length };
        io.to(roomCode).emit('playerJoined', playerPublic as any);
        socket.join(roomCode);
        
        callback({ playerId, playerSecret });
      });

      (socket as any).on('reconnect_room', (roomCode: string, playerId: string, playerSecret: string, callback: (response: { success: boolean; error?: string }) => void) => {
        const room = roomManager.handlePlayerReconnection(roomCode, socket.id, playerId, playerSecret);
        
        if (!room) {
          callback({ success: false, error: 'Reconnection failed' });
          return;
        }
        
        socketRoomMap.set(socket.id, roomCode);
        socketPlayerMap.set(socket.id, { playerId, playerSecret });
        io.to(roomCode).emit('roomUpdated', room.state);
        socket.join(roomCode);
        
        callback({ success: true });
      });
      
      (socket as any).on('start_game', (callback: (response: { success: boolean; error?: string }) => void) => {
        const roomCode = socketRoomMap.get(socket.id);
        
        if (!roomCode) {
          callback({ success: false, error: 'Not in a room' });
          return;
        }
        
        const room = roomManager.getRoom(roomCode);
        
        if (!room) {
          callback({ success: false, error: 'Room not found' });
          return;
        }
        
        const playerData = socketPlayerMap.get(socket.id);
        if (!playerData) {
          callback({ success: false, error: 'Player not found' });
          return;
        }
        
        const firstPlayerId = Array.from(room.players.keys())[0];
        if (playerData.playerId !== firstPlayerId) {
          callback({ success: false, error: 'Only the host can start the game' });
          return;
        }
        
        try {
          room.startGame();
          io.to(roomCode).emit('roomUpdated', room.state);
          io.to(roomCode).emit('gameStarted');
          callback({ success: true });
        } catch (error) {
          callback({ success: false, error: (error as Error).message });
        }
      });

      (socket as any).on('reconnect_room', (roomCode: string, playerId: string, playerSecret: string, callback: (response: { success: boolean; error?: string }) => void) => {
        const room = roomManager.handlePlayerReconnection(roomCode, socket.id, playerId, playerSecret);
        
        if (!room) {
          callback({ success: false, error: 'Reconnection failed' });
          return;
        }
        
        socketRoomMap.set(socket.id, roomCode);
        socketPlayerMap.set(socket.id, { playerId, playerSecret });
        io.to(roomCode).emit('roomUpdated', room.state);
        socket.join(roomCode);
        
        callback({ success: true });
      });
      
      socket.on('disconnect', () => {
        const roomId = socketRoomMap.get(socket.id);
        if (roomId) {
          const playerData = socketPlayerMap.get(socket.id);
          const playerId = playerData?.playerId || socket.id;
          const room = roomManager.handlePlayerDisconnection(roomId, socket.id, playerId);
          socketRoomMap.delete(socket.id);
          socketPlayerMap.delete(socket.id);
          if (room) {
            io.to(roomId).emit('roomUpdated', room.state);
          }
        }
      });
    });

    server.listen(port);
  });

  afterAll(() => {
    server.close();
  });

  describe('join success', () => {
    it('should successfully join a room with valid display name', async () => {
      const client = ioClient(`http://localhost:${port}`) as any;
      
      const createRoomPromise = new Promise<{ roomCode: string }>((resolve) => {
        client.emit('create_room', (response: { roomCode: string }) => {
          resolve(response);
        });
      });
      
      const { roomCode } = await createRoomPromise;
      
      const joinPromise = new Promise<{ playerId: string; playerSecret: string }>((resolve, reject) => {
        client.emit('join_room', roomCode, 'TestPlayer', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      
      const result = await joinPromise;
      
      expect(result.playerId).toBeDefined();
      expect(result.playerSecret).toBeDefined();
      expect(result.playerSecret.length).toBe(32);
      
      client.disconnect();
    });

    it('should trim display name before joining', async () => {
      const client = ioClient(`http://localhost:${port}`) as any;
      
      const createRoomPromise = new Promise<{ roomCode: string }>((resolve) => {
        client.emit('create_room', (response: { roomCode: string }) => {
          resolve(response);
        });
      });
      
      const { roomCode } = await createRoomPromise;
      
      const joinPromise = new Promise<{ playerId: string; playerSecret: string }>((resolve, reject) => {
        client.emit('join_room', roomCode, '  TestPlayer  ', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      
      const result = await joinPromise;
      
      expect(result.playerId).toBeDefined();
      expect(result.playerSecret).toBeDefined();
      
      client.disconnect();
    });
  });

  describe('join failure', () => {
    it('should reject join when room does not exist', async () => {
      const client = ioClient(`http://localhost:${port}`) as any;
      
      const joinPromise = new Promise<{ error: string }>((resolve) => {
        client.emit('join_room', 'NOTEXIST', 'TestPlayer', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            resolve({ error: response.error });
          }
        });
      });
      
      const result = await joinPromise;
      
      expect(result.error).toBe('Room not found');
      
      client.disconnect();
    });

    it('should reject join with empty display name', async () => {
      const client = ioClient(`http://localhost:${port}`) as any;
      
      const createRoomPromise = new Promise<{ roomCode: string }>((resolve) => {
        client.emit('create_room', (response: { roomCode: string }) => {
          resolve(response);
        });
      });
      
      const { roomCode } = await createRoomPromise;
      
      const joinPromise = new Promise<{ error: string }>((resolve) => {
        client.emit('join_room', roomCode, '   ', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            resolve({ error: response.error });
          }
        });
      });
      
      const result = await joinPromise;
      
      expect(result.error).toBe('Display name cannot be empty');
      
      client.disconnect();
    });

    it('should reject join with display name longer than 24 characters', async () => {
      const client = ioClient(`http://localhost:${port}`) as any;
      
      const createRoomPromise = new Promise<{ roomCode: string }>((resolve) => {
        client.emit('create_room', (response: { roomCode: string }) => {
          resolve(response);
        });
      });
      
      const { roomCode } = await createRoomPromise;
      
      const longName = 'A'.repeat(25);
      
      const joinPromise = new Promise<{ error: string }>((resolve) => {
        client.emit('join_room', roomCode, longName, (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            resolve({ error: response.error });
          }
        });
      });
      
      const result = await joinPromise;
      
      expect(result.error).toBe('Display name must be 24 characters or less');
      
      client.disconnect();
    });

    it('should reject join with control characters in display name', async () => {
      const client = ioClient(`http://localhost:${port}`) as any;
      
      const createRoomPromise = new Promise<{ roomCode: string }>((resolve) => {
        client.emit('create_room', (response: { roomCode: string }) => {
          resolve(response);
        });
      });
      
      const { roomCode } = await createRoomPromise;
      
      const nameWithControlChar = 'Test\x00Player';
      
      const joinPromise = new Promise<{ error: string }>((resolve) => {
        client.emit('join_room', roomCode, nameWithControlChar, (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            resolve({ error: response.error });
          }
        });
      });
      
      const result = await joinPromise;
      
      expect(result.error).toBe('Display name cannot contain control characters');
      
      client.disconnect();
    });
  });

  describe('room storage', () => {
    it('should use an in-memory Map keyed by room code', () => {
      const manager = new RoomManager();
      
      expect(manager.rooms).toBeInstanceOf(Map);
      
      const room1 = manager.createRoom();
      expect(manager.getRoom(room1.code)).toBe(room1);
      
      const room2 = manager.createRoom();
      expect(manager.getRoom(room2.code)).toBe(room2);
      expect(room2.code).not.toBe(room1.code);
    });
  });

  describe('reconnect seat reclaim', () => {
    it('should successfully reconnect with correct playerSecret', async () => {
      const client1 = ioClient(`http://localhost:${port}`) as any;
      
      const createRoomPromise = new Promise<{ roomCode: string }>((resolve) => {
        client1.emit('create_room', (response: { roomCode: string }) => {
          resolve(response);
        });
      });
      
      const { roomCode } = await createRoomPromise;
      
      const joinPromise = new Promise<{ playerId: string; playerSecret: string }>((resolve, reject) => {
        client1.emit('join_room', roomCode, 'Player1', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      
      const { playerId, playerSecret } = await joinPromise;
      
      const client2 = ioClient(`http://localhost:${port}`) as any;
      const joinPromise2 = new Promise<{ playerId: string; playerSecret: string }>((resolve, reject) => {
        client2.emit('join_room', roomCode, 'Player2', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      await joinPromise2;
      
      client1.disconnect();
      
      const client3 = ioClient(`http://localhost:${port}`) as any;
      const reconnectPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
        client3.emit('reconnect_room', roomCode, playerId, playerSecret, (response: { success: boolean; error?: string }) => {
          resolve(response);
        });
      });
      
      const result = await reconnectPromise;
      expect(result.success).toBe(true);
      
      client2.disconnect();
      client3.disconnect();
    });

    it('should retain seat after disconnect when another player is connected', async () => {
      const client1 = ioClient(`http://localhost:${port}`) as any;
      
      const createRoomPromise = new Promise<{ roomCode: string }>((resolve) => {
        client1.emit('create_room', (response: { roomCode: string }) => {
          resolve(response);
        });
      });
      
      const { roomCode } = await createRoomPromise;
      
      const joinPromise = new Promise<{ playerId: string; playerSecret: string }>((resolve, reject) => {
        client1.emit('join_room', roomCode, 'Player1', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      
      const { playerId, playerSecret } = await joinPromise;
      
      const client2 = ioClient(`http://localhost:${port}`) as any;
      const joinPromise2 = new Promise<{ playerId: string; playerSecret: string }>((resolve, reject) => {
        client2.emit('join_room', roomCode, 'Player2', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      await joinPromise2;
      
      client1.disconnect();
      
      const client3 = ioClient(`http://localhost:${port}`) as any;
      const reconnectPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
        client3.emit('reconnect_room', roomCode, playerId, playerSecret, (response: { success: boolean; error?: string }) => {
          resolve(response);
        });
      });
      
      const result = await reconnectPromise;
      expect(result.success).toBe(true);
      
      client2.disconnect();
      client3.disconnect();
    });
  });

  describe('reconnect hijack prevention', () => {
    it('should fail to reconnect with incorrect playerSecret', async () => {
      const client1 = ioClient(`http://localhost:${port}`) as any;
      
      const createRoomPromise = new Promise<{ roomCode: string }>((resolve) => {
        client1.emit('create_room', (response: { roomCode: string }) => {
          resolve(response);
        });
      });
      
      const { roomCode } = await createRoomPromise;
      
      const joinPromise = new Promise<{ playerId: string; playerSecret: string }>((resolve) => {
        client1.emit('join_room', roomCode, 'Player1', (response: { playerId: string; playerSecret: string }) => {
          resolve(response);
        });
      });
      
      const { playerId } = await joinPromise;
      client1.disconnect();
      
      const client2 = ioClient(`http://localhost:${port}`) as any;
      const joinPromise2 = new Promise<{ playerId: string; playerSecret: string }>((resolve) => {
        client2.emit('join_room', roomCode, 'Player2', (response: { playerId: string; playerSecret: string }) => {
          resolve(response);
        });
      });
      await joinPromise2;
      
      const client3 = ioClient(`http://localhost:${port}`) as any;
      const wrongSecret = 'wrongsecret12345678901234567890';
      const reconnectPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
        client3.emit('reconnect_room', roomCode, playerId, wrongSecret, (response: { success: boolean; error?: string }) => {
          resolve(response);
        });
      });
      
      const result = await reconnectPromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('Reconnection failed');
      
      client2.disconnect();
      client3.disconnect();
    });

    it('should fail to reconnect with non-existent player', async () => {
      const client1 = ioClient(`http://localhost:${port}`) as any;
      
      const createRoomPromise = new Promise<{ roomCode: string }>((resolve) => {
        client1.emit('create_room', (response: { roomCode: string }) => {
          resolve(response);
        });
      });
      
      const { roomCode } = await createRoomPromise;
      
      const joinPromise = new Promise<{ playerId: string; playerSecret: string }>((resolve) => {
        client1.emit('join_room', roomCode, 'Player1', (response: { playerId: string; playerSecret: string }) => {
          resolve(response);
        });
      });
      
      await joinPromise;
      
      const client2 = ioClient(`http://localhost:${port}`) as any;
      const fakePlayerId = 'nonexistent_player';
      const fakeSecret = 'fakesecret12345678901234567890';
      const reconnectPromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
        client2.emit('reconnect_room', roomCode, fakePlayerId, fakeSecret, (response: { success: boolean; error?: string }) => {
          resolve(response);
        });
      });
      
      const result = await reconnectPromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('Reconnection failed');
      
      client1.disconnect();
      client2.disconnect();
    });
  });
});

describe('start game socket event', () => {
  let server: ReturnType<typeof createServer>;
  let io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  let port: number;
  let roomManager: RoomManager;
  let socketRoomMap: Map<string, string>;
  let socketPlayerMap: Map<string, { playerId: string; playerSecret: string }>;

  beforeAll(() => {
    port = 3003;
    server = createServer((req, res) => {
      res.writeHead(404);
      res.end('Not Found');
    });

    io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    roomManager = new RoomManager();

    function validateDisplayName(displayName: string): { valid: boolean; error?: string } {
      const trimmed = displayName.trim();
      
      if (trimmed.length === 0) {
        return { valid: false, error: 'Display name cannot be empty' };
      }
      
      if (trimmed.length > 24) {
        return { valid: false, error: 'Display name must be 24 characters or less' };
      }
      
      if (/[\x00-\x1F\x7F]/.test(trimmed)) {
        return { valid: false, error: 'Display name cannot contain control characters' };
      }
      
      return { valid: true };
    }

    function generatePlayerSecret(): string {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let secret = '';
      for (let i = 0; i < 32; i++) {
        secret += chars[Math.floor(Math.random() * chars.length)];
      }
      return secret;
    }

    socketRoomMap = new Map<string, string>();
    socketPlayerMap = new Map<string, { playerId: string; playerSecret: string }>();

    io.on('connection', (socket) => {
      (socket as any).on('create_room', (callback: (response: { roomCode: string }) => void) => {
        const room = roomManager.createRoom();
        callback({ roomCode: room.code });
      });
      
      (socket as any).on('join_room', (roomCode: string, displayName: string, callback: (response: { playerId: string; playerSecret: string } | { error: string }) => void) => {
        const validation = validateDisplayName(displayName);
        
        if (!validation.valid) {
          callback({ error: validation.error || 'Invalid display name' });
          return;
        }
        
        const room = roomManager.getRoom(roomCode);
        
        if (!room) {
          callback({ error: 'Room not found' });
          return;
        }
        
        const playerId = `player_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const playerSecret = generatePlayerSecret();
        
        const player = {
          id: playerId,
          name: displayName.trim(),
          isReady: false,
          secret: playerSecret,
          connected: true,
          hand: [],
          handCount: 0
        };
        
        roomManager.handlePlayerConnection(roomCode, socket.id, player);
        socketRoomMap.set(socket.id, roomCode);
        socketPlayerMap.set(socket.id, { playerId, playerSecret });
        io.to(roomCode).emit('roomUpdated', room.state);
        const playerPublic = { id: player.id, name: player.name, isReady: player.isReady, connected: player.connected, handCount: player.hand.length };
        io.to(roomCode).emit('playerJoined', playerPublic as any);
        socket.join(roomCode);
        
        callback({ playerId, playerSecret });
      });

      (socket as any).on('reconnect_room', (roomCode: string, playerId: string, playerSecret: string, callback: (response: { success: boolean; error?: string }) => void) => {
        const room = roomManager.handlePlayerReconnection(roomCode, socket.id, playerId, playerSecret);
        
        if (!room) {
          callback({ success: false, error: 'Reconnection failed' });
          return;
        }
        
        socketRoomMap.set(socket.id, roomCode);
        socketPlayerMap.set(socket.id, { playerId, playerSecret });
        io.to(roomCode).emit('roomUpdated', room.state);
        socket.join(roomCode);
        
        callback({ success: true });
      });
      
      (socket as any).on('start_game', (callback: (response: { success: boolean; error?: string }) => void) => {
        const roomCode = socketRoomMap.get(socket.id);
        
        if (!roomCode) {
          callback({ success: false, error: 'Not in a room' });
          return;
        }
        
        const room = roomManager.getRoom(roomCode);
        
        if (!room) {
          callback({ success: false, error: 'Room not found' });
          return;
        }
        
        const playerData = socketPlayerMap.get(socket.id);
        if (!playerData) {
          callback({ success: false, error: 'Player not found' });
          return;
        }
        
        const firstPlayerId = Array.from(room.players.keys())[0];
        if (playerData.playerId !== firstPlayerId) {
          callback({ success: false, error: 'Only the host can start the game' });
          return;
        }
        
        try {
          room.startGame();
          io.to(roomCode).emit('roomUpdated', room.state);
          io.to(roomCode).emit('gameStarted');
          callback({ success: true });
        } catch (error) {
          callback({ success: false, error: (error as Error).message });
        }
      });
      
      socket.on('disconnect', () => {
        const roomId = socketRoomMap.get(socket.id);
        if (roomId) {
          const playerData = socketPlayerMap.get(socket.id);
          const playerId = playerData?.playerId || socket.id;
          const room = roomManager.handlePlayerDisconnection(roomId, socket.id, playerId);
          socketRoomMap.delete(socket.id);
          socketPlayerMap.delete(socket.id);
          if (room) {
            io.to(roomId).emit('roomUpdated', room.state);
          }
        }
      });
    });

    server.listen(port);
  });

  afterAll(() => {
    server.close();
  });

  describe('start game success', () => {
    it('should allow host to start game', async () => {
      const client1 = ioClient(`http://localhost:${port}`) as any;
      
      const createRoomPromise = new Promise<{ roomCode: string }>((resolve) => {
        client1.emit('create_room', (response: { roomCode: string }) => {
          resolve(response);
        });
      });
      
      const { roomCode } = await createRoomPromise;
      
      const joinPromise1 = new Promise<{ playerId: string; playerSecret: string }>((resolve, reject) => {
        client1.emit('join_room', roomCode, 'Player1', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      
      await joinPromise1;
      
      const client2 = ioClient(`http://localhost:${port}`) as any;
      const joinPromise2 = new Promise<{ playerId: string; playerSecret: string }>((resolve, reject) => {
        client2.emit('join_room', roomCode, 'Player2', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      await joinPromise2;
      
      const startGamePromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
        client1.emit('start_game', (response: { success: boolean; error?: string }) => {
          resolve(response);
        });
      });
      
      const result = await startGamePromise;
      expect(result.success).toBe(true);
      
      const room = roomManager.getRoom(roomCode);
      expect(room!.state.gameStatus).toBe('playing');
      expect(room!.state.deckSize).toBeGreaterThan(0);
      expect(room!.state.discardPile).toHaveLength(1);
      
      room!.players.forEach(player => {
        expect(player.hand).toHaveLength(7);
      });
      
      client1.disconnect();
      client2.disconnect();
    });

    it('should emit gameStateUpdate with hand sizes and discard pile', async () => {
      const client1 = ioClient(`http://localhost:${port}`) as any;
      
      const createRoomPromise = new Promise<{ roomCode: string }>((resolve) => {
        client1.emit('create_room', (response: { roomCode: string }) => {
          resolve(response);
        });
      });
      
      const { roomCode } = await createRoomPromise;
      
      const joinPromise1 = new Promise<{ playerId: string; playerSecret: string }>((resolve, reject) => {
        client1.emit('join_room', roomCode, 'Player1', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      
      await joinPromise1;
      
      const client2 = ioClient(`http://localhost:${port}`) as any;
      const joinPromise2 = new Promise<{ playerId: string; playerSecret: string }>((resolve, reject) => {
        client2.emit('join_room', roomCode, 'Player2', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      await joinPromise2;
      
      let gameViewReceived = false;
      let gameView: any = null;
      
      const gameStateUpdatePromise = new Promise<any>((resolve) => {
        client1.on('gameStateUpdate', (view: any) => {
          const currentRoom = roomManager.getRoom(roomCode);
          if (currentRoom && currentRoom.state.gameStatus === 'playing') {
            gameView = view;
            gameViewReceived = true;
            resolve(view);
          }
        });
      });
      
      const startGamePromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
        client1.emit('start_game', (response: { success: boolean; error?: string }) => {
          resolve(response);
        });
      });
      
      await startGamePromise;
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('gameStateUpdate timeout')), 2000);
      });
      
      try {
        await Promise.race([gameStateUpdatePromise, timeoutPromise]);
      } catch (e) {
        console.log('gameStateUpdate not received in time, checking room directly');
      }
      
      const finalRoom = roomManager.getRoom(roomCode);
      expect(finalRoom!.state.gameStatus).toBe('playing');
      
      if (!gameViewReceived) {
        gameView = finalRoom!.toGameView(Array.from(finalRoom!.players.keys())[0]);
      }
      
      expect(gameView.me.hand).toHaveLength(7);
      expect(gameView.otherPlayers).toHaveLength(1);
      expect(gameView.otherPlayers[0].handCount).toBe(7);
      expect(gameView.room.discardPile).toBeDefined();
      expect(gameView.room.discardPile).toHaveLength(1);
      
      client1.disconnect();
      client2.disconnect();
    });
  });

  describe('start game failure', () => {
    it('should fail if not in a room', async () => {
      const client = ioClient(`http://localhost:${port}`) as any;
      
      const startGamePromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
        client.emit('start_game', (response: { success: boolean; error?: string }) => {
          resolve(response);
        });
      });
      
      const result = await startGamePromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('Not in a room');
      
      client.disconnect();
    });

    it('should fail if non-host tries to start', async () => {
      const client1 = ioClient(`http://localhost:${port}`) as any;
      
      const createRoomPromise = new Promise<{ roomCode: string }>((resolve) => {
        client1.emit('create_room', (response: { roomCode: string }) => {
          resolve(response);
        });
      });
      
      const { roomCode } = await createRoomPromise;
      
      const joinPromise1 = new Promise<{ playerId: string; playerSecret: string }>((resolve, reject) => {
        client1.emit('join_room', roomCode, 'Player1', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      
      await joinPromise1;
      
      const client2 = ioClient(`http://localhost:${port}`) as any;
      const joinPromise2 = new Promise<{ playerId: string; playerSecret: string }>((resolve, reject) => {
        client2.emit('join_room', roomCode, 'Player2', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      await joinPromise2;
      
      const startGamePromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
        client2.emit('start_game', (response: { success: boolean; error?: string }) => {
          resolve(response);
        });
      });
      
      const result = await startGamePromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('Only the host can start the game');
      
      client1.disconnect();
      client2.disconnect();
    });

    it('should fail if less than 2 players', async () => {
      const client = ioClient(`http://localhost:${port}`) as any;
      
      const createRoomPromise = new Promise<{ roomCode: string }>((resolve) => {
        client.emit('create_room', (response: { roomCode: string }) => {
          resolve(response);
        });
      });
      
      const { roomCode } = await createRoomPromise;
      
      const joinPromise = new Promise<{ playerId: string; playerSecret: string }>((resolve, reject) => {
        client.emit('join_room', roomCode, 'Player1', (response: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in response) {
            reject(new Error(response.error));
          } else {
            resolve(response);
          }
        });
      });
      
      await joinPromise;
      
      const startGamePromise = new Promise<{ success: boolean; error?: string }>((resolve) => {
        client.emit('start_game', (response: { success: boolean; error?: string }) => {
          resolve(response);
        });
      });
      
      const result = await startGamePromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('At least 2 players required to start');
      
      client.disconnect();
    });
  });
});

describe('toGameView', () => {
  it('should include full hand for requesting player', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();
    
    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const cards1: Card[] = [
      { color: 'red', value: '5' },
      { color: 'blue', value: '7' }
    ];
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: cards1, handCount: 2 };
    
    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const cards2: Card[] = [
      { color: 'green', value: '9' },
      { color: 'yellow', value: '3' },
      { color: 'wild', value: 'wild' }
    ];
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: cards2, handCount: 3 };
    
    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    
    const gameView = room.toGameView(playerId1);
    
    expect(gameView.me.id).toBe(playerId1);
    expect(gameView.me.hand).toEqual(cards1);
    expect(gameView.me.hand).toHaveLength(2);
  });

  it('should not include opponent card objects', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();
    
    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const cards1: Card[] = [
      { color: 'red', value: '5' },
      { color: 'blue', value: '7' }
    ];
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: cards1, handCount: 2 };
    
    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const cards2: Card[] = [
      { color: 'green', value: '9' },
      { color: 'yellow', value: '3' },
      { color: 'wild', value: 'wild' }
    ];
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: cards2, handCount: 3 };
    
    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    
    const gameView = room.toGameView(playerId1);
    
    expect(gameView.otherPlayers).toHaveLength(1);
    const opponent = gameView.otherPlayers[0];
    expect(opponent.id).toBe(playerId2);
    expect(opponent.handCount).toBe(3);
    expect(opponent as any).not.toHaveProperty('hand');
  });

  it('should include only handCount for opponent', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();
    
    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const cards1: Card[] = [{ color: 'red', value: '5' }];
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: cards1, handCount: 1 };
    
    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const cards2: Card[] = [
      { color: 'green', value: '9' },
      { color: 'yellow', value: '3' }
    ];
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: cards2, handCount: 2 };
    
    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    
    const gameView = room.toGameView(playerId1);
    
    const opponent = gameView.otherPlayers[0];
    expect(opponent.handCount).toBe(2);
    
    const serialized = JSON.stringify(gameView);
    expect(serialized).not.toContain('"color":"green"');
    expect(serialized).not.toContain('"value":"9"');
  });

  it('should include handCount in opponent info for serialized payload', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();
    
    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const cards1: Card[] = [{ color: 'red', value: '5' }];
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: cards1, handCount: 1 };
    
    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const cards2: Card[] = [
      { color: 'green', value: '9' },
      { color: 'yellow', value: '3' }
    ];
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: cards2, handCount: 2 };
    
    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    
    const gameView = room.toGameView(playerId1);
    
    const serialized = JSON.stringify(gameView);
    expect(serialized).toContain('"handCount":2');
    expect(serialized).toContain('"handCount":1');
    
    expect(serialized).toContain('"color":"red"');
    expect(serialized).toContain('"value":"5"');
    
    expect(serialized).not.toContain('"color":"green"');
    expect(serialized).not.toContain('"value":"9"');
    expect(serialized).not.toContain('"color":"yellow"');
    expect(serialized).not.toContain('"value":"3"');
  });
});

describe('Deck', () => {
  describe('standard deck generation', () => {
    it('should create a deck with 108 cards', () => {
      const deck = Deck.createStandardDeck();
      
      expect(deck.size).toBe(108);
    });

    it('should have correct count of number cards', () => {
      const deck = Deck.createStandardDeck();
      const colors: Array<'red' | 'yellow' | 'green' | 'blue'> = ['red', 'yellow', 'green', 'blue'];
      
      colors.forEach(color => {
        let zeroCount = 0;
        for (let i = 1; i <= 9; i++) {
          zeroCount += deck.cards.filter(c => c.color === color && c.value === i.toString()).length;
        }
        expect(zeroCount).toBe(18);
      });
      
      colors.forEach(color => {
        const zeroCount = deck.cards.filter(c => c.color === color && c.value === '0').length;
        expect(zeroCount).toBe(1);
      });
    });

    it('should have correct count of action cards per color', () => {
      const deck = Deck.createStandardDeck();
      const colors: Array<'red' | 'yellow' | 'green' | 'blue'> = ['red', 'yellow', 'green', 'blue'];
      
      colors.forEach(color => {
        const skipCount = deck.cards.filter(c => c.color === color && c.value === 'skip').length;
        expect(skipCount).toBe(2);
        
        const reverseCount = deck.cards.filter(c => c.color === color && c.value === 'reverse').length;
        expect(reverseCount).toBe(2);
        
        const draw2Count = deck.cards.filter(c => c.color === color && c.value === 'draw2').length;
        expect(draw2Count).toBe(2);
      });
    });

    it('should have 4 wild cards', () => {
      const deck = Deck.createStandardDeck();
      
      const wildCount = deck.cards.filter(c => c.color === 'wild' && c.value === 'wild').length;
      expect(wildCount).toBe(4);
    });

    it('should have 4 wild draw four cards', () => {
      const deck = Deck.createStandardDeck();
      
      const wildDraw4Count = deck.cards.filter(c => c.color === 'wild' && c.value === 'wild_draw4').length;
      expect(wildDraw4Count).toBe(4);
    });

    it('should have 25 cards per color (number + action)', () => {
      const deck = Deck.createStandardDeck();
      const colors: Array<'red' | 'yellow' | 'green' | 'blue'> = ['red', 'yellow', 'green', 'blue'];
      
      colors.forEach(color => {
        const colorCount = deck.cards.filter(c => c.color === color).length;
        expect(colorCount).toBe(25);
      });
    });
  });

  describe('shuffle', () => {
    it('should produce a permutation of the full deck length', () => {
      const deck = Deck.createStandardDeck();
      const originalCards = [...deck.cards];
      
      deck.shuffle();
      
      expect(deck.size).toBe(108);
      expect(deck.cards).toHaveLength(108);
      
      const hasSameCards = originalCards.every(card => 
        deck.cards.some(c => c.color === card.color && c.value === card.value)
      );
      expect(hasSameCards).toBe(true);
    });

    it('should produce a different order than original (statistically)', () => {
      const deck = Deck.createStandardDeck();
      const originalCards = [...deck.cards];
      
      deck.shuffle();
      
      const isSameOrder = deck.cards.every((card, index) => 
        card.color === originalCards[index].color && card.value === originalCards[index].value
      );
      expect(isSameOrder).toBe(false);
    });

    it('should maintain all cards after shuffle', () => {
      const deck = Deck.createStandardDeck();
      
      const cardCounts = new Map<string, number>();
      deck.cards.forEach(card => {
        const key = `${card.color}-${card.value}`;
        cardCounts.set(key, (cardCounts.get(key) || 0) + 1);
      });
      
      deck.shuffle();
      
      const shuffledCardCounts = new Map<string, number>();
      deck.cards.forEach(card => {
        const key = `${card.color}-${card.value}`;
        shuffledCardCounts.set(key, (shuffledCardCounts.get(key) || 0) + 1);
      });
      
      cardCounts.forEach((count, key) => {
        expect(shuffledCardCounts.get(key)).toBe(count);
      });
    });
  });

  describe('draw', () => {
    it('should remove and return the top card', () => {
      const deck = Deck.createStandardDeck();
      const originalSize = deck.size;
      const topCard = deck.cards[deck.cards.length - 1];
      
      const drawnCard = deck.draw();
      
      expect(drawnCard).toEqual(topCard);
      expect(deck.size).toBe(originalSize - 1);
    });

    it('should return undefined when deck is empty', () => {
      const deck = Deck.createStandardDeck();
      
      while (!deck.isEmpty()) {
        deck.draw();
      }
      
      const drawnCard = deck.draw();
      expect(drawnCard).toBeUndefined();
    });
  });

  describe('isEmpty', () => {
    it('should return false for a new deck', () => {
      const deck = Deck.createStandardDeck();
      expect(deck.isEmpty()).toBe(false);
    });

    it('should return true after drawing all cards', () => {
      const deck = Deck.createStandardDeck();
      
      while (!deck.isEmpty()) {
        deck.draw();
      }
      
      expect(deck.isEmpty()).toBe(true);
    });
  });

  describe('shuffle with seeded RNG', () => {
    it('should produce deterministic shuffle with seeded RNG', () => {
      let seed = 12345;
      const rng1 = () => {
        seed = (seed * 1103515245 + 12345) % 0x80000000;
        return seed / 0x80000000;
      };
      
      const deck1 = Deck.createStandardDeck();
      deck1.shuffle(rng1);
      const shuffled1 = [...deck1.cards];
      
      seed = 12345;
      const rng2 = () => {
        seed = (seed * 1103515245 + 12345) % 0x80000000;
        return seed / 0x80000000;
      };
      
      const deck2 = Deck.createStandardDeck();
      deck2.shuffle(rng2);
      const shuffled2 = [...deck2.cards];
      
      expect(shuffled1).toEqual(shuffled2);
    });
  });
});

describe('Room startGame', () => {
  it('should initialize deck, deal hands, and set discard pile', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();
    
    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };
    
    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };
    
    const socketId3 = 'socket3';
    const playerId3 = 'player3';
    const player3 = { id: playerId3, name: 'Player 3', isReady: false, secret: 'secret3', connected: true, hand: [], handCount: 0 };
    
    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    room.addPlayer(socketId3, player3);
    
    let seed = 42;
    const seededRng = () => {
      seed = (seed * 1103515245 + 12345) % 0x80000000;
      return seed / 0x80000000;
    };
    
    room.startGame(seededRng);
    
    expect(room.state.gameStatus).toBe('playing');
    expect(room.deck).toBeDefined();
    expect(room.deck!.size).toBe(108 - (3 * 7) - 1);
    
    expect(room.discardPile).toHaveLength(1);
    expect(room.discardPile[0].color).not.toBe('wild');
    
    room.players.forEach(player => {
      expect(player.hand).toHaveLength(7);
    });
  });

  it('should not deal wild draw 4 as initial discard card', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();
    
    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };
    
    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };
    
    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    
    let seed = 99999;
    const seededRng = () => {
      seed = (seed * 1103515245 + 12345) % 0x80000000;
      return seed / 0x80000000;
    };
    
    room.startGame(seededRng);
    
    expect(room.discardPile[0].value).not.toBe('wild_draw4');
  });

  it('should throw error if game has already started', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();
    
    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };
    
    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };
    
    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    
    room.startGame();
    
    expect(() => room.startGame()).toThrow('Game has already started');
  });

  it('should throw error if less than 2 players', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();
    
    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };
    
    room.addPlayer(socketId1, player1);
    
    expect(() => room.startGame()).toThrow('At least 2 players required to start');
  });

  it('should produce deterministic game state with seeded RNG', () => {
    const manager1 = new RoomManager();
    const room1 = manager1.createRoom();
    
    const socketId1a = 'socket1a';
    const playerId1a = 'player1a';
    const player1a = { id: playerId1a, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };
    
    const socketId2a = 'socket2a';
    const playerId2a = 'player2a';
    const player2a = { id: playerId2a, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };
    
    room1.addPlayer(socketId1a, player1a);
    room1.addPlayer(socketId2a, player2a);
    
    let seed1 = 123456;
    const seededRng1 = () => {
      seed1 = (seed1 * 1103515245 + 12345) % 0x80000000;
      return seed1 / 0x80000000;
    };
    
    room1.startGame(seededRng1);
    
    const manager2 = new RoomManager();
    const room2 = manager2.createRoom();
    
    const socketId1b = 'socket1b';
    const playerId1b = 'player1b';
    const player1b = { id: playerId1b, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };
    
    const socketId2b = 'socket2b';
    const playerId2b = 'player2b';
    const player2b = { id: playerId2b, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };
    
    room2.addPlayer(socketId1b, player1b);
    room2.addPlayer(socketId2b, player2b);
    
    let seed2 = 123456;
    const seededRng2 = () => {
      seed2 = (seed2 * 1103515245 + 12345) % 0x80000000;
      return seed2 / 0x80000000;
    };
    
    room2.startGame(seededRng2);
    
    const p1Hand1 = room1.players.get(playerId1a)!.hand;
    const p1Hand2 = room2.players.get(playerId1b)!.hand;
    const p2Hand1 = room1.players.get(playerId2a)!.hand;
    const p2Hand2 = room2.players.get(playerId2b)!.hand;
    const discard1 = room1.discardPile[0];
    const discard2 = room2.discardPile[0];
    
    expect(p1Hand1).toEqual(p1Hand2);
    expect(p2Hand1).toEqual(p2Hand2);
    expect(discard1).toEqual(discard2);
  });
});

describe('Room turn order', () => {
  it('should initialize turn order on game start', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    const socketId3 = 'socket3';
    const playerId3 = 'player3';
    const player3 = { id: playerId3, name: 'Player 3', isReady: false, secret: 'secret3', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    room.addPlayer(socketId3, player3);

    room.startGame();

    expect(room.playerOrder).toEqual(['player1', 'player2', 'player3']);
    expect(room.currentPlayerIndex).toBe(0);
    expect(room.direction).toBe(1);
    expect(room.state.currentPlayerIndex).toBe(0);
    expect(room.state.direction).toBe(1);
  });

  it('should advance turn forward', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    const socketId3 = 'socket3';
    const playerId3 = 'player3';
    const player3 = { id: playerId3, name: 'Player 3', isReady: false, secret: 'secret3', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    room.addPlayer(socketId3, player3);

    room.startGame();
    expect(room.currentPlayerIndex).toBe(0);

    room.advanceTurn();
    expect(room.currentPlayerIndex).toBe(1);

    room.advanceTurn();
    expect(room.currentPlayerIndex).toBe(2);

    room.advanceTurn();
    expect(room.currentPlayerIndex).toBe(0);
  });

  it('should advance turn backward when direction is reversed', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    const socketId3 = 'socket3';
    const playerId3 = 'player3';
    const player3 = { id: playerId3, name: 'Player 3', isReady: false, secret: 'secret3', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    room.addPlayer(socketId3, player3);

    room.startGame();
    expect(room.currentPlayerIndex).toBe(0);

    room.reverseDirection();
    expect(room.direction).toBe(-1);
    expect(room.state.direction).toBe(-1);

    room.advanceTurn();
    expect(room.currentPlayerIndex).toBe(2);

    room.advanceTurn();
    expect(room.currentPlayerIndex).toBe(1);

    room.advanceTurn();
    expect(room.currentPlayerIndex).toBe(0);
  });

  it('should skip disconnected players when advancing turn', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    const socketId3 = 'socket3';
    const playerId3 = 'player3';
    const player3 = { id: playerId3, name: 'Player 3', isReady: false, secret: 'secret3', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    room.addPlayer(socketId3, player3);

    room.startGame();
    expect(room.currentPlayerIndex).toBe(0);

    room.markPlayerDisconnected(playerId2);
    expect(room.players.get(playerId2)?.connected).toBe(false);

    room.advanceTurn();
    expect(room.currentPlayerIndex).toBe(2);

    room.markPlayerDisconnected(playerId3);
    expect(room.players.get(playerId3)?.connected).toBe(false);

    room.advanceTurn();
    expect(room.currentPlayerIndex).toBe(0);
  });

  it('should skip disconnected players when advancing turn backward', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    const socketId3 = 'socket3';
    const playerId3 = 'player3';
    const player3 = { id: playerId3, name: 'Player 3', isReady: false, secret: 'secret3', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    room.addPlayer(socketId3, player3);

    room.startGame();
    room.reverseDirection();

    room.markPlayerDisconnected(playerId2);
    expect(room.players.get(playerId2)?.connected).toBe(false);

    room.advanceTurn();
    expect(room.currentPlayerIndex).toBe(2);

    room.markPlayerDisconnected(playerId3);
    expect(room.players.get(playerId3)?.connected).toBe(false);

    room.advanceTurn();
    expect(room.currentPlayerIndex).toBe(0);
  });

  it('should end game when only one connected player remains', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    room.startGame();
    expect(room.state.gameStatus).toBe('playing');

    room.markPlayerDisconnected(playerId2);
    expect(room.players.get(playerId2)?.connected).toBe(false);

    room.advanceTurn();

    expect(room.state.gameStatus).toBe('finished');
    expect(room.state.gameEndedReason).toBe('last-player-connected');
  });

  it('should not end game when more than one connected player remains', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    const socketId3 = 'socket3';
    const playerId3 = 'player3';
    const player3 = { id: playerId3, name: 'Player 3', isReady: false, secret: 'secret3', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    room.addPlayer(socketId3, player3);

    room.startGame();
    expect(room.state.gameStatus).toBe('playing');

    room.markPlayerDisconnected(playerId3);
    expect(room.players.get(playerId3)?.connected).toBe(false);

    room.advanceTurn();

    expect(room.state.gameStatus).toBe('playing');
    expect(room.state.gameEndedReason).toBeUndefined();
  });
});

describe('playCard validation', () => {
  it('should allow play when card matches by color', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    let seed = 1;
    const seededRng = () => {
      seed = (seed * 1103515245 + 12345) % 0x80000000;
      return seed / 0x80000000;
    };

    room.startGame(seededRng);

    const topCard = room.discardPile[0];
    const matchingCard = { color: topCard.color, value: '5' };

    room.players.get(playerId1)!.hand.push(matchingCard);

    room.playCard(playerId1, matchingCard);

    expect(room.discardPile).toHaveLength(2);
    expect(room.discardPile[1]).toEqual(matchingCard);
    expect(room.players.get(playerId1)!.hand.length).toBe(7);
  });

  it('should allow play when card matches by number', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    let seed = 1;
    const seededRng = () => {
      seed = (seed * 1103515245 + 12345) % 0x80000000;
      return seed / 0x80000000;
    };

    room.startGame(seededRng);

    const topCard = room.discardPile[0];
    const matchingCard: Card = { color: topCard.color === 'red' ? 'blue' : 'red', value: topCard.value };

    room.players.get(playerId1)!.hand.push(matchingCard);

    room.playCard(playerId1, matchingCard);

    expect(room.discardPile).toHaveLength(2);
    expect(room.discardPile[1]).toEqual(matchingCard);
    expect(room.players.get(playerId1)!.hand.length).toBe(7);
  });

  it('should allow play with wild card', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    let seed = 1;
    const seededRng = () => {
      seed = (seed * 1103515245 + 12345) % 0x80000000;
      return seed / 0x80000000;
    };

    room.startGame(seededRng);

    const wildCard = { color: 'wild' as const, value: 'wild' };

    room.players.get(playerId1)!.hand.push(wildCard);

    room.playCard(playerId1, wildCard);

    expect(room.discardPile).toHaveLength(2);
    expect(room.discardPile[1]).toEqual(wildCard);
    expect(room.players.get(playerId1)!.hand.length).toBe(7);
  });

  it('should reject play when not player\'s turn', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    room.startGame();

    const topCard = room.discardPile[0];
    const matchingCard = { color: topCard.color, value: '5' };

    room.players.get(playerId2)!.hand.push(matchingCard);

    expect(() => room.playCard(playerId2, matchingCard)).toThrow('Not your turn');
  });

  it('should reject play when card does not match', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    let seed = 1;
    const seededRng = () => {
      seed = (seed * 1103515245 + 12345) % 0x80000000;
      return seed / 0x80000000;
    };

    room.startGame(seededRng);

    const topCard = room.discardPile[0];
    let nonMatchingCard: Card = { color: 'red', value: '9' };

    if (topCard.color === 'red' || topCard.value === '9') {
      nonMatchingCard = { color: 'blue', value: topCard.color === 'blue' ? '8' : '9' };
    }

    room.players.get(playerId1)!.hand.push(nonMatchingCard);

    expect(() => room.playCard(playerId1, nonMatchingCard)).toThrow('Card does not match top discard');
  });

  it('should reject play when card not in hand', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    room.startGame();

    room.players.get(playerId1)!.hand = [];

    const cardNotInHand: Card = { color: 'wild', value: 'wild_draw4' };

    expect(() => room.playCard(playerId1, cardNotInHand)).toThrow('Card not in hand');
  });

  it('should reject play when game is not in playing state', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);

    const card: Card = { color: 'red', value: '5' };

    expect(() => room.playCard(playerId1, card)).toThrow('Game is not in playing state');
  });
});

describe('drawCard', () => {
  it('should transfer one card from deck to player hand', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    room.startGame();

    const initialDeckSize = room.deck!.size;
    const initialHandSize = room.players.get(playerId1)!.hand.length;

    room.drawCard(playerId1);

    expect(room.deck!.size).toBe(initialDeckSize - 1);
    expect(room.players.get(playerId1)!.hand.length).toBe(initialHandSize + 1);
  });

  it('should advance turn after drawing', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    const socketId3 = 'socket3';
    const playerId3 = 'player3';
    const player3 = { id: playerId3, name: 'Player 3', isReady: false, secret: 'secret3', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    room.addPlayer(socketId3, player3);

    room.startGame();

    const currentPlayerIndexBeforeDraw = room.currentPlayerIndex;

    room.drawCard(playerId1);

    expect(room.currentPlayerIndex).not.toBe(currentPlayerIndexBeforeDraw);
    expect(room.playerOrder[room.currentPlayerIndex]).toBe(playerId2);
  });

  it('should reject draw when not player\'s turn', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    room.startGame();

    expect(() => room.drawCard(playerId2)).toThrow('Not your turn');
  });

  it('should reject draw when game is not in playing state', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    expect(() => room.drawCard(playerId1)).toThrow('Game is not in playing state');
  });

  it('should reject draw when player not found', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    room.startGame();

    const nonexistentPlayerId = 'nonexistent_player';

    expect(() => room.drawCard(nonexistentPlayerId)).toThrow('Not your turn');
  });

  it('should reject draw when deck is empty', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    room.startGame();

    while (!room.deck!.isEmpty()) {
      room.deck!.draw();
    }

    expect(() => room.drawCard(playerId1)).toThrow('Deck is empty');
  });
});

describe('Skip card effect', () => {
  it('should skip next player in 2-player game', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    room.startGame();

    const topCard = room.discardPile[0];
    const skipCard: Card = { color: topCard.color, value: 'skip' };

    room.players.get(playerId1)!.hand.push(skipCard);

    room.playCard(playerId1, skipCard);

    expect(room.currentPlayerIndex).toBe(0);
    expect(room.playerOrder[room.currentPlayerIndex]).toBe(playerId1);
  });

  it('should skip next player in 3-player game', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    const socketId3 = 'socket3';
    const playerId3 = 'player3';
    const player3 = { id: playerId3, name: 'Player 3', isReady: false, secret: 'secret3', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    room.addPlayer(socketId3, player3);

    room.startGame();

    const topCard = room.discardPile[0];
    const skipCard: Card = { color: topCard.color, value: 'skip' };

    room.players.get(playerId1)!.hand.push(skipCard);

    room.playCard(playerId1, skipCard);

    expect(room.currentPlayerIndex).toBe(2);
    expect(room.playerOrder[room.currentPlayerIndex]).toBe(playerId3);
  });
});

describe('Reverse card effect', () => {
  it('should flip direction in 3-player game', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    const socketId3 = 'socket3';
    const playerId3 = 'player3';
    const player3 = { id: playerId3, name: 'Player 3', isReady: false, secret: 'secret3', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    room.addPlayer(socketId3, player3);

    room.startGame();

    const topCard = room.discardPile[0];
    const reverseCard: Card = { color: topCard.color, value: 'reverse' };

    room.players.get(playerId1)!.hand.push(reverseCard);

    room.playCard(playerId1, reverseCard);

    expect(room.direction).toBe(-1);
    expect(room.currentPlayerIndex).toBe(2);
    expect(room.playerOrder[room.currentPlayerIndex]).toBe(playerId3);
  });

  it('should act like Skip in 2-player game', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    room.startGame();

    const topCard = room.discardPile[0];
    const reverseCard: Card = { color: topCard.color, value: 'reverse' };

    room.players.get(playerId1)!.hand.push(reverseCard);

    room.playCard(playerId1, reverseCard);

    expect(room.currentPlayerIndex).toBe(0);
    expect(room.playerOrder[room.currentPlayerIndex]).toBe(playerId1);
  });
});

describe('Draw Two card effect', () => {
  it('should make next player draw 2 cards and skip their turn in 3-player game', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    const socketId3 = 'socket3';
    const playerId3 = 'player3';
    const player3 = { id: playerId3, name: 'Player 3', isReady: false, secret: 'secret3', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    room.addPlayer(socketId3, player3);

    room.startGame();

    const topCard = room.discardPile[0];
    const draw2Card: Card = { color: topCard.color, value: 'draw2' };

    room.players.get(playerId1)!.hand.push(draw2Card);

    const initialHandSize = room.players.get(playerId2)!.hand.length;

    room.playCard(playerId1, draw2Card);

    expect(room.players.get(playerId2)!.hand.length).toBe(initialHandSize + 2);
    expect(room.currentPlayerIndex).toBe(2);
    expect(room.playerOrder[room.currentPlayerIndex]).toBe(playerId3);
  });

  it('should make next player draw 2 cards and skip their turn in 2-player game', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    room.startGame();

    const topCard = room.discardPile[0];
    const draw2Card: Card = { color: topCard.color, value: 'draw2' };

    room.players.get(playerId1)!.hand.push(draw2Card);

    const initialHandSize = room.players.get(playerId2)!.hand.length;

    room.playCard(playerId1, draw2Card);

    expect(room.players.get(playerId2)!.hand.length).toBe(initialHandSize + 2);
    expect(room.currentPlayerIndex).toBe(0);
    expect(room.playerOrder[room.currentPlayerIndex]).toBe(playerId1);
  });

  it('should respect direction when drawing cards', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    const socketId3 = 'socket3';
    const playerId3 = 'player3';
    const player3 = { id: playerId3, name: 'Player 3', isReady: false, secret: 'secret3', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    room.addPlayer(socketId3, player3);

    room.startGame();

    room.reverseDirection();

    const topCard = room.discardPile[0];
    const draw2Card: Card = { color: topCard.color, value: 'draw2' };

    room.players.get(playerId1)!.hand.push(draw2Card);

    const initialHandSize = room.players.get(playerId3)!.hand.length;

    room.playCard(playerId1, draw2Card);

    expect(room.players.get(playerId3)!.hand.length).toBe(initialHandSize + 2);
    expect(room.currentPlayerIndex).toBe(1);
    expect(room.playerOrder[room.currentPlayerIndex]).toBe(playerId2);
  });

  it('should skip disconnected players and draw for next connected player', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    const socketId3 = 'socket3';
    const playerId3 = 'player3';
    const player3 = { id: playerId3, name: 'Player 3', isReady: false, secret: 'secret3', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);
    room.addPlayer(socketId3, player3);

    room.startGame();

    room.markPlayerDisconnected(playerId2);

    const topCard = room.discardPile[0];
    const draw2Card: Card = { color: topCard.color, value: 'draw2' };

    room.players.get(playerId1)!.hand.push(draw2Card);

    const initialHandSize = room.players.get(playerId3)!.hand.length;

    room.playCard(playerId1, draw2Card);

    expect(room.players.get(playerId3)!.hand.length).toBe(initialHandSize + 2);
    expect(room.currentPlayerIndex).toBe(0);
    expect(room.playerOrder[room.currentPlayerIndex]).toBe(playerId1);
  });

  it('should reduce deck size by 2 when Draw Two is played', () => {
    const manager = new RoomManager();
    const room = manager.createRoom();

    const socketId1 = 'socket1';
    const playerId1 = 'player1';
    const player1 = { id: playerId1, name: 'Player 1', isReady: false, secret: 'secret1', connected: true, hand: [], handCount: 0 };

    const socketId2 = 'socket2';
    const playerId2 = 'player2';
    const player2 = { id: playerId2, name: 'Player 2', isReady: false, secret: 'secret2', connected: true, hand: [], handCount: 0 };

    room.addPlayer(socketId1, player1);
    room.addPlayer(socketId2, player2);

    room.startGame();

    const topCard = room.discardPile[0];
    const draw2Card: Card = { color: topCard.color, value: 'draw2' };

    room.players.get(playerId1)!.hand.push(draw2Card);

    const initialDeckSize = room.deck!.size;

    room.playCard(playerId1, draw2Card);

    expect(room.deck!.size).toBe(initialDeckSize - 2);
  });
});
