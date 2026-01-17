import type { Socket, Server as SocketIOServer } from 'socket.io';
import type { 
  ClientToServerEvents, 
  ServerToClientEvents,
  CreateRoomPayload,
  CreateRoomResponse,
  JoinRoomPayload,
  JoinRoomResponse,
  PlayerPrivate,
  PlayCardPayload,
  DrawCardPayload,
  ActionPayload,
  ClockSync,
  SendChatPayload,
  ChatMessage
} from '@ccu/shared';
import { RoomManager, roomManager as defaultRoomManager, generatePlayerId, generatePlayerSecret } from './RoomManager';
import { toGameView } from './gameView';
import { startGame, playCard, drawCard, callUno, catchUno } from './gameEngine';
import { startClockSync, stopClockSync, handleTimeout, applyIncrement } from './clock';

// Chat rate limiting: max messages per interval
const CHAT_RATE_LIMIT = 10; // messages
const CHAT_RATE_INTERVAL = 10000; // 10 seconds
const MAX_MESSAGE_LENGTH = 200;
const chatRateLimits = new Map<string, { count: number; resetTime: number }>();

function checkChatRateLimit(socketId: string): boolean {
  const now = Date.now();
  const limit = chatRateLimits.get(socketId);
  
  if (!limit || now > limit.resetTime) {
    chatRateLimits.set(socketId, { count: 1, resetTime: now + CHAT_RATE_INTERVAL });
    return true;
  }
  
  if (limit.count >= CHAT_RATE_LIMIT) {
    return false;
  }
  
  limit.count++;
  return true;
}

// Store chat history per room (limited to last 50 messages)
const roomChatHistory = new Map<string, ChatMessage[]>();

function addChatMessage(roomCode: string, message: ChatMessage): void {
  let history = roomChatHistory.get(roomCode);
  if (!history) {
    history = [];
    roomChatHistory.set(roomCode, history);
  }
  history.push(message);
  // Keep only last 50 messages
  if (history.length > 50) {
    history.shift();
  }
}

function getChatHistory(roomCode: string): ChatMessage[] {
  return roomChatHistory.get(roomCode) || [];
}

// Validate display name: 1-24 chars after trimming, no control characters
function validateDisplayName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length < 1) {
    return { valid: false, error: 'Display name is required' };
  }
  if (trimmed.length > 24) {
    return { valid: false, error: 'Display name must be 24 characters or less' };
  }
  // Check for control characters
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return { valid: false, error: 'Display name contains invalid characters' };
  }
  return { valid: true };
}

export function setupSocketHandlers(
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>,
  roomManagerInstance: RoomManager = defaultRoomManager
) {
  // Track which room each socket is in (scoped to this setup)
  const socketRoomMap = new Map<string, { roomCode: string; playerId: string }>();
  
  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    console.log(`Client connected: ${socket.id}`);

    // Create room handler
    socket.on('createRoom', (payload: CreateRoomPayload, callback) => {
      // Validate display name
      const validation = validateDisplayName(payload.displayName);
      if (!validation.valid) {
        callback({ error: validation.error || 'Invalid display name' });
        return;
      }

      // Generate player credentials
      const playerId = generatePlayerId();
      const playerSecret = generatePlayerSecret();

      // Create room with this player as host
      const room = roomManagerInstance.createRoom(playerId);

      // Create player object
      const player: PlayerPrivate = {
        playerId,
        playerSecret,
        displayName: payload.displayName.trim(),
        connected: true,
        handCount: 0,
        hand: [],
        timeRemainingMs: room.settings.initialTimeMs,
        avatarId: payload.avatarId
      };

      // Add player to room
      roomManagerInstance.addPlayer(room.roomCode, player);

      // Join socket.io room
      socket.join(room.roomCode);
      socketRoomMap.set(socket.id, { roomCode: room.roomCode, playerId });

      // Send response
      const response: CreateRoomResponse = {
        roomCode: room.roomCode,
        playerId,
        playerSecret
      };
      callback(response);

      // Broadcast initial game state
      const view = toGameView(room, playerId);
      socket.emit('gameStateUpdate', view);

      console.log(`Room ${room.roomCode} created by ${player.displayName} (${playerId})`);
    });

    // Join room handler
    socket.on('joinRoom', (payload: JoinRoomPayload, callback) => {
      // Validate display name
      const validation = validateDisplayName(payload.displayName);
      if (!validation.valid) {
        callback({ error: validation.error || 'Invalid display name' });
        return;
      }

      // Check if room exists
      const room = roomManagerInstance.getRoom(payload.roomCode);
      if (!room) {
        callback({ error: 'Room not found' });
        return;
      }

      // Check if reconnecting with playerSecret
      if (payload.playerSecret) {
        const existingPlayer = roomManagerInstance.findPlayerBySecret(payload.roomCode, payload.playerSecret);
        if (existingPlayer) {
          // Reconnect: mark player as connected
          roomManagerInstance.markPlayerConnected(payload.roomCode, existingPlayer.playerId);
          
          // Join socket.io room
          socket.join(payload.roomCode);
          socketRoomMap.set(socket.id, { roomCode: payload.roomCode, playerId: existingPlayer.playerId });

          // Send response
          const response: JoinRoomResponse = {
            playerId: existingPlayer.playerId,
            playerSecret: existingPlayer.playerSecret
          };
          callback(response);

          // Notify others
          socket.to(payload.roomCode).emit('playerReconnected', existingPlayer.playerId);

          // Broadcast updated game state to all
          broadcastGameState(io, room);

          console.log(`Player ${existingPlayer.displayName} (${existingPlayer.playerId}) reconnected to room ${payload.roomCode}`);
          return;
        }
        // Invalid secret - don't allow hijacking, continue as new player
      }

      // Check if room is full
      if (room.players.length >= room.settings.maxPlayers) {
        callback({ error: 'Room is full' });
        return;
      }

      // Check if game already started
      if (room.phase !== 'lobby') {
        callback({ error: 'Game has already started' });
        return;
      }

      // Generate player credentials for new player
      const playerId = generatePlayerId();
      const playerSecret = generatePlayerSecret();

      // Create player object
      const player: PlayerPrivate = {
        playerId,
        playerSecret,
        displayName: payload.displayName.trim(),
        connected: true,
        handCount: 0,
        hand: [],
        timeRemainingMs: room.settings.initialTimeMs,
        avatarId: payload.avatarId
      };

      // Add player to room
      roomManagerInstance.addPlayer(payload.roomCode, player);

      // Join socket.io room
      socket.join(payload.roomCode);
      socketRoomMap.set(socket.id, { roomCode: payload.roomCode, playerId });

      // Send response
      const response: JoinRoomResponse = {
        playerId,
        playerSecret
      };
      callback(response);

      // Send chat history to the joining player
      const history = getChatHistory(payload.roomCode);
      if (history.length > 0) {
        socket.emit('chatHistory', history);
      }

      // Notify others
      socket.to(payload.roomCode).emit('playerJoined', {
        playerId,
        displayName: player.displayName,
        connected: true,
        handCount: 0,
        timeRemainingMs: player.timeRemainingMs,
        avatarId: player.avatarId
      });

      // Broadcast updated game state to all
      broadcastGameState(io, room);

      console.log(`Player ${player.displayName} (${playerId}) joined room ${payload.roomCode}`);
    });

    // Start game handler
    socket.on('startGame', (payload: ActionPayload, callback) => {
      const info = socketRoomMap.get(socket.id);
      if (!info) {
        callback({ actionId: payload.actionId, ok: false, errorCode: 'NOT_IN_ROOM' });
        return;
      }

      const room = roomManagerInstance.getRoom(info.roomCode);
      if (!room) {
        callback({ actionId: payload.actionId, ok: false, errorCode: 'ROOM_NOT_FOUND' });
        return;
      }

      // Only host can start game
      if (room.hostPlayerId !== info.playerId) {
        callback({ actionId: payload.actionId, ok: false, errorCode: 'NOT_HOST' });
        return;
      }

      try {
        startGame(room);
        callback({ actionId: payload.actionId, ok: true });
        broadcastGameState(io, room);
        
        // Start clock sync
        startClockSync(
          room,
          (sync: ClockSync) => io.to(room.roomCode).emit('clockSync', sync),
          (playerId: string) => {
            const result = handleTimeout(room, playerId);
            if (result.ok) {
              io.to(room.roomCode).emit('timeOut', { playerId, policy: 'autoDrawAndSkip' });
              broadcastGameState(io, room);
            }
          }
        );
        
        console.log(`Game started in room ${info.roomCode}`);
      } catch (error) {
        callback({ 
          actionId: payload.actionId, 
          ok: false, 
          errorCode: error instanceof Error ? error.message : 'START_FAILED' 
        });
      }
    });

    // Play card handler
    socket.on('playCard', (payload: PlayCardPayload, callback) => {
      const info = socketRoomMap.get(socket.id);
      if (!info) {
        callback({ actionId: payload.actionId, ok: false, errorCode: 'NOT_IN_ROOM' });
        return;
      }

      const room = roomManagerInstance.getRoom(info.roomCode);
      if (!room) {
        callback({ actionId: payload.actionId, ok: false, errorCode: 'ROOM_NOT_FOUND' });
        return;
      }

      // Apply time increment before action (for player who just played)
      const previousPlayer = info.playerId;
      
      const result = playCard(room, info.playerId, payload.cardId, payload.chosenColor);
      callback({ actionId: payload.actionId, ok: result.ok, errorCode: result.errorCode });
      
      if (result.ok) {
        // Apply time increment to the player who just played
        applyIncrement(room, previousPlayer);
        broadcastGameState(io, room);
      }
    });

    // Draw card handler
    socket.on('drawCard', (payload: DrawCardPayload, callback) => {
      const info = socketRoomMap.get(socket.id);
      if (!info) {
        callback({ actionId: payload.actionId, ok: false, errorCode: 'NOT_IN_ROOM' });
        return;
      }

      const room = roomManagerInstance.getRoom(info.roomCode);
      if (!room) {
        callback({ actionId: payload.actionId, ok: false, errorCode: 'ROOM_NOT_FOUND' });
        return;
      }

      // Apply time increment before action (for player who just drew)
      const previousPlayer = info.playerId;
      
      const result = drawCard(room, info.playerId);
      callback({ actionId: payload.actionId, ok: result.ok, errorCode: result.errorCode });
      
      if (result.ok) {
        // Apply time increment to the player who just drew
        applyIncrement(room, previousPlayer);
        broadcastGameState(io, room);
      }
    });

    // Call UNO handler
    socket.on('callUno', (payload: ActionPayload, callback) => {
      const info = socketRoomMap.get(socket.id);
      if (!info) {
        callback({ actionId: payload.actionId, ok: false, errorCode: 'NOT_IN_ROOM' });
        return;
      }

      const room = roomManagerInstance.getRoom(info.roomCode);
      if (!room) {
        callback({ actionId: payload.actionId, ok: false, errorCode: 'ROOM_NOT_FOUND' });
        return;
      }

      const result = callUno(room, info.playerId);
      callback({ actionId: payload.actionId, ok: result.ok, errorCode: result.errorCode });
      
      if (result.ok) {
        io.to(room.roomCode).emit('unoCalled', { playerId: info.playerId });
        broadcastGameState(io, room);
      }
    });

    // Catch UNO handler
    socket.on('catchUno', (payload: ActionPayload, callback) => {
      const info = socketRoomMap.get(socket.id);
      if (!info) {
        callback({ actionId: payload.actionId, ok: false, errorCode: 'NOT_IN_ROOM' });
        return;
      }

      const room = roomManagerInstance.getRoom(info.roomCode);
      if (!room) {
        callback({ actionId: payload.actionId, ok: false, errorCode: 'ROOM_NOT_FOUND' });
        return;
      }

      const result = catchUno(room, info.playerId);
      callback({ actionId: payload.actionId, ok: result.ok, errorCode: result.errorCode });
      
      if (result.ok && result.caughtPlayerId) {
        io.to(room.roomCode).emit('unoCaught', { 
          catcherId: info.playerId, 
          caughtPlayerId: result.caughtPlayerId 
        });
        broadcastGameState(io, room);
      }
    });

    // Send chat message handler
    socket.on('sendChat', (payload: SendChatPayload) => {
      const info = socketRoomMap.get(socket.id);
      if (!info) return;

      const room = roomManagerInstance.getRoom(info.roomCode);
      if (!room) return;

      // Rate limiting
      if (!checkChatRateLimit(socket.id)) {
        socket.emit('error', 'Too many messages. Please slow down.');
        return;
      }

      // Validate message
      const message = payload.message.trim();
      if (message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
        return;
      }

      // Find player display name
      const player = room.players.find(p => p.playerId === info.playerId);
      if (!player) return;

      const chatMessage: ChatMessage = {
        playerId: info.playerId,
        displayName: player.displayName,
        message,
        timestamp: Date.now()
      };

      // Store in history
      addChatMessage(info.roomCode, chatMessage);

      // Broadcast to room
      io.to(info.roomCode).emit('chatMessage', chatMessage);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      const info = socketRoomMap.get(socket.id);
      if (info) {
        const { roomCode, playerId } = info;
        const room = roomManagerInstance.getRoom(roomCode);
        
        if (room) {
          // Mark player as disconnected
          roomManagerInstance.markPlayerDisconnected(roomCode, playerId);
          
          // Notify others
          socket.to(roomCode).emit('playerLeft', playerId);

          // Check if room should be deleted
          if (roomManagerInstance.checkAndCleanupRoom(roomCode)) {
            // Stop clock and delete room
            stopClockSync(roomCode);
            console.log(`Room ${roomCode} deleted (no connected players)`);
          } else {
            // Broadcast updated game state
            broadcastGameState(io, room);
          }
        }

        socketRoomMap.delete(socket.id);
      }

      console.log(`Client disconnected: ${socket.id}`);
    });
  });
}

// Helper to broadcast game state to all players in a room
function broadcastGameState(io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>, room: any) {
  for (const player of room.players) {
    const view = toGameView(room, player.playerId);
    io.to(room.roomCode).emit('gameStateUpdate', view);
  }
}
