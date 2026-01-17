// Chess Clock UNO - Shared Types

// Card types
export type CardColor = 'red' | 'yellow' | 'green' | 'blue';
export type CardValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 'skip' | 'reverse' | 'draw2';
export type WildType = 'wild' | 'wild4';

export interface NumberCard {
  type: 'number';
  color: CardColor;
  value: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

export interface ActionCard {
  type: 'action';
  color: CardColor;
  value: 'skip' | 'reverse' | 'draw2';
}

export interface WildCard {
  type: 'wild';
  wildType: WildType;
}

export type Card = NumberCard | ActionCard | WildCard;

// CardWithId is a card with an ID added
export type CardWithId = Card & { id: string };

// Player types
export interface PlayerPublic {
  playerId: string;
  displayName: string;
  connected: boolean;
  handCount: number;
  avatarId?: string;
  timeRemainingMs: number;
}

export interface PlayerPrivate extends PlayerPublic {
  hand: CardWithId[];
  playerSecret: string;
}

// Room state
export type GamePhase = 'lobby' | 'playing' | 'finished';
export type TurnDirection = 1 | -1;

export interface RoomSettings {
  maxPlayers: number;
  initialTimeMs: number;
  incrementMs: number;
  deckCount: number;
}

export interface UnoWindow {
  playerId: string;
  calledUno: boolean;
}

export interface RoomState {
  roomCode: string;
  hostPlayerId: string;
  phase: GamePhase;
  settings: RoomSettings;
  players: PlayerPrivate[];
  // Game state (only relevant when phase === 'playing')
  deck: CardWithId[];
  discardPile: CardWithId[];
  activeColor: CardColor | null;
  turnIndex: number;
  direction: TurnDirection;
  unoWindow: UnoWindow | null;
  winnerId: string | null;
  winReason: string | null;
  // Clock state
  activePlayerId: string | null;
  lastClockStartMs: number | null;
}

// Game view sent to client (hides opponent hands)
export interface OpponentView {
  playerId: string;
  displayName: string;
  connected: boolean;
  handCount: number;
  avatarId?: string;
  timeRemainingMs: number;
}

export interface GameView {
  roomCode: string;
  hostPlayerId: string;
  phase: GamePhase;
  settings: RoomSettings;
  myPlayerId: string;
  myHand: CardWithId[];
  opponents: OpponentView[];
  discardTop: CardWithId | null;
  activeColor: CardColor | null;
  turnIndex: number;
  currentPlayerId: string | null;
  direction: TurnDirection;
  unoWindow: UnoWindow | null;
  winnerId: string | null;
  winReason: string | null;
  myTimeRemainingMs: number;
}

// Socket event types
export interface CreateRoomPayload {
  displayName: string;
  avatarId?: string;
}

export interface CreateRoomResponse {
  roomCode: string;
  playerId: string;
  playerSecret: string;
}

export interface JoinRoomPayload {
  roomCode: string;
  displayName: string;
  playerSecret?: string;
  avatarId?: string;
}

export interface JoinRoomResponse {
  playerId: string;
  playerSecret: string;
}

export interface ActionPayload {
  actionId: string;
}

export interface PlayCardPayload extends ActionPayload {
  cardId: string;
  chosenColor?: CardColor;
}

export interface DrawCardPayload extends ActionPayload {}

export interface CallUnoPayload extends ActionPayload {}

export interface CatchUnoPayload extends ActionPayload {
  targetPlayerId: string;
}

export interface SendChatPayload {
  message: string;
}

export interface ActionAck {
  actionId: string;
  ok: boolean;
  errorCode?: string;
}

export interface ClockSync {
  activePlayerId: string | null;
  players: { playerId: string; timeRemainingMs: number }[];
  serverTimestamp: number;
}

export interface TimeOutEvent {
  playerId: string;
  policy: 'autoDrawAndSkip';
}

export interface ChatMessage {
  playerId: string;
  displayName: string;
  message: string;
  timestamp: number;
}

// Socket.io event definitions
export interface ClientToServerEvents {
  createRoom: (payload: CreateRoomPayload, callback: (response: CreateRoomResponse | { error: string }) => void) => void;
  joinRoom: (payload: JoinRoomPayload, callback: (response: JoinRoomResponse | { error: string }) => void) => void;
  startGame: (payload: ActionPayload, callback: (ack: ActionAck) => void) => void;
  playCard: (payload: PlayCardPayload, callback: (ack: ActionAck) => void) => void;
  drawCard: (payload: DrawCardPayload, callback: (ack: ActionAck) => void) => void;
  callUno: (payload: CallUnoPayload, callback: (ack: ActionAck) => void) => void;
  catchUno: (payload: CatchUnoPayload, callback: (ack: ActionAck) => void) => void;
  sendChat: (payload: SendChatPayload) => void;
}

export interface ServerToClientEvents {
  gameStateUpdate: (view: GameView) => void;
  actionAck: (ack: ActionAck) => void;
  actionResolved: (data: { actionId: string; effects: string[] }) => void;
  clockSync: (sync: ClockSync) => void;
  timeOut: (event: TimeOutEvent) => void;
  chatMessage: (msg: ChatMessage) => void;
  chatHistory: (messages: ChatMessage[]) => void;
  playerJoined: (player: OpponentView) => void;
  playerLeft: (playerId: string) => void;
  playerReconnected: (playerId: string) => void;
  error: (message: string) => void;
}
