import { useState, useEffect, useRef, useCallback, ChangeEvent } from 'react';
import { animated, useSprings } from '@react-spring/web';
import { useDrag } from '@use-gesture/react';
import { io, Socket } from 'socket.io-client';
import type {
  RoomState,
  PlayerPublic,
  PlayerPrivate,
  ServerToClientEvents,
  ClientToServerEvents,
  Card,
  GameView,
  ClockSyncData,
  ChatMessage,
  RoomSettings
} from 'shared';

// ============================================================================
// Constants & Types
// ============================================================================

const STORAGE_KEYS = {
  PLAYER_SECRET: 'playerSecret',
  PLAYER_ID: 'playerId',
  ROOM_CODE: 'roomCode',
  DISPLAY_NAME: 'displayName',
  AVATAR_ID: 'avatarId'
} as const;

const SERVER_URL = 'http://localhost:3000';

type AppView = 'lobby' | 'room';

// Material Design 3-inspired color palette
const THEME = {
  surface: '#1C1B1F',
  surfaceDim: '#141316',
  surfaceContainer: '#211F26',
  surfaceContainerHigh: '#2B2930',
  surfaceContainerHighest: '#36343B',
  onSurface: '#E6E1E5',
  onSurfaceVariant: '#CAC4D0',
  outline: '#938F99',
  outlineVariant: '#49454F',
  primary: '#D0BCFF',
  onPrimary: '#381E72',
  primaryContainer: '#4F378B',
  onPrimaryContainer: '#EADDFF',
  secondary: '#CCC2DC',
  tertiary: '#EFB8C8',
  error: '#F2B8B5',
  errorContainer: '#8C1D18',
  // Card colors (solid, vibrant)
  cardRed: '#EF5350',
  cardBlue: '#42A5F5',
  cardGreen: '#66BB6A',
  cardYellow: '#FFEE58',
  cardWild: '#1C1B1F',
} as const;

// Card background colors (solid colors, no gradients for minimalist look)
const CARD_COLORS: Record<string, string> = {
  red: THEME.cardRed,
  blue: THEME.cardBlue,
  green: THEME.cardGreen,
  yellow: THEME.cardYellow,
  wild: THEME.cardWild,
};

// ============================================================================
// Utility Functions
// ============================================================================

function generateActionId(): string {
  return `action_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// Format time with milliseconds for chess clock: M:SS.cc
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}

// Format time without milliseconds for compact display
function formatTimeCompact(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function isPlayerPrivate(player: PlayerPublic | PlayerPrivate): player is PlayerPrivate {
  return 'hand' in player;
}

function getPlayerHandCount(player: PlayerPublic | PlayerPrivate): number {
  if (isPlayerPrivate(player)) {
    return player.hand?.length || 0;
  }
  return player.handCount || 0;
}

// ============================================================================
// Custom Hooks
// ============================================================================

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return reducedMotion;
}

function useClockInterpolation(
  clockSync: ClockSyncData | null,
  reducedMotion: boolean
): Record<string, number> {
  const [interpolatedTime, setInterpolatedTime] = useState<Record<string, number>>({});
  const lastSyncRef = useRef<{ data: ClockSyncData; timestamp: number } | null>(null);

  useEffect(() => {
    if (!clockSync) {
      setInterpolatedTime({});
      lastSyncRef.current = null;
      return;
    }

    // Store the sync data with the timestamp it was received
    lastSyncRef.current = { data: clockSync, timestamp: Date.now() };

    // Update more frequently to show centiseconds
    const updateInterval = reducedMotion ? 1000 : 37; // ~27fps for smooth centiseconds

    const updateInterpolatedTime = () => {
      const sync = lastSyncRef.current;
      if (!sync) return;

      const elapsed = Date.now() - sync.timestamp;
      const newInterpolatedTime: Record<string, number> = {};

      for (const [playerId, timeRemainingMs] of Object.entries(sync.data.timeRemainingMs)) {
        // Only decrement the active player's time
        if (playerId === sync.data.activePlayerId) {
          newInterpolatedTime[playerId] = Math.max(0, timeRemainingMs - elapsed);
        } else {
          newInterpolatedTime[playerId] = timeRemainingMs;
        }
      }

      setInterpolatedTime(newInterpolatedTime);
    };

    // Initial update
    updateInterpolatedTime();

    const intervalId = setInterval(updateInterpolatedTime, updateInterval);
    return () => clearInterval(intervalId);
  }, [clockSync, reducedMotion]);

  return interpolatedTime;
}

// ============================================================================
// SVG Card Icons (UNO Minimalista Style)
// ============================================================================

interface CardIconProps {
  className?: string;
}

// Skip icon: Circle with diagonal line (prohibition sign)
function SkipIcon({ className = "w-10 h-10" }: CardIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none" />
      <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Reverse icon: Two curved arrows forming a loop
function ReverseIcon({ className = "w-10 h-10" }: CardIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M7 10L4 7L7 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 7H14C17.3137 7 20 9.68629 20 13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M17 14L20 17L17 20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 17H10C6.68629 17 4 14.3137 4 11"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Draw2 icon: Two overlapping card rectangles
function Draw2Icon({ className = "w-10 h-10" }: CardIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="3" y="5" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
      <rect x="9" y="3" width="12" height="16" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  );
}

// Wild icon: Four-segment color wheel
function WildIcon({ className = "w-12 h-12" }: CardIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1.5" fill="none" />
      <path d="M12 2A10 10 0 0 1 22 12H12V2Z" fill={THEME.cardRed} />
      <path d="M22 12A10 10 0 0 1 12 22V12H22Z" fill={THEME.cardBlue} />
      <path d="M12 22A10 10 0 0 1 2 12H12V22Z" fill={THEME.cardGreen} />
      <path d="M2 12A10 10 0 0 1 12 2V12H2Z" fill={THEME.cardYellow} />
      <circle cx="12" cy="12" r="3" fill="white" />
    </svg>
  );
}

// WildDraw4 icon: Four overlapping colored cards
function WildDraw4Icon({ className = "w-12 h-12" }: CardIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      <rect x="2" y="6" width="10" height="14" rx="1.5" fill={THEME.cardRed} stroke="white" strokeWidth="0.5" />
      <rect x="5" y="4" width="10" height="14" rx="1.5" fill={THEME.cardYellow} stroke="white" strokeWidth="0.5" />
      <rect x="9" y="5" width="10" height="14" rx="1.5" fill={THEME.cardGreen} stroke="white" strokeWidth="0.5" />
      <rect x="12" y="3" width="10" height="14" rx="1.5" fill={THEME.cardBlue} stroke="white" strokeWidth="0.5" />
    </svg>
  );
}

// Number display component for cards
function CardNumber({ value, size = 'md' }: { value: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClasses = {
    sm: 'text-xl',
    md: 'text-3xl',
    lg: 'text-4xl',
  };
  return (
    <span className={`font-bold ${sizeClasses[size]} drop-shadow-md`} style={{ fontFamily: 'Arial Black, sans-serif' }}>
      {value}
    </span>
  );
}

// Get the appropriate icon/content for a card value
function CardContent({ value, size = 'md' }: { value: string; size?: 'sm' | 'md' | 'lg' }) {
  const iconSizes = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
  };

  switch (value) {
    case 'skip':
      return <SkipIcon className={iconSizes[size]} />;
    case 'reverse':
      return <ReverseIcon className={iconSizes[size]} />;
    case 'draw2':
      return <Draw2Icon className={iconSizes[size]} />;
    case 'wild':
      return <WildIcon className={iconSizes[size]} />;
    case 'wild_draw4':
      return <WildDraw4Icon className={iconSizes[size]} />;
    default:
      return <CardNumber value={value} size={size} />;
  }
}

// Corner indicator for cards
function CornerIndicator({ value, position }: { value: string; position: 'top-left' | 'bottom-right' }) {
  const positionClasses = position === 'top-left' 
    ? 'top-1 left-1.5' 
    : 'bottom-1 right-1.5 rotate-180';
  
  const displayValue = value === 'wild' ? 'W' 
    : value === 'wild_draw4' ? '+4' 
    : value === 'draw2' ? '+2'
    : value === 'skip' ? 'S'
    : value === 'reverse' ? 'R'
    : value;

  return (
    <span 
      className={`absolute ${positionClasses} text-xs font-bold opacity-90`}
      style={{ fontFamily: 'Arial, sans-serif' }}
    >
      {displayValue}
    </span>
  );
}

// ============================================================================
// Components
// ============================================================================

interface LoadingScreenProps {
  message?: string;
}

function LoadingScreen({ message = 'Connecting...' }: LoadingScreenProps) {
  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: THEME.surfaceDim }}
    >
      <div 
        className="rounded-2xl p-8 shadow-2xl border"
        style={{ 
          backgroundColor: THEME.surfaceContainer,
          borderColor: THEME.outlineVariant 
        }}
      >
        <div className="flex items-center gap-3">
          <div 
            className="w-5 h-5 border-2 rounded-full animate-spin"
            style={{ borderColor: THEME.outlineVariant, borderTopColor: THEME.primary }}
          />
          <span className="text-lg" style={{ color: THEME.onSurface }}>{message}</span>
        </div>
      </div>
    </div>
  );
}

interface ErrorMessageProps {
  message: string;
  onDismiss?: () => void;
}

function ErrorMessage({ message, onDismiss }: ErrorMessageProps) {
  if (!message) return null;

  return (
    <div 
      className="rounded-xl p-3 mb-4 flex items-center justify-between border"
      style={{ 
        backgroundColor: `${THEME.errorContainer}33`,
        borderColor: THEME.errorContainer 
      }}
    >
      <span className="text-sm" style={{ color: THEME.error }}>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="ml-2 text-lg leading-none hover:opacity-70 transition-opacity"
          style={{ color: THEME.error }}
        >
          &times;
        </button>
      )}
    </div>
  );
}

interface PlayerAvatarProps {
  avatarId?: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  connected?: boolean;
}

function PlayerAvatar({ avatarId, name, size = 'md', connected = true }: PlayerAvatarProps) {
  const sizeClasses = {
    sm: 'w-8 h-8 text-sm',
    md: 'w-10 h-10 text-base',
    lg: 'w-14 h-14 text-xl'
  };

  return (
    <div
      className={`${sizeClasses[size]} rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0 border-2
                  ${!connected ? 'opacity-50 grayscale' : ''}`}
      style={{ 
        backgroundColor: THEME.primaryContainer,
        borderColor: THEME.outline 
      }}
    >
      {avatarId ? (
        <img
          src={`${SERVER_URL}/avatars/${avatarId}`}
          alt={`${name}'s avatar`}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <span className="font-bold" style={{ color: THEME.onPrimaryContainer }}>
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

interface CardDisplayProps {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  dragging?: boolean;
  size?: 'sm' | 'md' | 'lg';
  isDropTarget?: boolean;
  style?: React.CSSProperties;
}

function CardDisplay({
  card,
  onClick,
  disabled,
  selected,
  dragging,
  size = 'md',
  isDropTarget,
  style
}: CardDisplayProps) {
  const sizes = {
    sm: { width: 48, height: 72, radius: 8 },
    md: { width: 64, height: 96, radius: 10 },
    lg: { width: 80, height: 120, radius: 12 },
  };

  const { width, height, radius } = sizes[size];
  const bgColor = CARD_COLORS[card.color] || CARD_COLORS.wild;
  const isWild = card.color === 'wild';
  const textColor = card.color === 'yellow' ? '#1C1B1F' : '#FFFFFF';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...style,
        width,
        height,
        backgroundColor: bgColor,
        borderRadius: radius,
        color: textColor,
      }}
      className={`
        relative flex items-center justify-center
        shadow-lg transition-all duration-150 border-2
        ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:-translate-y-1 hover:shadow-xl active:scale-95'}
        ${selected ? 'ring-4 ring-amber-400 -translate-y-3 shadow-xl' : ''}
        ${dragging ? 'shadow-2xl scale-110 z-50' : ''}
        ${isDropTarget ? 'ring-4 ring-emerald-400 scale-105' : ''}
        ${isWild ? 'border-white/30' : 'border-white/20'}
        touch-none select-none
      `}
    >
      {/* Corner indicators */}
      <CornerIndicator value={card.value} position="top-left" />
      <CornerIndicator value={card.value} position="bottom-right" />
      
      {/* Center content */}
      <CardContent value={card.value} size={size} />
    </button>
  );
}

interface ColorPickerModalProps {
  onSelect: (color: 'red' | 'yellow' | 'green' | 'blue') => void;
  onCancel: () => void;
}

function ColorPickerModal({ onSelect, onCancel }: ColorPickerModalProps) {
  const colors: Array<{ name: 'red' | 'yellow' | 'green' | 'blue'; bg: string; text: string }> = [
    { name: 'red', bg: THEME.cardRed, text: '#FFFFFF' },
    { name: 'yellow', bg: THEME.cardYellow, text: '#1C1B1F' },
    { name: 'green', bg: THEME.cardGreen, text: '#FFFFFF' },
    { name: 'blue', bg: THEME.cardBlue, text: '#FFFFFF' },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div 
        className="rounded-2xl p-6 max-w-sm w-full shadow-2xl border"
        style={{ backgroundColor: THEME.surfaceContainer, borderColor: THEME.outlineVariant }}
      >
        <h3 
          className="text-xl font-bold text-center mb-6"
          style={{ color: THEME.onSurface }}
        >
          Choose a Color
        </h3>
        <div className="grid grid-cols-2 gap-4 mb-6">
          {colors.map((color) => (
            <button
              key={color.name}
              onClick={() => onSelect(color.name)}
              className="py-8 rounded-xl font-bold text-lg capitalize shadow-lg
                         transform transition-all duration-150 hover:scale-105 hover:shadow-xl active:scale-95"
              style={{ backgroundColor: color.bg, color: color.text }}
            >
              {color.name}
            </button>
          ))}
        </div>
        <button
          onClick={onCancel}
          className="w-full py-3 rounded-xl font-medium transition-colors hover:opacity-80"
          style={{ backgroundColor: THEME.surfaceContainerHighest, color: THEME.onSurface }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Prominent Chess Clock display
interface ChessClockProps {
  timeMs: number;
  isActive: boolean;
  playerName: string;
  isLow?: boolean;
}

function ChessClock({ timeMs, isActive, playerName, isLow = false }: ChessClockProps) {
  const urgentThreshold = 10000; // 10 seconds
  const isUrgent = timeMs < urgentThreshold && isActive;
  
  return (
    <div 
      className={`flex flex-col items-center p-4 rounded-xl transition-all duration-200 ${isActive ? 'scale-105' : 'opacity-60'}`}
      style={{ 
        backgroundColor: isActive ? THEME.primaryContainer : THEME.surfaceContainerHigh,
        boxShadow: isActive ? '0 4px 20px rgba(208, 188, 255, 0.3)' : 'none',
      }}
    >
      <span 
        className="text-xs font-medium uppercase tracking-wider mb-1"
        style={{ color: isActive ? THEME.onPrimaryContainer : THEME.onSurfaceVariant }}
      >
        {playerName}
      </span>
      <span 
        className={`font-mono text-3xl font-bold tabular-nums ${isUrgent ? 'animate-pulse' : ''}`}
        style={{ 
          color: isUrgent ? THEME.error : isActive ? THEME.primary : THEME.onSurfaceVariant,
          textShadow: isUrgent ? '0 0 10px rgba(242, 184, 181, 0.5)' : 'none',
        }}
      >
        {formatTime(timeMs)}
      </span>
    </div>
  );
}

interface PlayerRowProps {
  player: PlayerPublic | PlayerPrivate;
  isActive: boolean;
  timeRemaining: number;
  isPlaying: boolean;
  showCatch: boolean;
  onCatch: () => void;
  isPending: boolean;
}

function PlayerRow({
  player,
  isActive,
  timeRemaining,
  isPlaying,
  showCatch,
  onCatch,
  isPending
}: PlayerRowProps) {
  const isUrgent = timeRemaining < 10000 && isActive;
  
  return (
    <div
      className="flex items-center gap-3 p-3 rounded-xl transition-all duration-200 border"
      style={{ 
        backgroundColor: isActive ? THEME.primaryContainer : THEME.surfaceContainerHigh,
        borderColor: isActive ? THEME.primary : 'transparent',
        opacity: player.connected ? 1 : 0.6,
      }}
    >
      <PlayerAvatar
        avatarId={player.avatarId}
        name={player.name}
        connected={player.connected}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span 
            className="font-semibold truncate"
            style={{ color: isActive ? THEME.onPrimaryContainer : THEME.onSurface }}
          >
            {player.name}
          </span>
          {isActive && (
            <span 
              className="px-2 py-0.5 text-xs rounded-full font-medium"
              style={{ backgroundColor: THEME.primary, color: THEME.onPrimary }}
            >
              Turn
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span style={{ color: THEME.onSurfaceVariant }}>{getPlayerHandCount(player)} cards</span>
          <span style={{ color: THEME.outline }}>-</span>
          <span style={{ color: player.connected ? THEME.cardGreen : THEME.error }}>
            {player.connected ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {isPlaying && (
        <div
          className={`font-mono text-lg font-bold tabular-nums ${isUrgent ? 'animate-pulse' : ''}`}
          style={{ 
            color: isUrgent ? THEME.error : isActive ? THEME.primary : THEME.onSurfaceVariant 
          }}
        >
          {formatTimeCompact(timeRemaining)}
        </div>
      )}

      {showCatch && (
        <button
          onClick={onCatch}
          disabled={isPending}
          className="px-3 py-1.5 text-sm font-bold rounded-lg uppercase tracking-wide
                     transition-all duration-150 animate-pulse disabled:opacity-50"
          style={{ backgroundColor: THEME.cardRed, color: '#FFFFFF' }}
        >
          Catch!
        </button>
      )}
    </div>
  );
}

interface ChatDrawerProps {
  messages: ChatMessage[];
  myPlayerId: string | null;
  onSend: (message: string) => void;
  isPending: boolean;
}

function ChatDrawer({ messages, myPlayerId, onSend, isPending }: ChatDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    } else if (wasOpenRef.current === false && messages.length > 0) {
      // Don't increment on initial load
    } else if (!isOpen && messages.length > 0) {
      setUnreadCount((prev) => prev + 1);
    }
    wasOpenRef.current = isOpen;
  }, [messages.length, isOpen]);

  const handleSend = () => {
    if (input.trim() && !isPending) {
      onSend(input.trim());
      setInput('');
    }
  };

  return (
    <div className="mt-4">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors"
        style={{ backgroundColor: THEME.surfaceContainerHigh }}
      >
        <div className="flex items-center gap-3">
          <span className="font-medium" style={{ color: THEME.onSurface }}>Room Chat</span>
          {unreadCount > 0 && (
            <span 
              className="px-2 py-0.5 text-xs rounded-full font-bold"
              style={{ backgroundColor: THEME.cardRed, color: '#FFFFFF' }}
            >
              {unreadCount}
            </span>
          )}
        </div>
        <span className="text-sm" style={{ color: THEME.onSurfaceVariant }}>
          {isOpen ? 'Hide' : 'Show'}
        </span>
      </button>

      {isOpen && (
        <div 
          className="mt-2 rounded-xl border overflow-hidden"
          style={{ backgroundColor: THEME.surfaceContainer, borderColor: THEME.outlineVariant }}
        >
          <div
            ref={listRef}
            className="max-h-64 overflow-y-auto p-4 space-y-3"
          >
            {messages.length === 0 ? (
              <p className="text-center text-sm" style={{ color: THEME.onSurfaceVariant }}>
                No messages yet
              </p>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg"
                  style={{ 
                    backgroundColor: msg.playerId === myPlayerId 
                      ? THEME.primaryContainer 
                      : THEME.surfaceContainerHighest,
                    marginLeft: msg.playerId === myPlayerId ? '2rem' : 0,
                    marginRight: msg.playerId === myPlayerId ? 0 : '2rem',
                  }}
                >
                  <div className="flex items-baseline gap-2 mb-1">
                    <span 
                      className="font-semibold text-sm"
                      style={{ color: msg.playerId === myPlayerId ? THEME.onPrimaryContainer : THEME.onSurface }}
                    >
                      {msg.playerName}
                    </span>
                    <span className="text-xs" style={{ color: THEME.onSurfaceVariant }}>
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                  <p 
                    className="text-sm break-words"
                    style={{ color: msg.playerId === myPlayerId ? THEME.onPrimaryContainer : THEME.onSurfaceVariant }}
                  >
                    {msg.message}
                  </p>
                </div>
              ))
            )}
          </div>

          <div 
            className="p-3 flex gap-2 border-t"
            style={{ borderColor: THEME.outlineVariant }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder="Type a message..."
              className="flex-1 px-3 py-2 rounded-lg focus:outline-none focus:ring-2"
              style={{ 
                backgroundColor: THEME.surfaceContainerHighest,
                color: THEME.onSurface,
                borderColor: THEME.outline,
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isPending}
              className="px-4 py-2 font-medium rounded-lg transition-colors disabled:opacity-50"
              style={{ backgroundColor: THEME.primary, color: THEME.onPrimary }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface GameFinishedOverlayProps {
  reason: string;
  onLeave: () => void;
}

function GameFinishedOverlay({ reason, onLeave }: GameFinishedOverlayProps) {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div 
        className="rounded-3xl p-8 max-w-md w-full shadow-2xl text-center border"
        style={{ backgroundColor: THEME.surfaceContainer, borderColor: THEME.primary }}
      >
        <div 
          className="w-20 h-20 mx-auto mb-4 rounded-full flex items-center justify-center text-4xl"
          style={{ backgroundColor: THEME.primaryContainer }}
        >
          <span role="img" aria-label="trophy">&#127942;</span>
        </div>
        <h2 
          className="text-3xl font-bold mb-2"
          style={{ color: THEME.onSurface }}
        >
          Game Over!
        </h2>
        <p 
          className="text-lg mb-6"
          style={{ color: THEME.onSurfaceVariant }}
        >
          {reason}
        </p>
        <button
          onClick={onLeave}
          className="px-8 py-3 font-bold rounded-xl transition-colors shadow-lg hover:opacity-90"
          style={{ backgroundColor: THEME.primary, color: THEME.onPrimary }}
        >
          Leave Room
        </button>
      </div>
    </div>
  );
}

interface HandAreaProps {
  cards: Card[];
  myTurn: boolean;
  isPending: boolean;
  onPlayCard: (card: Card, index: number) => void;
  discardRef: React.RefObject<HTMLDivElement>;
  reducedMotion: boolean;
}

function HandArea({
  cards,
  myTurn,
  isPending,
  onPlayCard,
  discardRef,
  reducedMotion
}: HandAreaProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [isOverDiscard, setIsOverDiscard] = useState(false);

  const [springs, api] = useSprings(cards.length, () => ({
    x: 0,
    y: 0,
    scale: 1,
    rotateZ: 0,
    immediate: reducedMotion
  }));

  const bind = useDrag(
    ({ args: [card, index], active, movement: [mx, my], event }) => {
      if (!myTurn || isPending) return;

      if (event?.type === 'pointerdown') {
        setSelectedIndex(index);
      }

      setDraggingIndex(active ? index : null);

      api.start((i) =>
        i === index
          ? {
              x: active ? mx : 0,
              y: active ? my : 0,
              scale: active ? 1.1 : 1,
              rotateZ: active ? mx * 0.02 : 0,
              immediate: active
            }
          : undefined
      );

      // Check if over discard pile
      if (discardRef.current && event instanceof PointerEvent) {
        const rect = discardRef.current.getBoundingClientRect();
        const over =
          active &&
          rect.left <= event.clientX &&
          event.clientX <= rect.right &&
          rect.top <= event.clientY &&
          event.clientY <= rect.bottom;
        setIsOverDiscard(!!over);
      }

      if (!active) {
        setIsOverDiscard(false);
        setDraggingIndex(null);

        if (discardRef.current && event instanceof PointerEvent) {
          const rect = discardRef.current.getBoundingClientRect();
          const wasOver =
            rect.left <= event.clientX &&
            event.clientX <= rect.right &&
            rect.top <= event.clientY &&
            event.clientY <= rect.bottom;

          if (wasOver) {
            onPlayCard(card, index);
          }
        }

        setSelectedIndex(null);
      }
    },
    { threshold: 8, pointer: { touch: true }, filterTaps: true }
  );

  const handleCardClick = (card: Card, index: number) => {
    if (!myTurn || isPending) return;
    onPlayCard(card, index);
  };

  return (
    <div className="mt-4">
      <h3 
        className="text-sm font-semibold uppercase tracking-wider mb-3"
        style={{ color: THEME.onSurfaceVariant }}
      >
        Your Hand
      </h3>
      <div className="flex flex-wrap gap-2 justify-center">
        {cards.map((card, index) => (
          <animated.div
            key={index}
            {...bind(card, index)}
            style={{
              x: springs[index].x,
              y: springs[index].y,
              scale: springs[index].scale,
              rotateZ: springs[index].rotateZ,
              zIndex: draggingIndex === index ? 50 : 1
            }}
            className="cursor-grab active:cursor-grabbing"
          >
            <CardDisplay
              card={card}
              onClick={() => handleCardClick(card, index)}
              disabled={!myTurn || isPending}
              selected={selectedIndex === index}
              dragging={draggingIndex === index}
            />
          </animated.div>
        ))}
      </div>
      {isOverDiscard && (
        <p 
          className="text-center text-sm mt-3 font-medium"
          style={{ color: THEME.cardGreen }}
        >
          Release to play card
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Main App Component
// ============================================================================

function App() {
  // State
  const [view, setView] = useState<AppView>('lobby');
  const [displayName, setDisplayName] = useState('');
  const [joinRoomCode, setJoinRoomCode] = useState('');
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [avatarUrlInput, setAvatarUrlInput] = useState('');
  const [avatarUploadError, setAvatarUploadError] = useState('');
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  // Room settings
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [aiPlayerCount, setAiPlayerCount] = useState(0);

  const [socket, setSocket] = useState<Socket<ServerToClientEvents, ClientToServerEvents> | null>(
    null
  );
  const [room, setRoom] = useState<RoomState | null>(null);
  const [gameView, setGameView] = useState<GameView | null>(null);
  const [clockSync, setClockSync] = useState<ClockSyncData | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());

  const [showColorPicker, setShowColorPicker] = useState(false);
  const [pendingWildCard, setPendingWildCard] = useState<Card | null>(null);

  const discardRef = useRef<HTMLDivElement>(null);

  const reducedMotion = useReducedMotion();
  const interpolatedTime = useClockInterpolation(clockSync, reducedMotion);

  // Derived state
  const myPlayerId = localStorage.getItem(STORAGE_KEYS.PLAYER_ID);
  const myPlayerSecret = localStorage.getItem(STORAGE_KEYS.PLAYER_SECRET);
  const storedRoomCode = localStorage.getItem(STORAGE_KEYS.ROOM_CODE);

  const allPlayers = room && gameView ? [gameView.me, ...gameView.otherPlayers] : room?.players || [];
  const myPlayer = gameView?.me || allPlayers.find((p) => p.id === myPlayerId);
  const topCard = room?.discardPile?.length ? room.discardPile[room.discardPile.length - 1] : null;
  const myTurn = !!(
    room &&
    myPlayerId &&
    room.currentPlayerIndex !== undefined &&
    allPlayers[room.currentPlayerIndex]?.id === myPlayerId
  );
  const isHost = allPlayers.length > 0 && allPlayers[0]?.id === myPlayerId;
  const isPending = pendingActions.size > 0;
  const handCards: Card[] = myPlayer && isPlayerPrivate(myPlayer) ? myPlayer.hand : [];

  // Socket event setup
  const setupSocketListeners = useCallback(
    (sock: Socket<ServerToClientEvents, ClientToServerEvents>) => {
      sock.on('actionAck', ({ actionId, ok }) => {
        setPendingActions((prev) => {
          const next = new Set(prev);
          next.delete(actionId);
          return next;
        });
      });

      sock.on('roomUpdated', (updatedRoom) => {
        setRoom(updatedRoom);
        setView('room');
        setLoading(false);
      });

      sock.on('gameStateUpdate', (view) => {
        setGameView(view);
        setRoom(view.room);
      });

      sock.on('clockSync', (data) => {
        setClockSync(data);
      });

      sock.on('chatMessage', (msg) => {
        setChatMessages((prev) => [...prev, msg]);
      });

      sock.on('chatHistory', (history) => {
        setChatMessages(history);
      });

      sock.on('error', (message) => {
        setError(message);
        setLoading(false);
      });
    },
    []
  );

  // Reconnection on mount
  useEffect(() => {
    if (myPlayerSecret && myPlayerId && storedRoomCode) {
      const storedDisplayName = localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME);
      const storedAvatarId = localStorage.getItem(STORAGE_KEYS.AVATAR_ID);

      if (storedDisplayName) {
        setDisplayName(storedDisplayName);
        setAvatarId(storedAvatarId);
        setLoading(true);

        const newSocket = io(SERVER_URL);
        setupSocketListeners(newSocket);

        newSocket.on('connect', () => {
          const actionId = generateActionId();
          setPendingActions((prev) => new Set(prev).add(actionId));

          newSocket.emit(
            'reconnect_room',
            actionId,
            storedRoomCode,
            myPlayerId,
            myPlayerSecret,
            (response: { success: boolean; error?: string }) => {
              if (!response.success) {
                // Clear stored data and go to lobby
                localStorage.removeItem(STORAGE_KEYS.PLAYER_SECRET);
                localStorage.removeItem(STORAGE_KEYS.PLAYER_ID);
                localStorage.removeItem(STORAGE_KEYS.ROOM_CODE);
                setLoading(false);
                setError(response.error || 'Reconnection failed');
              }
            }
          );
        });

        setSocket(newSocket);
      }
    }
  }, []);

  // Actions
  const handleCreateRoom = () => {
    if (!displayName.trim()) {
      setError('Please enter a display name');
      return;
    }

    setLoading(true);
    setError('');

    const roomSettings: Partial<RoomSettings> = {
      maxPlayers,
      aiPlayerCount
    };

    const newSocket = io(SERVER_URL);
    setupSocketListeners(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('create_room', generateActionId(), roomSettings, (response: { roomCode: string }) => {
        const roomCode = response.roomCode;
        setJoinRoomCode(roomCode);

        // Now join the room we just created
        const joinActionId = generateActionId();
        setPendingActions((prev) => new Set(prev).add(joinActionId));

        newSocket.emit('join_room', joinActionId, roomCode, displayName.trim(), avatarId, (joinResponse: { playerId: string; playerSecret: string } | { error: string }) => {
          if ('error' in joinResponse) {
            setError(joinResponse.error);
            setLoading(false);
          } else {
            localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, displayName.trim());
            localStorage.setItem(STORAGE_KEYS.PLAYER_SECRET, joinResponse.playerSecret);
            localStorage.setItem(STORAGE_KEYS.PLAYER_ID, joinResponse.playerId);
            localStorage.setItem(STORAGE_KEYS.ROOM_CODE, roomCode);
            if (avatarId) {
              localStorage.setItem(STORAGE_KEYS.AVATAR_ID, avatarId);
            }
          }
        });
      });
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

    const newSocket = io(SERVER_URL);
    setupSocketListeners(newSocket);

    newSocket.on('connect', () => {
      const actionId = generateActionId();
      setPendingActions((prev) => new Set(prev).add(actionId));

      newSocket.emit('join_room', actionId, joinRoomCode.toUpperCase(), displayName.trim(), avatarId, (response: { playerId: string; playerSecret: string } | { error: string }) => {
        if ('error' in response) {
          setError(response.error);
          setLoading(false);
          newSocket.disconnect();
        } else {
          localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, displayName.trim());
          localStorage.setItem(STORAGE_KEYS.PLAYER_SECRET, response.playerSecret);
          localStorage.setItem(STORAGE_KEYS.PLAYER_ID, response.playerId);
          localStorage.setItem(STORAGE_KEYS.ROOM_CODE, joinRoomCode.toUpperCase());
          if (avatarId) {
            localStorage.setItem(STORAGE_KEYS.AVATAR_ID, avatarId);
          }
        }
      });
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
    setGameView(null);
    setClockSync(null);
    setChatMessages([]);
    setView('lobby');
    setLoading(false);
    setError('');
  };

  const handleStartGame = () => {
    if (!socket) return;

    const actionId = generateActionId();
    setPendingActions((prev) => new Set(prev).add(actionId));

    socket.emit('start_game', actionId, (response) => {
      if (!response.success) {
        setError(response.error || 'Failed to start game');
      }
    });
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

    socket.emit('playCard', actionId, card, null, (response) => {
      if (!response.success) {
        setError(response.error || 'Failed to play card');
      }
    });
  };

  const handleColorSelect = (color: 'red' | 'yellow' | 'green' | 'blue') => {
    if (!socket || !pendingWildCard) return;

    const actionId = generateActionId();
    setPendingActions((prev) => new Set(prev).add(actionId));

    socket.emit('playCard', actionId, pendingWildCard, color, (response) => {
      if (!response.success) {
        setError(response.error || 'Failed to play card');
      }
    });

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

  const handleSendChat = (message: string) => {
    if (!socket) return;

    const actionId = generateActionId();
    setPendingActions((prev) => new Set(prev).add(actionId));

    socket.emit('sendChat', actionId, message, (response) => {
      if (!response.success) {
        setError(response.error || 'Failed to send message');
      }
    });
  };

  const handleAvatarUpload = async (file: File) => {
    setAvatarUploadError('');
    setIsUploadingAvatar(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${SERVER_URL}/avatar/upload`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const json = await res.json();
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
      const res = await fetch(`${SERVER_URL}/avatar/from-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: avatarUrlInput.trim() })
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const json = await res.json();
      setAvatarId(json.avatarId);
      setAvatarUrlInput('');
    } catch (err) {
      setAvatarUploadError((err as Error).message || 'Failed to add avatar from URL');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // Render
  if (loading) {
    return <LoadingScreen />;
  }

  // Room View
  if (view === 'room' && room) {
    const showUnoButton =
      room.unoWindow &&
      room.unoWindow.playerId === myPlayerId &&
      !room.unoWindow.called &&
      handCards.length === 1;

    // Find active player for prominent clock display
    const activePlayerIndex = room.currentPlayerIndex ?? 0;
    const activePlayer = allPlayers[activePlayerIndex];

    return (
      <div 
        className="min-h-screen p-4"
        style={{ backgroundColor: THEME.surfaceDim }}
      >
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 
                className="text-xl font-bold"
                style={{ color: THEME.onSurface }}
              >
                Chess Clock UNO
              </h1>
              <p style={{ color: THEME.onSurfaceVariant }}>
                Room: <span className="font-mono" style={{ color: THEME.primary }}>{room.id}</span>
              </p>
            </div>
            <button
              onClick={handleLeave}
              className="px-4 py-2 rounded-lg transition-colors text-sm font-medium"
              style={{ backgroundColor: THEME.surfaceContainerHigh, color: THEME.onSurface }}
            >
              Leave
            </button>
          </div>

          <ErrorMessage message={error} onDismiss={() => setError('')} />

          {/* Color Picker Modal */}
          {showColorPicker && (
            <ColorPickerModal 
              onSelect={handleColorSelect} 
              onCancel={() => { setShowColorPicker(false); setPendingWildCard(null); }} 
            />
          )}

          {/* Game Finished Overlay */}
          {room.gameStatus === 'finished' && room.gameEndedReason && (
            <GameFinishedOverlay reason={room.gameEndedReason} onLeave={handleLeave} />
          )}

          {/* Waiting for game to start */}
          {room.gameStatus === 'waiting' && (
            <div 
              className="rounded-2xl p-6 border"
              style={{ backgroundColor: THEME.surfaceContainer, borderColor: THEME.outlineVariant }}
            >
              <h2 
                className="text-xl font-semibold mb-4"
                style={{ color: THEME.onSurface }}
              >
                Waiting for players ({allPlayers.length}/{room.settings?.maxPlayers || 10})
              </h2>

              <div className="space-y-2 mb-6">
                {allPlayers.map((player, idx) => (
                  <div
                    key={player.id}
                    className="flex items-center gap-3 p-3 rounded-xl"
                    style={{ backgroundColor: THEME.surfaceContainerHigh }}
                  >
                    <PlayerAvatar
                      avatarId={player.avatarId}
                      name={player.name}
                      connected={player.connected}
                    />
                    <span className="font-medium" style={{ color: THEME.onSurface }}>{player.name}</span>
                    {idx === 0 && (
                      <span 
                        className="ml-auto px-2 py-0.5 text-xs rounded-full font-medium"
                        style={{ backgroundColor: THEME.primaryContainer, color: THEME.onPrimaryContainer }}
                      >
                        Host
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {isHost && (allPlayers.length >= 2 || (allPlayers.length >= 1 && (room.settings?.aiPlayerCount ?? 0) >= 1)) && (
                <button
                  onClick={handleStartGame}
                  disabled={isPending}
                  className="w-full py-4 font-bold text-lg rounded-xl transition-all duration-150 
                             disabled:opacity-50 shadow-lg hover:opacity-90"
                  style={{ backgroundColor: THEME.cardGreen, color: '#FFFFFF' }}
                >
                  {isPending ? 'Starting...' : `Start Game${(room.settings?.aiPlayerCount ?? 0) > 0 ? ` (+ ${room.settings?.aiPlayerCount} AI)` : ''}`}
                </button>
              )}

              {isHost && allPlayers.length < 2 && (room.settings?.aiPlayerCount ?? 0) === 0 && (
                <p className="text-center" style={{ color: THEME.onSurfaceVariant }}>
                  Need at least 2 players to start (or add AI opponents)
                </p>
              )}

              {!isHost && (
                <p className="text-center" style={{ color: THEME.onSurfaceVariant }}>
                  Waiting for host to start the game...
                </p>
              )}
            </div>
          )}

          {/* Playing */}
          {room.gameStatus === 'playing' && topCard && (
            <div className="space-y-4">
              {/* Prominent Chess Clock */}
              <div 
                className="rounded-2xl p-4 border"
                style={{ backgroundColor: THEME.surfaceContainer, borderColor: THEME.outlineVariant }}
              >
                <div className="flex justify-center gap-4">
                  {allPlayers.slice(0, 2).map((player, idx) => (
                    <ChessClock
                      key={player.id}
                      timeMs={interpolatedTime[player.id] || 0}
                      isActive={room.currentPlayerIndex === idx}
                      playerName={player.name}
                    />
                  ))}
                </div>
                {allPlayers.length > 2 && (
                  <div className="flex justify-center gap-2 mt-3 flex-wrap">
                    {allPlayers.slice(2).map((player, idx) => {
                      const actualIdx = idx + 2;
                      const isActive = room.currentPlayerIndex === actualIdx;
                      return (
                        <div 
                          key={player.id}
                          className="px-3 py-1 rounded-lg text-sm font-mono"
                          style={{ 
                            backgroundColor: isActive ? THEME.primaryContainer : THEME.surfaceContainerHigh,
                            color: isActive ? THEME.primary : THEME.onSurfaceVariant,
                          }}
                        >
                          {player.name}: {formatTimeCompact(interpolatedTime[player.id] || 0)}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Discard Pile & Active Color */}
              <div
                ref={discardRef}
                className="rounded-2xl p-6 border"
                style={{ backgroundColor: THEME.surfaceContainer, borderColor: THEME.outlineVariant }}
              >
                <div className="flex items-center justify-between mb-4">
                  <span 
                    className="text-sm font-medium uppercase tracking-wider"
                    style={{ color: THEME.onSurfaceVariant }}
                  >
                    Discard Pile
                  </span>
                  {room.activeColor && (
                    <div 
                      className="px-4 py-1.5 rounded-full font-bold text-sm capitalize"
                      style={{ 
                        backgroundColor: CARD_COLORS[room.activeColor],
                        color: room.activeColor === 'yellow' ? '#1C1B1F' : '#FFFFFF',
                      }}
                    >
                      {room.activeColor}
                    </div>
                  )}
                </div>

                <div className="flex justify-center">
                  <CardDisplay card={topCard} size="lg" disabled />
                </div>

                <p 
                  className="text-center text-sm mt-4"
                  style={{ color: THEME.onSurfaceVariant }}
                >
                  {myTurn ? 'Drag a card here or tap to play' : `${activePlayer?.name || 'Opponent'}'s turn`}
                </p>
              </div>

              {/* UNO Button */}
              {showUnoButton && (
                <button
                  onClick={handleCallUno}
                  disabled={isPending}
                  className="w-full py-5 font-bold text-3xl uppercase tracking-widest 
                             rounded-xl animate-pulse hover:animate-none disabled:opacity-50 shadow-lg"
                  style={{ backgroundColor: THEME.cardRed, color: '#FFFFFF' }}
                >
                  {isPending ? 'Calling...' : 'UNO!'}
                </button>
              )}

              {/* Players List */}
              <div 
                className="rounded-2xl p-4 border"
                style={{ backgroundColor: THEME.surfaceContainer, borderColor: THEME.outlineVariant }}
              >
                <h2 
                  className="text-sm font-semibold uppercase tracking-wider mb-3"
                  style={{ color: THEME.onSurfaceVariant }}
                >
                  Players
                </h2>
                <div className="space-y-2">
                  {allPlayers.map((player, idx) => (
                    <PlayerRow
                      key={player.id}
                      player={player}
                      isActive={room.currentPlayerIndex === idx}
                      timeRemaining={interpolatedTime[player.id] || 0}
                      isPlaying={room.gameStatus === 'playing'}
                      showCatch={
                        !!(
                          room.unoWindow &&
                          room.unoWindow.playerId === player.id &&
                          !room.unoWindow.called &&
                          player.id !== myPlayerId
                        )
                      }
                      onCatch={() => handleCatchUno(player.id)}
                      isPending={isPending}
                    />
                  ))}
                </div>
              </div>

              {/* Hand */}
              {handCards.length > 0 && (
                <div 
                  className="rounded-2xl p-4 border"
                  style={{ backgroundColor: THEME.surfaceContainer, borderColor: THEME.outlineVariant }}
                >
                  <HandArea
                    cards={handCards}
                    myTurn={myTurn}
                    isPending={isPending}
                    onPlayCard={(card) => handlePlayCard(card)}
                    discardRef={discardRef}
                    reducedMotion={reducedMotion}
                  />

                  {/* Draw Button */}
                  {myTurn && (
                    <button
                      onClick={handleDrawCard}
                      disabled={isPending}
                      className="w-full mt-4 py-3 font-medium rounded-xl transition-colors disabled:opacity-50"
                      style={{ backgroundColor: THEME.surfaceContainerHighest, color: THEME.onSurface }}
                    >
                      {isPending ? 'Drawing...' : 'Draw Card'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Chat */}
          <ChatDrawer
            messages={chatMessages}
            myPlayerId={myPlayerId}
            onSend={handleSendChat}
            isPending={isPending}
          />
        </div>
      </div>
    );
  }

  // Lobby View
  return (
    <div 
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: THEME.surfaceDim }}
    >
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 
            className="text-4xl font-bold mb-2"
            style={{ color: THEME.onSurface }}
          >
            Chess Clock UNO
          </h1>
          <p style={{ color: THEME.onSurfaceVariant }}>Play UNO with time pressure</p>
        </div>

        <div 
          className="rounded-2xl p-6 shadow-2xl border"
          style={{ backgroundColor: THEME.surfaceContainer, borderColor: THEME.outlineVariant }}
        >
          <ErrorMessage message={error} onDismiss={() => setError('')} />

          {/* Display Name */}
          <div className="mb-4">
            <label 
              className="block text-sm font-medium mb-2"
              style={{ color: THEME.onSurface }}
            >
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your name"
              className="w-full px-4 py-3 rounded-xl focus:outline-none focus:ring-2 border"
              style={{ 
                backgroundColor: THEME.surfaceContainerHigh,
                borderColor: THEME.outlineVariant,
                color: THEME.onSurface,
              }}
            />
          </div>

          {/* Avatar */}
          <div className="mb-6">
            <label 
              className="block text-sm font-medium mb-2"
              style={{ color: THEME.onSurface }}
            >
              Avatar (optional)
            </label>

            {avatarId && (
              <div 
                className="flex items-center gap-3 mb-3 p-3 rounded-xl"
                style={{ backgroundColor: `${THEME.cardGreen}22` }}
              >
                <PlayerAvatar avatarId={avatarId} name={displayName || 'You'} size="lg" />
                <div className="flex-1">
                  <p className="text-sm font-medium" style={{ color: THEME.cardGreen }}>Avatar selected</p>
                </div>
                <button
                  onClick={() => setAvatarId(null)}
                  className="hover:opacity-70 transition-opacity"
                  style={{ color: THEME.onSurfaceVariant }}
                >
                  Remove
                </button>
              </div>
            )}

            <div className="space-y-3">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const file = e.target.files?.[0];
                  if (file) handleAvatarUpload(file);
                }}
                disabled={isUploadingAvatar}
                className="w-full text-sm file:mr-4 file:py-2 file:px-4
                           file:rounded-lg file:border-0 file:text-sm file:font-medium
                           file:cursor-pointer file:transition-colors"
                style={{ color: THEME.onSurfaceVariant }}
              />

              <div className="flex gap-2">
                <input
                  type="url"
                  value={avatarUrlInput}
                  onChange={(e) => setAvatarUrlInput(e.target.value)}
                  placeholder="https://example.com/avatar.png"
                  disabled={isUploadingAvatar}
                  className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 border"
                  style={{ 
                    backgroundColor: THEME.surfaceContainerHigh,
                    borderColor: THEME.outlineVariant,
                    color: THEME.onSurface,
                  }}
                />
                <button
                  onClick={handleAvatarUrlSubmit}
                  disabled={isUploadingAvatar || !avatarUrlInput.trim()}
                  className="px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  style={{ backgroundColor: THEME.primary, color: THEME.onPrimary }}
                >
                  {isUploadingAvatar ? '...' : 'Use'}
                </button>
              </div>

              {avatarUploadError && (
                <p className="text-sm" style={{ color: THEME.error }}>{avatarUploadError}</p>
              )}
            </div>
          </div>

          {/* Room Settings */}
          <div 
            className="mb-6 p-4 rounded-xl border"
            style={{ backgroundColor: THEME.surfaceContainerHigh, borderColor: THEME.outlineVariant }}
          >
            <h3 
              className="text-sm font-medium mb-4"
              style={{ color: THEME.onSurface }}
            >
              Room Settings
            </h3>
            
            <div className="space-y-4">
              {/* Max Players */}
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm" style={{ color: THEME.onSurfaceVariant }}>Max Players</label>
                  <span className="text-sm font-medium" style={{ color: THEME.onSurface }}>{maxPlayers}</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="10"
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(parseInt(e.target.value))}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer
                             [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 
                             [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full 
                             [&::-webkit-slider-thumb]:cursor-pointer"
                  style={{ 
                    backgroundColor: THEME.outlineVariant,
                  }}
                />
              </div>

              {/* AI Players */}
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm" style={{ color: THEME.onSurfaceVariant }}>AI Opponents</label>
                  <span className="text-sm font-medium" style={{ color: THEME.onSurface }}>{aiPlayerCount}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={Math.min(9, maxPlayers - 1)}
                  value={aiPlayerCount}
                  onChange={(e) => setAiPlayerCount(parseInt(e.target.value))}
                  className="w-full h-2 rounded-lg appearance-none cursor-pointer
                             [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 
                             [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full 
                             [&::-webkit-slider-thumb]:cursor-pointer"
                  style={{ 
                    backgroundColor: THEME.outlineVariant,
                  }}
                />
                {aiPlayerCount > 0 && (
                  <p className="text-xs mt-1" style={{ color: THEME.onSurfaceVariant }}>
                    AI players will be added when the game starts
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Create Room */}
          <button
            onClick={handleCreateRoom}
            disabled={loading || isPending}
            className="w-full py-3 font-semibold rounded-xl transition-all duration-150 
                       disabled:opacity-50 mb-4 shadow-lg hover:opacity-90"
            style={{ backgroundColor: THEME.primary, color: THEME.onPrimary }}
          >
            {isPending ? 'Creating...' : 'Create Room'}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4 my-4">
            <div className="flex-1 h-px" style={{ backgroundColor: THEME.outlineVariant }} />
            <span className="text-sm" style={{ color: THEME.onSurfaceVariant }}>or join existing</span>
            <div className="flex-1 h-px" style={{ backgroundColor: THEME.outlineVariant }} />
          </div>

          {/* Join Room */}
          <div className="mb-4">
            <input
              type="text"
              value={joinRoomCode}
              onChange={(e) => setJoinRoomCode(e.target.value.toUpperCase())}
              placeholder="Enter room code"
              className="w-full px-4 py-3 rounded-xl font-mono text-center uppercase
                         tracking-widest focus:outline-none focus:ring-2 border"
              style={{ 
                backgroundColor: THEME.surfaceContainerHigh,
                borderColor: THEME.outlineVariant,
                color: THEME.onSurface,
              }}
            />
          </div>

          <button
            onClick={handleJoinRoom}
            disabled={loading || isPending}
            className="w-full py-3 font-semibold rounded-xl transition-colors disabled:opacity-50"
            style={{ backgroundColor: THEME.surfaceContainerHighest, color: THEME.onSurface }}
          >
            {isPending ? 'Joining...' : 'Join Room'}
          </button>
        </div>
      </div>
    </div>
  );
}

export { App };
