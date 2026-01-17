# ccu.vc: Chess Clock Uno (Vibe-coded Edition)

> **note!**  
> i eventually want to make this myself, from scratch---but fighting
> with executive dysfunction, academic assignments, wanting to give opencode a shot,
> and wanting to try ralph loops mean that:
>
> this is an experiment! if it works, cool! else, it's a learning experience!

## Overview

Chess Clock UNO is a real-time multiplayer UNO game variant with per-player time banks—like chess clocks, but for UNO. Built with a Bun monorepo architecture using React (Vite) for the client and Socket.io for real-time communication.

## Project Structure

```
ccu.vc/
├── client/          # React + Vite frontend (@ccu/client)
├── server/          # Bun + Socket.io backend (@ccu/server)
├── shared/          # Shared TypeScript types (@ccu/shared)
└── package.json     # Workspace root
```

## Prerequisites

- [Bun](https://bun.sh/) v1.0+ (for running the server and managing dependencies)
- [Node.js](https://nodejs.org/) v18+ (optional, for npm compatibility)

## Development Setup

### 1. Install Dependencies

From the root directory:

```bash
bun install
```

This installs dependencies for all workspaces (client, server, shared).

### 2. Start the Development Servers

You'll need two terminal windows:

**Terminal 1 - Start the Server:**

```bash
cd server
bun run dev
```

The server runs on `http://localhost:3000` by default.

**Terminal 2 - Start the Client:**

```bash
cd client
bun run dev
```

The client runs on `http://localhost:5173` by default (Vite dev server).

### 3. Open the Game

Navigate to `http://localhost:5173` in your browser. You can open multiple tabs/browsers to test multiplayer functionality.

## Available Scripts

### Root

| Script | Description |
|--------|-------------|
| `bun install` | Install all workspace dependencies |

### Server (`cd server`)

| Script | Description |
|--------|-------------|
| `bun run dev` | Start server with hot reload |
| `bun run start` | Start server (production) |
| `bun run test` | Run server tests |
| `bun run typecheck` | TypeScript type checking |

### Client (`cd client`)

| Script | Description |
|--------|-------------|
| `bun run dev` | Start Vite dev server |
| `bun run build` | Build for production |
| `bun run preview` | Preview production build |
| `bun run typecheck` | TypeScript type checking |

## Environment Variables

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `CORS_ORIGIN` | `*` | Allowed CORS origins |

### Client

Create a `.env` file in the `client/` directory:

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_SERVER_URL` | `http://localhost:3000` | Socket.io server URL |

## Deployment

### Production Build

**Build the client:**

```bash
cd client
bun run build
```

This outputs static files to `client/dist/`.

**Start the server:**

```bash
cd server
bun run start
```

### Deployment Options

#### Option 1: Separate Static Hosting + Server

1. Deploy `client/dist/` to any static host (Vercel, Netlify, Cloudflare Pages)
2. Deploy the server to a Node.js/Bun-compatible host (Railway, Fly.io, Render)
3. Set `VITE_SERVER_URL` in the client build to point to your server URL

#### Option 2: Single Server (Server serves client)

You can configure the server to serve the built client files. Add static file serving to `server/src/index.ts`:

```typescript
// Serve static files from client/dist
if (req.method === 'GET' && !req.url?.startsWith('/socket.io')) {
  // Serve from client/dist
}
```

### Docker Deployment

Example `Dockerfile` for the server:

```dockerfile
FROM oven/bun:1

WORKDIR /app

COPY package.json bun.lockb ./
COPY shared ./shared
COPY server ./server

RUN bun install --frozen-lockfile

EXPOSE 3000

CMD ["bun", "run", "server/src/index.ts"]
```

## Testing

Run server tests:

```bash
cd server
bun test
```

## Game Features

- **Real-time multiplayer**: Create/join rooms with short 6-character codes
- **Chess clock**: Per-player time banks with configurable initial time and increment
- **Full UNO rules**: All card types including Wild, Wild Draw Four, Skip, Reverse, Draw Two
- **UNO calling**: Call UNO when down to one card, or get caught for a 2-card penalty
- **Reconnect support**: Rejoin games using stored session secrets
- **In-game chat**: Room-wide chat with rate limiting

## License

See [LICENSE](LICENSE) for details.
