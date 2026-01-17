import { useEffect, useCallback, useState } from 'react';
import type { GameView, CardWithId, CardColor } from '@ccu/shared';
import { getSocket } from './socket';
import { StoredSession, clearSession } from './storage';

interface RoomProps {
  session: StoredSession;
  gameView: GameView;
  onGameViewUpdate: (view: GameView) => void;
  onLeaveRoom: () => void;
}

// Card color to CSS color mapping
const colorMap: Record<CardColor, string> = {
  red: '#e63946',
  yellow: '#f4a261',
  green: '#2a9d8f',
  blue: '#457b9d'
};

function CardComponent({ card, onClick, disabled }: { 
  card: CardWithId; 
  onClick?: () => void;
  disabled?: boolean;
}) {
  const getCardLabel = () => {
    if (card.type === 'number') {
      return String(card.value);
    }
    if (card.type === 'action') {
      return card.value.toUpperCase();
    }
    if (card.type === 'wild') {
      return card.wildType === 'wild4' ? '+4' : 'WILD';
    }
    return '?';
  };

  const getCardColor = () => {
    if (card.type === 'wild') {
      return '#1a1a1a';
    }
    if (card.type === 'number' || card.type === 'action') {
      return colorMap[card.color];
    }
    return '#666';
  };

  return (
    <button
      className="card"
      style={{ 
        backgroundColor: getCardColor(),
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.7 : 1
      }}
      onClick={onClick}
      disabled={disabled}
    >
      {getCardLabel()}
    </button>
  );
}

function ColorPicker({ onSelect, onCancel }: { 
  onSelect: (color: CardColor) => void;
  onCancel: () => void;
}) {
  return (
    <div className="color-picker-overlay">
      <div className="color-picker">
        <h3>Choose a color</h3>
        <div className="color-options">
          {(['red', 'yellow', 'green', 'blue'] as CardColor[]).map(color => (
            <button
              key={color}
              className="color-option"
              style={{ backgroundColor: colorMap[color] }}
              onClick={() => onSelect(color)}
            >
              {color}
            </button>
          ))}
        </div>
        <button className="cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function Room({ session, gameView, onGameViewUpdate, onLeaveRoom }: RoomProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [colorPickerCard, setColorPickerCard] = useState<CardWithId | null>(null);

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

  const handleStartGame = useCallback(() => {
    const socket = getSocket();
    const actionId = `start-${Date.now()}`;
    setPendingAction(actionId);
    
    socket.emit('startGame', { actionId }, (ack) => {
      setPendingAction(null);
      if (!ack.ok) {
        console.error('Start game failed:', ack.errorCode);
      }
    });
  }, []);

  const handlePlayCard = useCallback((card: CardWithId) => {
    // If wild card, show color picker
    if (card.type === 'wild') {
      setColorPickerCard(card);
      return;
    }

    const socket = getSocket();
    const actionId = `play-${Date.now()}`;
    setPendingAction(actionId);
    
    socket.emit('playCard', { actionId, cardId: card.id }, (ack) => {
      setPendingAction(null);
      if (!ack.ok) {
        console.error('Play card failed:', ack.errorCode);
      }
    });
  }, []);

  const handleColorSelect = useCallback((color: CardColor) => {
    if (!colorPickerCard) return;
    
    const socket = getSocket();
    const actionId = `play-${Date.now()}`;
    setPendingAction(actionId);
    
    socket.emit('playCard', { 
      actionId, 
      cardId: colorPickerCard.id, 
      chosenColor: color 
    }, (ack) => {
      setPendingAction(null);
      setColorPickerCard(null);
      if (!ack.ok) {
        console.error('Play wild card failed:', ack.errorCode);
      }
    });
  }, [colorPickerCard]);

  const handleDrawCard = useCallback(() => {
    const socket = getSocket();
    const actionId = `draw-${Date.now()}`;
    setPendingAction(actionId);
    
    socket.emit('drawCard', { actionId }, (ack) => {
      setPendingAction(null);
      if (!ack.ok) {
        console.error('Draw card failed:', ack.errorCode);
      }
    });
  }, []);

  const isMyTurn = gameView.currentPlayerId === gameView.myPlayerId;

  return (
    <div className="room">
      <header className="room-header">
        <h2>Room: {session.roomCode}</h2>
        <button onClick={handleLeave}>Leave Room</button>
      </header>

      {/* Finished state */}
      {gameView.phase === 'finished' && (
        <div className="game-finished">
          <h2>🎉 Game Over!</h2>
          <p>
            {gameView.winnerId === gameView.myPlayerId 
              ? 'You won!' 
              : `${gameView.opponents.find(o => o.playerId === gameView.winnerId)?.displayName || 'Someone'} won!`
            }
          </p>
        </div>
      )}

      {/* Lobby state */}
      {gameView.phase === 'lobby' && (
        <div className="lobby-info">
          <p>Players: {gameView.opponents.length + 1}/{gameView.settings.maxPlayers}</p>
          {gameView.hostPlayerId === gameView.myPlayerId ? (
            <button 
              className="start-btn"
              onClick={handleStartGame}
              disabled={gameView.opponents.length < 1 || pendingAction !== null}
            >
              {pendingAction ? 'Starting...' : 'Start Game'}
            </button>
          ) : (
            <p>Waiting for host to start the game...</p>
          )}
        </div>
      )}

      {/* Playing state */}
      {gameView.phase === 'playing' && (
        <div className="game-area">
          <div className="turn-indicator">
            {isMyTurn ? (
              <span className="your-turn">🎯 Your Turn!</span>
            ) : (
              <span>Waiting for {gameView.opponents.find(o => o.playerId === gameView.currentPlayerId)?.displayName}...</span>
            )}
          </div>

          <div className="active-color">
            Active Color: 
            <span 
              className="color-badge" 
              style={{ backgroundColor: gameView.activeColor ? colorMap[gameView.activeColor] : '#666' }}
            >
              {gameView.activeColor || 'None'}
            </span>
          </div>

          {/* Discard pile */}
          <div className="discard-pile">
            <h3>Discard Pile</h3>
            {gameView.discardTop && (
              <CardComponent card={gameView.discardTop} disabled />
            )}
          </div>

          {/* Draw button */}
          {isMyTurn && (
            <div className="draw-area">
              <button 
                className="draw-btn"
                onClick={handleDrawCard}
                disabled={pendingAction !== null}
              >
                {pendingAction ? 'Drawing...' : 'Draw Card'}
              </button>
            </div>
          )}

          {/* Player's hand */}
          <div className="hand">
            <h3>Your Hand ({gameView.myHand.length} cards)</h3>
            <div className="hand-cards">
              {gameView.myHand.map(card => (
                <CardComponent
                  key={card.id}
                  card={card}
                  onClick={() => handlePlayCard(card)}
                  disabled={!isMyTurn || pendingAction !== null}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Players list */}
      <div className="players-list">
        <h3>Players</h3>
        <ul>
          <li className={gameView.currentPlayerId === gameView.myPlayerId ? 'active' : ''}>
            You ({gameView.myHand.length} cards)
            {gameView.hostPlayerId === gameView.myPlayerId && ' 👑'}
          </li>
          {gameView.opponents.map(opponent => (
            <li 
              key={opponent.playerId}
              className={`${gameView.currentPlayerId === opponent.playerId ? 'active' : ''} ${!opponent.connected ? 'disconnected' : ''}`}
            >
              {opponent.displayName} ({opponent.handCount} cards)
              {!opponent.connected && ' [Disconnected]'}
              {gameView.hostPlayerId === opponent.playerId && ' 👑'}
            </li>
          ))}
        </ul>
      </div>

      {/* Color picker modal */}
      {colorPickerCard && (
        <ColorPicker 
          onSelect={handleColorSelect}
          onCancel={() => setColorPickerCard(null)}
        />
      )}
    </div>
  );
}
