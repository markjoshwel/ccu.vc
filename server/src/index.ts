import { createServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, RoomSettings, Card } from 'shared';
import { RoomManager } from './RoomManager';
import { RateLimiter } from './RateLimiter';
import { AvatarStore } from './AvatarStore';
import { createHttpHandler } from './httpHandler';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Global error handlers for production robustness
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  // Keep server running but log the error
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

const avatarStore = new AvatarStore();
const roomManager = new RoomManager();

const httpHandler = createHttpHandler({ 
  avatarStore,
  getStats: () => ({
    rooms: roomManager.roomCount,
    players: roomManager.connectedPlayerCount,
    avatars: avatarStore.size
  })
});

const httpServer = createServer(httpHandler);

const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const socketRoomMap = new Map<string, string>();
const socketPlayerMap = new Map<string, { playerId: string; playerSecret: string; avatarId?: string }>();

// Rate limiters per socket for different action types
const socketRateLimiters = new Map<string, {
  chat: RateLimiter;
  action: RateLimiter;  // For game actions (playCard, drawCard, etc.)
  room: RateLimiter;    // For room actions (create, join)
}>();

function getOrCreateRateLimiters(socketId: string) {
  let limiters = socketRateLimiters.get(socketId);
  if (!limiters) {
    limiters = {
      chat: new RateLimiter(3, 1),      // 3 messages per second
      action: new RateLimiter(10, 1),   // 10 actions per second
      room: new RateLimiter(2, 5),      // 2 room actions per 5 seconds
    };
    socketRateLimiters.set(socketId, limiters);
  }
  return limiters;
}

// Input validation helpers
function isValidRoomCode(code: unknown): code is string {
  return typeof code === 'string' && /^[A-Z0-9]{6}$/.test(code);
}

function isValidCard(card: unknown): card is Card {
  if (typeof card !== 'object' || card === null) return false;
  const c = card as Record<string, unknown>;
  if (typeof c.color !== 'string' || typeof c.value !== 'string') return false;
  if (!['red', 'yellow', 'green', 'blue', 'wild'].includes(c.color)) return false;
  const validValues = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'reverse', 'draw2', 'wild', 'wild_draw4'];
  if (!validValues.includes(c.value)) return false;
  return true;
}

function isValidColor(color: unknown): color is 'red' | 'yellow' | 'green' | 'blue' | null {
  return color === null || ['red', 'yellow', 'green', 'blue'].includes(color as string);
}

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
  
  // Initialize rate limiters for this socket
  getOrCreateRateLimiters(socket.id);
  
  socket.on('create_room', (actionId: string, settings: Partial<RoomSettings> | null, callback: (response: { roomCode: string }) => void) => {
    const limiters = getOrCreateRateLimiters(socket.id);
    if (!limiters.room.tryConsume()) {
      socket.emit('actionAck', { actionId, ok: false });
      socket.emit('error', 'Rate limit exceeded. Please wait before creating another room.');
      return;
    }
    
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

    // Rate limiting
    const limiters = getOrCreateRateLimiters(socket.id);
    if (!limiters.room.tryConsume()) {
      socket.emit('actionAck', { actionId, ok: false });
      callback({ error: 'Rate limit exceeded. Please wait before joining.' });
      return;
    }

    // Validate room code format
    if (!isValidRoomCode(roomCode)) {
      socket.emit('actionAck', { actionId, ok: false });
      callback({ error: 'Invalid room code format' });
      return;
    }

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

  socket.on('update_room_settings', (actionId: string, settings: Partial<RoomSettings>, callback: (response: { success: boolean; error?: string }) => void) => {
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

    // Only host can update settings
    const players = room.state.players;
    if (players.length === 0 || players[0].id !== playerData.playerId) {
      socket.emit('actionAck', { actionId, ok: false });
      callback({ success: false, error: 'Only the host can update room settings' });
      return;
    }

    // Only allow settings changes in 'waiting' state
    if (room.state.gameStatus !== 'waiting') {
      socket.emit('actionAck', { actionId, ok: false });
      callback({ success: false, error: 'Can only update settings when game is not playing' });
      return;
    }

    // Validate and apply settings
    const sanitizedSettings: Partial<RoomSettings> = {};

    if (typeof settings.maxPlayers === 'number') {
      sanitizedSettings.maxPlayers = Math.min(10, Math.max(2, Math.floor(settings.maxPlayers)));
    }
    if (typeof settings.aiPlayerCount === 'number') {
      sanitizedSettings.aiPlayerCount = Math.min(9, Math.max(0, Math.floor(settings.aiPlayerCount)));
    }
    if (typeof settings.timePerTurnMs === 'number') {
      sanitizedSettings.timePerTurnMs = Math.min(300000, Math.max(10000, Math.floor(settings.timePerTurnMs)));
    }
    if (settings.stackingMode !== undefined) {
      sanitizedSettings.stackingMode = settings.stackingMode;
    }
    if (settings.jumpInMode !== undefined) {
      sanitizedSettings.jumpInMode = settings.jumpInMode;
    }
    if (settings.drawMode !== undefined) {
      sanitizedSettings.drawMode = settings.drawMode;
    }

    // Update room settings
    room.updateSettings(sanitizedSettings);

    // Broadcast updated room state to all players
    io.to(roomCode).emit('roomUpdated', room.state);

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
    // Rate limiting
    const limiters = getOrCreateRateLimiters(socket.id);
    if (!limiters.action.tryConsume()) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Rate limit exceeded' });
      return;
    }

    // Validate card object
    if (!isValidCard(card)) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Invalid card' });
      return;
    }

    // Validate color choice
    if (!isValidColor(chosenColor)) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Invalid color choice' });
      return;
    }

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
    // Rate limiting
    const limiters = getOrCreateRateLimiters(socket.id);
    if (!limiters.action.tryConsume()) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Rate limit exceeded' });
      return;
    }

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
    // Rate limiting
    const limiters = getOrCreateRateLimiters(socket.id);
    if (!limiters.action.tryConsume()) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Rate limit exceeded' });
      return;
    }

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
    // Rate limiting
    const limiters = getOrCreateRateLimiters(socket.id);
    if (!limiters.action.tryConsume()) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Rate limit exceeded' });
      return;
    }

    // Validate targetPlayerId
    if (typeof targetPlayerId !== 'string' || targetPlayerId.length === 0) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Invalid target player' });
      return;
    }

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
    
    // Validate message
    if (typeof message !== 'string' || message.length === 0) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Invalid message' });
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
    
    // Rate limiting using socket-based limiter
    const limiters = getOrCreateRateLimiters(socket.id);
    if (!limiters.chat.tryConsume()) {
      socket.emit('actionAck', { actionId, ok: false });
      callback?.({ success: false, error: 'Rate limit exceeded' });
      return;
    }
    
    const playerId = playerData.playerId;
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
    
    // Clean up rate limiters for this socket
    socketRateLimiters.delete(socket.id);
    
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
    } else {
      // Clean up socket maps even if not in a room
      socketPlayerMap.delete(socket.id);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Graceful shutdown handling
function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Starting graceful shutdown...`);
  
  // Stop accepting new connections
  httpServer.close((err) => {
    if (err) {
      console.error('Error closing HTTP server:', err);
    } else {
      console.log('HTTP server closed');
    }
  });
  
  // Stop room cleanup interval
  roomManager.stopCleanupInterval();
  console.log('Room cleanup interval stopped');
  
  // Disconnect all sockets gracefully
  io.sockets.sockets.forEach((socket) => {
    socket.disconnect(true);
  });
  console.log('All sockets disconnected');
  
  // Close Socket.IO server
  io.close((err) => {
    if (err) {
      console.error('Error closing Socket.IO server:', err);
    } else {
      console.log('Socket.IO server closed');
    }
    
    console.log('Graceful shutdown complete');
    process.exit(0);
  });
  
  // Force exit after 10 seconds if graceful shutdown fails
  setTimeout(() => {
    console.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
