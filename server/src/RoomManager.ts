import type { RoomState, RoomSettings, PlayerPrivate } from '@ccu/shared';
import { nanoid } from 'nanoid';

// Default room settings
export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  maxPlayers: 6,
  initialTimeMs: 60000, // 1 minute per player
  incrementMs: 5000, // 5 second increment
  deckCount: 1
};

// Short code generator: 6-8 uppercase alphanumeric chars (no ambiguous chars)
const SHORT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // excludes I, O, 0, 1
const SHORT_CODE_LENGTH = 6;

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    code += SHORT_CODE_ALPHABET[Math.floor(Math.random() * SHORT_CODE_ALPHABET.length)];
  }
  return code;
}

export function generatePlayerId(): string {
  return nanoid(12);
}

export function generatePlayerSecret(): string {
  return nanoid(24);
}

export function createNewRoom(roomCode: string, hostPlayerId: string): RoomState {
  return {
    roomCode,
    hostPlayerId,
    phase: 'lobby',
    settings: { ...DEFAULT_ROOM_SETTINGS },
    players: [],
    deck: [],
    discardPile: [],
    activeColor: null,
    turnIndex: 0,
    direction: 1,
    unoWindow: null,
    winnerId: null,
    winReason: null,
    activePlayerId: null,
    lastClockStartMs: null
  };
}

export class RoomManager {
  private rooms: Map<string, RoomState> = new Map();

  /**
   * Create a new room with a unique short code
   */
  createRoom(hostPlayerId: string): RoomState {
    // Generate unique room code
    let roomCode: string;
    do {
      roomCode = generateRoomCode();
    } while (this.rooms.has(roomCode));

    const room = createNewRoom(roomCode, hostPlayerId);
    this.rooms.set(roomCode, room);
    return room;
  }

  /**
   * Get a room by its code
   */
  getRoom(roomCode: string): RoomState | undefined {
    return this.rooms.get(roomCode);
  }

  /**
   * Check if a room exists
   */
  hasRoom(roomCode: string): boolean {
    return this.rooms.has(roomCode);
  }

  /**
   * Delete a room
   */
  deleteRoom(roomCode: string): boolean {
    return this.rooms.delete(roomCode);
  }

  /**
   * Get count of connected players in a room
   */
  getConnectedCount(room: RoomState): number {
    return room.players.filter(p => p.connected).length;
  }

  /**
   * Add a player to a room
   */
  addPlayer(roomCode: string, player: PlayerPrivate): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;
    
    if (room.players.length >= room.settings.maxPlayers) return false;
    
    room.players.push(player);
    return true;
  }

  /**
   * Mark a player as disconnected
   */
  markPlayerDisconnected(roomCode: string, playerId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.playerId === playerId);
    if (player) {
      player.connected = false;
    }
  }

  /**
   * Mark a player as connected
   */
  markPlayerConnected(roomCode: string, playerId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.playerId === playerId);
    if (player) {
      player.connected = true;
    }
  }

  /**
   * Check if room should be deleted (0 connected players)
   * and delete it if so
   */
  checkAndCleanupRoom(roomCode: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    const connectedCount = this.getConnectedCount(room);
    if (connectedCount === 0) {
      this.rooms.delete(roomCode);
      return true;
    }
    return false;
  }

  /**
   * Find a player by their secret across all rooms
   */
  findPlayerBySecret(roomCode: string, playerSecret: string): PlayerPrivate | undefined {
    const room = this.rooms.get(roomCode);
    if (!room) return undefined;

    return room.players.find(p => p.playerSecret === playerSecret);
  }

  /**
   * Get all room codes (for debugging)
   */
  getAllRoomCodes(): string[] {
    return Array.from(this.rooms.keys());
  }

  /**
   * Get room count (for debugging)
   */
  getRoomCount(): number {
    return this.rooms.size;
  }
}

// Singleton instance
export const roomManager = new RoomManager();
