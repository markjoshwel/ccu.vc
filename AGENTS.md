# Agent Session Notes

## Version: v2026.1.19

### Overview
Chess Clock UNO - Real-time multiplayer UNO with chess clock mechanics, keyboard controls, and niconico-style flying chat.

### Recent Changes (v2026.1.19)

#### Keyboard Controls
- **Arrow Left/Right**: Select card in hand
- **Arrow Up / Enter**: Play selected card
- **Arrow Down / Space**: Draw card from pile
- **/** (slash): Open chat overlay
- **Escape**: Close chat overlay
- Keybinds help displayed at bottom of game screen (desktop only)

#### Flying Chat (Niconico-style)
- Messages fly across the screen right-to-left like niconico/bilibili
- Press `/` to open floating chat input overlay
- Messages visible without scrolling down
- 8-second animation across screen
- Original ChatDrawer still available at bottom

#### Opponent Hand Visualization
- Card backs now fanned out like player's hand
- Up to 12 cards shown individually
- Overflow indicator (+N) for hands larger than 12
- More intuitive count visualization than just a number

#### Range Slider Fix
- Added `step={1}` and `Math.round()` for proper integer rounding

#### Deployment
- Added `flake.nix` for Nix-based builds and Docker images
- Added `docker-compose.yml` for container deployment
- Added `Caddyfile` for reverse proxy configuration
- Added `DEPLOY.md` with deployment documentation

### Codebase Structure
```
ccu.vc/
├── client/           # Vite + React frontend
│   ├── index.html    # Barlow font loaded from Google Fonts
│   └── src/
│       ├── App.tsx   # Main component (tabletop UI)
│       ├── main.tsx  # Entry point
│       └── index.css # Tailwind v4 + custom utilities
├── server/           # Bun + Socket.io backend
│   └── src/
│       ├── index.ts      # Server entry, socket handlers
│       ├── RoomManager.ts # Room & game logic (with AI players)
│       ├── Deck.ts       # UNO deck
│       └── ...
├── shared/           # Shared TypeScript types
│   └── src/
│       └── index.ts  # Types for Room, Player, Card, Events
├── flake.nix         # Nix flake for builds & Docker images
├── docker-compose.yml # Container orchestration
├── Caddyfile         # Reverse proxy config
├── DEPLOY.md         # Deployment documentation
└── AGENTS.md         # This file
```

### UI Components

#### Chess Clock Components
- `ChessClock`: Large clock with M:SS.cc format, urgency effects, active indicator
- `ClockChip`: Compact clock for carousel display
- `ChessClockBar`: Horizontal carousel of all players' clocks

#### Card Components
- `CardDisplay`: Renders a card with UNO Minimalista styling
- `CardBack`: Card back with UNO logo for opponent hands
- `CardNumber`, `CardContent`, `CornerIndicator`: Card internals
- `SkipIcon`, `ReverseIcon`, `Draw2Icon`, `WildIcon`, `WildDraw4Icon`: SVG icons

#### Layout Components
- `OpponentHand`: Fanned card backs (up to 12 visible) with player info
- `HandArea`: Player's hand with drag-to-play and keyboard selection
- `ColorPickerModal`: Wild card color selection (overlay)
- `ErrorMessage`: Floating toast notification
- `ChatDrawer`: Collapsible room chat
- `RangeSlider`: Styled range input with filled track

#### Input Components
- `RangeSlider`: Custom styled range input with gradient fill

### Keyboard Controls Reference
| Key | Action |
|-----|--------|
| `←` `→` | Select card in hand |
| `↑` or `Enter` | Play selected card |
| `↓` or `Space` | Draw card |
| `/` | Open chat input |
| `Escape` | Close chat input |

### CSS Animations Added
```css
/* Flying chat message animation (niconico-style) */
@keyframes fly-across {
  0% { transform: translateX(0); }
  100% { transform: translateX(calc(-100% - 100vw)); }
}
.animate-fly-across {
  animation: fly-across 8s linear forwards;
}
```

### How to Run

```bash
# Terminal 1 - Server
cd server && bun run dev

# Terminal 2 - Client
cd client && bun run dev
```

Open http://localhost:5173 in browser.

### Deployment

See `DEPLOY.md` for full instructions. Quick start:

```bash
# Build Docker images with Nix
nix build .#serverImage && docker load < result
nix build .#clientImage && docker load < result

# Start with Docker Compose
docker-compose up -d
```

### Test Results
- **340 server tests pass**
- **956 expect() calls**
- Client typecheck passes
- Client builds successfully (~290KB JS)

### Socket Event Signatures
```typescript
// playCard: chosenColor comes BEFORE callback (Socket.io callback must be last)
playCard: (actionId, card, chosenColor, callback?) => void

// All callbacks are now optional (use callback?.() pattern)
drawCard: (actionId, callback?) => void
callUno: (actionId, callback?) => void
catchUno: (actionId, targetPlayerId, callback?) => void
sendChat: (actionId, message, callback?) => void
```

### Key Technical Decisions
- Error messages use `fixed` positioning to avoid layout shifts
- Clock updates at ~27fps (37ms interval) for smooth centiseconds
- Background color set on html/body to prevent white flash
- URL params cleaned after processing to keep URLs clean
- Mobile breakpoint uses Tailwind's `md:` prefix (768px)
- Keyboard controls only active when not typing in input fields
- Flying messages removed after 8s animation completes
- Opponent cards capped at 12 visible for performance
