# Agent Session Notes

## Version: 2026.1.19+6-aafe55e

### Overview
Chess Clock UNO - Real-time multiplayer UNO with chess clock mechanics, keyboard controls, and niconico-style flying chat.

### Recent Changes (v2026.1.19)

#### Bug Fixes
- **Card Selection Bug Fixed**: At least one card is now always selected when it's the player's turn, on both mobile and desktop. Fixed issue where players couldn't play even when it was their turn.
- **Drag-to-Deck Clipping Fixed**: Cards no longer clip out of hand view when being dragged. Added `pointer-events` handling and proper z-index management.
- **Power Card Stacking Fixed**: Players can no longer stay in turn after playing power cards (wild, reverse, +2, +4). Turn properly advances to the next player.
- **Auto-Reset After Game End**: When a game finishes, all players now correctly return to the "waiting for players" view, allowing hosts to play consecutive rounds without creating new rooms.
- **UNO Rules Label Styling Fixed**: All checkboxes and radio buttons in the UNO Rules tab now have proper `THEME.onSurface` color styling, fixing black text on dark background.
- **Version Footer Visibility Fixed**: Version tag now displayed in Lobby and Room views. Game table container changed from `overflow-hidden` to `overflow-visible` to prevent clipping.

#### Production Robustness
- **Room Grace Period**: Added 5-minute grace period when room becomes empty of connected humans. Hosts can switch tabs/apps and reconnect without losing the room. Room is deleted only after grace period expires (5 min) OR after 30 minutes of inactivity.
- **Max Room Limit**: Server caps at 1000 concurrent rooms to prevent resource exhaustion
- **Room Grace Period**: Removed immediate room deletion on last player disconnect; rooms now persist until TTL cleanup (30 min), allowing hosts to leave and return
- **React Error Boundary**: Catches React crashes, shows user-friendly error with reload button
- **Socket Auto-Reconnection**: Automatic rejoin attempts when connection is lost
- **Deck Reshuffling**: Discard pile automatically reshuffled into deck when empty (standard UNO rule)
- **Rate Limiting**: All socket events rate-limited (chat: 3/s, actions: 10/s, room ops: 2/5s)
- **Input Validation**: Room codes, cards, colors, and player IDs validated server-side
- **Memory Leak Fix**: Rate limiters cleaned up on socket disconnect
- **Timer Cleanup**: Room clocks properly stopped when room is removed
- **Graceful Shutdown**: SIGTERM/SIGINT handlers for clean server shutdown
- **Avatar LRU Eviction**: MAX_AVATARS=5000 limit with least-recently-used eviction
- **Health Endpoint**: `GET /health` returns status, uptime, room/player/avatar counts

#### Card Play Animation
- **Player Card Animation**: When a player plays a card, it now animates flying from their hand to the discard pile
- **Opponent Card Animation**: When an opponent plays a card, it animates flying from their position to the discard pile
- Visual distinction between different players' card plays
- Smooth 600px/s animation speed with distance-based duration

#### Niconico Chat Improvements
- **Full Screen Travel**: Chat messages now travel the full width of the screen (from right edge to left edge), no longer stopping at center
- **Slower Speed**: Animation speed reduced from 350px/s to 200px/s for better readability
- **CSS Animation Updated**: `@keyframes fly-across` now translates to `calc(-100vw - 120%)` for full-width travel

#### Room Creation UI
- **Tabbed Interface**: Settings and UNO Rules tabs in lobby and room creation
- **Settings Tab**: Max players slider (2-10), AI opponents counter (0-9), time-per-turn slider (15-120s)
- **UNO Rules Tab**: Granular checkboxes for stacking modes (colors, numbers, plus_same, plus_any, skip_reverse), jump-in modes (exact, skip, reverse, draw2, wild, wild4), and radio buttons for draw mode (single, until_playable) - server-side logic implemented for all combinations

#### Dynamic Version Tag
- **Version Display**: All pages now display a dynamic version tag in the footer
- **Format**: `YYYY.MM.DD+BUILD-<git-hash>` (e.g., `2026.1.19+6-aafe55e`)
- **Build Info**: Reads from environment variables (VITE_GIT_COMMIT_HASH, VITE_BUILD_NUMBER) at build time
- **Fallback**: Falls back to hardcoded version if build variables not available

#### Keyboard Controls
- **Arrow Left/Right**: Select card in hand
- **Arrow Up / Enter**: Play selected card
- **Arrow Down / Space**: Draw card from pile
- **1-4**: Choose wild card color (when color picker is open)
- **/** (slash): Open chat overlay
- **Escape**: Close chat overlay
- Keybinds help displayed at bottom of game screen (desktop only)

#### Flying Chat (Niconico-style)
- Messages fly across the screen right-to-left within game table area like niconico/bilibili
- Press `/` to open floating chat input overlay
- Messages visible without scrolling down
- Start at `right: -100%` (completely off-screen), travel full viewport width
- Dynamic animation duration based on game table width (~350px/s for faster, niconico-like speed)
- Own messages appear instantly (optimistic UI, no server round-trip delay)
- Original ChatDrawer still available at bottom

#### Opponent Hand Visualization
- Card backs now fanned out like player's hand
- Up to 12 cards shown individually
- Overflow indicator (+N) for hands larger than 12
- More intuitive count visualization than just a number
- Avatar display: Users see their uploaded avatar; bots and users without avatars get a colored initial badge
- Avatar initial color: Consistent per player based on name character code (5 color palette) - uses second character for better distribution (e.g., "Bot Alpha" uses 'A', "Bot Beta" uses 'B')
- Layout improvements: Avatar, name, and time evenly spaced with proper alignment
- Active player highlighting fixed by using player ID instead of array index

#### Range Slider Fix
- Added `step={1}` and `Math.round()` for proper integer rounding

#### Color Picker Keyboard Shortcuts
- Press `1-4` to quickly select red, yellow, green, or blue when color picker is open
- `Escape` cancels color selection
- Keyboard shortcuts displayed on color buttons

#### Timeout Behavior Update
- Timed-out players marked as disconnected (unplayable) instead of ending game immediately
- Game continues until only one active player remains
- Prevents premature game end in multiplayer scenarios
- 1v1 games still end instantly when one player times out

#### AI Hesitation
- AI players now hesitate 1-3 seconds normally, with 20% chance for extra 2-5 seconds delay
- Makes AI behavior more human-like and less predictable

#### Autoscroll & Carousel Fixes
- **Hand Autoscroll**: Selected card automatically centered in view using `scrollIntoView({ inline: 'center' })`
- **Opponent Carousel Autoscroll**: Active player's hand automatically centered in view
- **Timer Carousel Autoscroll**: Active player's clock automatically centered in view with requestAnimationFrame + setTimeout for reliable DOM rendering
- **Carousel Clipping Fix**: Removed `justify-center` from overflow containers to prevent left-side clipping when scrolling
- **Carousel Padding**: Added 8rem horizontal padding to ensure proper scroll range without clipping
- **Opponent Active State Fix**: Fixed opponent highlighting by using player ID comparison instead of array index (prevented one-off bug)
- **Opponent Avatars**: Added avatar display for opponents; bots and users without avatars get a colored initial badge with consistent color based on name

#### Room Creation UI Enhancements
- **Tabbed Interface**: Settings and UNO Rules tabs in lobby
- **Settings Tab**: Max players slider (2-10), AI opponents counter (0-9), time-per-turn slider (15-120s)
- **UNO Rules Tab**: Granular checkboxes for stacking modes (colors, numbers, plus_same, plus_any, skip_reverse), jump-in modes (exact, power), and radio buttons for draw mode (single, until_playable) - server-side logic implemented for all combinations
- **Auto-Selection**: First card automatically selected when player's turn starts
- **Card Animation**: Flying card animations for all card plays (opponents and player)
- **Drag Clipping Fix**: Hand container overflow changed to prevent card clipping
- **Chat Speed**: Niconico-style chat at ~350px/s, stops at screen center
- **Continuous Rounds**: Games auto-reset to waiting view after completion
- **In-Room Settings Changes**: Hosts can update room settings in the waiting view between rounds via settings modal
- **UI Fixes**: Corrected tab styling by using inline styles for proper color theming instead of invalid Tailwind classes

#### Keyboard Controls
- **Arrow Left/Right**: Select card in hand
- **Arrow Up / Enter**: Play selected card
- **Arrow Down / Space**: Draw card from pile
- **/** (slash): Open chat overlay
- **Escape**: Close chat overlay
- Keybinds help displayed at bottom of game screen (desktop only)

#### Flying Chat (Niconico-style)
- Messages fly across the screen right-to-left within game table area like niconico/bilibili
- Press `/` to open floating chat input overlay
- Messages visible without scrolling down
- Start at `right: -100%` (completely off-screen), travel full viewport width
- Dynamic animation duration based on game table width (~350px/s for faster, niconico-like speed)
- Own messages appear instantly (optimistic UI, no server round-trip delay)
- Original ChatDrawer still available at bottom

#### Opponent Hand Visualization
- Card backs now fanned out like player's hand
- Up to 12 cards shown individually
- Overflow indicator (+N) for hands larger than 12
- More intuitive count visualization than just a number
- Avatar display: Users see their uploaded avatar; bots and users without avatars get a colored initial badge
- Avatar initial color: Consistent per player based on name character code (5 color palette) - uses second character for better distribution (e.g., "Bot Alpha" uses 'A', "Bot Beta" uses 'B')
- Layout improvements: Avatar, name, and time evenly spaced with proper alignment
- Active player highlighting fixed by using player ID instead of array index

#### Range Slider Fix
- Added `step={1}` and `Math.round()` for proper integer rounding

#### Color Picker Keyboard Shortcuts
- Press `1-4` to quickly select red, yellow, green, or blue when color picker is open
- `Escape` cancels color selection
- Keyboard shortcuts displayed on color buttons

#### Timeout Behavior Update
- Timed-out players marked as disconnected (unplayable) instead of ending game immediately
- Game continues until only one active player remains
- Prevents premature game end in multiplayer scenarios
- 1v1 games still end instantly when one player times out

#### AI Hesitation
- AI players now hesitate 1-3 seconds normally, with 20% chance for extra 2-5 seconds delay
- Makes AI behavior more human-like and less predictable

#### Autoscroll & Carousel Fixes
- **Hand Autoscroll**: Selected card automatically centered in view using `scrollIntoView({ inline: 'center' })`
- **Opponent Carousel Autoscroll**: Active player's hand automatically centered in view
- **Timer Carousel Autoscroll**: Active player's clock automatically centered in view with requestAnimationFrame + setTimeout for reliable DOM rendering
- **Carousel Clipping Fix**: Removed `justify-center` from overflow containers to prevent left-side clipping when scrolling
- **Carousel Padding**: Added 8rem horizontal padding to ensure proper scroll range without clipping
- **Opponent Active State Fix**: Fixed opponent highlighting by using player ID comparison instead of array index (prevented one-off bug)
- **Opponent Avatars**: Added avatar display for opponents; bots and users without avatars get a colored initial badge with consistent color based on name

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
- `OpponentCarousel`: Horizontal carousel of opponent hands with autoscroll to active player
- `HandArea`: Player's hand with drag-to-play, keyboard selection, and autoscroll to selected card
- `ColorPickerModal`: Wild card color selection (overlay)
- `ErrorMessage`: Floating toast notification
- `ChatDrawer`: Collapsible room chat
- `RangeSlider`: Styled range input with filled track
- `SettingsModal`: In-room settings update for hosts in waiting state (overlay)

#### Input Components
- `RangeSlider`: Custom styled range input with gradient fill

### Keyboard Controls Reference
| Key | Action |
|-----|--------|
| `←` `→` | Select card in hand |
| `↑` or `Enter` | Play selected card |
| `↓` or `Space` | Draw card |
| `1-4` | Choose wild card color (when color picker is open) |
| `/` | Open chat input |
| `Escape` | Close color picker or chat input |

### CSS Animations Added
```css
/* Flying chat message animation (niconico-style) */
@keyframes fly-across {
  0% { transform: translateX(0); }
  100% { transform: translateX(calc(-100vw - 120%)); }
}
/* Duration set dynamically via inline styles: (gameTableWidth + 300) / 200 seconds for readable speed */

/* Flying card animation for card plays */
@keyframes fly-card {
  0% { transform: translate(0, 0); }
  100% { transform: translate(targetX, targetY); }
}
/* Duration calculated as: distance / 600 seconds */
```

### Key Technical Decisions
- Error messages use `fixed` positioning to avoid layout shifts
- Clock updates at ~27fps (37ms interval) for smooth centiseconds
- Background color set on html/body to prevent white flash
- URL params cleaned after processing to keep URLs clean
- Mobile breakpoint uses Tailwind's `md:` prefix (768px)
- Keyboard controls only active when not typing in input fields
- Flying message duration calculated as `(gameTableWidth + 300) / 200` seconds for readable speed
- Flying card duration calculated as `distance / 600` seconds
- Own flying messages shown immediately via optimistic UI (no server round-trip)
- Opponent cards capped at 12 visible for performance
- Autoscroll uses `scrollIntoView({ inline: 'center', block: 'nearest' })` for reliable centering
- Carousel containers use explicit `paddingLeft`/`paddingRight` instead of `justify-center` to prevent overflow clipping
- Room grace period of 5 minutes allows hosts to switch tabs/apps and reconnect
- Dynamic version tag reads from `import.meta.env.VITE_GIT_COMMIT_HASH` and `VITE_BUILD_NUMBER`

### Version Increment Workflow

When releasing changes, follow this workflow:

1. **Make your changes** - Implement features/fixes in the codebase

2. **Commit changes** - Use a descriptive commit message:
   ```bash
   git add -A
   git commit -m "Describe your changes"
   ```

3. **Increment version** - Update all version references:
   ```bash
   # Update package.json files (client, server, shared)
   # Update flake.nix
   # Update shared/src/version.ts fallback
   # Update AGENTS.md version header
   # Update IMPLEMENTATION.md version header
   ```

   Version format: `YYYY.MM.DD+BUILD-<git-hash>`
   - `YYYY.MM.DD`: Current date
   - `BUILD`: Increment build number (6, 7, 8...)
   - `<git-hash>`: First 7 chars of commit hash (e.g., `aafe55e`)

4. **Commit version bump**:
   ```bash
   git add -A
   git commit -m "Update version to <new-version>"
   ```

5. **Push**:
   ```bash
   git push
   ```

**Files to update for version bumps:**
| File | Location |
|------|----------|
| `client/package.json` | `"version": "YYYY.MM.DD+BUILD-hash"` |
| `server/package.json` | `"version": "YYYY.MM.DD+BUILD-hash"` |
| `shared/package.json` | `"version": "YYYY.MM.DD+BUILD-hash"` |
| `flake.nix` | `version = "YYYY.MM.DD+BUILD-hash"` |
| `shared/src/version.ts` | Fallback string and BUILD_NUMBER default |
| `AGENTS.md` | `## Version: YYYY.MM.DD+BUILD-hash` |
| `IMPLEMENTATION.md` | `## Version: YYYY.MM.DD+BUILD-hash` |

**Build with version:**
```bash
# Sets VITE_GIT_COMMIT_HASH and VITE_BUILD_NUMBER at build time
bun run build
```

The dynamic version tag will display: `YYYY.MM.DD+BUILD-hash` (e.g., `2026.1.19+7-aafe55e`)
