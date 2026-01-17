import { useState, useEffect, useCallback } from 'react';
import type { GameView, CreateRoomResponse, JoinRoomResponse } from '@ccu/shared';
import { getSocket } from './socket';
import { getStoredSession, storeSession, clearSession, StoredSession } from './storage';

interface LobbyProps {
  onJoinRoom: (session: StoredSession, gameView: GameView) => void;
}

export default function Lobby({ onJoinRoom }: LobbyProps) {
  const [displayName, setDisplayName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  // Attempt to reconnect using stored session on mount
  useEffect(() => {
    const storedSession = getStoredSession();
    if (storedSession) {
      setReconnecting(true);
      attemptReconnect(storedSession);
    }
  }, []);

  const attemptReconnect = useCallback((session: StoredSession) => {
    const socket = getSocket();
    
    socket.emit('joinRoom', {
      roomCode: session.roomCode,
      displayName: 'Reconnecting...', // Will use existing name on server
      playerSecret: session.playerSecret
    }, (response) => {
      setReconnecting(false);
      if ('error' in response) {
        // Room no longer exists or invalid secret
        clearSession();
        return;
      }
      
      const joinResponse = response as JoinRoomResponse;
      const newSession: StoredSession = {
        roomCode: session.roomCode,
        playerId: joinResponse.playerId,
        playerSecret: joinResponse.playerSecret
      };
      storeSession(newSession);
    });

    // Wait for game state update
    socket.once('gameStateUpdate', (view: GameView) => {
      const storedSession = getStoredSession();
      if (storedSession) {
        onJoinRoom(storedSession, view);
      }
    });
  }, [onJoinRoom]);

  const handleCreateRoom = async () => {
    if (!displayName.trim()) {
      setError('Please enter a display name');
      return;
    }

    setLoading(true);
    setError(null);

    const socket = getSocket();
    
    socket.emit('createRoom', { displayName: displayName.trim() }, (response) => {
      setLoading(false);
      if ('error' in response) {
        setError(response.error);
        return;
      }
      
      const createResponse = response as CreateRoomResponse;
      const session: StoredSession = {
        roomCode: createResponse.roomCode,
        playerId: createResponse.playerId,
        playerSecret: createResponse.playerSecret
      };
      storeSession(session);
    });

    // Wait for game state update
    socket.once('gameStateUpdate', (view: GameView) => {
      const session = getStoredSession();
      if (session) {
        onJoinRoom(session, view);
      }
    });
  };

  const handleJoinRoom = async () => {
    if (!displayName.trim()) {
      setError('Please enter a display name');
      return;
    }
    if (!roomCode.trim()) {
      setError('Please enter a room code');
      return;
    }

    setLoading(true);
    setError(null);

    const socket = getSocket();
    
    socket.emit('joinRoom', { 
      roomCode: roomCode.trim().toUpperCase(), 
      displayName: displayName.trim() 
    }, (response) => {
      setLoading(false);
      if ('error' in response) {
        setError(response.error);
        return;
      }
      
      const joinResponse = response as JoinRoomResponse;
      const session: StoredSession = {
        roomCode: roomCode.trim().toUpperCase(),
        playerId: joinResponse.playerId,
        playerSecret: joinResponse.playerSecret
      };
      storeSession(session);
    });

    // Wait for game state update
    socket.once('gameStateUpdate', (view: GameView) => {
      const session = getStoredSession();
      if (session) {
        onJoinRoom(session, view);
      }
    });
  };

  if (reconnecting) {
    return (
      <div className="lobby">
        <h1>Chess Clock UNO</h1>
        <p>Reconnecting to room...</p>
      </div>
    );
  }

  return (
    <div className="lobby">
      <h1>Chess Clock UNO</h1>
      
      <div className="form-group">
        <label htmlFor="displayName">Display Name</label>
        <input
          id="displayName"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Enter your name"
          maxLength={24}
          disabled={loading}
        />
      </div>

      <div className="actions">
        <button 
          onClick={handleCreateRoom} 
          disabled={loading || !displayName.trim()}
        >
          Create Room
        </button>
      </div>

      <div className="divider">or</div>

      <div className="form-group">
        <label htmlFor="roomCode">Room Code</label>
        <input
          id="roomCode"
          type="text"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          placeholder="Enter room code"
          maxLength={6}
          disabled={loading}
        />
      </div>

      <div className="actions">
        <button 
          onClick={handleJoinRoom} 
          disabled={loading || !displayName.trim() || !roomCode.trim()}
        >
          Join Room
        </button>
      </div>

      {error && <p className="error">{error}</p>}
    </div>
  );
}
