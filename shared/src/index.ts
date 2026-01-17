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
  gameEndedReason?: string;
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
};

export type PlayerPrivate = {
  id: string;
  name: string;
  isReady: boolean;
  score?: number;
  secret: string;
  connected: boolean;
  hand: Card[];
};

export type GameView = {
  room: RoomState;
  me: PlayerPrivate;
  otherPlayers: PlayerPublic[];
};

export type ClientToServerEvents = {
  create_room: (callback: (response: { roomCode: string }) => void) => void;
  join_room: (roomCode: string, displayName: string, callback: (response: { playerId: string; playerSecret: string } | { error: string }) => void) => void;
  reconnect_room: (roomCode: string, playerId: string, playerSecret: string, callback: (response: { success: boolean; error?: string }) => void) => void;
  joinRoom: (roomId: string) => void;
  leaveRoom: () => void;
  updatePlayer: (data: Partial<PlayerPrivate>) => void;
  playerReady: () => void;
  start_game: (callback: (response: { success: boolean; error?: string }) => void) => void;
};

export type ServerToClientEvents = {
  roomUpdated: (room: RoomState) => void;
  playerJoined: (player: PlayerPublic) => void;
  playerLeft: (playerId: string) => void;
  gameStarted: () => void;
  gameStateUpdate: (view: GameView) => void;
  error: (message: string) => void;
};
