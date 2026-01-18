import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import type { RoomState, PlayerPublic, ServerToClientEvents, ClientToServerEvents, Card, GameView } from 'shared';

const STORAGE_KEYS = {
  PLAYER_SECRET: 'playerSecret',
  PLAYER_ID: 'playerId',
  ROOM_CODE: 'roomCode',
  DISPLAY_NAME: 'displayName',
  AVATAR_ID: 'avatarId'
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
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [avatarUploadError, setAvatarUploadError] = useState('');
  const [avatarUrlInput, setAvatarUrlInput] = useState('');
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [players, setPlayers] = useState<PlayerPublic[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());
  const [gameView, setGameView] = useState<GameView | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pendingWildCard, setPendingWildCard] = useState<Card | null>(null);
  const [clockSync, setClockSync] = useState<import('shared').ClockSyncData | null>(null);
  const [interpolatedTime, setInterpolatedTime] = useState<{ [playerId: string]: number }>({});
  const [reducedMotion, setReducedMotion] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ playerId: string; playerName: string; message: string; timestamp: number }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const isChatOpenRef = useRef(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (!clockSync) return;

    const updateInterval = reducedMotion ? 1000 : 100;
    let lastSyncTime = Date.now();

    const updateInterpolatedTime = () => {
      const now = Date.now();
      const elapsed = now - lastSyncTime;
      
      setInterpolatedTime(() => {
        const newInterpolatedTime: { [playerId: string]: number } = {};
        
        for (const [playerId, timeRemainingMs] of Object.entries(clockSync.timeRemainingMs)) {
          const remainingTime = Math.max(0, timeRemainingMs - elapsed);
          newInterpolatedTime[playerId] = remainingTime;
        }
        
        return newInterpolatedTime;
      });

      lastSyncTime = now;
    };

    const intervalId = setInterval(updateInterpolatedTime, updateInterval);
    return () => clearInterval(intervalId);
  }, [clockSync, reducedMotion]);

  useEffect(() => {
    const storedSecret = localStorage.getItem(STORAGE_KEYS.PLAYER_SECRET);
    const storedPlayerId = localStorage.getItem(STORAGE_KEYS.PLAYER_ID);
    const storedRoomCode = localStorage.getItem(STORAGE_KEYS.ROOM_CODE);
    const storedDisplayName = localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME);
    const storedAvatarId = localStorage.getItem(STORAGE_KEYS.AVATAR_ID);

    if (storedSecret && storedPlayerId && storedRoomCode && storedDisplayName) {
      setDisplayName(storedDisplayName);
      setAvatarId(storedAvatarId);
      setLoading(true);

      const newSocket = io('http://localhost:3000');

      newSocket.on('actionAck', ({ actionId }: { actionId: string; ok: boolean }) => {
        setPendingActions((prev) => {
          const next = new Set(prev);
          next.delete(actionId);
          return next;
        });
      });

      newSocket.on('chatMessage', (data) => {
        setChatMessages((prev) => [...prev, data]);
        if (!isChatOpenRef.current) {
          setUnreadCount((count) => count + 1);
        }
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

      newSocket.on('clockSync', (data) => {
        setClockSync(data);
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

    newSocket.on('actionAck', ({ actionId }: { actionId: string; ok: boolean }) => {
      setPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(actionId);
        return next;
      });
    });

    newSocket.on('chatMessage', (data) => {
      setChatMessages((prev) => [...prev, data]);
      if (!isChatOpenRef.current) {
        setUnreadCount((count) => count + 1);
      }
    });

    newSocket.emit('create_room', (response: { roomCode: string }) => {
      localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, displayName);
      if (avatarId) {
        localStorage.setItem(STORAGE_KEYS.AVATAR_ID, avatarId);
      } else {
        localStorage.removeItem(STORAGE_KEYS.AVATAR_ID);
      }
      setJoinRoomCode(response.roomCode);
    });

    newSocket.on('connect', () => {
      const joinActionId = generateActionId();
      setPendingActions((prev) => new Set(prev).add(joinActionId));
      newSocket.emit('join_room', joinActionId, joinRoomCode || roomCode, displayName, avatarId, (response: { error: string } | { playerId: string; playerSecret: string }) => {
        if ('error' in response) {
          setError(response.error);
          setLoading(false);
        } else {
          localStorage.setItem(STORAGE_KEYS.PLAYER_SECRET, response.playerSecret);
          localStorage.setItem(STORAGE_KEYS.PLAYER_ID, response.playerId);
          localStorage.setItem(STORAGE_KEYS.ROOM_CODE, joinRoomCode || roomCode);
          if (avatarId) {
            localStorage.setItem(STORAGE_KEYS.AVATAR_ID, avatarId);
          } else {
            localStorage.removeItem(STORAGE_KEYS.AVATAR_ID);
          }
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

    newSocket.on('actionAck', ({ actionId }: { actionId: string; ok: boolean }) => {
      setPendingActions((prev) => {
        const next = new Set(prev);
        next.delete(actionId);
        return next;
      });
    });

    newSocket.on('chatMessage', (data) => {
      setChatMessages((prev) => [...prev, data]);
      if (!isChatOpenRef.current) {
        setUnreadCount((count) => count + 1);
      }
    });

    newSocket.on('connect', () => {
      const joinActionId = generateActionId();
      setPendingActions((prev) => new Set(prev).add(joinActionId));
      newSocket.emit('join_room', joinActionId, joinRoomCode, displayName, avatarId, (response: { error: string } | { playerId: string; playerSecret: string }) => {
        if ('error' in response) {
          setError(response.error);
          setLoading(false);
          newSocket.disconnect();
        } else {
          localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, displayName);
          localStorage.setItem(STORAGE_KEYS.PLAYER_SECRET, response.playerSecret);
          localStorage.setItem(STORAGE_KEYS.PLAYER_ID, response.playerId);
          localStorage.setItem(STORAGE_KEYS.ROOM_CODE, joinRoomCode);
          if (avatarId) {
            localStorage.setItem(STORAGE_KEYS.AVATAR_ID, avatarId);
          } else {
            localStorage.removeItem(STORAGE_KEYS.AVATAR_ID);
          }
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

    newSocket.on('clockSync', (data) => {
      setClockSync(data);
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
    localStorage.removeItem(STORAGE_KEYS.AVATAR_ID);
    socket?.disconnect();
    setSocket(null);
    setRoom(null);
    setPlayers([]);
    setGameView(null);
    setClockSync(null);
    setInterpolatedTime({});
    setChatMessages([]);
    setUnreadCount(0);
    setIsChatOpen(false);
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

  const handleCallUno = () => {
    if (!socket) return;

    const actionId = generateActionId();
    setPendingActions((prev) => new Set(prev).add(actionId));

    socket.emit('callUno', actionId, (response) => {
      if (!response.success) {
        setError(response.error || 'Failed to call UNO');
      }
    });
  };

  const handleCatchUno = (targetPlayerId: string) => {
    if (!socket) return;

    const actionId = generateActionId();
    setPendingActions((prev) => new Set(prev).add(actionId));

    socket.emit('catchUno', actionId, targetPlayerId, (response) => {
      if (!response.success) {
        setError(response.error || 'Failed to catch UNO');
      }
    });
  };

  const handleSendChat = () => {
    if (!socket || !chatInput.trim()) return;
    const actionId = generateActionId();
    setPendingActions((prev) => new Set(prev).add(actionId));
    const message = chatInput.trim();
    setChatInput('');
    socket.emit('sendChat', actionId, message, (response) => {
      if (!response.success) {
        setError(response.error || 'Failed to send message');
      }
    });
  };

  const toggleChat = () => {
    setIsChatOpen((open) => {
      const next = !open;
      isChatOpenRef.current = next;
      if (next) {
        setUnreadCount(0);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!isChatOpen) return;
    setUnreadCount(0);
    if (chatListRef.current) {
      chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
    }
  }, [chatMessages, isChatOpen]);

  const isCreatePending = pendingActions.size > 0;
  const isJoinPending = pendingActions.size > 0;

  const handleAvatarUpload = async (file: File) => {
    setAvatarUploadError('');
    setIsUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('http://localhost:3000/avatar/upload', {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Upload failed');
      }
      const json = await res.json();
      if (!json.avatarId) {
        throw new Error('Upload did not return avatarId');
      }
      setAvatarId(json.avatarId);
      setAvatarUrlInput('');
    } catch (err) {
      setAvatarUploadError((err as Error).message || 'Failed to upload avatar');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleAvatarUrlSubmit = async () => {
    if (!avatarUrlInput.trim()) {
      setAvatarUploadError('Please enter an image URL');
      return;
    }
    setAvatarUploadError('');
    setIsUploadingAvatar(true);
    try {
      const res = await fetch('http://localhost:3000/avatar/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: avatarUrlInput.trim() })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'URL upload failed');
      }
      const json = await res.json();
      if (!json.avatarId) {
        throw new Error('Request did not return avatarId');
      }
      setAvatarId(json.avatarId);
      setAvatarUrlInput('');
    } catch (err) {
      setAvatarUploadError((err as Error).message || 'Failed to add avatar from URL');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleAvatarFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleAvatarUpload(file);
    }
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

    const myName = players.find((p) => p.id === myPlayerId)?.name;

    const formatTime = (ms: number): string => {
      const seconds = Math.ceil(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    };

    const getPlayerTime = (playerId: string): number => {
      if (interpolatedTime[playerId] !== undefined) {
        return interpolatedTime[playerId];
      }
      if (clockSync?.timeRemainingMs[playerId] !== undefined) {
        return clockSync.timeRemainingMs[playerId];
      }
      return 0;
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
                    {room.gameStatus === 'playing' && (
                      <span className={`clock-time ${room.currentPlayerIndex === index ? 'active' : ''}`}>
                        {formatTime(getPlayerTime(player.id))}
                      </span>
                    )}
                    {room.gameStatus === 'playing' && room.unoWindow && room.unoWindow.playerId === player.id && !room.unoWindow.called && player.id !== myPlayerId && (
                      <button
                        onClick={() => handleCatchUno(player.id)}
                        disabled={isPlayPending}
                        className="catch-btn"
                        style={{ marginTop: '8px' }}
                      >
                        {isPlayPending ? 'Catching...' : 'Catch UNO!'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {gameView && gameView.me.hand && gameView.me.hand.length > 0 && (
            <div className="hand-area">
              <h2>Your Hand</h2>
              {room.unoWindow && room.unoWindow.playerId === myPlayerId && !room.unoWindow.called && gameView.me.hand.length === 1 && (
                <button
                  onClick={handleCallUno}
                  disabled={isPlayPending}
                  className="uno-btn"
                  style={{ marginBottom: '16px' }}
                >
                  {isPlayPending ? 'Calling...' : 'Call UNO!'}
                </button>
              )}
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

          <div className="chat-shell">
            <button className="chat-toggle" onClick={toggleChat} aria-expanded={isChatOpen} aria-controls="room-chat">
              <span>Room Chat</span>
              {unreadCount > 0 && <span className="badge" aria-label={`${unreadCount} unread messages`}>{unreadCount}</span>}
              <span className="chat-toggle-state">{isChatOpen ? 'Hide' : 'Show'}</span>
            </button>

            <div id="room-chat" className={`chat-drawer ${isChatOpen ? 'open' : ''}`}>
              <div className="chat-header">
                <div>
                  <div className="chat-title">Room Chat</div>
                  <div className="chat-subtitle">Messages are visible to everyone</div>
                </div>
                <button className="chat-close" onClick={toggleChat}>
                  {isChatOpen ? 'Close' : 'Open'}
                </button>
              </div>
              <div className="chat-messages" ref={chatListRef}>
                {chatMessages.map((msg, index) => (
                  <div key={index} className={`chat-message ${msg.playerId === myPlayerId ? 'me' : ''}`}>
                    <div className="chat-meta">
                      <span className="chat-author">{msg.playerName}</span>
                      <span className="chat-time">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="chat-text">{msg.message}</div>
                  </div>
                ))}
              </div>
              <div className="chat-input-row">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type a message"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                />
                <button onClick={handleSendChat} disabled={!chatInput.trim() || pendingActions.size > 0}>
                  Send
                </button>
              </div>
            </div>
          </div>

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
        <div className="form-group">
          <label>Avatar (optional)</label>
          <div className="avatar-inputs">
            <div className="avatar-file">
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleAvatarFileChange} disabled={isUploadingAvatar} />
            </div>
            <div className="avatar-url">
              <input
                type="url"
                value={avatarUrlInput}
                onChange={(e) => setAvatarUrlInput(e.target.value)}
                placeholder="https://example.com/avatar.png"
                disabled={isUploadingAvatar}
              />
              <button type="button" onClick={handleAvatarUrlSubmit} disabled={isUploadingAvatar || !avatarUrlInput.trim()}>
                {isUploadingAvatar ? 'Adding...' : 'Use URL'}
              </button>
            </div>
            {avatarId && <div className="avatar-selected">Avatar selected</div>}
            {avatarUploadError && <div className="error" style={{ textAlign: 'left' }}>{avatarUploadError}</div>}
          </div>
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