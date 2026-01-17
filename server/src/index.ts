import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from 'shared';
import { RoomManager } from './RoomManager';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const httpServer = createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager();

const socketRoomMap = new Map<string, string>();
const socketPlayerMap = new Map<string, { playerId: string; playerSecret: string }>();

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

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
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
      connected: true
    };
    
    roomManager.handlePlayerConnection(roomCode, socket.id, player);
    socketRoomMap.set(socket.id, roomCode);
    socketPlayerMap.set(socket.id, { playerId, playerSecret });
    io.to(roomCode).emit('roomUpdated', room.state);
    const playerPublic = { id: player.id, name: player.name, isReady: player.isReady, connected: player.connected };
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

  socket.on('leaveRoom', () => {
    const roomId = socketRoomMap.get(socket.id);
    if (roomId) {
      const room = roomManager.handlePlayerDisconnection(roomId, socket.id, socket.id);
      socketRoomMap.delete(socket.id);
      socket.leave(roomId);
      if (room) {
        io.to(roomId).emit('roomUpdated', room.state);
        io.to(roomId).emit('playerLeft', socket.id);
      }
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
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

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
