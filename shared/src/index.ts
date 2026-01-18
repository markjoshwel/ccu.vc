export type RoomState = {
  id: string;
  name: string;
  players: PlayerPublic[];
  gameStatus: 'waiting' | 'playing' | 'finished';
  createdAt: number;
  deckSize?: number;
  discardPile?: Card[];
  currentPlayerIndex?: number;
  direction?: 1 | -1;
  activeColor?: 'red' | 'yellow' | 'green' | 'blue';
  gameEndedReason?: string;
  unoWindow?: UnoWindow;
};

export type UnoWindow = {
  playerId: string;
  called: boolean;
};

export type Card = {
  color: 'red' | 'yellow' | 'green' | 'blue' | 'wild';
  value: string;
};

export type PlayerPublic = {
  id: string;
  name: string;
  isReady: boolean;
  score?: number;
  connected: boolean;
  handCount: number;
  avatarId?: string;
};

export type PlayerPrivate = {
  id: string;
  name: string;
  isReady: boolean;
  score?: number;
  secret: string;
  connected: boolean;
  hand: Card[];
  avatarId?: string;
};

export type GameView = {
  room: RoomState;
  me: PlayerPrivate;
  otherPlayers: PlayerPublic[];
};

type JoinRoomCallback = (response: { playerId: string; playerSecret: string } | { error: string }) => void;

type JoinRoomArgs =
  | [actionId: string, roomCode: string, displayName: string, callback: JoinRoomCallback]
  | [actionId: string, roomCode: string, displayName: string, avatarId: string | null | undefined, callback: JoinRoomCallback];

export type ClientToServerEvents = {
  create_room: (actionId: string, callback: (response: { roomCode: string }) => void) => void;
  join_room: (...args: JoinRoomArgs) => void;
  reconnect_room: (actionId: string, roomCode: string, playerId: string, playerSecret: string, callback: (response: { success: boolean; error?: string }) => void) => void;
  joinRoom: (roomId: string) => void;
  leaveRoom: () => void;
  updatePlayer: (data: Partial<PlayerPrivate>) => void;
  playerReady: () => void;
  start_game: (actionId: string, callback: (response: { success: boolean; error?: string }) => void) => void;
  playCard: (actionId: string, card: Card, callback: (response: { success: boolean; error?: string }) => void, chosenColor?: 'red' | 'yellow' | 'green' | 'blue') => void;
  drawCard: (actionId: string, callback: (response: { success: boolean; error?: string }) => void) => void;
  callUno: (actionId: string, callback: (response: { success: boolean; error?: string }) => void) => void;
  catchUno: (actionId: string, targetPlayerId: string, callback: (response: { success: boolean; error?: string }) => void) => void;
  sendChat: (actionId: string, message: string, callback: (response: { success: boolean; error?: string }) => void) => void;
};

export type ClockSyncData = {
  activePlayerId: string;
  timeRemainingMs: { [playerId: string]: number };
};

export type TimeOutEvent = {
  playerId: string;
  policy: 'autoDrawAndSkip';
};

export type ServerToClientEvents = {
  roomUpdated: (room: RoomState) => void;
  playerJoined: (player: PlayerPublic) => void;
  playerLeft: (playerId: string) => void;
  gameStarted: () => void;
  gameStateUpdate: (view: GameView) => void;
  clockSync: (data: ClockSyncData) => void;
  timeOut: (data: TimeOutEvent) => void;
  error: (message: string) => void;
  actionAck: (data: { actionId: string; ok: boolean }) => void;
  chatMessage: (data: { playerId: string; playerName: string; message: string; timestamp: number }) => void;
};
