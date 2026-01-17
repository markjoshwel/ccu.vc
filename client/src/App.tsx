import { useState, useCallback } from 'react';
import type { GameView } from '@ccu/shared';
import Lobby from './Lobby';
import Room from './Room';
import { StoredSession, clearSession } from './storage';
import { disconnectSocket } from './socket';
import './App.css';

function App() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [gameView, setGameView] = useState<GameView | null>(null);

  const handleJoinRoom = useCallback((newSession: StoredSession, view: GameView) => {
    setSession(newSession);
    setGameView(view);
  }, []);

  const handleLeaveRoom = useCallback(() => {
    clearSession();
    disconnectSocket();
    setSession(null);
    setGameView(null);
  }, []);

  const handleGameViewUpdate = useCallback((view: GameView) => {
    setGameView(view);
  }, []);

  if (session && gameView) {
    return (
      <Room 
        session={session} 
        gameView={gameView} 
        onGameViewUpdate={handleGameViewUpdate}
        onLeaveRoom={handleLeaveRoom}
      />
    );
  }

  return <Lobby onJoinRoom={handleJoinRoom} />;
}

export default App;
