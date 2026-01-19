# Chess Clock UNO (ccu.vc)

A web-based multiplayer UNO game with chess clock time pressure. Built with React, Socket.io, and Bun.

## Quick Start

```bash
# Install dependencies
bun install

# Start server (terminal 1)
cd server && bun run dev

# Start client (terminal 2)
cd client && bun run dev

# Open http://localhost:5173
```

## Tech Stack

- **Frontend**: Vite + React + Tailwind CSS v4
- **Backend**: Bun + Socket.io
- **Animations**: react-spring + @use-gesture/react
- **Monorepo**: Bun workspaces

## Project Structure

```
ccu.vc/
├── client/           # Vite + React frontend
│   └── src/
│       ├── App.tsx   # Main application (2000+ lines)
│       ├── main.tsx  # Entry point
│       └── index.css # Tailwind + custom utilities
├── server/           # Bun + Socket.io backend
│   └── src/
│       ├── index.ts      # Server entry & socket handlers
│       ├── RoomManager.ts # Room & game logic
│       ├── Deck.ts       # UNO deck implementation
│       └── server.test.ts # 339 tests
├── shared/           # Shared TypeScript types
│   └── src/
│       └── index.ts  # Type definitions
└── DEPLOY.md         # Deployment guide
```

## Key Features

- **Real-time Multiplayer** - 2-10 players per room with Socket.io
- **Chess Clock Timer** - Millisecond precision with urgency effects
- **Customizable UNO Rules** - Stacking, jump-in modes, draw behaviors
- **AI Opponents** - Configurable bot players
- **Niconico-style Chat** - Flying messages across screen
- **Card Animations** - Flying cards from hand to discard pile
- **Mobile Responsive** - Touch-friendly with keyboard shortcuts

## Development Commands

```bash
# Type check all workspaces
bun run typecheck

# Build for production
bun run build

# Run server tests
cd server && bun test

# Lint (if configured)
bun run lint
```

## Game Rules & Settings

### Standard UNO (Default)
- **Stacking**: Plus cards of same denomination (+2 on +2, +4 on +4)
- **Jump-In**: Exact color+value match only
- **Draw**: Single card per turn

### Customizable Options

**Stacking Modes:**
- Colors: Stack cards of same color
- Numbers: Stack cards of same number
- Plus (same): Stack +2 on +2, +4 on +4
- Plus (any): Stack any draw card on any draw card
- Skip/Reverse: Stack Skip on Skip, Reverse on Reverse

**Jump-In Modes:**
- Exact: Jump in with matching color+number
- Skip: Jump in with Skip cards
- Reverse: Jump in with Reverse cards
- Draw 2: Jump in with Draw 2 cards
- Wild: Jump in with Wild cards
- Wild Draw 4: Jump in with Wild Draw 4 cards

**Draw Modes:**
- Single: Draw one card per turn
- Until Playable: Auto-draw until playable card

## Architecture

- **Server-Authoritative**: All game logic on server prevents cheating
- **Ephemeral Rooms**: No database, rooms deleted after grace period
- **Reconnection**: 5-minute grace period for dropped connections
- **Hidden Information**: Server only sends each player their own hand

## Configuration

### Environment Variables (Build Time)
- `VITE_GIT_COMMIT_HASH`: Git commit hash for version tag
- `VITE_BUILD_NUMBER`: Build number for version tag

### Server Settings
- Max rooms: 1000 concurrent
- Room TTL: 30 minutes inactivity
- Grace period: 5 minutes (empty rooms)
- Rate limits: Chat 3/s, Actions 10/s, Room ops 2/5s

## Deployment

See [DEPLOY.md](./DEPLOY.md) for:
- Docker Compose setup
- Nix flake builds
- Reverse proxy configuration (Caddy)

## Contributing

See [AGENTS.md](./AGENTS.md) for development notes and session history.
See [IMPLEMENTATION.md](./IMPLEMENTATION.md) for detailed technical specification.
