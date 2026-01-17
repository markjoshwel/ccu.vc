import type { RoomState, PlayerPublic, PlayerPrivate, Card, GameView } from 'shared';
import { Deck } from './Deck';

type RoomCode = string;

type StoredPlayer = PlayerPublic & { secret: string; connected: boolean; hand: Card[] };

export class Room {
  code: RoomCode;
  connectedPlayerIds: Set<string>;
  playerSocketMap: Map<string, string>;
  players: Map<string, StoredPlayer>;
  state: RoomState;
  deck?: Deck;
  discardPile: Card[];
  currentPlayerIndex: number;
  direction: 1 | -1;
  playerOrder: string[];

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
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.direction = 1;
    this.playerOrder = [];
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
    this.state.deckSize = this.deck?.size || 0;
    this.state.discardPile = this.discardPile;
    this.state.currentPlayerIndex = this.state.gameStatus === 'playing' ? this.currentPlayerIndex : undefined;
    this.state.direction = this.state.gameStatus === 'playing' ? this.direction : undefined;
  }

  startGame(rng?: () => number): void {
    if (this.state.gameStatus !== 'waiting') {
      throw new Error('Game has already started');
    }

    if (this.players.size < 2) {
      throw new Error('At least 2 players required to start');
    }

    this.playerOrder = Array.from(this.players.keys());
    this.currentPlayerIndex = 0;
    this.direction = 1;

    this.deck = Deck.createStandardDeck();
    this.deck.shuffle(rng);

    const initialHandSize = 7;

    for (const [playerId, player] of this.players) {
      player.hand = [];
      for (let i = 0; i < initialHandSize; i++) {
        const card = this.deck.draw();
        if (card) {
          player.hand.push(card);
        }
      }
    }

    let initialCard = this.deck.draw();
    while (initialCard && initialCard.color === 'wild' && initialCard.value === 'wild_draw4') {
      this.deck.cards.unshift(initialCard);
      this.deck.shuffle(rng);
      initialCard = this.deck.draw();
    }

    if (initialCard) {
      this.discardPile = [initialCard];
    } else {
      throw new Error('Failed to draw initial card');
    }

    this.state.gameStatus = 'playing';
    this.updateState();
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

  nextConnectedPlayerIndex(): number {
    const playerCount = this.playerOrder.length;
    let nextIndex = this.currentPlayerIndex;
    let attempts = 0;

    do {
      nextIndex = (nextIndex + this.direction + playerCount) % playerCount;
      attempts++;

      if (attempts > playerCount) {
        break;
      }
    } while (!this.players.get(this.playerOrder[nextIndex])?.connected);

    const connectedCount = Array.from(this.players.values()).filter(p => p.connected).length;

    if (connectedCount === 1) {
      this.state.gameStatus = 'finished';
      this.state.gameEndedReason = 'last-player-connected';
      this.updateState();
    }

    return nextIndex;
  }

  advanceTurn(): void {
    if (this.state.gameStatus !== 'playing') {
      return;
    }

    this.currentPlayerIndex = this.nextConnectedPlayerIndex();
    this.updateState();
  }

  reverseDirection(): void {
    if (this.state.gameStatus !== 'playing') {
      return;
    }

    this.direction = this.direction === 1 ? -1 : 1;
    this.updateState();
  }

  playCard(playerId: string, card: Card): void {
    if (this.state.gameStatus !== 'playing') {
      throw new Error('Game is not in playing state');
    }

    const currentPlayerId = this.playerOrder[this.currentPlayerIndex];
    if (playerId !== currentPlayerId) {
      throw new Error('Not your turn');
    }

    const player = this.players.get(playerId);
    if (!player) {
      throw new Error('Player not found');
    }

    const cardIndex = player.hand.findIndex(
      (c) => c.color === card.color && c.value === card.value
    );

    if (cardIndex === -1) {
      throw new Error('Card not in hand');
    }

    const topCard = this.discardPile[this.discardPile.length - 1];
    if (!topCard) {
      throw new Error('No top card in discard pile');
    }

    const isMatch =
      card.color === 'wild' ||
      card.color === topCard.color ||
      card.value === topCard.value;

    if (!isMatch) {
      throw new Error('Card does not match top discard');
    }

    player.hand.splice(cardIndex, 1);
    this.discardPile.push(card);
    this.updateState();
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
