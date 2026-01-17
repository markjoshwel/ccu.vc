import type { RoomState, GameView, OpponentView, PlayerPrivate } from '@ccu/shared';

/**
 * Convert full room state to a player-specific view that hides opponent hands
 */
export function toGameView(room: RoomState, playerId: string): GameView {
  const myPlayer = room.players.find(p => p.playerId === playerId);
  if (!myPlayer) {
    throw new Error(`Player ${playerId} not found in room ${room.roomCode}`);
  }

  // Build opponents view (hide hands, only show count)
  const opponents: OpponentView[] = room.players
    .filter(p => p.playerId !== playerId)
    .map(p => ({
      playerId: p.playerId,
      displayName: p.displayName,
      connected: p.connected,
      handCount: p.hand.length,
      avatarId: p.avatarId,
      timeRemainingMs: p.timeRemainingMs
    }));

  // Get current player based on turn index
  const currentPlayer = room.phase === 'playing' && room.players.length > 0
    ? room.players[room.turnIndex]
    : null;

  return {
    roomCode: room.roomCode,
    hostPlayerId: room.hostPlayerId,
    phase: room.phase,
    settings: room.settings,
    myPlayerId: playerId,
    myHand: myPlayer.hand,
    opponents,
    discardTop: room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null,
    activeColor: room.activeColor,
    turnIndex: room.turnIndex,
    currentPlayerId: currentPlayer?.playerId || null,
    direction: room.direction,
    unoWindow: room.unoWindow,
    winnerId: room.winnerId,
    winReason: room.winReason,
    myTimeRemainingMs: myPlayer.timeRemainingMs
  };
}
