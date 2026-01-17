**Implementation Plan: Chess Clock UNO (ccu.vc)**

- Goals
- Web multiplayer UNO with a chess clock
- Server-authoritative gameplay and timer
- Rule customization per room, defaulting to official UNO
- 2–10 players ("2–many"), designed for large friend groups
- Ephemeral identity (name + optional avatar), ephemeral rooms (exist only while someone is connected)
- Responsive, game-like interaction “juice” with physics-based motion
- Room-wide chat

**Tech Stack**
- Monorepo managed by Bun (workspaces)
- Server: Bun + Socket.io, in-memory room map (ephemeral)
- Client: Vite + React
- Shared: `shared/` for TypeScript types/constants and Socket event typings
- Motion/gestures: `react-spring` + `@use-gesture/react` (prefers-reduced-motion aware)

**Room & Identity Model**
- Room lifecycle
- Room exists iff `connectedCount > 0`
- If `connectedCount` becomes 0: room is ended and deleted immediately (game + chat + avatars)
- If only one connected player remains: auto-end game, winner = last connected, `reason="last-player-connected"`
- Player identity (ephemeral)
- On join: user submits `displayName` (required) and optional avatar setup
- Server assigns `playerId` (seat) and `playerSecret` (reconnect credential)
- Client stores `playerSecret` locally to reclaim seat on reconnect
- Reconnect allowed indefinitely as long as room still exists (someone connected)

**Server-Authoritative Game Engine**
- State store: `Map<roomId, RoomState>`
- Deterministic engine API shape
- `validateAction(room, playerId, action)`
- `applyAction(room, playerId, action)` -> updates state, returns animation/effect hints
- Hidden information
- Server stores full hands
- Client state view includes:
  - full own hand
  - opponents’ hand counts only
- Turn order + direction
- `players[]` is an ordered seat list
- `turnIndex` + `direction`
- `nextConnectedPlayerIndex()` skips disconnected players
- Reverse behavior
- 2 players: Reverse acts like Skip
- 3+ players: Reverse flips direction
- Settings (host-controlled pre-start)
- `maxPlayers` (2–10, default 6)
- timer config, UNO rule toggles, timeout policy, deck count (default 1)

**Chess Clock System**
- Server authoritative bookkeeping
- For each player: `timeRemainingMs`
- Current running clock: `activePlayerId`, `lastStartEpochMs`
- Internal timeout checks every 100–250ms (no broadcast)
- Broadcast sync: `clockSync` every 500ms per active room
- Client interpolation
- Smooth render using rAF (or 50ms interval fallback)
- Gentle correction on sync drift
- Timeout default (UNO flavor)
- On timeout: forced draw 1, immediately end turn (“autoDrawAndSkip”), advance to next connected player

**UNO Call / Catch (Defaults)**
- When a player hits 1 card by playing: open an “UNO window”
- Player may `callUno` out of turn until the next player performs their first action (play/draw)
- Catch-only resolution
- Any opponent may `catchUno(targetPlayerId)` while the window is open
- If caught: apply penalty (default draw 2), close window
- If window closes uncaught: no penalty (they got away with it)
- UNO/catch do not pause/switch clocks (prevents time abuse); rate-limited

**Networking Model (Socket.io)**
- Core idea: client sends “intent”, server validates and broadcasts authoritative updates
- Action pipeline (for responsiveness)
- Client generates `actionId` and sends action
- Immediate local pending visuals (optimistic intent, not optimistic state)
- Server replies quickly with `actionAck({ actionId, ok, errorCode? })`
- Server emits `actionResolved` (animation hints) + `gameStateUpdate` (full snapshot)
- Snapshot strategy
- Start with full snapshots after each action and on join/reconnect
- Optimize to deltas later only if needed

**Chat (Room-Wide)**
- Room-wide only, ephemeral
- Server maintains capped `chatLog` (last 100–200 msgs)
- On join/reconnect: `chatHistory`
- Rate limiting: e.g. 1 msg/sec with small burst
- Text-only rendering (no HTML), length cap (e.g. 280)

**Avatars (Upload + URL)**
- User can set avatar from:
- Uploaded file
- Remote URL
- Safety + serving model
- Server always sanitizes and serves avatars from your own endpoint
- Client never embeds third-party URLs directly in `<img>`
- Publicly accessible avatar URLs (anyone can fetch if they know the URL)
- Use unguessable `avatarId` (UUID) to make enumeration impractical
- Endpoints (example)
- `POST /avatar/upload` multipart -> `{ avatarId }`
- `POST /avatar/from-url` JSON -> `{ avatarId }`
- `GET /avatars/:avatarId` -> image bytes
- Sanitization pipeline (mandatory)
- Allowlist input types: png/jpeg/webp (no SVG; skip GIF in v1)
- Size cap: 1–2MB, strict timeout for URL fetch
- SSRF protection for URL fetch:
  - HTTPS only
  - forbid localhost/private/link-local IPs
  - limit redirects, re-check after redirect
- Decode then re-encode to a single safe format (recommend WebP)
- Strip metadata (EXIF), center-crop and resize to square (e.g. 256x256)
- Storage
- Ephemeral storage tied to room lifecycle (in-memory map is fine)
- On room deletion (0 connected): delete associated avatars

**Security Practices Checklist**
- Validate all user input server-side (name, chat, settings, actions, URLs)
- Escape/render chat as text
- Strict CORS allowlist in production; validate Socket.io handshake origin
- Server-per-event authorization (room membership, turn ownership, host-only sets)
- Rate limit:
- game actions
- join/create
- chat
- avatar upload/fetch
- Don’t leak hidden info (hands)
- Use unguessable IDs for rooms, players, avatars
- HTTPS/WSS in production

**Client UI/UX + Motion (“Interaction Juice”)**
- Design requirements
- First feedback within ~50ms for taps/presses
- GPU-friendly: animate transforms + opacity only
- Physics-based springs for tactile feel; interruptible gestures
- Respect `prefers-reduced-motion` (reduce bounce, simplify)
- Controls
- Tap/click selects card (primary, mobile friendly)
- Drag-and-drop optional for both mouse and touch (Pointer Events + drag threshold)
- Wild color selection via bottom sheet modal
- Feedback loops
- Pending action states on cards/buttons while awaiting server ack
- Invalid action: shake + message (no silent failures)
- Subtle audio/haptics optional (behind toggles and autoplay constraints)
- Layout (2–10 players)
- Player rail shows: name, avatar, connected state, card count, active highlight, timer
- Mobile: player rail scrollable/carousel; chat as bottom drawer

**Phases**
1. Scaffold monorepo (Bun), Vite client, Bun server, shared typings, basic room create/join
2. Implement server game engine (deck, hands, rules validation, turn logic, special cards)
3. Implement chess clock engine + timeout policy + clock sync
4. Implement client gameplay UI (selection-first), socket wiring, snapshots, pending/ack UX
5. Add motion system (react-spring/use-gesture), card animations, reduced-motion path
6. Add UNO call/catch mechanics + UI affordances
7. Add room-wide chat UI + server log + rate limiting
8. Add avatar upload + URL fetch pipeline + safe serving
9. Reconnect/disconnect skipping polish + last-player-connected win condition
10. AI opponents (optional order: earlier if desired), then final polish/perf/deploy
