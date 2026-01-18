# Agent Session Notes

## Current Session: Tabletop UI Revamp

### Overview
Chess Clock UNO UI has been completely redesigned with a tabletop game feel:
1. Green felt table background with radial gradient
2. Opponents shown at top with fanned card backs
3. Central play area with draw pile and discard pile
4. Player hand at bottom with fanned cards
5. UNO Minimalista card styling (Barlow font, thin lines, underlined 6/9)

### Session Summary
- **Bug Fix**: Fixed UNO call crash (callback was null) - made all socket callbacks optional
- **Bug Fix**: Fixed playCard signature order (chosenColor before callback)
- **Tabletop UI**: Complete redesign of game view
- **UNO Minimalista Cards**: Thin font, clean line icons, proper color ring for wild
- **Opponent Card Backs**: Fanned display showing card count
- **Fanned Hand**: Cards fan out in an arc at bottom
- **Configurable Server URL**: Users can connect to any server, supports URL params
- 340 server tests passing

### Codebase Structure
```
ccu.vc/
├── client/           # Vite + React frontend
│   ├── index.html    # Barlow font loaded from Google Fonts
│   └── src/
│       ├── App.tsx   # Main component (tabletop UI)
│       ├── main.tsx  # Entry point
│       └── index.css # Tailwind v4 import
├── server/           # Bun + Socket.io backend
│   └── src/
│       ├── index.ts      # Server entry, socket handlers
│       ├── RoomManager.ts # Room & game logic (with AI players)
│       ├── Deck.ts       # UNO deck
│       └── ...
├── shared/           # Shared TypeScript types
│   └── src/
│       └── index.ts  # Types for Room, Player, Card, Events
└── AGENTS.md         # This file
```

### UI Components Implemented

#### 1. Server Configuration (server-config view)
- First-time users see a server URL input dialog
- URL parameter support: `?server=your-server.com` skips the dialog
- Server URL is saved to localStorage
- "Change" button in lobby to switch servers
- Connection test before proceeding

#### 2. SVG Card Icons (UNO Minimalista Style)
Located in App.tsx as inline components:
- `SkipIcon`: Circle with diagonal line (thin stroke)
- `ReverseIcon`: Angular arrows (sharp corners, not curved)
- `Draw2Icon`: Two overlapping card outlines
- `WildIcon`: Color ring with 4 arc segments (red/blue/green/yellow)
- `WildDraw4Icon`: Four overlapping colored card outlines
- `CardNumber`: Large thin digit (Barlow 200 weight), underlined for 6/9
- `CornerIndicator`: Corner value (thin font, underlined 6/9)
- `CardBack`: Card back with UNO logo for opponent hands

#### 3. Opponent Hand Display (OpponentHand component)
- Fanned card backs showing card count
- Player name and timer badge
- Active player highlighting
- Positioned at top of table

#### 4. Tabletop Layout
- Green felt background with radial gradient
- Subtle noise texture overlay
- Direction indicator (↻ or ↺)
- Central play area with:
  - Draw pile (stacked card backs, clickable)
  - Discard pile (top card displayed)
  - Active color indicator (colored dot)

#### 5. Fanned Hand (HandArea component)
- Cards fan out in an arc
- Overlapping cards with calculated offsets
- Hover lift effect
- Drag-to-play functionality
- Plays on tap/click or drag-to-discard

#### 6. Color Palette (THEME constant)
```typescript
const THEME = {
  // UNO Minimalista card colors
  cardRed: '#E53935',
  cardBlue: '#1E88E5',
  cardGreen: '#43A047',
  cardYellow: '#FDD835',
  cardWild: '#212121',
  // Tabletop
  tableGreen: '#1B5E20',
  tableFelt: '#2E7D32',
  // ... Material Design 3 colors
};
const CARD_FONT = "'Barlow', sans-serif";
```

### Card Values (from Deck.ts)
- Colors: `red`, `yellow`, `green`, `blue`, `wild`
- Values: `0-9`, `skip`, `reverse`, `draw2`, `wild`, `wild_draw4`

### Key UI Features
- **Configurable server** - Users can point to any server URL
- **URL parameter sharing** - `?server=host.com` for easy sharing
- **Tabletop feel** - Green felt background, cards arranged around table
- **UNO Minimalista styling** - Thin Barlow font, clean line icons
- **Underlined 6/9** - To distinguish from each other
- **Fanned cards** - Both player hand and opponent backs
- **Active color indicator** - Colored dot on discard pile for wild cards
- **Direction indicator** - Arrow showing play direction
- **Drag-and-drop** - Drag cards to discard pile to play

### How to Share a Game Link

```
https://your-hosted-client.com/?server=your-server.com:3000
```

This will:
1. Skip the server configuration dialog
2. Automatically connect to the specified server
3. Save the server URL to localStorage for future visits

### How to Run

```bash
# Terminal 1 - Server
cd server && bun run dev

# Terminal 2 - Client
cd client && bun run dev
```

Open http://localhost:5173 in browser.

### Test Results (Last Run)
- **340 server tests pass**
- **956 expect() calls**
- Client typecheck passes
- Client builds successfully

### Socket Event Signatures (Updated)
```typescript
// playCard: chosenColor comes BEFORE callback (Socket.io callback must be last)
playCard: (actionId, card, chosenColor, callback?) => void

// All callbacks are now optional (use callback?.() pattern)
drawCard: (actionId, callback?) => void
callUno: (actionId, callback?) => void
catchUno: (actionId, targetPlayerId, callback?) => void
sendChat: (actionId, message, callback?) => void
```
