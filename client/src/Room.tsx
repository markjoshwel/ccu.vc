import { useEffect } from 'react';
import type { GameView } from '@ccu/shared';
import { getSocket } from './socket';
import { StoredSession, clearSession } from './storage';

interface RoomProps {
  session: StoredSession;
  gameView: GameView;
  onGameViewUpdate: (view: GameView) => void;
  onLeaveRoom: () => void;
}

export default function Room({ session, gameView, onGameViewUpdate, onLeaveRoom }: RoomProps) {
  useEffect(() => {
    const socket = getSocket();
    
    socket.on('gameStateUpdate', onGameViewUpdate);
    
    socket.on('error', (message) => {
      console.error('Socket error:', message);
    });

    return () => {
      socket.off('gameStateUpdate', onGameViewUpdate);
      socket.off('error');
    };
  }, [onGameViewUpdate]);

  const handleLeave = () => {
    clearSession();
    onLeaveRoom();
  };

  return (
    <div className="room">
      <header className="room-header">
        <h2>Room: {session.roomCode}</h2>
        <button onClick={handleLeave}>Leave Room</button>
      </header>

      <div className="room-info">
        <p>Phase: {gameView.phase}</p>
        <p>Players: {gameView.opponents.length + 1}</p>
        <p>You: {gameView.myPlayerId}</p>
      </div>

      <div className="players-list">
        <h3>Players</h3>
        <ul>
          <li className={gameView.currentPlayerId === gameView.myPlayerId ? 'active' : ''}>
            You ({gameView.myHand.length} cards)
            {gameView.hostPlayerId === gameView.myPlayerId && ' (Host)'}
          </li>
          {gameView.opponents.map(opponent => (
            <li 
              key={opponent.playerId}
              className={`${gameView.currentPlayerId === opponent.playerId ? 'active' : ''} ${!opponent.connected ? 'disconnected' : ''}`}
            >
              {opponent.displayName} ({opponent.handCount} cards)
              {!opponent.connected && ' [Disconnected]'}
              {gameView.hostPlayerId === opponent.playerId && ' (Host)'}
            </li>
          ))}
        </ul>
      </div>

      {gameView.phase === 'lobby' && (
        <div className="lobby-info">
          <p>Waiting for host to start the game...</p>
          {gameView.hostPlayerId === gameView.myPlayerId && (
            <p>You are the host. Start game feature coming soon!</p>
          )}
        </div>
      )}

      {gameView.discardTop && (
        <div className="discard-pile">
          <h3>Discard Pile</h3>
          <div className="card">
            {gameView.discardTop.type === 'number' && (
              <span>{gameView.discardTop.color} {gameView.discardTop.value}</span>
            )}
            {gameView.discardTop.type === 'action' && (
              <span>{gameView.discardTop.color} {gameView.discardTop.value}</span>
            )}
            {gameView.discardTop.type === 'wild' && (
              <span>{gameView.discardTop.wildType}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
