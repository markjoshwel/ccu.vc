export type RoomState = {
  id: string;
  name: string;
  players: PlayerPublic[];
  gameStatus: 'waiting' | 'playing' | 'finished';
  createdAt: number;
};

export type PlayerPublic = {
  id: string;
  name: string;
  isReady: boolean;
  score?: number;
  connected: boolean;
};

export type PlayerPrivate = {
  id: string;
  name: string;
  isReady: boolean;
  score?: number;
  secret: string;
  connected: boolean;
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
};

export type ServerToClientEvents = {
  roomUpdated: (room: RoomState) => void;
  playerJoined: (player: PlayerPublic) => void;
  playerLeft: (playerId: string) => void;
  gameStarted: () => void;
  error: (message: string) => void;
};
