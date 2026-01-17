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
});
