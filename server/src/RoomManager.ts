import type { RoomState, PlayerPublic, PlayerPrivate, Card, GameView, ClockSyncData, TimeOutEvent, UnoWindow, ChatMessage, RoomSettings } from 'shared';
import { Deck } from './Deck';

type RoomCode = string;

type StoredPlayer = PlayerPublic & { secret: string; connected: boolean; hand: Card[]; avatarId?: string; isAI?: boolean };

const MAX_CHAT_HISTORY = 100;
const DEFAULT_TIME_PER_TURN_MS = 60000;
const DEFAULT_MAX_PLAYERS = 6;
const AI_NAMES = ['Bot Alpha', 'Bot Beta', 'Bot Gamma', 'Bot Delta', 'Bot Epsilon', 'Bot Zeta', 'Bot Eta', 'Bot Theta', 'Bot Iota'];

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
  activeColor?: 'red' | 'yellow' | 'green' | 'blue';
  timeRemainingMs: { [playerId: string]: number };
  timePerTurnMs: number;
  clockSyncIntervalId?: ReturnType<typeof setInterval>;
  onClockSync?: (data: ClockSyncData) => void;
  onTimeOut?: (data: TimeOutEvent) => void;
  onAIMove?: () => void;
  unoWindow?: UnoWindow;
  chatHistory: ChatMessage[];
  settings: RoomSettings;
  aiMoveTimeoutId?: ReturnType<typeof setTimeout>;

  constructor(code: RoomCode, settings?: Partial<RoomSettings>) {
    this.code = code;
    this.connectedPlayerIds = new Set();
    this.playerSocketMap = new Map();
    this.players = new Map();
    this.settings = {
      maxPlayers: settings?.maxPlayers ?? DEFAULT_MAX_PLAYERS,
      aiPlayerCount: settings?.aiPlayerCount ?? 0,
      timePerTurnMs: settings?.timePerTurnMs ?? DEFAULT_TIME_PER_TURN_MS
    };
    this.state = {
      id: code,
      name: code,
      players: [],
      gameStatus: 'waiting',
      createdAt: Date.now(),
      settings: this.settings
    };
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.direction = 1;
    this.playerOrder = [];
    this.timeRemainingMs = {};
    this.timePerTurnMs = this.settings.timePerTurnMs;
    this.chatHistory = [];
  }

  addChatMessage(message: ChatMessage): void {
    this.chatHistory.push(message);
    if (this.chatHistory.length > MAX_CHAT_HISTORY) {
      this.chatHistory.shift();
    }
  }

  getChatHistory(): ChatMessage[] {
    return [...this.chatHistory];
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
      handCount: p.hand.length,
      avatarId: p.avatarId,
      isAI: p.isAI
    }));
    this.state.deckSize = this.deck?.size || 0;
    this.state.discardPile = this.discardPile;
    this.state.currentPlayerIndex = this.state.gameStatus === 'playing' ? this.currentPlayerIndex : undefined;
    this.state.direction = this.state.gameStatus === 'playing' ? this.direction : undefined;
    this.state.activeColor = this.activeColor;
    this.state.unoWindow = this.unoWindow;
    this.state.settings = this.settings;
  }

  addAIPlayers(): void {
    const existingAICount = Array.from(this.players.values()).filter(p => p.isAI).length;
    const toAdd = this.settings.aiPlayerCount - existingAICount;
    
    for (let i = 0; i < toAdd; i++) {
      const aiIndex = existingAICount + i;
      const aiName = AI_NAMES[aiIndex % AI_NAMES.length];
      const aiId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      const aiPlayer: StoredPlayer = {
        id: aiId,
        name: aiName,
        isReady: true,
        connected: true,
        hand: [],
        handCount: 0,
        secret: 'AI_SECRET',
        isAI: true
      };
      
      this.players.set(aiId, aiPlayer);
    }
    
    this.updateState();
  }

  isCurrentPlayerAI(): boolean {
    if (this.state.gameStatus !== 'playing') return false;
    const currentPlayerId = this.playerOrder[this.currentPlayerIndex];
    const player = this.players.get(currentPlayerId);
    return player?.isAI === true;
  }

  makeAIMove(): void {
    if (this.state.gameStatus !== 'playing') return;
    if (!this.isCurrentPlayerAI()) return;

    const currentPlayerId = this.playerOrder[this.currentPlayerIndex];
    const player = this.players.get(currentPlayerId);
    if (!player) return;

    const topCard = this.discardPile[this.discardPile.length - 1];
    if (!topCard) return;

    const effectiveColor = this.activeColor || topCard.color;

    // Find a playable card
    const playableCard = player.hand.find(card => {
      if (card.color === 'wild') return true;
      if (card.color === effectiveColor) return true;
      if (card.value === topCard.value) return true;
      return false;
    });

    if (playableCard) {
      // Choose color for wild cards
      let chosenColor: 'red' | 'yellow' | 'green' | 'blue' | undefined;
      if (playableCard.color === 'wild') {
        // Pick the most common color in hand
        const colorCounts = { red: 0, yellow: 0, green: 0, blue: 0 };
        for (const card of player.hand) {
          if (card.color !== 'wild') {
            colorCounts[card.color]++;
          }
        }
        chosenColor = (Object.entries(colorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'red') as 'red' | 'yellow' | 'green' | 'blue';
      }

      try {
        this.playCard(currentPlayerId, playableCard, chosenColor);
        
        // Call UNO if down to 1 card
        if (this.unoWindow && this.unoWindow.playerId === currentPlayerId && !this.unoWindow.called) {
          this.callUno(currentPlayerId);
        }
      } catch (e) {
        // If play fails, draw instead
        this.drawCard(currentPlayerId);
      }
    } else {
      // No playable card, draw
      this.drawCard(currentPlayerId);
    }
  }

  scheduleAIMove(): void {
    if (this.aiMoveTimeoutId) {
      clearTimeout(this.aiMoveTimeoutId);
      this.aiMoveTimeoutId = undefined;
    }

    if (this.state.gameStatus !== 'playing') return;
    if (!this.isCurrentPlayerAI()) return;

    // AI thinks for 1-2 seconds
    const delay = 1000 + Math.random() * 1000;
    this.aiMoveTimeoutId = setTimeout(() => {
      this.makeAIMove();
      if (this.onAIMove) {
        this.onAIMove();
      }
    }, delay);
  }

  startGame(rng?: () => number): void {
    if (this.state.gameStatus !== 'waiting') {
      throw new Error('Game has already started');
    }

    // Add AI players before checking player count
    if (this.settings.aiPlayerCount > 0) {
      this.addAIPlayers();
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
    while (initialCard && initialCard.color === 'wild') {
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
    this.startClockSync();
    
    // Schedule AI move if first player is AI
    this.scheduleAIMove();
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
      hand: requestingPlayer.hand,
      avatarId: requestingPlayer.avatarId
    };

    const otherPlayers: PlayerPublic[] = Array.from(this.players.values())
      .filter(p => p.id !== playerId)
      .map(p => ({
        id: p.id,
        name: p.name,
        isReady: p.isReady,
        score: p.score,
        connected: p.connected,
        handCount: p.hand.length,
        avatarId: p.avatarId
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
      const nextPlayer = this.players.get(this.playerOrder[nextIndex]);
      // AI players are always "connected", humans need connected flag
      if (nextPlayer?.isAI || nextPlayer?.connected) {
        break;
      }
    } while (true);

    // Count active players (connected humans + all AIs)
    const connectedHumans = Array.from(this.players.values()).filter(p => !p.isAI && p.connected).length;
    const aiCount = Array.from(this.players.values()).filter(p => p.isAI).length;
    const activeCount = connectedHumans + aiCount;

    // End game if:
    // - No humans are connected, OR
    // - Only 1 player total is active (could be 1 human with no AI, or edge case)
    if (connectedHumans === 0) {
      this.state.gameStatus = 'finished';
      this.state.gameEndedReason = 'All human players disconnected';
      this.updateState();
      this.stopClockSync();
    } else if (activeCount === 1) {
      // Only 1 active player (1 human, 0 AI) - they win by default
      this.state.gameStatus = 'finished';
      this.state.gameEndedReason = 'last-player-connected';
      this.updateState();
      this.stopClockSync();
    }

    return nextIndex;
  }

  advanceTurn(): void {
    if (this.state.gameStatus !== 'playing') {
      return;
    }

    this.currentPlayerIndex = this.nextConnectedPlayerIndex();
    this.resetCurrentPlayerTimer();
    this.updateState();
    
    // Schedule AI move if next player is AI
    this.scheduleAIMove();
  }

  reverseDirection(): void {
    if (this.state.gameStatus !== 'playing') {
      return;
    }

    this.direction = this.direction === 1 ? -1 : 1;
    this.updateState();
  }

  playCard(playerId: string, card: Card, chosenColor?: 'red' | 'yellow' | 'green' | 'blue'): void {
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

    if (card.color === 'wild') {
      if (!chosenColor) {
        throw new Error('Must choose a color when playing a Wild card');
      }
      if (!['red', 'yellow', 'green', 'blue'].includes(chosenColor)) {
        throw new Error('Invalid color choice');
      }
    } else if (chosenColor) {
      throw new Error('Cannot choose color for non-Wild cards');
    }

    const effectiveColor = this.activeColor || topCard.color;
    const isMatch =
      card.color === 'wild' ||
      card.color === effectiveColor ||
      card.value === topCard.value ||
      topCard.value === 'wild' ||
      topCard.value === 'wild_draw4';

    if (!isMatch) {
      throw new Error('Card does not match top discard');
    }

    player.hand.splice(cardIndex, 1);
    this.discardPile.push(card);

    if (player.hand.length === 0) {
      this.state.gameStatus = 'finished';
      this.state.gameEndedReason = `${player.name} won`;
      this.updateState();
      this.stopClockSync();
      return;
    }

    if (player.hand.length === 1) {
      this.unoWindow = { playerId, called: false };
      this.updateState();
    }

    if (card.color === 'wild') {
      this.activeColor = chosenColor;
    } else {
      this.activeColor = undefined;
    }

    this.updateState();

    if (card.value === 'skip') {
      this.advanceTurn();
      this.advanceTurn();
    } else if (card.value === 'reverse') {
      if (this.playerOrder.length >= 3) {
        this.reverseDirection();
        this.advanceTurn();
      } else {
        this.advanceTurn();
        this.advanceTurn();
      }
    } else if (card.value === 'draw2') {
      const nextPlayerIndex = this.nextConnectedPlayerIndex();
      const nextPlayerId = this.playerOrder[nextPlayerIndex];
      const nextPlayer = this.players.get(nextPlayerId);
      
      if (nextPlayer) {
        for (let i = 0; i < 2; i++) {
          if (this.deck && !this.deck.isEmpty()) {
            const drawnCard = this.deck.draw();
            if (drawnCard) {
              nextPlayer.hand.push(drawnCard);
            }
          }
        }
        this.updateState();
      }
      
      this.currentPlayerIndex = nextPlayerIndex;
      this.advanceTurn();
    } else if (card.value === 'wild_draw4') {
      const nextPlayerIndex = this.nextConnectedPlayerIndex();
      const nextPlayerId = this.playerOrder[nextPlayerIndex];
      const nextPlayer = this.players.get(nextPlayerId);
      
      if (nextPlayer) {
        for (let i = 0; i < 4; i++) {
          if (this.deck && !this.deck.isEmpty()) {
            const drawnCard = this.deck.draw();
            if (drawnCard) {
              nextPlayer.hand.push(drawnCard);
            }
          }
        }
        this.updateState();
      }
      
      this.currentPlayerIndex = nextPlayerIndex;
      this.advanceTurn();
    } else {
      this.advanceTurn();
    }

    if (this.unoWindow && this.unoWindow.playerId !== playerId) {
      this.unoWindow = undefined;
      this.updateState();
    }
  }

  drawCard(playerId: string): void {
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

    if (!this.deck || this.deck.isEmpty()) {
      throw new Error('Deck is empty');
    }

    const drawnCard = this.deck.draw();
    if (drawnCard) {
      player.hand.push(drawnCard);
    }

    this.updateState();
    this.advanceTurn();

    if (this.unoWindow && this.unoWindow.playerId !== playerId) {
      this.unoWindow = undefined;
      this.updateState();
    }
  }

  callUno(playerId: string): void {
    if (this.state.gameStatus !== 'playing') {
      throw new Error('Game is not in playing state');
    }

    if (!this.unoWindow) {
      throw new Error('No UNO window open');
    }

    if (this.unoWindow.playerId !== playerId) {
      throw new Error('Not your UNO window');
    }

    if (this.unoWindow.called) {
      throw new Error('UNO already called');
    }

    this.unoWindow.called = true;
    this.updateState();
  }

  catchUno(catcherPlayerId: string, targetPlayerId: string): void {
    if (this.state.gameStatus !== 'playing') {
      throw new Error('Game is not in playing state');
    }

    if (!this.unoWindow) {
      throw new Error('No UNO window open');
    }

    if (this.unoWindow.playerId !== targetPlayerId) {
      throw new Error('Target player does not have an open UNO window');
    }

    if (this.unoWindow.called) {
      throw new Error('UNO already called');
    }

    const targetPlayer = this.players.get(targetPlayerId);
    if (!targetPlayer) {
      throw new Error('Target player not found');
    }

    if (!this.deck || this.deck.isEmpty()) {
      throw new Error('Deck is empty');
    }

    for (let i = 0; i < 2; i++) {
      const drawnCard = this.deck.draw();
      if (drawnCard) {
        targetPlayer.hand.push(drawnCard);
      }
    }

    this.unoWindow = undefined;
    this.updateState();
  }

  getClockSyncData(): ClockSyncData {
    const activePlayerId = this.playerOrder[this.currentPlayerIndex];
    return {
      activePlayerId,
      timeRemainingMs: { ...this.timeRemainingMs }
    };
  }

  startClockSync(): void {
    if (this.clockSyncIntervalId) {
      return;
    }

    this.playerOrder.forEach(playerId => {
      this.timeRemainingMs[playerId] = this.timePerTurnMs;
    });

    this.clockSyncIntervalId = setInterval(() => {
      if (this.state.gameStatus === 'playing') {
        const activePlayerId = this.playerOrder[this.currentPlayerIndex];
        this.timeRemainingMs[activePlayerId] = Math.max(0, this.timeRemainingMs[activePlayerId] - 500);

        if (this.onClockSync) {
          this.onClockSync(this.getClockSyncData());
        }

        if (this.timeRemainingMs[activePlayerId] === 0) {
          const player = this.players.get(activePlayerId);
          if (player && this.deck && !this.deck.isEmpty()) {
            const drawnCard = this.deck.draw();
            if (drawnCard) {
              player.hand.push(drawnCard);
              this.updateState();
            }
          }

          this.advanceTurn();

          if (this.onTimeOut) {
            this.onTimeOut({ playerId: activePlayerId, policy: 'autoDrawAndSkip' });
          }
        }
      }
    }, 500);
  }

  resetCurrentPlayerTimer(): void {
    const activePlayerId = this.playerOrder[this.currentPlayerIndex];
    if (activePlayerId) {
      this.timeRemainingMs[activePlayerId] = this.timePerTurnMs;
    }
  }

  stopClockSync(): void {
    if (this.clockSyncIntervalId) {
      clearInterval(this.clockSyncIntervalId);
      this.clockSyncIntervalId = undefined;
    }
    if (this.aiMoveTimeoutId) {
      clearTimeout(this.aiMoveTimeoutId);
      this.aiMoveTimeoutId = undefined;
    }
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

  createRoom(settings?: Partial<RoomSettings>): Room {
    let code: RoomCode;
    do {
      code = this.generateRoomCode();
    } while (this.rooms.has(code));

    const room = new Room(code, settings);
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
