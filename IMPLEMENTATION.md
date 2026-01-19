# Chess Clock UNO - Implementation Reference

## Version: 2026.1.19+6-58b87b3

## Overview

Chess Clock UNO (`ccu.vc`) is a real-time multiplayer UNO game with chess clock mechanics. Features include:
- Server-authoritative gameplay with 2-10 players
- Chess clock time pressure per turn (configurable, default 60s)
- AI opponents (0-9 bots per room)
- Ephemeral identity and rooms (no accounts required)
- Niconico-style flying chat messages
- Keyboard controls for fast gameplay
- Avatar upload from file or URL
- Reconnection support

## Tech Stack

- **Monorepo**: Managed by Bun workspaces
- **Server**: Bun + Socket.io + Node HTTP server (in-memory, ephemeral)
- **Client**: Vite + React + TypeScript + Tailwind CSS v4
- **Shared**: TypeScript types package (`shared/`)
- **Motion**: `react-spring` + `@use-gesture/react` (drag-to-play cards)
- **Image Processing**: `imagescript` (avatar sanitization)

## Project Structure

```
ccu.vc/
├── client/                    # Vite + React frontend
│   ├── index.html             # Entry HTML (Barlow font from Google Fonts)
│   └── src/
│       ├── App.tsx            # Main component (~2800 lines)
│       ├── main.tsx           # Entry point
│       └── index.css          # Tailwind v4 + custom animations
├── server/                    # Bun + Socket.io backend
│   └── src/
│       ├── index.ts           # Server entry, socket event handlers
│       ├── RoomManager.ts     # Room & game logic, AI players
│       ├── Deck.ts            # UNO deck creation and shuffling
│       ├── RateLimiter.ts     # Token bucket rate limiter
│       ├── AvatarStore.ts     # In-memory avatar storage
│       ├── ImagePipeline.ts   # Avatar image processing
│       └── httpHandler.ts     # HTTP routes (avatars, health)
├── shared/                    # Shared TypeScript types
│   └── src/
│       └── index.ts           # Types for Room, Player, Card, Events
├── flake.nix                  # Nix flake for builds & Docker images
├── docker-compose.yml         # Container orchestration
├── Caddyfile                  # Reverse proxy configuration
├── DEPLOY.md                  # Deployment documentation
├── AGENTS.md                  # Session notes
└── IMPLEMENTATION.md          # This file
```

---

## Server Architecture

### Entry Point (`server/src/index.ts`)

- Creates HTTP server with custom handler for avatar endpoints
- Creates Socket.io server with CORS enabled
- Initializes `RoomManager` and `AvatarStore`
- Manages socket-to-room and socket-to-player mappings
- Implements global error handlers for production robustness

**Key Maps:**
```typescript
socketRoomMap: Map<string, string>        // socketId -> roomCode
socketPlayerMap: Map<string, {...}>       // socketId -> {playerId, playerSecret, avatarId}
socketRateLimiters: Map<string, {...}>    // socketId -> {chat, action, room} limiters
```

**Rate Limiting (per socket):**
- `chat`: 3 messages/second
- `action`: 10 game actions/second (playCard, drawCard, callUno, catchUno)
- `room`: 2 room operations/5 seconds (create, join)

**Input Validation:**
- Room codes: 6 uppercase alphanumeric characters
- Cards: Valid color (red/yellow/green/blue/wild) and value
- Colors: null or valid UNO color
- Display names: 1-24 characters, no control characters
- Chat messages: 1-280 characters

### Room Manager (`server/src/RoomManager.ts`)

**Constants:**
```typescript
MAX_CHAT_HISTORY = 100          // Messages per room
DEFAULT_TIME_PER_TURN_MS = 60000 // 1 minute
DEFAULT_MAX_PLAYERS = 6
MAX_ROOMS = 1000                // Server capacity limit
ROOM_STALE_TTL_MS = 30 * 60 * 1000   // 30 minutes
ROOM_GRACE_PERIOD_MS = 5 * 60 * 1000 // 5 minutes grace for reconnection
ROOM_CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes
```

**Room Class:**
- Manages players, game state, deck, discard pile, clocks
- Handles AI players (up to 9 bots named "Bot Alpha" through "Bot Iota")
- Implements full UNO rules including special cards
- Clock sync broadcasts every 500ms during gameplay
- Automatic deck reshuffling when empty (standard UNO rule)

**Room Lifecycle:**
1. Created via `createRoom(settings)` - returns Room with unique 6-char code
2. Players join via `addPlayer(socketId, player)`
3. Host starts game via `startGame()` - deals 7 cards each, sets up clocks
4. Game plays until someone empties their hand or all humans disconnect
5. Room deleted when no humans connected (5-minute grace period OR 30 minutes inactivity)

**Room Grace Period:**
- When last human player disconnects and game is in 'waiting' state, a 5-minute grace period starts
- During grace period, room persists even with no connected players
- Host can switch tabs/apps and reconnect without losing the room
- Reconnection via `reconnect_room` clears the grace period
- Room deleted only after grace period expires OR 30 minutes of inactivity

**Game State Machine:**
```
waiting -> playing -> finished
```

**Win Conditions:**
- Player plays their last card
- All other human players disconnect ("last-player-connected")
- All human players disconnect ("Game ended - no active players left")

### Deck (`server/src/Deck.ts`)

Standard UNO deck (108 cards):
- 4 colors (red, yellow, green, blue): 0 (×1), 1-9 (×2 each)
- Action cards per color: Skip (×2), Reverse (×2), Draw2 (×2)
- Wild cards: Wild (×4), Wild Draw 4 (×4)

**Deck Reshuffling:**
When deck is empty, discard pile (except top card) is shuffled back into deck. Throws error only when both deck is empty AND discard pile has ≤1 card.

### Rate Limiter (`server/src/RateLimiter.ts`)

Token bucket algorithm:
- Configurable max tokens and refill rate
- Tokens refill continuously based on elapsed time
- `tryConsume()`: Returns true if token available, false otherwise

### Avatar System

**AvatarStore (`server/src/AvatarStore.ts`):**
- In-memory Map storage with UUID keys
- Tracks avatars by room for cleanup
- Stores: data (Uint8Array), contentType, width, height, roomCode, lastAccessed
- **LRU Eviction**: MAX_AVATARS=5000 limit, evicts least-recently-used when full
- `get()` updates lastAccessed timestamp for LRU tracking

**ImagePipeline (`server/src/ImagePipeline.ts`):**
- Center-crops to square
- Resizes to 256×256
- Re-encodes to same format (JPEG, PNG, or WebP)
- Strips metadata

**HTTP Handler (`server/src/httpHandler.ts`):**
- `GET /health` - Health check with stats (status, uptime, rooms, players, avatars)
- `GET /avatars/:avatarId` - Serve avatar image
- `POST /avatar/upload` - Upload avatar (multipart/form-data, max 2MB)
- `POST /avatar/from-url` - Fetch avatar from URL (HTTPS only, SSRF protection)

**SSRF Protection:**
- HTTPS only
- DNS resolution check before fetch
- Blocks localhost, private IPs (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x)
- Blocks IPv6 local addresses (::1, fc/fd prefixes, fe80)
- No redirects allowed

---

## Socket Events

### Client → Server

| Event | Parameters | Description |
|-------|------------|-------------|
| `create_room` | `(actionId, settings, callback)` | Create new room with optional settings |
| `join_room` | `(actionId, roomCode, displayName, avatarId?, callback)` | Join existing room |
| `reconnect_room` | `(actionId, roomCode, playerId, playerSecret, callback)` | Rejoin after disconnect |
| `start_game` | `(actionId, callback)` | Start game (host only) |
| `update_room_settings` | `(actionId, settings, callback)` | Update room settings (host only, waiting state) |
| `playCard` | `(actionId, card, chosenColor, callback)` | Play a card |
| `drawCard` | `(actionId, callback)` | Draw from deck |
| `callUno` | `(actionId, callback)` | Call UNO on yourself |
| `catchUno` | `(actionId, targetPlayerId, callback)` | Catch someone who didn't call UNO |
| `sendChat` | `(actionId, message, callback)` | Send chat message |
| `leaveRoom` | `()` | Leave current room |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `roomUpdated` | `RoomState` | Room state changed |
| `playerJoined` | `PlayerPublic` | New player joined |
| `playerLeft` | `playerId` | Player left/disconnected |
| `gameStarted` | `void` | Game has started |
| `gameStateUpdate` | `GameView` | Player-specific game view (includes hand) |
| `clockSync` | `ClockSyncData` | Timer update (every 500ms) |
| `timeOut` | `TimeOutEvent` | Player ran out of time |
| `actionAck` | `{actionId, ok}` | Action acknowledgement |
| `chatMessage` | `ChatMessage` | New chat message |
| `chatHistory` | `ChatMessage[]` | Chat history on join |
| `error` | `string` | Error message |

---

## Shared Types (`shared/src/index.ts`)

```typescript
type RoomSettings = {
  maxPlayers: number;      // 2-10, default 6
  aiPlayerCount: number;   // 0-9, default 0
  timePerTurnMs: number;   // default 60000
  stackingMode: 'none' | 'colors' | 'numbers' | 'colors+numbers' | 'plus_same' | 'plus_any' | 'skip_reverse';
  jumpInMode: 'none' | 'exact' | 'power' | 'both';
  drawMode: 'single' | 'until_playable';
};

type RoomState = {
  id: string;
  name: string;
  players: PlayerPublic[];
  gameStatus: 'waiting' | 'playing' | 'finished';
  createdAt: number;
  deckSize?: number;
  discardPile?: Card[];
  currentPlayerIndex?: number;
  direction?: 1 | -1;
  activeColor?: 'red' | 'yellow' | 'green' | 'blue';
  gameEndedReason?: string;
  unoWindow?: UnoWindow;
  settings?: RoomSettings;
};

type Card = {
  color: 'red' | 'yellow' | 'green' | 'blue' | 'wild';
  value: string;  // '0'-'9', 'skip', 'reverse', 'draw2', 'wild', 'wild_draw4'
};

type PlayerPublic = {
  id: string;
  name: string;
  isReady: boolean;
  score?: number;
  connected: boolean;
  handCount: number;
  avatarId?: string;
  isAI?: boolean;
};

type PlayerPrivate = PlayerPublic & {
  secret: string;
  hand: Card[];
};

type GameView = {
  room: RoomState;
  me: PlayerPrivate;
  otherPlayers: PlayerPublic[];
};

type ClockSyncData = {
  activePlayerId: string;
  timeRemainingMs: { [playerId: string]: number };
};

type UnoWindow = {
  playerId: string;
  called: boolean;
};

type ChatMessage = {
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
};
```

---

## Client Architecture (`client/src/App.tsx`)

### Views

1. **Server Config** (`'server-config'`): Enter server URL, test connection
2. **Lobby** (`'lobby'`): Enter name, avatar, room settings, create/join room
3. **Room** (`'room'`): Waiting room or active game

### Key Components

**Error Boundary:**
- Class component wrapping entire app
- Catches React errors, shows friendly error screen
- "Reload Game" button clears session and reloads

**Game UI Components:**
- `ChessClock` - Large clock with M:SS.cc format, urgency effects
- `ClockChip` - Compact clock for carousel display
- `ChessClockBar` - Horizontal carousel of all player clocks with autoscroll to active player
- `CardDisplay` - UNO Minimalista styled card
- `CardBack` - Card back for opponent hands
- `OpponentHand` - Fanned card backs (up to 12 visible) with autoscroll to active player, avatar display (uploaded image or colored initial)
- `HandArea` - Player's hand with drag-to-play, keyboard selection, and autoscroll to selected card
- `ColorPickerModal` - Wild card color selection overlay with keyboard shortcuts (1-4)
- `SettingsModal` - In-room settings update for hosts in waiting state (overlay)
- `ChatDrawer` - Collapsible room chat at bottom
- `GameFinishedOverlay` - Game over modal with result

**Card Icons (SVG):**
- `SkipIcon` - Circle with diagonal line
- `ReverseIcon` - Angular arrows
- `Draw2Icon` - Two overlapping card outlines
- `WildIcon` - Four-color ring
- `WildDraw4Icon` - Four overlapping colored cards

### State Management

**localStorage Keys:**
```typescript
STORAGE_KEYS = {
  PLAYER_SECRET: 'playerSecret',
  PLAYER_ID: 'playerId',
  ROOM_CODE: 'roomCode',
  DISPLAY_NAME: 'displayName',
  AVATAR_ID: 'avatarId',
  SERVER_URL: 'serverUrl'
}
```

**URL Parameters:**
- `?server=<url>` - Pre-fill server URL
- `?room=<code>` - Pre-fill room code
- Parameters are cleaned from URL after processing

### Keyboard Controls

| Key | Action |
|-----|--------|
| `←` `→` | Select card in hand |
| `↑` or `Enter` | Play selected card |
| `↓` or `Space` | Draw card |
| `1-4` | Choose wild card color (when color picker is open) |
| `/` | Open chat input |
| `Escape` | Close color picker or chat input |

### Flying Chat (Niconico-style)

- Messages fly across screen right-to-left within game table area
- Start position: `right: -100%` (completely off-screen to right)
- End position: off-screen left, traveling full viewport width (not stopping at center)
- Random vertical position (10-70% from top)
- Dynamic duration: `(gameTableWidth + 300) / 200` seconds (~200px/s for readable speed)
- Own messages appear instantly (optimistic UI, no server round-trip delay)
- Other players' messages appear when received from server
- Removed from DOM 500ms after animation completes
- CSS `@keyframes fly-across` translates to `calc(-100vw - 120%)` for full-width travel

### Card Play Animation

- **Player Cards**: When local player plays a card, it animates flying from their hand position to the discard pile
- **Opponent Cards**: When opponent plays a card, it animates flying from their avatar/hand position to the discard pile
- Smooth 600px/s animation speed with distance-based duration (minimum 0.3s)
- Visual distinction between different players' card plays
- CSS transition with `transform` for smooth animation
- Card removed from DOM after animation completes

### Dynamic Version Tag

- Version displayed in footer on all pages: `YYYY.MM.DD+BUILD-<git-hash>`
- Example: `2026.1.19+6-58b87b3`
- Reads from Vite environment variables at build time:
  - `VITE_GIT_COMMIT_HASH`: Git commit hash (truncated to 7 chars)
  - `VITE_BUILD_NUMBER`: Build number (defaults to '0')
- Falls back to hardcoded version if environment variables not available
- Format: `${YYYY-MM-DD}+${BUILD}-${HASH}` ( dashes in date replaced with dots)

### Socket Reconnection

- Automatic reconnection on disconnect
- Shows "Connection lost. Attempting to reconnect..." message
- Attempts to rejoin room using stored credentials
- Falls back to lobby if room no longer exists

### Clock Interpolation

- Client interpolates between server clock syncs (every 500ms)
- Updates at ~27fps (37ms interval) for smooth centiseconds
- Respects `prefers-reduced-motion` (falls back to 1000ms updates)

---

## UNO Game Rules

### Card Matching
A card can be played if:
- Same color as top card (or active color after wild)
- Same value as top card
- Wild card (always playable)
- Top card is wild/wild_draw4 (any card playable)

### Special Cards

| Card | Effect |
|------|--------|
| Skip | Next player loses turn |
| Reverse | Direction changes (in 2-player: acts like Skip) |
| Draw 2 | Next player draws 2, loses turn |
| Wild | Choose color, normal turn advance |
| Wild Draw 4 | Choose color, next player draws 4, loses turn |

### UNO Call/Catch

1. When player has 1 card after playing, UNO window opens
2. Player can call `callUno` to protect themselves
3. Any opponent can call `catchUno(targetPlayerId)` before window closes
4. If caught: target draws 2 cards
5. Window closes when next player takes action

### Timeout Policy

When a player's clock reaches 0:
- They are marked as disconnected (unplayable)
- Turn advances to next player
- `timeOut` event emitted with `policy: 'playerTimedOut'`
- Game continues until only one active player remains

### Customizable Rules

#### Stacking Modes
- **none**: No stacking allowed
- **colors**: Stack cards of the same color (including wilds on colored cards)
- **numbers**: Stack cards of the same number
- **colors+numbers**: Stack cards of the same color or number
- **plus_same**: Stack Draw 2 and Wild Draw 4 cards (same denomination)
- **plus_any**: Stack Draw 2 and Wild Draw 4 cards (any denomination)
- **skip_reverse**: Stack Skip and Reverse cards (same type)

#### Jump-In Modes
- **none**: No jump-in allowed
- **exact**: Jump-in with exact color+value match
- **power**: Jump-in with Skip, Reverse, Draw 2, Wild, Wild Draw 4
- **both**: Jump-in with exact matches or power cards

#### Draw Modes
- **single**: Draw one card per turn
- **until_playable**: Draw until you get a playable card (maximum deck size to prevent infinite draws)

### AI Behavior

AI players (1-3 second "thinking" delay, occasionally longer for realism):
1. Find first playable card in hand
2. For wilds: choose most common color in hand
3. If no playable card: draw
4. Always calls UNO when at 1 card

---

## Production Robustness

### Server-side

- **Global Error Handlers**: `uncaughtException` and `unhandledRejection` logged but don't crash server
- **Max Room Limit**: 1000 concurrent rooms
- **Room Cleanup**: Every 5 minutes, removes rooms with no connected humans that are either:
  - Older than 30 minutes (stale)
  - Game status is 'finished'
- **Rate Limiting**: All socket events rate-limited per socket
- **Input Validation**: Room codes, cards, colors, player IDs validated
- **Timer Cleanup**: Room clocks stopped when room removed
- **Memory Leak Prevention**: Rate limiters cleaned up on socket disconnect
- **Graceful Shutdown**: SIGTERM/SIGINT handlers stop cleanup interval, disconnect sockets, close servers
- **Avatar LRU Eviction**: MAX_AVATARS=5000, evicts least-recently-used when at capacity
- **Health Endpoint**: `GET /health` returns `{ status, uptime, rooms, players, avatars }`

### Client-side

- **React Error Boundary**: Catches crashes, shows error screen with reload button
- **Socket Auto-Reconnection**: Automatic rejoin on connection loss
- **Session Recovery**: Uses localStorage to rejoin after page refresh

---

## Commands

```bash
# Development
cd server && bun run dev    # Start server on port 3000
cd client && bun run dev    # Start client on port 5173

# Testing
cd server && bun test       # Run 340 tests

# Type checking
cd client && bun run tsc --noEmit

# Production build
cd client && bun run build  # Outputs to dist/ (~293KB JS)

# Docker (with Nix)
nix build .#serverImage && docker load < result
nix build .#clientImage && docker load < result
docker-compose up -d
```

---

## Test Coverage

- **339 server tests pass** (1 flaky timeout in AI scheduling test)
- **953 expect() calls**
- Tests cover:
  - Room creation/joining/reconnection
  - Room grace period and reconnection
  - Game flow (start, play, draw, win conditions)
  - All card types and special effects
  - UNO call/catch mechanics
  - Clock timeout behavior
  - AI player behavior
  - Chat functionality
  - Rate limiting
  - Input validation
  - Deck reshuffling

---

## Design Decisions

1. **Server-authoritative**: All game logic runs on server to prevent cheating
2. **Full snapshots**: Send complete game state after each action (not deltas)
3. **Ephemeral everything**: No database, rooms deleted when empty (after grace period)
4. **Clock precision**: Centiseconds displayed for urgency, interpolated client-side
5. **Mobile-first**: Touch-friendly tap-to-select, drag-to-play optional
6. **UNO Minimalista style**: Clean, minimal card design with thin fonts
7. **Material Design 3**: Dark theme color palette
8. **Keyboard controls**: Desktop users can play without mouse, including wild card color selection
9. **Autoscroll behavior**: Active player/carousel and selected card automatically centered in view using `scrollIntoView({ inline: 'center' })` with multiple scroll attempts for timing reliability
10. **Carousel padding**: Horizontal padding (8rem) prevents clipping while allowing full scroll range, no `justify-center` on overflow containers to avoid rendering bugs
11. **Stacking logic**: Pending draws/skips/reverses accumulate when stackable cards are played on pending actions, resolved when drawing or advancing turns
12. **In-room settings**: Hosts can update room settings between rounds in waiting state, allowing dynamic rule changes without recreating rooms
13. **Tab styling**: Uses inline styles for color and border theming to ensure proper contrast and avoid invalid Tailwind class issues
14. **Card selection**: Always at least one card selected when it's player's turn (auto-selects first card on turn start, prevents selection clearing on card play)
15. **Drag handling**: Uses `pointer-events` and proper z-index management to prevent card clipping during drag-to-play
16. **Power card turn advancement**: Wild, Reverse, +2, and +4 cards always advance turn (no staying in round)
17. **Game reset**: Games auto-reset to waiting view after completion, allowing consecutive rounds without creating new rooms
18. **UNO Rules label styling**: All checkboxes and radio buttons use inline `style={{ color: THEME.onSurface }}` for proper contrast on dark backgrounds
19. **Version footer visibility**: Game table container uses `overflow-visible` instead of `overflow-hidden` to prevent clipping of absolute positioned elements
