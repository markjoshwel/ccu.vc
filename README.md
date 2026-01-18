# Chess Clock UNO (ccu.vc)

A web-based multiplayer UNO game with chess clock time pressure. Built with React, Socket.io, and Bun.

## Features

- **Multiplayer UNO** - 2-10 players per room
- **Chess Clock Timer** - Each player has limited time per turn (60 seconds default)
- **Real-time Gameplay** - Server-authoritative game state with Socket.io
- **UNO Mechanics** - Call UNO when you have one card, catch opponents who forget
- **Room Chat** - Chat with other players in your room
- **Custom Avatars** - Upload an image or use a URL
- **Responsive Design** - Works on desktop and mobile
- **Reduced Motion Support** - Respects `prefers-reduced-motion`

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
│       ├── App.tsx   # Main application component
│       ├── main.tsx  # Entry point
│       └── index.css # Tailwind imports
├── server/           # Bun + Socket.io backend
│   └── src/
│       ├── index.ts      # Server entry & socket handlers
│       ├── RoomManager.ts # Room & game logic
│       ├── Deck.ts       # UNO deck implementation
│       ├── AvatarStore.ts # Avatar storage
│       ├── ImagePipeline.ts # Image processing
│       └── RateLimiter.ts   # Rate limiting
├── shared/           # Shared TypeScript types
│   └── src/
│       └── index.ts  # Type definitions
└── IMPLEMENTATION.md # Detailed specification
```

## Setup

1. Install Bun (>=1.0) from https://bun.sh
2. Install dependencies:
   ```bash
   bun install
   ```

## Development

Start both server and client in separate terminals:

```bash
# Terminal 1 - Start the server
cd server && bun run dev

# Terminal 2 - Start the client
cd client && bun run dev
```

Open http://localhost:5173 in your browser.

## Other Commands

```bash
# Type check all workspaces
bun run typecheck

# Build for production
bun run build

# Run server tests
cd server && bun test
```

## Game Rules

- Standard UNO rules apply
- Special cards: Skip, Reverse, Draw 2, Wild, Wild Draw 4
- When you have one card left, you can call "UNO!"
- If you forget to call UNO, other players can catch you (draw 2 penalty)
- If your timer runs out, you automatically draw a card and your turn ends

## Architecture

- **Server-Authoritative**: All game logic runs on the server
- **Ephemeral Rooms**: Rooms exist only while players are connected
- **Reconnection**: Players can rejoin using stored credentials
- **Hidden Information**: Server only sends each player their own hand

## Contributing

See [AGENTS.md](./AGENTS.md) for development notes and session history.
