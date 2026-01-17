import type { RoomState, ClockSync } from '@ccu/shared';
import { drawCard, advanceTurn, checkLastPlayerStanding } from './gameEngine';

// Clock sync interval in ms
const CLOCK_SYNC_INTERVAL = 1000;

// Store interval handles per room
const clockIntervals = new Map<string, NodeJS.Timer>();

/**
 * Start the clock for a room
 */
export function startClockSync(
  room: RoomState, 
  broadcastSync: (sync: ClockSync) => void,
  onTimeout: (playerId: string) => void
): void {
  // Clear any existing interval
  stopClockSync(room.roomCode);

  const interval = setInterval(() => {
    if (room.phase !== 'playing') {
      stopClockSync(room.roomCode);
      return;
    }

    // Update active player's time
    if (room.activePlayerId && room.lastClockStartMs) {
      const player = room.players.find(p => p.playerId === room.activePlayerId);
      if (player && player.connected) {
        const elapsed = Date.now() - room.lastClockStartMs;
        const newTimeRemaining = Math.max(0, player.timeRemainingMs - elapsed);
        
        // Check for timeout
        if (newTimeRemaining <= 0) {
          onTimeout(player.playerId);
          return;
        }
      }
    }

    // Broadcast clock sync
    const sync: ClockSync = {
      activePlayerId: room.activePlayerId,
      players: room.players.map(p => ({
        playerId: p.playerId,
        timeRemainingMs: p.playerId === room.activePlayerId && room.lastClockStartMs
          ? Math.max(0, p.timeRemainingMs - (Date.now() - room.lastClockStartMs))
          : p.timeRemainingMs
      })),
      serverTimestamp: Date.now()
    };

    broadcastSync(sync);
  }, CLOCK_SYNC_INTERVAL);

  clockIntervals.set(room.roomCode, interval);
}

/**
 * Stop the clock for a room
 */
export function stopClockSync(roomCode: string): void {
  const interval = clockIntervals.get(roomCode);
  if (interval) {
    clearInterval(interval);
    clockIntervals.delete(roomCode);
  }
}

/**
 * Handle player timeout with autoDrawAndSkip policy
 */
export function handleTimeout(room: RoomState, playerId: string): { ok: boolean; drew: boolean } {
  if (room.phase !== 'playing') {
    return { ok: false, drew: false };
  }

  const player = room.players.find(p => p.playerId === playerId);
  if (!player || room.activePlayerId !== playerId) {
    return { ok: false, drew: false };
  }

  // Apply increment to the player who timed out (so they have time next turn)
  player.timeRemainingMs = room.settings.incrementMs;

  // Auto-draw a card and skip turn
  const drawnCard = room.deck.pop();
  if (drawnCard) {
    player.hand.push(drawnCard);
    player.handCount = player.hand.length;
  }

  // Reshuffle if deck is empty
  if (room.deck.length === 0 && room.discardPile.length > 1) {
    const topCard = room.discardPile.pop()!;
    room.deck = [...room.discardPile];
    room.discardPile = [topCard];
    for (let i = room.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [room.deck[i], room.deck[j]] = [room.deck[j], room.deck[i]];
    }
  }

  // Advance turn
  advanceTurn(room);

  // Check if only one player connected
  checkLastPlayerStanding(room);

  return { ok: true, drew: drawnCard !== undefined };
}

/**
 * Apply time increment when a player completes their turn
 */
export function applyIncrement(room: RoomState, playerId: string): void {
  const player = room.players.find(p => p.playerId === playerId);
  if (!player) return;

  if (room.lastClockStartMs) {
    // Calculate actual time remaining
    const elapsed = Date.now() - room.lastClockStartMs;
    player.timeRemainingMs = Math.max(0, player.timeRemainingMs - elapsed);
  }

  // Add increment
  player.timeRemainingMs += room.settings.incrementMs;
}
