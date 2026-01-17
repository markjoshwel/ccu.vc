import type { RoomState, PlayerPublic, PlayerPrivate, Card, GameView } from 'shared';

type RoomCode = string;

type StoredPlayer = PlayerPublic & { secret: string; connected: boolean; hand: Card[] };

export class Room {
  code: RoomCode;
  connectedPlayerIds: Set<string>;
  playerSocketMap: Map<string, string>;
  players: Map<string, StoredPlayer>;
  state: RoomState;

  constructor(code: RoomCode) {
    this.code = code;
    this.connectedPlayerIds = new Set();
    this.playerSocketMap = new Map();
    this.players = new Map();
    this.state = {
      id: code,
      name: code,
      players: [],
      gameStatus: 'waiting',
      createdAt: Date.now()
    };
  }

  addPlayer(socketId: string, player: StoredPlayer): void {
    this.connectedPlayerIds.add(socketId);
    this.playerSocketMap.set(player.id, socketId);
    if (!this.players.has(player.id)) {
      this.players.set(player.id, { ...player, connected: true });
    } else {
      const existingPlayer = this.players.get(player.id)!;
      existingPlayer.connected = true;
      this.playerSocketMap.set(player.id, socketId);
    }
    this.updateState();
  }

  getPlayer(playerId: string): StoredPlayer | undefined {
    return this.players.get(playerId);
  }

  hasPlayer(playerId: string): boolean {
    return this.players.has(playerId);
  }

  markPlayerDisconnected(playerId: string): void {
    const player = this.players.get(playerId);
    if (player) {
      player.connected = false;
      const socketId = this.playerSocketMap.get(playerId);
      if (socketId) {
        this.connectedPlayerIds.delete(socketId);
        this.playerSocketMap.delete(playerId);
      }
    }
    this.updateState();
  }

  updateState(): void {
    this.state.players = Array.from(this.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      isReady: p.isReady,
      score: p.score,
      connected: p.connected,
      handCount: p.hand.length
    }));
  }

  toGameView(playerId: string): GameView {
    const requestingPlayer = this.players.get(playerId);
    if (!requestingPlayer) {
      throw new Error(`Player ${playerId} not found in room`);
    }

    const me: PlayerPrivate = {
      id: requestingPlayer.id,
      name: requestingPlayer.name,
      isReady: requestingPlayer.isReady,
      score: requestingPlayer.score,
      secret: requestingPlayer.secret,
      connected: requestingPlayer.connected,
      hand: requestingPlayer.hand
    };

    const otherPlayers: PlayerPublic[] = Array.from(this.players.values())
      .filter(p => p.id !== playerId)
      .map(p => ({
        id: p.id,
        name: p.name,
        isReady: p.isReady,
        score: p.score,
        connected: p.connected,
        handCount: p.hand.length
      }));

    return {
      room: this.state,
      me,
      otherPlayers
    };
  }

  get connectedPlayerCount(): number {
    return this.connectedPlayerIds.size;
  }
}

export class RoomManager {
  rooms: Map<RoomCode, Room>;

  constructor() {
    this.rooms = new Map();
  }

  private generateRoomCode(): RoomCode {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const length = 6;
    let code = '';
    for (let i = 0; i < length; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  createRoom(): Room {
    let code: RoomCode;
    do {
      code = this.generateRoomCode();
    } while (this.rooms.has(code));

    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: RoomCode): Room | undefined {
    return this.rooms.get(code);
  }

  removeRoom(code: RoomCode): void {
    this.rooms.delete(code);
  }

  handlePlayerConnection(roomCode: RoomCode, socketId: string, player: StoredPlayer): Room {
    const room = this.getRoom(roomCode);
    if (!room) {
      throw new Error(`Room ${roomCode} not found`);
    }
    room.addPlayer(socketId, player);
    return room;
  }

  handlePlayerDisconnection(roomCode: RoomCode, socketId: string, playerId: string): Room | null {
    const room = this.getRoom(roomCode);
    if (!room) {
      return null;
    }
    room.markPlayerDisconnected(playerId);
    
    if (room.connectedPlayerCount === 0) {
      this.removeRoom(roomCode);
      return null;
    }
    
    return room;
  }

  handlePlayerReconnection(roomCode: RoomCode, socketId: string, playerId: string, playerSecret: string): Room | null {
    const room = this.getRoom(roomCode);
    if (!room) {
      return null;
    }
    
    const player = room.getPlayer(playerId);
    if (!player) {
      return null;
    }
    
    if (player.secret !== playerSecret) {
      return null;
    }
    
    room.addPlayer(socketId, player);
    return room;
  }

  get roomCount(): number {
    return this.rooms.size;
  }
}
