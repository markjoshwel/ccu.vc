import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, RoomSettings } from 'shared';
import { RoomManager } from './RoomManager';
import { RateLimiter } from './RateLimiter';
import { AvatarStore } from './AvatarStore';
import { createHttpHandler } from './httpHandler';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const avatarStore = new AvatarStore();
const httpHandler = createHttpHandler({ avatarStore });

const httpServer = createServer(httpHandler);

const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager();

const socketRoomMap = new Map<string, string>();
const socketPlayerMap = new Map<string, { playerId: string; playerSecret: string; avatarId?: string }>();
const playerRateLimiters = new Map<string, RateLimiter>();

function broadcastGameStateUpdate(roomCode: string): void {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;

  room.players.forEach((player, playerId) => {
    const socketId = room.playerSocketMap.get(playerId);
    if (socketId && player.connected) {
      const gameView = room.toGameView(playerId);
      io.to(socketId).emit('gameStateUpdate', gameView);
    }
  });
}

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
  
  socket.on('create_room', (actionId: string, settings: Partial<RoomSettings> | null, callback: (response: { roomCode: string }) => void) => {
    // Validate and sanitize settings
    const sanitizedSettings: Partial<RoomSettings> = {};
    if (settings) {
      if (typeof settings.maxPlayers === 'number') {
        sanitizedSettings.maxPlayers = Math.min(10, Math.max(2, Math.floor(settings.maxPlayers)));
      }
      if (typeof settings.aiPlayerCount === 'number') {
        sanitizedSettings.aiPlayerCount = Math.min(9, Math.max(0, Math.floor(settings.aiPlayerCount)));
      }
      if (typeof settings.timePerTurnMs === 'number') {
        sanitizedSettings.timePerTurnMs = Math.min(300000, Math.max(10000, Math.floor(settings.timePerTurnMs)));
      }
    }
    
    const room = roomManager.createRoom(sanitizedSettings);
    socket.emit('actionAck', { actionId, ok: true });
    callback({ roomCode: room.code });
  });
  
  socket.on('join_room', (...args) => {
    const [actionId, roomCode, displayName, maybeAvatarOrCallback, maybeCallback] = args as Parameters<ClientToServerEvents['join_room']>;

    const avatarId = typeof maybeAvatarOrCallback === 'function' ? undefined : maybeAvatarOrCallback ?? undefined;
    const callback = (typeof maybeAvatarOrCallback === 'function'
      ? maybeAvatarOrCallback
      : maybeCallback) as (response: { playerId: string; playerSecret: string } | { error: string }) => void;

    const validation = validateDisplayName(displayName);
    
    if (!validation.valid) {
      socket.emit('actionAck', { actionId, ok: false });
      callback({ error: validation.error || 'Invalid display name' });
      return;
    }
    
    const room = roomManager.getRoom(roomCode);
    
    if (!room) {
      socket.emit('actionAck', { actionId, ok: false });
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
      handCount: 0,
      avatarId: avatarId ?? undefined
    };
    
    roomManager.handlePlayerConnection(roomCode, socket.id, player);
    socketRoomMap.set(socket.id, roomCode);
    socketPlayerMap.set(socket.id, { playerId, playerSecret });

    room.onClockSync = (data) => {
      io.to(roomCode).emit('clockSync', data);
    };

    room.onTimeOut = (data) => {
      io.to(roomCode).emit('timeOut', data);
      io.to(roomCode).emit('roomUpdated', room.state);
      broadcastGameStateUpdate(roomCode);
    };

    room.onAIMove = () => {
      io.to(roomCode).emit('roomUpdated', room.state);
      broadcastGameStateUpdate(roomCode);
    };

    socket.join(roomCode);
    
    io.to(roomCode).emit('roomUpdated', room.state);
    const playerPublic = { id: player.id, name: player.name, isReady: player.isReady, connected: player.connected, handCount: player.hand.length, avatarId: player.avatarId };
    io.to(roomCode).emit('playerJoined', playerPublic as any);
    
    // Send chat history to the newly joined player
    socket.emit('chatHistory', room.getChatHistory());
    
    broadcastGameStateUpdate(roomCode);
    
    socket.emit('actionAck', { actionId, ok: true });
    callback({ playerId, playerSecret });
  });
  
  socket.on('reconnect_room', (actionId: string, roomCode: string, playerId: string, playerSecret: string, callback: (response: { success: boolean; error?: string }) => void) => {
    const room = roomManager.handlePlayerReconnection(roomCode, socket.id, playerId, playerSecret);
    
    if (!room) {
      socket.emit('actionAck', { actionId, ok: false });
      callback({ success: false, error: 'Reconnection failed' });
      return;
    }
    
    socketRoomMap.set(socket.id, roomCode);
    socketPlayerMap.set(socket.id, { playerId, playerSecret });

    room.onClockSync = (data) => {
      io.to(roomCode).emit('clockSync', data);
    };

    room.onTimeOut = (data) => {
      io.to(roomCode).emit('timeOut', data);
      io.to(roomCode).emit('roomUpdated', room.state);
      broadcastGameStateUpdate(roomCode);
    };

    room.onAIMove = () => {
      io.to(roomCode).emit('roomUpdated', room.state);
      broadcastGameStateUpdate(roomCode);
    };

    io.to(roomCode).emit('roomUpdated', room.state);
    socket.join(roomCode);
    
    // Send chat history to the reconnecting player
    socket.emit('chatHistory', room.getChatHistory());
    
    broadcastGameStateUpdate(roomCode);
    
    socket.emit('actionAck', { actionId, ok: true });
    callback({ success: true });
  });
  
  socket.on('start_game', (actionId: string, callback: (response: { success: boolean; error?: string }) => void) => {
    const roomCode = socketRoomMap.get(socket.id);
    
    if (!roomCode) {
      socket.emit('actionAck', { actionId, ok: false });
      callback({ success: false, error: 'Not in a room' });
      return;
    }
    
    const room = roomManager.getRoom(roomCode);
    
    if (!room) {
      socket.emit('actionAck', { actionId, ok: false });
      callback({ success: false, error: 'Room not found' });
      return;
    }
    
    const playerData = socketPlayerMap.get(socket.id);
    if (!playerData) {
      socket.emit('actionAck', { actionId, ok: false });
      callback({ success: false, error: 'Player not found' });
      return;
    }
    
    const firstPlayerId = Array.from(room.players.keys())[0];
    if (playerData.playerId !== firstPlayerId) {
      socket.emit('actionAck', { actionId, ok: false });
      callback({ success: false, error: 'Only the host can start the game' });
      return;
    }
    
    try {
      room.startGame();
      io.to(roomCode).emit('roomUpdated', room.state);
      io.to(roomCode).emit('gameStarted');
      broadcastGameStateUpdate(roomCode);
      socket.emit('actionAck', { actionId, ok: true });
      callback({ success: true });
    } catch (error) {
      socket.emit('actionAck', { actionId, ok: false });
      callback({ success: false, error: (error as Error).message });
    }
  });

  socket.on('playCard', (actionId: string, card: any, chosenColor: 'red' | 'yellow' | 'green' | 'blue' | null, callback?: (response: { success: boolean; error?: string }) => void) => {
    const roomCode = socketRoomMap.get(socket.id);
    
    if (!roomCode) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Not in a room' });
      return;
    }
    
    const room = roomManager.getRoom(roomCode);
    
    if (!room) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Room not found' });
      return;
    }
    
    const playerData = socketPlayerMap.get(socket.id);
    if (!playerData) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Player not found' });
      return;
    }
    
    try {
      room.playCard(playerData.playerId, card, chosenColor ?? undefined);
      io.to(roomCode).emit('roomUpdated', room.state);
      broadcastGameStateUpdate(roomCode);
      socket.emit('actionAck', { actionId, ok: true });
      callback?.({ success: true });
    } catch (error) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: (error as Error).message });
    }
  });

  socket.on('drawCard', (actionId: string, callback?: (response: { success: boolean; error?: string }) => void) => {
    const roomCode = socketRoomMap.get(socket.id);
    
    if (!roomCode) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Not in a room' });
      return;
    }
    
    const room = roomManager.getRoom(roomCode);
    
    if (!room) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Room not found' });
      return;
    }
    
    const playerData = socketPlayerMap.get(socket.id);
    if (!playerData) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Player not found' });
      return;
    }
    
    try {
      room.drawCard(playerData.playerId);
      io.to(roomCode).emit('roomUpdated', room.state);
      broadcastGameStateUpdate(roomCode);
      socket.emit('actionAck', { actionId, ok: true });
      callback?.({ success: true });
    } catch (error) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: (error as Error).message });
    }
  });

  socket.on('callUno', (actionId: string, callback?: (response: { success: boolean; error?: string }) => void) => {
    const roomCode = socketRoomMap.get(socket.id);
    
    if (!roomCode) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Not in a room' });
      return;
    }
    
    const room = roomManager.getRoom(roomCode);
    
    if (!room) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Room not found' });
      return;
    }
    
    const playerData = socketPlayerMap.get(socket.id);
    if (!playerData) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Player not found' });
      return;
    }
    
    try {
      room.callUno(playerData.playerId);
      io.to(roomCode).emit('roomUpdated', room.state);
      broadcastGameStateUpdate(roomCode);
      socket.emit('actionAck', { actionId, ok: true });
      callback?.({ success: true });
    } catch (error) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: (error as Error).message });
    }
  });

  socket.on('catchUno', (actionId: string, targetPlayerId: string, callback?: (response: { success: boolean; error?: string }) => void) => {
    const roomCode = socketRoomMap.get(socket.id);
    
    if (!roomCode) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Not in a room' });
      return;
    }
    
    const room = roomManager.getRoom(roomCode);
    
    if (!room) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Room not found' });
      return;
    }
    
    const playerData = socketPlayerMap.get(socket.id);
    if (!playerData) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Player not found' });
      return;
    }
    
    try {
      room.catchUno(playerData.playerId, targetPlayerId);
      io.to(roomCode).emit('roomUpdated', room.state);
      broadcastGameStateUpdate(roomCode);
      socket.emit('actionAck', { actionId, ok: true });
      callback?.({ success: true });
    } catch (error) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: (error as Error).message });
    }
  });

  socket.on('sendChat', (actionId: string, message: string, callback?: (response: { success: boolean; error?: string }) => void) => {
    const roomCode = socketRoomMap.get(socket.id);
    
    if (!roomCode) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Not in a room' });
      return;
    }
    
    if (message.length > 280) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Message exceeds 280 characters' });
      return;
    }
    
    const playerData = socketPlayerMap.get(socket.id);
    if (!playerData) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Player not found' });
      return;
    }
    
    const playerId = playerData.playerId;
    
    let rateLimiter = playerRateLimiters.get(playerId);
    if (!rateLimiter) {
      rateLimiter = new RateLimiter(3, 1);
      playerRateLimiters.set(playerId, rateLimiter);
    }
    
    if (!rateLimiter.tryConsume()) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Rate limit exceeded' });
      return;
    }
    
    const room = roomManager.getRoom(roomCode);
    const player = room?.players.get(playerId);
    
    if (!room || !player) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Room or player not found' });
      return;
    }
    
    const chatMessage = {
      playerId,
      playerName: player.name,
      message,
      timestamp: Date.now()
    };
    
    // Store in chat history
    room.addChatMessage(chatMessage);
    
    io.to(roomCode).emit('chatMessage', chatMessage);
    socket.emit('actionAck', { actionId, ok: true });
    callback?.({ success: true });
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
        broadcastGameStateUpdate(roomId);
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
        if (room.connectedPlayerCount === 0) {
          room.onClockSync = undefined;
        }
        io.to(roomId).emit('roomUpdated', room.state);
        broadcastGameStateUpdate(roomId);
      } else {
        // Room was deleted - clean up avatars
        avatarStore.deleteByRoom(roomId);
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
