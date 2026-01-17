import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import type { RoomState, PlayerPublic, ServerToClientEvents, ClientToServerEvents } from 'shared';

const STORAGE_KEYS = {
  PLAYER_SECRET: 'playerSecret',
  PLAYER_ID: 'playerId',
  ROOM_CODE: 'roomCode',
  DISPLAY_NAME: 'displayName'
};

type AppView = 'lobby' | 'room';

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

  useEffect(() => {
    const storedSecret = localStorage.getItem(STORAGE_KEYS.PLAYER_SECRET);
    const storedPlayerId = localStorage.getItem(STORAGE_KEYS.PLAYER_ID);
    const storedRoomCode = localStorage.getItem(STORAGE_KEYS.ROOM_CODE);
    const storedDisplayName = localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME);

    if (storedSecret && storedPlayerId && storedRoomCode && storedDisplayName) {
      setDisplayName(storedDisplayName);
      setLoading(true);

      const newSocket = io('http://localhost:3000');

      newSocket.on('connect', () => {
        newSocket.emit('reconnect_room', storedRoomCode, storedPlayerId, storedSecret, (response: { success: boolean; error?: string }) => {
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

    newSocket.emit('create_room', (response: { roomCode: string }) => {
      localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, displayName);
      setJoinRoomCode(response.roomCode);
    });

    newSocket.on('connect', () => {
      newSocket.emit('join_room', joinRoomCode || roomCode, displayName, (response: { error: string } | { playerId: string; playerSecret: string }) => {
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

    newSocket.on('connect', () => {
      newSocket.emit('join_room', joinRoomCode, displayName, (response: { error: string } | { playerId: string; playerSecret: string }) => {
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
    setView('lobby');
    setLoading(false);
    setError('');
  };

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
    return (
      <div className="container">
        <div className="card">
          <h1>Room {room.id}</h1>
          <div className="room-code">{roomCode || joinRoomCode}</div>
          <div className="players-list">
            <h2>Players ({players.length})</h2>
            {players.map((player) => (
              <div key={player.id} className={`player ${player.connected ? 'connected' : 'disconnected'}`}>
                <span className="name">{player.name}</span>
                <span className="status">{player.connected ? 'Online' : 'Offline'}</span>
              </div>
            ))}
          </div>
          <button onClick={handleLeave} style={{ marginTop: '24px' }}>
            Leave Room
          </button>
        </div>
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
        <button onClick={handleCreateRoom} disabled={loading}>
          Create Room
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
        <button onClick={handleJoinRoom} disabled={loading}>
          Join Room
        </button>
      </div>
    </div>
  );
}

export { App };