import { useState, useEffect, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { RoomState, PlayerPublic, ServerToClientEvents, ClientToServerEvents, Card, GameView } from 'shared';

const STORAGE_KEYS = {
  PLAYER_SECRET: 'playerSecret',
  PLAYER_ID: 'playerId',
  ROOM_CODE: 'roomCode',
  DISPLAY_NAME: 'displayName'
};

type AppView = 'lobby' | 'room';

function generateActionId(): string {
  return `action_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function App() {
  const [view, setView] = useState<AppView>('lobby');
  const [displayName, setDisplayName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [joinRoomCode, setJoinRoomCode] = useState('');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [players, setPlayers] = useState<PlayerPublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
  const [gameView, setGameView] = useState<GameView | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pendingWildCard, setPendingWildCard] = useState<Card | null>(null);

  useEffect(() => {
    const storedSecret = localStorage.getItem(STORAGE_KEYS.PLAYER_SECRET);
    const storedPlayerId = localStorage.getItem(STORAGE_KEYS.PLAYER_ID);
    const storedRoomCode = localStorage.getItem(STORAGE_KEYS.ROOM_CODE);
    const storedDisplayName = localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME);

    if (storedSecret && storedPlayerId && storedRoomCode && storedDisplayName) {
      setDisplayName(storedDisplayName);
      setLoading(true);

      const newSocket = io('http://localhost:3000');

      newSocket.on('actionAck', ({ actionId, ok }: { actionId: string; ok: boolean }) => {
        setPendingActions((prev) => {
          const next = new Set(prev);
          next.delete(actionId);
          return next;
        });
      });

      newSocket.on('connect', () => {
        const reconnectActionId = generateActionId();
        setPendingActions((prev) => new Set(prev).add(reconnectActionId));
        newSocket.emit('reconnect_room', reconnectActionId, storedRoomCode, storedPlayerId, storedSecret, (response: { success: boolean; error?: string }) => {
          if (response.success) {
            setJoinRoomCode(storedRoomCode);
          } else {
            localStorage.removeItem(STORAGE_KEYS.PLAYER_SECRET);
            localStorage.removeItem(STORAGE_KEYS.PLAYER_ID);
            localStorage.removeItem(STORAGE_KEYS.ROOM_CODE);
            setLoading(false);
            setError(response.error || 'Reconnection failed');
          }
        });
      });

      newSocket.on('roomUpdated', (updatedRoom) => {
        setRoom(updatedRoom);
        setPlayers(updatedRoom.players);
        setView('room');
        setLoading(false);
      });

      newSocket.on('gameStateUpdate', (updatedGameView) => {
        setGameView(updatedGameView);
        setRoom(updatedGameView.room);
      });

      newSocket.on('error', (message) => {
        setError(message);
        setLoading(false);
      });

      setSocket(newSocket);
    }
  }, []);

  const handleCreateRoom = () => {
    if (!displayName.trim()) {
      setError('Please enter a display name');
      return;
    }

    setLoading(true);
    setError('');

    const newSocket = io('http://localhost:3000');

    newSocket.on('actionAck', ({ actionId, ok }: { actionId: string; ok: boolean }) => {
      setPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(actionId);
        return next;
      });
    });

    newSocket.emit('create_room', (response: { roomCode: string }) => {
      localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, displayName);
      setJoinRoomCode(response.roomCode);
    });

    newSocket.on('connect', () => {
      const joinActionId = generateActionId();
      setPendingActions((prev) => new Set(prev).add(joinActionId));
      newSocket.emit('join_room', joinActionId, joinRoomCode || roomCode, displayName, (response: { error: string } | { playerId: string; playerSecret: string }) => {
        if ('error' in response) {
          setError(response.error);
          setLoading(false);
        } else {
          localStorage.setItem(STORAGE_KEYS.PLAYER_SECRET, response.playerSecret);
          localStorage.setItem(STORAGE_KEYS.PLAYER_ID, response.playerId);
          localStorage.setItem(STORAGE_KEYS.ROOM_CODE, joinRoomCode || roomCode);
        }
      });
    });

    newSocket.on('roomUpdated', (updatedRoom) => {
      setRoom(updatedRoom);
      setPlayers(updatedRoom.players);
      setView('room');
      setLoading(false);
    });

    newSocket.on('gameStateUpdate', (updatedGameView) => {
      setGameView(updatedGameView);
      setRoom(updatedGameView.room);
    });

    newSocket.on('error', (message) => {
      setError(message);
      setLoading(false);
    });

    setSocket(newSocket);
  };

  const handleJoinRoom = () => {
    if (!displayName.trim()) {
      setError('Please enter a display name');
      return;
    }

    if (!joinRoomCode.trim()) {
      setError('Please enter a room code');
      return;
    }

    setLoading(true);
    setError('');

    const newSocket = io('http://localhost:3000');

    newSocket.on('actionAck', ({ actionId, ok }: { actionId: string; ok: boolean }) => {
      setPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(actionId);
        return next;
      });
    });

    newSocket.on('connect', () => {
      const joinActionId = generateActionId();
      setPendingActions((prev) => new Set(prev).add(joinActionId));
      newSocket.emit('join_room', joinActionId, joinRoomCode, displayName, (response: { error: string } | { playerId: string; playerSecret: string }) => {
        if ('error' in response) {
          setError(response.error);
          setLoading(false);
          newSocket.disconnect();
        } else {
          localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, displayName);
          localStorage.setItem(STORAGE_KEYS.PLAYER_SECRET, response.playerSecret);
          localStorage.setItem(STORAGE_KEYS.PLAYER_ID, response.playerId);
          localStorage.setItem(STORAGE_KEYS.ROOM_CODE, joinRoomCode);
        }
      });
    });

    newSocket.on('roomUpdated', (updatedRoom) => {
      setRoom(updatedRoom);
      setPlayers(updatedRoom.players);
      setView('room');
      setLoading(false);
    });

    newSocket.on('gameStateUpdate', (updatedGameView) => {
      setGameView(updatedGameView);
      setRoom(updatedGameView.room);
    });

    newSocket.on('error', (message) => {
      setError(message);
      setLoading(false);
    });

    setSocket(newSocket);
  };

  const handleLeave = () => {
    localStorage.removeItem(STORAGE_KEYS.PLAYER_SECRET);
    localStorage.removeItem(STORAGE_KEYS.PLAYER_ID);
    localStorage.removeItem(STORAGE_KEYS.ROOM_CODE);
    socket?.disconnect();
    setSocket(null);
    setRoom(null);
    setPlayers([]);
    setGameView(null);
    setView('lobby');
    setLoading(false);
    setError('');
  };

  const handlePlayCard = (card: Card) => {
    if (!socket) return;
    
    if (card.color === 'wild') {
      setPendingWildCard(card);
      setShowColorPicker(true);
      return;
    }
    
    const actionId = generateActionId();
    setPendingActions((prev) => new Set(prev).add(actionId));
    
    socket.emit('playCard', actionId, card, (response) => {
      if (!response.success) {
        setError(response.error || 'Failed to play card');
      }
    });
  };

  const handleColorSelect = (color: 'red' | 'yellow' | 'green' | 'blue') => {
    if (!socket || !pendingWildCard) return;
    
    const actionId = generateActionId();
    setPendingActions((prev) => new Set(prev).add(actionId));
    
    socket.emit('playCard', actionId, pendingWildCard, (response) => {
      if (!response.success) {
        setError(response.error || 'Failed to play card');
      }
    }, color);
    
    setShowColorPicker(false);
    setPendingWildCard(null);
  };

  const handleColorPickerCancel = () => {
    setShowColorPicker(false);
    setPendingWildCard(null);
  };

  const handleDrawCard = () => {
    if (!socket) return;
    
    const actionId = generateActionId();
    setPendingActions((prev) => new Set(prev).add(actionId));
    
    socket.emit('drawCard', actionId, (response) => {
      if (!response.success) {
        setError(response.error || 'Failed to draw card');
      }
    });
  };

  const isCreatePending = pendingActions.size > 0;
  const isJoinPending = pendingActions.size > 0;

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <div className="loading">Connecting...</div>
        </div>
      </div>
    );
  }

  if (view === 'room' && room) {
    const myPlayerId = localStorage.getItem(STORAGE_KEYS.PLAYER_ID);
    const allPlayers = gameView ? [...gameView.otherPlayers, gameView.me] : players;
    const topCard = room.discardPile && room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null;
    const myTurn = myPlayerId && room.currentPlayerIndex !== undefined && allPlayers[room.currentPlayerIndex]?.id === myPlayerId;
    const isPlayPending = pendingActions.size > 0;
    const isPlayerPrivate = (player: any): player is { hand: Card[] } => 'hand' in player;
    const getPlayerHandCount = (player: any): number => {
      if (isPlayerPrivate(player)) {
        return player.hand?.length || 0;
      }
      return player.handCount || 0;
    };

    return (
      <div className="container">
        <div className="card">
          <h1>Room {room.id}</h1>
          <div className="room-code">{roomCode || joinRoomCode}</div>
          
          {room.gameStatus === 'playing' && topCard && (
            <div className="game-area">
              <div className="discard-area">
                <h2>Discard Pile</h2>
                {room.activeColor && (
                  <div className="active-color-indicator">
                    <span>Active Color: </span>
                    <span className={`color-badge ${room.activeColor}`}>{room.activeColor}</span>
                  </div>
                )}
                <div className={`card-display color-${topCard.color}`}>
                  <span className="card-value">{topCard.value}</span>
                </div>
              </div>

              <div className="players-list">
                <h2>Players</h2>
                {allPlayers.map((player, index) => (
                  <div 
                    key={player.id} 
                    className={`player ${player.connected ? 'connected' : 'disconnected'} ${room.currentPlayerIndex === index ? 'active' : ''}`}
                  >
                    <span className="name">{player.name}</span>
                    <span className="status">{player.connected ? 'Online' : 'Offline'}</span>
                    <span className="hand-count">{getPlayerHandCount(player)} cards</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {gameView && gameView.me.hand && gameView.me.hand.length > 0 && (
            <div className="hand-area">
              <h2>Your Hand</h2>
              <div className="hand-grid">
                {gameView.me.hand.map((card, index) => (
                  <button
                    key={index}
                    className={`card-display color-${card.color} ${!myTurn || isPlayPending ? 'disabled' : ''}`}
                    onClick={() => myTurn && !isPlayPending && handlePlayCard(card)}
                    disabled={!myTurn || isPlayPending}
                  >
                    <span className="card-value">{card.value}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {room.gameStatus === 'playing' && myTurn && (
            <button 
              onClick={handleDrawCard} 
              disabled={isPlayPending}
              style={{ marginTop: '16px' }}
            >
              {isPlayPending ? 'Drawing...' : 'Draw Card'}
            </button>
          )}

          {room.gameStatus === 'waiting' && (
            <div className="players-list">
              <h2>Players ({players.length})</h2>
              {players.map((player) => (
                <div key={player.id} className={`player ${player.connected ? 'connected' : 'disconnected'}`}>
                  <span className="name">{player.name}</span>
                  <span className="status">{player.connected ? 'Online' : 'Offline'}</span>
                </div>
              ))}
            </div>
          )}

          <button onClick={handleLeave} style={{ marginTop: '24px' }}>
            Leave Room
          </button>
        </div>

        {showColorPicker && (
          <div className="color-picker-overlay">
            <div className="color-picker-modal">
              <h3>Choose a Color</h3>
              <div className="color-options">
                <button className="color-btn red" onClick={() => handleColorSelect('red')}>Red</button>
                <button className="color-btn yellow" onClick={() => handleColorSelect('yellow')}>Yellow</button>
                <button className="color-btn green" onClick={() => handleColorSelect('green')}>Green</button>
                <button className="color-btn blue" onClick={() => handleColorSelect('blue')}>Blue</button>
              </div>
              <button className="cancel-btn" onClick={handleColorPickerCancel}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <h1>Lobby</h1>
        {error && <div className="error">{error}</div>}
        <div className="form-group">
          <label>Display Name</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Enter your name"
          />
        </div>
        <button onClick={handleCreateRoom} disabled={loading || isCreatePending} data-pending={isCreatePending}>
          {isCreatePending ? 'Creating...' : 'Create Room'}
        </button>
        <div className="divider">
          <span>or</span>
        </div>
        <div className="form-group">
          <label>Room Code</label>
          <input
            type="text"
            value={joinRoomCode}
            onChange={(e) => setJoinRoomCode(e.target.value)}
            placeholder="Enter room code"
          />
        </div>
        <button onClick={handleJoinRoom} disabled={loading || isJoinPending} data-pending={isJoinPending}>
          {isJoinPending ? 'Joining...' : 'Join Room'}
        </button>
      </div>
    </div>
  );
}

export { App };