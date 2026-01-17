import type { Socket, Server as SocketIOServer } from 'socket.io';
import type { 
  ClientToServerEvents, 
  ServerToClientEvents,
  CreateRoomPayload,
  CreateRoomResponse,
  JoinRoomPayload,
  JoinRoomResponse,
  PlayerPrivate
} from '@ccu/shared';
import { roomManager, generatePlayerId, generatePlayerSecret } from './RoomManager';
import { toGameView } from './gameView';

// Track which room each socket is in
const socketRoomMap = new Map<string, { roomCode: string; playerId: string }>();

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

export function setupSocketHandlers(io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>) {
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
      const room = roomManager.createRoom(playerId);

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
      roomManager.addPlayer(room.roomCode, player);

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
      const room = roomManager.getRoom(payload.roomCode);
      if (!room) {
        callback({ error: 'Room not found' });
        return;
      }

      // Check if reconnecting with playerSecret
      if (payload.playerSecret) {
        const existingPlayer = roomManager.findPlayerBySecret(payload.roomCode, payload.playerSecret);
        if (existingPlayer) {
          // Reconnect: mark player as connected
          roomManager.markPlayerConnected(payload.roomCode, existingPlayer.playerId);
          
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
      roomManager.addPlayer(payload.roomCode, player);

      // Join socket.io room
      socket.join(payload.roomCode);
      socketRoomMap.set(socket.id, { roomCode: payload.roomCode, playerId });

      // Send response
      const response: JoinRoomResponse = {
        playerId,
        playerSecret
      };
      callback(response);

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

    // Handle disconnect
    socket.on('disconnect', () => {
      const info = socketRoomMap.get(socket.id);
      if (info) {
        const { roomCode, playerId } = info;
        const room = roomManager.getRoom(roomCode);
        
        if (room) {
          // Mark player as disconnected
          roomManager.markPlayerDisconnected(roomCode, playerId);
          
          // Notify others
          socket.to(roomCode).emit('playerLeft', playerId);

          // Check if room should be deleted
          if (roomManager.checkAndCleanupRoom(roomCode)) {
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

export { socketRoomMap };
