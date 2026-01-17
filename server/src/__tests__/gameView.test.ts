import { describe, expect, test } from 'bun:test';
import { toGameView } from '../gameView';
import type { RoomState, PlayerPrivate, CardWithId } from '@ccu/shared';

function createMockCard(id: string, color: 'red' | 'yellow' | 'green' | 'blue', value: number): CardWithId {
  return {
    id,
    type: 'number',
    color,
    value: value as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
  };
}

function createMockPlayer(playerId: string, displayName: string, cards: CardWithId[]): PlayerPrivate {
  return {
    playerId,
    playerSecret: `secret-${playerId}`,
    displayName,
    connected: true,
    handCount: cards.length,
    hand: cards,
    timeRemainingMs: 60000
  };
}

function createMockRoom(players: PlayerPrivate[]): RoomState {
  return {
    roomCode: 'TESTROOM',
    hostPlayerId: players[0]?.playerId || '',
    phase: 'playing',
    settings: {
      maxPlayers: 6,
      initialTimeMs: 60000,
      incrementMs: 5000,
      deckCount: 1
    },
    players,
    deck: [],
    discardPile: [createMockCard('discard-1', 'red', 5)],
    activeColor: 'red',
    turnIndex: 0,
    direction: 1,
    unoWindow: null,
    winnerId: null,
    winReason: null,
    activePlayerId: players[0]?.playerId || null,
    lastClockStartMs: null
  };
}

describe('toGameView - Hidden Information', () => {
  test('gameStateUpdate contains full hand only for the requesting player', () => {
    const player1Cards = [
      createMockCard('p1-1', 'red', 1),
      createMockCard('p1-2', 'blue', 2),
      createMockCard('p1-3', 'green', 3)
    ];
    const player2Cards = [
      createMockCard('p2-1', 'yellow', 4),
      createMockCard('p2-2', 'red', 5)
    ];

    const player1 = createMockPlayer('player1', 'Alice', player1Cards);
    const player2 = createMockPlayer('player2', 'Bob', player2Cards);

    const room = createMockRoom([player1, player2]);

    // Get view for player1
    const viewForPlayer1 = toGameView(room, 'player1');

    // Player1 should see their own full hand
    expect(viewForPlayer1.myHand).toEqual(player1Cards);
    expect(viewForPlayer1.myHand.length).toBe(3);
    
    // Player1 should see all card properties in their hand
    expect(viewForPlayer1.myHand[0].id).toBe('p1-1');
    const card = viewForPlayer1.myHand[0];
    if (card.type === 'number') {
      expect(card.color).toBe('red');
    }
    expect(viewForPlayer1.myHand[0].type).toBe('number');
  });

  test('opponent info shows handCount but not card objects', () => {
    const player1Cards = [
      createMockCard('p1-1', 'red', 1),
      createMockCard('p1-2', 'blue', 2),
      createMockCard('p1-3', 'green', 3)
    ];
    const player2Cards = [
      createMockCard('p2-1', 'yellow', 4),
      createMockCard('p2-2', 'red', 5)
    ];

    const player1 = createMockPlayer('player1', 'Alice', player1Cards);
    const player2 = createMockPlayer('player2', 'Bob', player2Cards);

    const room = createMockRoom([player1, player2]);

    // Get view for player1
    const viewForPlayer1 = toGameView(room, 'player1');

    // Check opponents array
    expect(viewForPlayer1.opponents.length).toBe(1);
    
    const opponentView = viewForPlayer1.opponents[0];
    expect(opponentView.playerId).toBe('player2');
    expect(opponentView.displayName).toBe('Bob');
    expect(opponentView.handCount).toBe(2);
    
    // Verify no card data is present (opponent should not have hand property)
    expect('hand' in opponentView).toBe(false);
    expect('playerSecret' in opponentView).toBe(false);
  });

  test('serialized payload does not contain opponent card data', () => {
    const player1Cards = [createMockCard('p1-1', 'red', 1)];
    const player2Cards = [
      createMockCard('secret-card-1', 'yellow', 4),
      createMockCard('secret-card-2', 'red', 5)
    ];

    const player1 = createMockPlayer('player1', 'Alice', player1Cards);
    const player2 = createMockPlayer('player2', 'Bob', player2Cards);

    const room = createMockRoom([player1, player2]);

    // Get view for player1 and serialize it (as would be sent over network)
    const viewForPlayer1 = toGameView(room, 'player1');
    const serialized = JSON.stringify(viewForPlayer1);

    // The serialized payload should NOT contain opponent card IDs
    expect(serialized).not.toContain('secret-card-1');
    expect(serialized).not.toContain('secret-card-2');
    
    // It should contain player1's card
    expect(serialized).toContain('p1-1');
    
    // It should NOT contain playerSecrets
    expect(serialized).not.toContain('secret-player1');
    expect(serialized).not.toContain('secret-player2');
  });

  test('view for each player shows different myHand', () => {
    const player1Cards = [createMockCard('p1-card', 'red', 1)];
    const player2Cards = [createMockCard('p2-card', 'blue', 2)];

    const player1 = createMockPlayer('player1', 'Alice', player1Cards);
    const player2 = createMockPlayer('player2', 'Bob', player2Cards);

    const room = createMockRoom([player1, player2]);

    const viewForPlayer1 = toGameView(room, 'player1');
    const viewForPlayer2 = toGameView(room, 'player2');

    // Each player sees their own hand
    expect(viewForPlayer1.myHand[0].id).toBe('p1-card');
    expect(viewForPlayer2.myHand[0].id).toBe('p2-card');

    // Each player sees the other as opponent with count only
    expect(viewForPlayer1.opponents[0].playerId).toBe('player2');
    expect(viewForPlayer1.opponents[0].handCount).toBe(1);
    
    expect(viewForPlayer2.opponents[0].playerId).toBe('player1');
    expect(viewForPlayer2.opponents[0].handCount).toBe(1);
  });
});
