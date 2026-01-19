import { useState, useEffect, useRef, useCallback, ChangeEvent, Component, ReactNode } from 'react';
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
// Error Boundary
// ============================================================================

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('React Error Boundary caught an error:', error, errorInfo);
  }

  handleReload = (): void => {
    // Clear stored session data to prevent loops
    localStorage.removeItem(STORAGE_KEYS.PLAYER_SECRET);
    localStorage.removeItem(STORAGE_KEYS.PLAYER_ID);
    localStorage.removeItem(STORAGE_KEYS.ROOM_CODE);
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div 
          style={{ 
            minHeight: '100vh', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            backgroundColor: THEME.surfaceDim,
            padding: '1rem',
          }}
        >
          <div 
            style={{ 
              backgroundColor: THEME.surfaceContainer,
              borderColor: THEME.error,
              borderWidth: '2px',
              borderStyle: 'solid',
              borderRadius: '1rem',
              padding: '2rem',
              maxWidth: '28rem',
              width: '100%',
              textAlign: 'center',
            }}
          >
            <div 
              style={{ 
                width: '4rem', 
                height: '4rem', 
                margin: '0 auto 1rem',
                backgroundColor: THEME.errorContainer,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.5rem',
              }}
            >
              <span role="img" aria-label="error">!</span>
            </div>
            <h2 
              style={{ 
                color: THEME.onSurface,
                fontSize: '1.5rem',
                fontWeight: 'bold',
                marginBottom: '0.5rem',
              }}
            >
              Something went wrong
            </h2>
            <p 
              style={{ 
                color: THEME.onSurfaceVariant,
                marginBottom: '1.5rem',
                fontSize: '0.875rem',
              }}
            >
              The game encountered an unexpected error. Please reload to continue.
            </p>
            {this.state.error && (
              <pre 
                style={{ 
                  backgroundColor: THEME.surfaceContainerHighest,
                  color: THEME.error,
                  padding: '0.75rem',
                  borderRadius: '0.5rem',
                  fontSize: '0.75rem',
                  marginBottom: '1.5rem',
                  overflow: 'auto',
                  maxHeight: '6rem',
                  textAlign: 'left',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              style={{ 
                backgroundColor: THEME.primary,
                color: THEME.onPrimary,
                padding: '0.75rem 2rem',
                borderRadius: '0.75rem',
                fontWeight: 'bold',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Reload Game
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// ============================================================================
// Constants & Types
// ============================================================================

const STORAGE_KEYS = {
  PLAYER_SECRET: 'playerSecret',
  PLAYER_ID: 'playerId',
  ROOM_CODE: 'roomCode',
  DISPLAY_NAME: 'displayName',
  AVATAR_ID: 'avatarId',
  SERVER_URL: 'serverUrl'
} as const;

const DEFAULT_SERVER_URL = 'https://server.ccu.joshwel.co';

type AppView = 'server-config' | 'lobby' | 'join-room' | 'room';

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
  // UNO Minimalista card colors (true to the original)
  cardRed: '#E53935',
  cardBlue: '#1E88E5',
  cardGreen: '#43A047',
  cardYellow: '#FDD835',
  cardWild: '#212121',
  // Tabletop
  tableGreen: '#1B5E20',
  tableFelt: '#2E7D32',
} as const;

// Font for UNO Minimalista cards (thin, clean)
const CARD_FONT = "'Barlow', sans-serif";

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
  color?: string;
}

// Skip icon: Circle with diagonal line (prohibition sign)
function SkipIcon({ className = "w-10 h-10", color = "currentColor" }: CardIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.5" fill="none" />
      <line x1="5.5" y1="5.5" x2="18.5" y2="18.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Reverse icon: Angular arrows (UNO Minimalista style - sharp corners)
function ReverseIcon({ className = "w-10 h-10", color = "currentColor" }: CardIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {/* Top arrow pointing left */}
      <path
        d="M8 6L4 10L8 14"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M4 10H16"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Bottom arrow pointing right */}
      <path
        d="M16 10L20 14L16 18"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M20 14H8"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Draw2 icon: Two overlapping card outlines
function Draw2Icon({ className = "w-10 h-10", color = "currentColor" }: CardIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <rect x="2" y="5" width="12" height="16" rx="1.5" stroke={color} strokeWidth="1.5" fill="none" />
      <rect x="8" y="3" width="12" height="16" rx="1.5" stroke={color} strokeWidth="1.5" fill="none" />
    </svg>
  );
}

// Wild icon: Color ring with 4 segments (as seen in image)
function WildIcon({ className = "w-12 h-12" }: CardIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className}>
      {/* Outer colored ring segments */}
      <path d="M12 2 A10 10 0 0 1 22 12" stroke={THEME.cardRed} strokeWidth="2" fill="none" />
      <path d="M22 12 A10 10 0 0 1 12 22" stroke={THEME.cardBlue} strokeWidth="2" fill="none" />
      <path d="M12 22 A10 10 0 0 1 2 12" stroke={THEME.cardGreen} strokeWidth="2" fill="none" />
      <path d="M2 12 A10 10 0 0 1 12 2" stroke={THEME.cardYellow} strokeWidth="2" fill="none" />
      {/* Inner white circle */}
      <circle cx="12" cy="12" r="6" stroke="white" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

// WildDraw4 icon: Four overlapping colored card outlines
function WildDraw4Icon({ className = "w-12 h-12" }: CardIconProps) {
  return (
    <svg viewBox="0 0 28 24" className={className}>
      <rect x="1" y="6" width="10" height="14" rx="1" stroke={THEME.cardRed} strokeWidth="1.5" fill="none" />
      <rect x="5" y="4" width="10" height="14" rx="1" stroke={THEME.cardYellow} strokeWidth="1.5" fill="none" />
      <rect x="10" y="5" width="10" height="14" rx="1" stroke={THEME.cardGreen} strokeWidth="1.5" fill="none" />
      <rect x="15" y="3" width="10" height="14" rx="1" stroke={THEME.cardBlue} strokeWidth="1.5" fill="none" />
    </svg>
  );
}

// Number display component for cards (UNO Minimalista style - thin font, underlined 6/9)
function CardNumber({ value, size = 'md' }: { value: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeConfig = {
    sm: { fontSize: '1.25rem', underlineOffset: '2px' },
    md: { fontSize: '2rem', underlineOffset: '3px' },
    lg: { fontSize: '2.75rem', underlineOffset: '4px' },
  };
  const config = sizeConfig[size];
  const needsUnderline = value === '6' || value === '9';
  
  return (
    <span 
      style={{ 
        fontFamily: CARD_FONT,
        fontWeight: 200,
        fontSize: config.fontSize,
        textDecoration: needsUnderline ? 'underline' : 'none',
        textUnderlineOffset: config.underlineOffset,
        letterSpacing: '-0.02em',
      }}
    >
      {value}
    </span>
  );
}

// Get the appropriate icon/content for a card value
function CardContent({ value, size = 'md', color = 'currentColor' }: { value: string; size?: 'sm' | 'md' | 'lg'; color?: string }) {
  const iconSizes = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-14 h-14',
  };

  switch (value) {
    case 'skip':
      return <SkipIcon className={iconSizes[size]} color={color} />;
    case 'reverse':
      return <ReverseIcon className={iconSizes[size]} color={color} />;
    case 'draw2':
      return <Draw2Icon className={iconSizes[size]} color={color} />;
    case 'wild':
      return <WildIcon className={iconSizes[size]} />;
    case 'wild_draw4':
      return <WildDraw4Icon className={iconSizes[size]} />;
    default:
      return <CardNumber value={value} size={size} />;
  }
}

// Corner indicator for cards (UNO Minimalista style)
function CornerIndicator({ value, position }: { value: string; position: 'top-left' | 'bottom-right' }) {
  const positionClasses = position === 'top-left' 
    ? 'top-1.5 left-2' 
    : 'bottom-1.5 right-2 rotate-180';
  
  const displayValue = value === 'wild' ? '' 
    : value === 'wild_draw4' ? '+4' 
    : value === 'draw2' ? '+2'
    : value === 'skip' ? '⊘'
    : value === 'reverse' ? '⇅'
    : value;

  const needsUnderline = value === '6' || value === '9';

  return (
    <span 
      className={`absolute ${positionClasses}`}
      style={{ 
        fontFamily: CARD_FONT,
        fontWeight: 300,
        fontSize: '0.75rem',
        textDecoration: needsUnderline ? 'underline' : 'none',
        textUnderlineOffset: '1px',
      }}
    >
      {displayValue}
    </span>
  );
}

// ============================================================================
// Components
// ============================================================================

// Custom range slider with filled track
interface RangeSliderProps {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
}

function RangeSlider({ min, max, value, onChange }: RangeSliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;
  
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={1}
      value={value}
      onChange={(e) => onChange(Math.round(Number(e.target.value)))}
      className="w-full appearance-none h-2 rounded-xl cursor-pointer"
      style={{
        background: `linear-gradient(to right, ${THEME.primary} 0%, ${THEME.primary} ${percentage}%, ${THEME.outlineVariant} ${percentage}%, ${THEME.outlineVariant} 100%)`,
      }}
    />
  );
}

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
      className="fixed top-4 left-1/2 -translate-x-1/2 z-50 rounded-xl p-3 flex items-center gap-3 border shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200 max-w-md"
      style={{ 
        backgroundColor: THEME.errorContainer,
        borderColor: THEME.error 
      }}
    >
      <span className="text-sm font-medium" style={{ color: THEME.error }}>{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-lg leading-none hover:opacity-70 transition-opacity flex-shrink-0"
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
  serverUrl?: string;
}

function PlayerAvatar({ avatarId, name, size = 'md', connected = true, serverUrl = '' }: PlayerAvatarProps) {
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
      {avatarId && serverUrl ? (
        <img
          src={`${serverUrl}/avatars/${avatarId}`}
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
      <CardContent value={card.value} size={size} color={textColor} />
    </button>
  );
}

// Card back for opponent hands
interface CardBackProps {
  size?: 'xs' | 'sm' | 'md';
  rotation?: number;
  style?: React.CSSProperties;
}

function CardBack({ size = 'sm', rotation = 0, style }: CardBackProps) {
  const sizes = {
    xs: { width: 28, height: 42, radius: 4 },
    sm: { width: 36, height: 54, radius: 5 },
    md: { width: 48, height: 72, radius: 6 },
  };
  const { width, height, radius } = sizes[size];

  return (
    <div
      style={{
        ...style,
        width,
        height,
        borderRadius: radius,
        transform: `rotate(${rotation}deg)`,
        backgroundColor: '#1a1a1a',
        border: '2px solid #333',
        boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
      }}
      className="flex items-center justify-center"
    >
      {/* CCU back design - simple oval */}
      <div 
        style={{
          width: width * 0.7,
          height: height * 0.5,
          borderRadius: '50%',
          border: `2px solid ${THEME.primary}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span 
          style={{ 
            fontFamily: CARD_FONT, 
            fontWeight: 400, 
            fontSize: size === 'xs' ? '6px' : size === 'sm' ? '8px' : '10px',
            color: THEME.primary,
            letterSpacing: '0.1em',
          }}
        >
          CCU
        </span>
      </div>
    </div>
  );
}

// Fanned opponent hand display
interface OpponentHandProps {
  cardCount: number;
  position: 'top' | 'left' | 'right';
  playerName: string;
  avatarId?: string;
  isActive: boolean;
  timeRemaining: number;
  serverUrl: string;
}

function OpponentHand({ cardCount, position, playerName, avatarId, isActive, timeRemaining, serverUrl }: OpponentHandProps) {
  const isUrgent = timeRemaining < 10000 && isActive;
  
  // Generate consistent random color for player initial
  // Use full name hash for better distribution
  const playerInitial = playerName.charAt(0).toUpperCase();
  let nameHash = 0;
  for (let i = 0; i < playerName.length; i++) {
    nameHash = ((nameHash << 5) - nameHash) + playerName.charCodeAt(i);
    nameHash = nameHash & nameHash;
  }
  const initialColorIndex = Math.abs(nameHash) % 5;
  const initialColors = [
    { bg: '#E53935', text: '#FFFFFF' },
    { bg: '#1E88E5', text: '#FFFFFF' },
    { bg: '#43A047', text: '#FFFFFF' },
    { bg: '#FDD835', text: '#1C1B1F' },
    { bg: '#9C27B0', text: '#FFFFFF' },
  ];
  const initialColor = initialColors[initialColorIndex];
  
  // Fan cards like the player's hand for intuitive count visualization
  // Show individual cards up to a limit, then stack the rest
  const maxVisibleCards = Math.min(cardCount, 12);
  const hasOverflow = cardCount > 12;
  
  return (
    <div className="flex flex-col items-center gap-1 pb-2">
      {/* Player info */}
      <div 
        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center justify-between gap-2 ${isActive ? 'scale-105' : ''}`}
        style={{ 
          backgroundColor: isActive ? THEME.primaryContainer : THEME.surfaceContainerHigh,
          color: isActive ? THEME.onPrimaryContainer : THEME.onSurfaceVariant,
          minWidth: '140px',
        }}
      >
        {/* Avatar + Name */}
        <div className="flex items-center gap-1.5">
          {/* Avatar */}
          {avatarId ? (
            <div
              className="w-5 h-5 rounded-md overflow-hidden flex-shrink-0 border"
              style={{ borderColor: 'rgba(255,255,255,0.2)' }}
            >
              <img
                src={`${serverUrl}/avatars/${avatarId}`}
                alt={`${playerName}'s avatar`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          ) : (
            <div
              className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: initialColor.bg }}
            >
              <span className="font-bold text-xs" style={{ color: initialColor.text }}>
                {playerInitial}
              </span>
            </div>
          )}
          <span className="truncate max-w-[100px]">{playerName}</span>
        </div>
        
        {/* Time */}
        <span 
          className={`font-mono ${isUrgent ? 'text-red-400 animate-pulse' : ''}`}
        >
          {formatTimeCompact(timeRemaining)}
        </span>
      </div>
      
      {/* Fanned cards - similar to player's hand */}
      <div 
        className="flex justify-center items-end px-2"
        style={{ minHeight: 56, paddingTop: 4 }}
      >
        {Array.from({ length: maxVisibleCards }).map((_, index) => {
          const totalCards = maxVisibleCards;
          const centerIndex = (totalCards - 1) / 2;
          const offset = index - centerIndex;
          
          // Fan angle: cards spread out from center (reduced angle to prevent clipping)
          const maxAngle = Math.min(15, totalCards * 1.5);
          const angle = (offset / Math.max(totalCards - 1, 1)) * maxAngle;
          
          // Overlap amount based on card count
          const cardWidth = 32; // xs card width
          const overlapAmount = Math.max(10, 22 - totalCards);
          
          // Vertical curve: center cards slightly lower (arc effect)
          const yOffset = Math.abs(offset) * 1;
          
          return (
            <div
              key={index}
              style={{
                marginLeft: index === 0 ? 0 : -cardWidth + overlapAmount,
                transform: `rotate(${angle}deg) translateY(${yOffset}px)`,
                zIndex: index,
              }}
            >
              <CardBack size="xs" />
            </div>
          );
        })}
        {hasOverflow && (
          <div 
            className="ml-1 px-1.5 py-0.5 rounded text-xs font-bold"
            style={{ backgroundColor: THEME.primaryContainer, color: THEME.onPrimaryContainer }}
          >
            +{cardCount - 12}
          </div>
        )}
      </div>
    </div>
  );
}

// Carousel of opponents
interface OpponentCarouselProps {
  players: Array<PlayerPublic | PlayerPrivate>;
  currentPlayerId: string | undefined;
  interpolatedTime: Record<string, number>;
  serverUrl: string;
}

function OpponentCarousel({ players, currentPlayerId, interpolatedTime, serverUrl }: OpponentCarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToCenter = useCallback(() => {
    if (!containerRef.current || !currentPlayerId) return;
    
    const container = containerRef.current;
    const activeOpponent = container.querySelector(`[data-player-id="${currentPlayerId}"]`) as HTMLElement;
    if (!activeOpponent) return;
    
    activeOpponent.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [currentPlayerId]);

  useEffect(() => {
    scrollToCenter();
  }, [currentPlayerId, scrollToCenter]);

  // Always center when container resizes
  useEffect(() => {
    if (!containerRef.current) return;
    
    const observer = new ResizeObserver(() => {
      scrollToCenter();
    });
    observer.observe(containerRef.current);
    
    return () => observer.disconnect();
  }, [scrollToCenter]);

  return (
    <div 
      ref={containerRef}
      className="flex gap-2 md:gap-6 pt-2 pb-1 overflow-x-auto overflow-y-visible scrollbar-hide"
      style={{ 
        paddingLeft: '8rem',
        paddingRight: '8rem',
      }}
    >
      {players.map((player) => {
        const handCount = isPlayerPrivate(player) ? player.hand.length : player.handCount;
        return (
          <div key={player.id} data-player-id={player.id}>
            <OpponentHand
              cardCount={handCount}
              position="top"
              playerName={player.name}
              avatarId={player.avatarId}
              isActive={player.id === currentPlayerId}
              timeRemaining={interpolatedTime[player.id] || 0}
              serverUrl={serverUrl}
            />
          </div>
        );
      })}
    </div>
  );
}

interface ColorPickerModalProps {
  onSelect: (color: 'red' | 'yellow' | 'green' | 'blue') => void;
  onCancel: () => void;
}

function ColorPickerModal({ onSelect, onCancel }: ColorPickerModalProps) {
  const colors: Array<{ name: 'red' | 'yellow' | 'green' | 'blue'; bg: string; text: string; key: string }> = [
    { name: 'red', bg: THEME.cardRed, text: '#FFFFFF', key: '1' },
    { name: 'yellow', bg: THEME.cardYellow, text: '#1C1B1F', key: '2' },
    { name: 'green', bg: THEME.cardGreen, text: '#FFFFFF', key: '3' },
    { name: 'blue', bg: THEME.cardBlue, text: '#FFFFFF', key: '4' },
  ];

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key >= '1' && e.key <= '4') {
        const color = colors[parseInt(e.key) - 1];
        if (color) {
          onSelect(color.name);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [colors, onSelect, onCancel]);

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
              className="py-8 rounded-xl font-bold text-lg capitalize shadow-lg relative
                         transform transition-all duration-150 hover:scale-105 hover:shadow-xl active:scale-95"
              style={{ backgroundColor: color.bg, color: color.text }}
            >
              <span className="absolute top-1 left-2 text-xs opacity-70">{color.key}</span>
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

// Prominent Chess Clock display - large, with milliseconds for urgency
interface ChessClockProps {
  timeMs: number;
  isActive: boolean;
  playerName: string;
  position?: 'top' | 'bottom';
}

function ChessClock({ timeMs, isActive, playerName, position = 'top' }: ChessClockProps) {
  const urgentThreshold = 30000; // 30 seconds - start showing urgency earlier
  const criticalThreshold = 10000; // 10 seconds - critical
  const isUrgent = timeMs < urgentThreshold && isActive;
  const isCritical = timeMs < criticalThreshold && isActive;
  
  // Format with milliseconds for that chess clock feel
  const totalSeconds = Math.floor(timeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((timeMs % 1000) / 10);
  
  return (
    <div 
      className={`flex flex-col items-center transition-all duration-200 ${isActive ? 'scale-105' : 'opacity-50'}`}
    >
      {/* Player name label */}
      <span 
        className={`text-xs font-semibold uppercase tracking-widest ${position === 'bottom' ? 'order-2 mt-1' : 'mb-1'}`}
        style={{ color: isActive ? THEME.primary : THEME.onSurfaceVariant }}
      >
        {playerName}
      </span>
      
      {/* Clock display - styled like a real chess clock */}
      <div 
        className={`relative px-4 py-2 rounded-lg ${isCritical ? 'animate-pulse' : ''}`}
        style={{ 
          backgroundColor: isActive 
            ? (isCritical ? 'rgba(242, 184, 181, 0.2)' : 'rgba(208, 188, 255, 0.15)') 
            : 'rgba(0, 0, 0, 0.3)',
          border: isActive 
            ? `2px solid ${isCritical ? THEME.error : THEME.primary}` 
            : '2px solid transparent',
          boxShadow: isActive 
            ? `0 0 20px ${isCritical ? 'rgba(242, 184, 181, 0.4)' : 'rgba(208, 188, 255, 0.3)'}` 
            : 'none',
        }}
      >
        {/* Main time display */}
        <div className="flex items-baseline font-mono tabular-nums">
          {/* Minutes:Seconds */}
          <span 
            className="text-3xl md:text-4xl font-bold"
            style={{ 
              color: isCritical ? THEME.error : isActive ? '#FFFFFF' : THEME.onSurfaceVariant,
              textShadow: isCritical ? '0 0 10px rgba(242, 184, 181, 0.8)' : 'none',
            }}
          >
            {minutes}:{seconds.toString().padStart(2, '0')}
          </span>
          
          {/* Centiseconds - smaller, always visible for urgency */}
          <span 
            className="text-lg md:text-xl font-bold ml-0.5"
            style={{ 
              color: isCritical ? THEME.error : isActive ? 'rgba(255,255,255,0.7)' : THEME.outline,
              textShadow: isCritical ? '0 0 8px rgba(242, 184, 181, 0.6)' : 'none',
            }}
          >
            .{centiseconds.toString().padStart(2, '0')}
          </span>
        </div>
        
        {/* Active indicator dot */}
        {isActive && (
          <div 
            className={`absolute -top-1 -right-1 w-3 h-3 rounded-full ${isCritical ? 'animate-ping' : ''}`}
            style={{ 
              backgroundColor: isCritical ? THEME.error : THEME.primary,
              boxShadow: `0 0 8px ${isCritical ? THEME.error : THEME.primary}`,
            }}
          />
        )}
      </div>
    </div>
  );
}

// Compact clock for carousel display
interface ClockChipProps {
  timeMs: number;
  isActive: boolean;
  playerName: string;
  isMe: boolean;
  'data-player-id'?: string;
}

function ClockChip({ timeMs, isActive, playerName, isMe, 'data-player-id': dataPlayerId }: ClockChipProps) {
  const criticalThreshold = 10000; // 10 seconds
  const urgentThreshold = 30000; // 30 seconds
  const isCritical = timeMs < criticalThreshold;
  const isUrgent = timeMs < urgentThreshold;
  
  // Format with centiseconds
  const totalSeconds = Math.floor(timeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((timeMs % 1000) / 10);
  
  return (
    <div 
      data-player-id={dataPlayerId}
      className={`flex flex-col items-center px-3 py-2 rounded-xl transition-all duration-300 flex-shrink-0
                  ${isActive ? 'scale-110 z-10' : 'scale-95'}`}
      style={{ 
        backgroundColor: isActive 
          ? (isCritical ? 'rgba(242, 184, 181, 0.25)' : 'rgba(208, 188, 255, 0.2)') 
          : 'rgba(0, 0, 0, 0.3)',
        border: isActive 
          ? `2px solid ${isCritical ? THEME.error : THEME.primary}` 
          : '2px solid rgba(255,255,255,0.1)',
        boxShadow: isActive 
          ? `0 0 20px ${isCritical ? 'rgba(242, 184, 181, 0.5)' : 'rgba(208, 188, 255, 0.4)'}` 
          : 'none',
        minWidth: isActive ? '140px' : '100px',
      }}
    >
      {/* Player name */}
      <span 
        className="text-[10px] font-semibold uppercase tracking-wider truncate max-w-full"
        style={{ color: isActive ? (isMe ? THEME.primary : '#FFFFFF') : THEME.onSurfaceVariant }}
      >
        {isMe ? 'You' : playerName}
      </span>
      
      {/* Time display */}
      <div className={`flex items-baseline font-mono tabular-nums ${isCritical && isActive ? 'animate-pulse' : ''}`}>
        <span 
          className={`font-bold ${isActive ? 'text-2xl' : 'text-lg'}`}
          style={{ 
            color: isCritical && isActive ? THEME.error : isActive ? '#FFFFFF' : THEME.onSurfaceVariant,
            textShadow: isCritical && isActive ? '0 0 8px rgba(242, 184, 181, 0.8)' : 'none',
          }}
        >
          {minutes}:{seconds.toString().padStart(2, '0')}
        </span>
        <span 
          className={`font-bold ${isActive ? 'text-sm' : 'text-xs'}`}
          style={{ 
            color: isCritical && isActive ? THEME.error : isActive ? 'rgba(255,255,255,0.7)' : THEME.outline,
          }}
        >
          .{centiseconds.toString().padStart(2, '0')}
        </span>
      </div>
      
      {/* Active turn indicator */}
      {isActive && (
        <span 
          className="text-[9px] uppercase tracking-widest mt-0.5"
          style={{ color: isCritical ? THEME.error : THEME.primary }}
        >
          {isMe ? 'Your Turn' : 'Playing'}
        </span>
      )}
    </div>
  );
}

// Carousel of all players' chess clocks
interface ChessClockBarProps {
  players: Array<{ id: string; name: string }>;
  currentPlayerId: string | undefined;
  interpolatedTime: Record<string, number>;
  myPlayerId: string | null;
}

function ChessClockBar({ players, currentPlayerId, interpolatedTime, myPlayerId }: ChessClockBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToCenter = useCallback(() => {
    if (!containerRef.current || !currentPlayerId) return;
    
    const container = containerRef.current;
    const activeChip = container.querySelector(`[data-player-id="${currentPlayerId}"]`) as HTMLElement;
    if (!activeChip) return;
    
    activeChip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [currentPlayerId]);

  useEffect(() => {
    // Use multiple attempts to ensure DOM is fully rendered before scrolling
    const rafId1 = requestAnimationFrame(() => {
      scrollToCenter();
    });
    const timeoutId = setTimeout(() => {
      scrollToCenter();
    }, 150);
    
    return () => {
      cancelAnimationFrame(rafId1);
      clearTimeout(timeoutId);
    };
  }, [currentPlayerId, scrollToCenter]);

  // Always center when container resizes
  useEffect(() => {
    if (!containerRef.current) return;
    
    const observer = new ResizeObserver(() => {
      scrollToCenter();
    });
    observer.observe(containerRef.current);
    
    return () => observer.disconnect();
  }, [scrollToCenter]);

  return (
    <div 
      ref={containerRef}
      className="flex items-center gap-2 py-2 md:py-3 overflow-x-auto scrollbar-hide"
      style={{ 
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        paddingLeft: '8rem',
        paddingRight: '8rem',
      }}
    >
      {players.map((player) => (
        <ClockChip
          key={player.id}
          timeMs={interpolatedTime[player.id] || 0}
          isActive={player.id === currentPlayerId}
          playerName={player.name}
          isMe={player.id === myPlayerId}
          data-player-id={player.id}
        />
      ))}
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
  serverUrl: string;
}

function PlayerRow({
  player,
  isActive,
  timeRemaining,
  isPlaying,
  showCatch,
  onCatch,
  isPending,
  serverUrl
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
        serverUrl={serverUrl}
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
  selectedCardIndex: number | null;
  onSelectedCardIndexChange: (index: number | null) => void;
}

function HandArea({
  cards,
  myTurn,
  isPending,
  onPlayCard,
  discardRef,
  reducedMotion,
  selectedCardIndex,
  onSelectedCardIndexChange
}: HandAreaProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [isOverDiscard, setIsOverDiscard] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Autoscroll to selected card
  useEffect(() => {
    if (selectedCardIndex === null || !containerRef.current) return;
    
    const cardElement = cardRefs.current[selectedCardIndex];
    if (!cardElement) return;
    
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();
    const cardRect = cardElement.getBoundingClientRect();
    
    // Calculate scroll position to center the card with some padding
    const scrollLeft = container.scrollLeft + (cardRect.left + cardRect.width / 2 - containerRect.left - containerRect.width / 2);
    container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
  }, [selectedCardIndex, cards.length]);

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
        onSelectedCardIndexChange(index);
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

        onSelectedCardIndexChange(null);
      }
    },
    { threshold: 8, pointer: { touch: true }, filterTaps: true }
  );

  const handleCardClick = (card: Card, index: number) => {
    if (!myTurn || isPending) return;
    onPlayCard(card, index);
  };

  return (
    <div className="py-2 md:py-4 overflow-x-auto scrollbar-hide" ref={containerRef}>
      {/* Fanned hand display */}
      <div 
        className="flex justify-center items-end px-8"
        style={{ minHeight: 100 }}
      >
        {cards.map((card, index) => {
          // Calculate fan positioning
          const totalCards = cards.length;
          const centerIndex = (totalCards - 1) / 2;
          const offset = index - centerIndex;
          
          // Fan angle: cards spread out from center (reduced on mobile)
          const maxAngle = Math.min(25, totalCards * 2.5);
          const angle = (offset / Math.max(totalCards - 1, 1)) * maxAngle;
          
          // Horizontal offset: overlap cards more on mobile
          const cardWidth = 64;
          const overlapAmount = Math.max(15, 40 - totalCards * 2);
          const xOffset = offset * overlapAmount;
          
          // Vertical curve: center cards slightly lower (arc effect)
          const yOffset = Math.abs(offset) * 3;
          
          return (
            <animated.div
              key={index}
              ref={(el) => { cardRefs.current[index] = el; }}
              {...bind(card, index)}
              style={{
                x: springs[index].x,
                y: springs[index].y,
                scale: springs[index].scale,
                rotateZ: springs[index].rotateZ,
                zIndex: draggingIndex === index ? 100 : selectedCardIndex === index ? 50 : index,
                marginLeft: index === 0 ? 0 : -cardWidth + overlapAmount,
                transform: `rotate(${angle}deg) translateY(${yOffset}px)`,
              }}
              className="cursor-grab active:cursor-grabbing transition-transform hover:-translate-y-2"
            >
              <CardDisplay
                card={card}
                onClick={() => handleCardClick(card, index)}
                disabled={!myTurn || isPending}
                selected={selectedCardIndex === index}
                dragging={draggingIndex === index}
              />
            </animated.div>
          );
        })}
      </div>
      {isOverDiscard && (
        <p 
          className="text-center text-sm mt-3 font-medium"
          style={{ color: '#90EE90' }}
        >
          Release to play card
        </p>
      )}
    </div>
  );
}

// Helper to get initial params from URL
function getInitialUrlParams(): { 
  serverUrl: string; 
  serverSource: 'url' | 'storage' | 'none';
  roomCode: string | null;
} {
  const urlParams = new URLSearchParams(window.location.search);
  
  // Get room code from URL
  const roomFromUrl = urlParams.get('room')?.toUpperCase() || null;
  
  // Get server URL
  const serverFromUrl = urlParams.get('server');
  if (serverFromUrl) {
    // Normalize: add https:// if no protocol specified
    const normalizedUrl = serverFromUrl.match(/^https?:\/\//) 
      ? serverFromUrl 
      : `https://${serverFromUrl}`;
    return { serverUrl: normalizedUrl, serverSource: 'url', roomCode: roomFromUrl };
  }
  
  // Check localStorage for server
  const savedServerUrl = localStorage.getItem(STORAGE_KEYS.SERVER_URL);
  if (savedServerUrl) {
    return { serverUrl: savedServerUrl, serverSource: 'storage', roomCode: roomFromUrl };
  }
  
  // No server configured
  return { serverUrl: '', serverSource: 'none', roomCode: roomFromUrl };
}

function App() {
  // Server configuration - check URL params, then localStorage
  const initialParams = getInitialUrlParams();
  const [serverUrl, setServerUrl] = useState<string>(initialParams.serverUrl);
  const [serverUrlInput, setServerUrlInput] = useState(initialParams.serverUrl || DEFAULT_SERVER_URL);
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionError, setConnectionError] = useState('');

  // State - skip config if we have a server from URL or storage
  const [view, setView] = useState<AppView>(() => {
    if (initialParams.serverSource === 'none') return 'server-config';
    if (initialParams.roomCode) return 'join-room';
    return 'lobby';
  });
  const [displayName, setDisplayName] = useState('');
  const [joinRoomCode, setJoinRoomCode] = useState(initialParams.roomCode || '');
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [avatarUrlInput, setAvatarUrlInput] = useState('');
  const [avatarUploadError, setAvatarUploadError] = useState('');
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  
  // If server/room came from URL param, save server to localStorage and clean URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const hasUrlParams = urlParams.has('server') || urlParams.has('room');
    
    if (hasUrlParams) {
      if (initialParams.serverSource === 'url' && initialParams.serverUrl) {
        localStorage.setItem(STORAGE_KEYS.SERVER_URL, initialParams.serverUrl);
      }
      // Clean the URL params after processing
      const url = new URL(window.location.href);
      url.searchParams.delete('server');
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  // Room settings
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [aiPlayerCount, setAiPlayerCount] = useState(0);

  // Clamp AI count when max players changes
  useEffect(() => {
    setAiPlayerCount(prev => Math.min(prev, Math.min(9, maxPlayers - 1)));
  }, [maxPlayers]);

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
  const gameTableRef = useRef<HTMLDivElement>(null);

  const reducedMotion = useReducedMotion();
  const interpolatedTime = useClockInterpolation(clockSync, reducedMotion);

  // Keyboard navigation state
  const [selectedCardIndex, setSelectedCardIndex] = useState<number | null>(null);
  
  // Flying chat overlay state
  const [showChatOverlay, setShowChatOverlay] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [flyingMessages, setFlyingMessages] = useState<Array<{ id: number; message: string; playerName: string; top: number; duration: number }>>([]);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const flyingMessageIdRef = useRef(0);

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

      sock.on('timeOut', (data) => {
        if (data.policy === 'gameEnd') {
          // Immediately end the game locally for instant feedback
          setRoom(prev => prev ? { ...prev, gameStatus: 'finished', gameEndedReason: `${data.playerId} ran out of time` } : null);
        }
        // For 'playerTimedOut', let gameStateUpdate handle the disconnected state
      });
    },
    []
  );

  // Reconnection on mount
  useEffect(() => {
    // Skip if we don't have a server URL configured
    if (!serverUrl) return;
    
    if (myPlayerSecret && myPlayerId && storedRoomCode) {
      const storedDisplayName = localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME);
      const storedAvatarId = localStorage.getItem(STORAGE_KEYS.AVATAR_ID);

      if (storedDisplayName) {
        setDisplayName(storedDisplayName);
        setAvatarId(storedAvatarId);
        setLoading(true);

        const newSocket = io(serverUrl);
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
  }, [serverUrl]);

  // Socket disconnect/reconnect handling
  const [isReconnecting, setIsReconnecting] = useState(false);
  
  useEffect(() => {
    if (!socket) return;
    
    const handleDisconnect = (reason: string) => {
      // Only show reconnecting state if we were in a room and it wasn't a manual disconnect
      if (view === 'room' && reason !== 'io client disconnect') {
        setIsReconnecting(true);
        setError('Connection lost. Attempting to reconnect...');
      }
    };
    
    const handleConnect = () => {
      if (isReconnecting && storedRoomCode && myPlayerId && myPlayerSecret) {
        // Attempt to rejoin the room
        const actionId = generateActionId();
        setPendingActions((prev) => new Set(prev).add(actionId));
        
        socket.emit(
          'reconnect_room',
          actionId,
          storedRoomCode,
          myPlayerId,
          myPlayerSecret,
          (response: { success: boolean; error?: string }) => {
            setIsReconnecting(false);
            if (response.success) {
              setError('');
            } else {
              // Reconnection failed - clear session and go to lobby
              localStorage.removeItem(STORAGE_KEYS.PLAYER_SECRET);
              localStorage.removeItem(STORAGE_KEYS.PLAYER_ID);
              localStorage.removeItem(STORAGE_KEYS.ROOM_CODE);
              setRoom(null);
              setGameView(null);
              setClockSync(null);
              setChatMessages([]);
              setView('lobby');
              setError(response.error || 'Room no longer exists');
            }
          }
        );
      } else {
        setIsReconnecting(false);
        setError('');
      }
    };
    
    const handleConnectError = (err: Error) => {
      if (isReconnecting) {
        setError(`Reconnection failed: ${err.message}`);
      }
    };
    
    socket.on('disconnect', handleDisconnect);
    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    
    return () => {
      socket.off('disconnect', handleDisconnect);
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
    };
  }, [socket, view, isReconnecting, storedRoomCode, myPlayerId, myPlayerSecret]);

  // Keyboard controls for gameplay
  useEffect(() => {
    if (view !== 'room' || room?.gameStatus !== 'playing') return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input field (except chat overlay)
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        // Allow Escape to close chat overlay
        if (e.key === 'Escape' && showChatOverlay) {
          setShowChatOverlay(false);
          setChatInput('');
        }
        return;
      }

      // "/" to open chat overlay
      if (e.key === '/') {
        e.preventDefault();
        setShowChatOverlay(true);
        setTimeout(() => chatInputRef.current?.focus(), 0);
        return;
      }

      // Escape to close chat overlay
      if (e.key === 'Escape' && showChatOverlay) {
        setShowChatOverlay(false);
        setChatInput('');
        return;
      }

      // Card navigation and actions (only when chat is closed)
      if (!showChatOverlay && handCards.length > 0) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setSelectedCardIndex(prev => {
            if (prev === null) return handCards.length - 1;
            return prev > 0 ? prev - 1 : handCards.length - 1;
          });
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          setSelectedCardIndex(prev => {
            if (prev === null) return 0;
            return prev < handCards.length - 1 ? prev + 1 : 0;
          });
        } else if (e.key === 'ArrowUp' || e.key === 'Enter') {
          // Play selected card
          e.preventDefault();
          if (selectedCardIndex !== null && myTurn && !isPending) {
            const card = handCards[selectedCardIndex];
            if (card) {
              handlePlayCard(card);
            }
          }
        } else if (e.key === 'ArrowDown' || e.key === ' ') {
          // Draw card
          e.preventDefault();
          if (myTurn && !isPending) {
            handleDrawCard();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [view, room?.gameStatus, handCards.length, selectedCardIndex, myTurn, isPending, showChatOverlay]);

  // Reset selected card when hand changes
  useEffect(() => {
    if (selectedCardIndex !== null && selectedCardIndex >= handCards.length) {
      setSelectedCardIndex(handCards.length > 0 ? handCards.length - 1 : null);
    }
  }, [handCards.length, selectedCardIndex]);

  // Auto-select first card when turn starts
  useEffect(() => {
    if (myTurn && selectedCardIndex === null && handCards.length > 0) {
      setSelectedCardIndex(0);
    }
  }, [myTurn, selectedCardIndex, handCards.length]);

  // Add flying messages when new chat arrives from OTHER players
  // (own messages are shown immediately in handleChatOverlaySubmit for zero delay)
  useEffect(() => {
    if (chatMessages.length === 0) return;
    const latestMessage = chatMessages[chatMessages.length - 1];
    
    // Only add flying message if game is playing
    if (room?.gameStatus !== 'playing') return;
    
    // Skip if this is the current player's message (already shown via optimistic UI)
    if (latestMessage.playerId === myPlayerId) return;
    
    const messageId = flyingMessageIdRef.current++;
    const randomTop = 10 + Math.random() * 60; // Random position 10-70% from top
    // Calculate duration based on game table width: ~350px/s for faster speed
    // Message travels from right edge to left edge + its own width (estimate ~300px for message)
    const gameTableWidth = gameTableRef.current?.clientWidth || window.innerWidth;
    const duration = (gameTableWidth + 300) / 350;
    
    setFlyingMessages(prev => [...prev, {
      id: messageId,
      message: latestMessage.message,
      playerName: latestMessage.playerName,
      top: randomTop,
      duration
    }]);

    // Remove after animation completes + 500ms buffer
    setTimeout(() => {
      setFlyingMessages(prev => prev.filter(m => m.id !== messageId));
    }, duration * 1000 + 500);
  }, [chatMessages.length, room?.gameStatus, myPlayerId]);

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

    const newSocket = io(serverUrl);
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

    const newSocket = io(serverUrl);
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

  const handleChatOverlaySubmit = () => {
    if (chatInput.trim() && socket && myPlayer) {
      const message = chatInput.trim();
      handleSendChat(message);
      
      // Immediately show flying message (optimistic UI - no server round-trip delay)
      if (room?.gameStatus === 'playing') {
        const messageId = flyingMessageIdRef.current++;
        const randomTop = 10 + Math.random() * 60;
        // Calculate duration based on game table width: ~350px/s for faster speed
        const gameTableWidth = gameTableRef.current?.clientWidth || window.innerWidth;
        const duration = (gameTableWidth + 300) / 350;
        
        setFlyingMessages(prev => [...prev, {
          id: messageId,
          message,
          playerName: myPlayer.name,
          top: randomTop,
          duration
        }]);
        // Remove after animation completes + 500ms buffer
        setTimeout(() => {
          setFlyingMessages(prev => prev.filter(m => m.id !== messageId));
        }, duration * 1000 + 500);
      }
      
      setChatInput('');
      setShowChatOverlay(false);
    }
  };

  const handleAvatarUpload = async (file: File) => {
    setAvatarUploadError('');
    setIsUploadingAvatar(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${serverUrl}/avatar/upload`, {
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
      const res = await fetch(`${serverUrl}/avatar/from-url`, {
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

  // Server Configuration View
  if (view === 'server-config') {
    const handleConnect = async () => {
      const urlToTest = serverUrlInput.trim();
      if (!urlToTest) {
        setConnectionError('Please enter a server URL');
        return;
      }

      // Normalize URL
      const normalizedUrl = urlToTest.match(/^https?:\/\//) 
        ? urlToTest 
        : `https://${urlToTest}`;

      setIsTestingConnection(true);
      setConnectionError('');

      try {
        // Test connection with a simple socket connect
        const testSocket = io(normalizedUrl, { 
          timeout: 5000,
          reconnection: false 
        });

        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            testSocket.disconnect();
            reject(new Error('Connection timed out'));
          }, 5000);

          testSocket.on('connect', () => {
            clearTimeout(timeout);
            testSocket.disconnect();
            resolve();
          });

          testSocket.on('connect_error', (err) => {
            clearTimeout(timeout);
            testSocket.disconnect();
            reject(err);
          });
        });

        // Connection successful - save and proceed
        localStorage.setItem(STORAGE_KEYS.SERVER_URL, normalizedUrl);
        setServerUrl(normalizedUrl);
        setView('lobby');
      } catch (err) {
        setConnectionError(`Failed to connect: ${(err as Error).message}`);
      } finally {
        setIsTestingConnection(false);
      }
    };

    return (
      <div 
        className="min-h-screen flex items-center justify-center p-4"
        style={{ backgroundColor: THEME.surfaceDim }}
      >
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <h1 
              className="text-4xl font-bold mb-2"
              style={{ color: THEME.onSurface, fontFamily: CARD_FONT }}
            >
              Chess Clock UNO
            </h1>
            <p style={{ color: THEME.onSurfaceVariant }}>Connect to a game server</p>
          </div>

          <div 
            className="rounded-2xl p-6 shadow-2xl border"
            style={{ backgroundColor: THEME.surfaceContainer, borderColor: THEME.outlineVariant }}
          >
            {connectionError && (
              <div 
                className="rounded-xl p-3 mb-4 border"
                style={{ 
                  backgroundColor: `${THEME.errorContainer}33`,
                  borderColor: THEME.errorContainer 
                }}
              >
                <span className="text-sm" style={{ color: THEME.error }}>{connectionError}</span>
              </div>
            )}

            <div className="mb-6">
              <label 
                className="block text-sm font-medium mb-2"
                style={{ color: THEME.onSurface }}
              >
                Server URL
              </label>
              <input
                type="text"
                value={serverUrlInput}
                onChange={(e) => setServerUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                placeholder="https://your-server.com or localhost:3000"
                className="w-full px-4 py-3 rounded-xl border outline-none transition-colors"
                style={{
                  backgroundColor: THEME.surfaceContainerHigh,
                  borderColor: THEME.outline,
                  color: THEME.onSurface,
                }}
              />
              <p className="text-xs mt-2" style={{ color: THEME.onSurfaceVariant }}>
                Enter the URL of a Chess Clock UNO server. Ask your host for the address!
              </p>
            </div>

            <button
              onClick={handleConnect}
              disabled={isTestingConnection}
              className="w-full py-4 font-bold text-lg rounded-xl transition-all duration-150 
                         disabled:opacity-50 shadow-lg hover:opacity-90"
              style={{ backgroundColor: THEME.primary, color: THEME.onPrimary }}
            >
              {isTestingConnection ? 'Connecting...' : 'Connect'}
            </button>

            <div className="mt-6 pt-6 border-t" style={{ borderColor: THEME.outlineVariant }}>
              <p className="text-sm text-center" style={{ color: THEME.onSurfaceVariant }}>
                Want to host your own server?
              </p>
              <a 
                href="https://github.com/markjoshwel/ccu.vc" 
                target="_blank" 
                rel="noopener noreferrer"
                className="block text-center text-sm mt-1 hover:underline"
                style={{ color: THEME.primary }}
              >
                View instructions on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
    );
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
        className="min-h-screen p-2 md:p-4"
        style={{ backgroundColor: THEME.surfaceDim }}
      >
        <div className={room.gameStatus === 'playing' ? 'max-w-5xl mx-auto' : 'max-w-2xl mx-auto'}>
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 
                className="text-lg md:text-xl font-bold"
                style={{ color: THEME.onSurface, fontFamily: CARD_FONT }}
              >
                Chess Clock UNO
              </h1>
              <div className="flex items-center gap-2">
                <p className="text-sm" style={{ color: THEME.onSurfaceVariant }}>
                  Room: <span className="font-mono" style={{ color: THEME.primary }}>{room.id}</span>
                </p>
                <button
                  onClick={async () => {
                    const link = `${window.location.origin}?server=${encodeURIComponent(serverUrl)}&room=${room.id}`;
                    try {
                      await navigator.clipboard.writeText(link);
                      setError('Link copied to clipboard!');
                      setTimeout(() => setError(''), 2000);
                    } catch (err) {
                      setError('Failed to copy link');
                    }
                  }}
                  className="px-2 py-1 text-xs font-medium rounded transition-colors hover:opacity-80"
                  style={{ backgroundColor: THEME.surfaceContainerHigh, color: THEME.onSurface }}
                >
                  Copy Link
                </button>
              </div>
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
                      serverUrl={serverUrl}
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

          {/* Playing - Tabletop View */}
          {room.gameStatus === 'playing' && topCard && (
            <div 
              ref={gameTableRef}
              className="relative rounded-3xl overflow-hidden flex flex-col"
              style={{ 
                background: `radial-gradient(ellipse at center, ${THEME.tableFelt} 0%, ${THEME.tableGreen} 100%)`,
                minHeight: '70vh',
                boxShadow: 'inset 0 0 100px rgba(0,0,0,0.3)',
              }}
            >
              {/* Table felt texture overlay */}
              <div 
                className="absolute inset-0 opacity-10 pointer-events-none"
                style={{ 
                  backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.8\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\'/%3E%3C/svg%3E")',
                }}
              />

              {/* PROMINENT CHESS CLOCK BAR - Top of table */}
              <ChessClockBar
                players={allPlayers.map(p => ({ id: p.id, name: p.name }))}
                currentPlayerId={activePlayer?.id}
                interpolatedTime={interpolatedTime}
                myPlayerId={myPlayerId}
              />

              {/* Opponents at top */}
              <OpponentCarousel
                players={allPlayers.filter((p) => p.id !== myPlayerId)}
                currentPlayerId={activePlayer?.id}
                interpolatedTime={interpolatedTime}
                serverUrl={serverUrl}
              />

              {/* Center play area */}
              <div className="flex-1 flex items-center justify-center py-4 md:py-8">
                <div className="flex items-center gap-4 md:gap-8">
                  {/* Draw pile */}
                  <button
                    onClick={handleDrawCard}
                    disabled={!myTurn || isPending}
                    className="relative transition-transform hover:scale-105 active:scale-95 disabled:opacity-70"
                    title="Draw a card"
                  >
                    <div className="relative">
                      {/* Stack effect */}
                      <CardBack size="sm" style={{ position: 'absolute', top: 4, left: 2 }} />
                      <CardBack size="sm" style={{ position: 'absolute', top: 2, left: 1 }} />
                      <CardBack size="sm" />
                    </div>
                    <div 
                      className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] md:text-xs font-medium px-2 py-0.5 rounded"
                      style={{ backgroundColor: 'rgba(0,0,0,0.5)', color: '#fff' }}
                    >
                      Draw
                    </div>
                  </button>

                  {/* Discard pile */}
                  <div 
                    ref={discardRef}
                    className="relative"
                  >
                    <CardDisplay card={topCard} size="md" disabled />
                    {/* Active color indicator */}
                    {room.activeColor && (
                      <div 
                        className="absolute -top-2 -right-2 w-6 h-6 md:w-8 md:h-8 rounded-full border-2 border-white shadow-lg"
                        style={{ backgroundColor: CARD_COLORS[room.activeColor] }}
                        title={`Active color: ${room.activeColor}`}
                      />
                    )}
                    <div 
                      className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[10px] md:text-xs font-medium px-2 py-0.5 rounded whitespace-nowrap"
                      style={{ backgroundColor: 'rgba(0,0,0,0.5)', color: '#fff' }}
                    >
                      {myTurn ? 'Your turn' : `${activePlayer?.name}'s turn`}
                    </div>
                  </div>
                </div>
              </div>

              {/* Direction indicator */}
              <div 
                className="absolute top-1/2 left-2 md:left-4 -translate-y-1/2 text-2xl md:text-4xl opacity-30"
                style={{ color: '#fff' }}
              >
                {room.direction === 1 ? '↻' : '↺'}
              </div>

              {/* UNO Button - floating */}
              {showUnoButton && (
                <button
                  onClick={handleCallUno}
                  disabled={isPending}
                  className="absolute top-1/2 right-2 md:right-4 -translate-y-1/2 px-4 py-3 md:px-6 md:py-4 font-bold text-xl md:text-2xl uppercase 
                             rounded-xl md:rounded-2xl animate-bounce hover:animate-none disabled:opacity-50 shadow-2xl"
                  style={{ 
                    backgroundColor: THEME.cardRed, 
                    color: '#FFFFFF',
                    fontFamily: CARD_FONT,
                  }}
                >
                  UNO!
                </button>
              )}

              {/* Catch UNO buttons */}
              {allPlayers.map((player, idx) => {
                const showCatch = !!(
                  room.unoWindow &&
                  room.unoWindow.playerId === player.id &&
                  !room.unoWindow.called &&
                  player.id !== myPlayerId
                );
                if (!showCatch) return null;
                return (
                  <button
                    key={player.id}
                    onClick={() => handleCatchUno(player.id)}
                    disabled={isPending}
                    className="absolute top-2 right-2 md:top-4 md:right-4 px-3 py-1.5 md:px-4 md:py-2 font-bold text-sm md:text-lg uppercase 
                               rounded-lg md:rounded-xl animate-pulse disabled:opacity-50 shadow-xl"
                    style={{ backgroundColor: THEME.cardYellow, color: '#000' }}
                  >
                    Catch {player.name}!
                  </button>
                );
              })}

              {/* My hand at bottom with my clock */}
              <div 
                className="mt-auto px-2 md:px-4 pb-2 md:pb-4"
                style={{ backgroundColor: 'rgba(0,0,0,0.3)' }}
              >
                {/* My prominent clock display */}
                <div className="flex justify-center py-1 md:py-2">
                  <ChessClock
                    timeMs={interpolatedTime[myPlayerId || ''] || 0}
                    isActive={myTurn}
                    playerName={myTurn ? "YOUR TURN" : "Your Time"}
                    position="bottom"
                  />
                </div>
                
                <HandArea
                  cards={handCards}
                  myTurn={myTurn}
                  isPending={isPending}
                  onPlayCard={(card) => handlePlayCard(card)}
                  discardRef={discardRef}
                  reducedMotion={reducedMotion}
                  selectedCardIndex={selectedCardIndex}
                  onSelectedCardIndexChange={setSelectedCardIndex}
                />
              </div>

              {/* Flying chat messages (niconico-style) */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {flyingMessages.map(msg => (
                  <div
                    key={msg.id}
                    className="absolute whitespace-nowrap"
                    style={{
                      top: `${msg.top}%`,
                      right: '-100%',
                      textShadow: '2px 2px 4px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.5)',
                      color: '#FFFFFF',
                      fontWeight: 600,
                      fontSize: '1.1rem',
                      animation: `fly-across ${msg.duration}s linear forwards`,
                    }}
                  >
                    <span style={{ color: THEME.primary }}>{msg.playerName}:</span> {msg.message}
                  </div>
                ))}
              </div>

              {/* Chat input overlay */}
              {showChatOverlay && (
                <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50">
                  <div 
                    className="flex gap-2 p-3 rounded-xl shadow-2xl border"
                    style={{ 
                      backgroundColor: 'rgba(28, 27, 31, 0.95)',
                      borderColor: THEME.outlineVariant,
                      backdropFilter: 'blur(8px)',
                    }}
                  >
                    <input
                      ref={chatInputRef}
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleChatOverlaySubmit();
                        } else if (e.key === 'Escape') {
                          setShowChatOverlay(false);
                          setChatInput('');
                        }
                      }}
                      placeholder="Type a message..."
                      className="w-64 px-3 py-2 rounded-lg focus:outline-none focus:ring-2"
                      style={{ 
                        backgroundColor: THEME.surfaceContainerHighest,
                        color: THEME.onSurface,
                      }}
                    />
                    <button
                      onClick={handleChatOverlaySubmit}
                      disabled={!chatInput.trim()}
                      className="px-4 py-2 font-medium rounded-lg transition-colors disabled:opacity-50"
                      style={{ backgroundColor: THEME.primary, color: THEME.onPrimary }}
                    >
                      Send
                    </button>
                  </div>
                </div>
              )}

              {/* Keybinds help */}
              <div 
                className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xs opacity-60 whitespace-nowrap"
                style={{ color: '#fff' }}
              >
                <span className="hidden md:inline">
                  <kbd className="px-1 py-0.5 rounded bg-black/30">←</kbd> <kbd className="px-1 py-0.5 rounded bg-black/30">→</kbd> select card · 
                  <kbd className="px-1 py-0.5 rounded bg-black/30">↑</kbd> play · 
                  <kbd className="px-1 py-0.5 rounded bg-black/30">↓</kbd> draw · 
                  <kbd className="px-1 py-0.5 rounded bg-black/30">/</kbd> chat
                </span>
              </div>
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

  // Join Room View (from link)
  if (view === 'join-room') {
    return (
      <div 
        className="min-h-screen flex items-center justify-center p-4"
        style={{ backgroundColor: THEME.surfaceDim }}
      >
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <h1 
              className="text-4xl font-bold mb-2"
              style={{ color: THEME.onSurface, fontFamily: CARD_FONT }}
            >
              Join Room
            </h1>
            <p style={{ color: THEME.onSurfaceVariant }}>Enter your details to join the game</p>
          </div>

          <div 
            className="rounded-2xl p-6 shadow-2xl border"
            style={{ backgroundColor: THEME.surfaceContainer, borderColor: THEME.outlineVariant }}
          >
            {/* Server indicator */}
            <div 
              className="flex items-center justify-between mb-4 p-3 rounded-xl"
              style={{ backgroundColor: THEME.surfaceContainerHigh }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs uppercase tracking-wider" style={{ color: THEME.onSurfaceVariant }}>
                  Joining room on
                </p>
                <p 
                  className="text-sm font-mono truncate" 
                  style={{ color: THEME.onSurface }}
                  title={serverUrl}
                >
                  {serverUrl.replace(/^https?:\/\//, '')}
                </p>
              </div>
              <button
                onClick={() => setView('lobby')}
                className="ml-3 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors hover:opacity-80"
                style={{ backgroundColor: THEME.surfaceContainerHighest, color: THEME.onSurfaceVariant }}
              >
                Back
              </button>
            </div>

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
                  <PlayerAvatar avatarId={avatarId} name={displayName || 'You'} size="lg" serverUrl={serverUrl} />
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

            {/* Join Room */}
            <div className="mb-4">
              <input
                type="text"
                value={joinRoomCode}
                readOnly
                className="w-full px-4 py-3 rounded-xl font-mono text-center uppercase
                           tracking-widest bg-gray-100 cursor-not-allowed"
                style={{ 
                  backgroundColor: THEME.surfaceContainerHighest,
                  color: THEME.onSurface,
                }}
              />
            </div>

            <button
              onClick={handleJoinRoom}
              disabled={loading || isPending || !displayName.trim()}
              className="w-full py-3 font-semibold rounded-xl transition-colors disabled:opacity-50"
              style={{ backgroundColor: THEME.primary, color: THEME.onPrimary }}
            >
              {isPending ? 'Joining...' : 'Join Room'}
            </button>
          </div>
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
            style={{ color: THEME.onSurface, fontFamily: CARD_FONT }}
          >
            Chess Clock UNO
          </h1>
          <p style={{ color: THEME.onSurfaceVariant }}>Play UNO with time pressure</p>
        </div>

        <div 
          className="rounded-2xl p-6 shadow-2xl border"
          style={{ backgroundColor: THEME.surfaceContainer, borderColor: THEME.outlineVariant }}
        >
          {/* Server indicator */}
          <div 
            className="flex items-center justify-between mb-4 p-3 rounded-xl"
            style={{ backgroundColor: THEME.surfaceContainerHigh }}
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-wider" style={{ color: THEME.onSurfaceVariant }}>
                Connected to
              </p>
              <p 
                className="text-sm font-mono truncate" 
                style={{ color: THEME.onSurface }}
                title={serverUrl}
              >
                {serverUrl.replace(/^https?:\/\//, '')}
              </p>
            </div>
            <button
              onClick={() => {
                localStorage.removeItem(STORAGE_KEYS.SERVER_URL);
                setServerUrl('');
                setView('server-config');
              }}
              className="ml-3 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors hover:opacity-80"
              style={{ backgroundColor: THEME.surfaceContainerHighest, color: THEME.onSurfaceVariant }}
            >
              Change
            </button>
          </div>

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
                <PlayerAvatar avatarId={avatarId} name={displayName || 'You'} size="lg" serverUrl={serverUrl} />
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
                <RangeSlider
                  min={2}
                  max={10}
                  value={maxPlayers}
                  onChange={setMaxPlayers}
                />
              </div>

              {/* AI Players */}
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm" style={{ color: THEME.onSurfaceVariant }}>AI Opponents</label>
                  <span className="text-sm font-medium" style={{ color: THEME.onSurface }}>{aiPlayerCount}</span>
                </div>
                <RangeSlider
                  min={0}
                  max={Math.min(9, maxPlayers - 1)}
                  value={aiPlayerCount}
                  onChange={setAiPlayerCount}
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

function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export { AppWithErrorBoundary as App };
