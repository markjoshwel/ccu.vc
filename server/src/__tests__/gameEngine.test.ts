import { describe, expect, test, beforeEach } from 'bun:test';
import { 
  startGame, 
  advanceTurn, 
  canPlayCard, 
  playCard, 
  drawCard,
  getNextConnectedPlayerIndex,
  checkLastPlayerStanding
} from '../gameEngine';
import type { RoomState, PlayerPrivate, CardWithId } from '@ccu/shared';

function createMockPlayer(id: string, name: string): PlayerPrivate {
  return {
    playerId: id,
    playerSecret: `secret-${id}`,
    displayName: name,
    connected: true,
    handCount: 0,
    hand: [],
    timeRemainingMs: 60000
  };
}

function createMockRoom(playerCount: number = 2): RoomState {
  const players: PlayerPrivate[] = [];
  for (let i = 0; i < playerCount; i++) {
    players.push(createMockPlayer(`player${i + 1}`, `Player ${i + 1}`));
  }

  return {
    roomCode: 'TESTROOM',
    hostPlayerId: players[0]?.playerId || '',
    phase: 'lobby',
    settings: {
      maxPlayers: 6,
      initialTimeMs: 60000,
      incrementMs: 5000,
      deckCount: 1
    },
    players,
    deck: [],
    discardPile: [],
    activeColor: null,
    turnIndex: 0,
    direction: 1,
    unoWindow: null,
    winnerId: null,
    winReason: null,
    activePlayerId: null,
    lastClockStartMs: null
  };
}

function createCard(type: 'number' | 'action' | 'wild', opts: {
  id?: string;
  color?: 'red' | 'yellow' | 'green' | 'blue';
  value?: number | 'skip' | 'reverse' | 'draw2';
  wildType?: 'wild' | 'wild4';
}): CardWithId {
  if (type === 'number') {
    return {
      id: opts.id || 'card-' + Math.random().toString(36).substr(2, 9),
      type: 'number',
      color: opts.color || 'red',
      value: (opts.value || 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
    };
  } else if (type === 'action') {
    return {
      id: opts.id || 'card-' + Math.random().toString(36).substr(2, 9),
      type: 'action',
      color: opts.color || 'red',
      value: (opts.value || 'skip') as 'skip' | 'reverse' | 'draw2'
    };
  } else {
    return {
      id: opts.id || 'card-' + Math.random().toString(36).substr(2, 9),
      type: 'wild',
      wildType: opts.wildType || 'wild'
    };
  }
}

describe('startGame', () => {
  test('deals 7 cards to each player', () => {
    const room = createMockRoom(4);
    startGame(room, 12345);
    
    expect(room.phase).toBe('playing');
    for (const player of room.players) {
      expect(player.hand.length).toBe(7);
      expect(player.handCount).toBe(7);
    }
  });

  test('sets up discard pile with a number card', () => {
    const room = createMockRoom(2);
    startGame(room, 12345);
    
    expect(room.discardPile.length).toBe(1);
    expect(room.discardPile[0].type).toBe('number');
  });

  test('sets active color from starting card', () => {
    const room = createMockRoom(2);
    startGame(room, 12345);
    
    const startCard = room.discardPile[0];
    if (startCard.type === 'number') {
      expect(room.activeColor).toBe(startCard.color);
    }
  });

  test('throws error if game already started', () => {
    const room = createMockRoom(2);
    room.phase = 'playing';
    
    expect(() => startGame(room)).toThrow('Game already started');
  });

  test('throws error if less than 2 players', () => {
    const room = createMockRoom(1);
    
    expect(() => startGame(room)).toThrow('Need at least 2 players');
  });
});

describe('turn order', () => {
  test('advanceTurn moves to next player', () => {
    const room = createMockRoom(4);
    startGame(room, 12345);
    
    expect(room.turnIndex).toBe(0);
    expect(room.activePlayerId).toBe('player1');
    
    advanceTurn(room);
    expect(room.turnIndex).toBe(1);
    expect(room.activePlayerId).toBe('player2');
  });

  test('advanceTurn wraps around', () => {
    const room = createMockRoom(3);
    startGame(room, 12345);
    room.turnIndex = 2;
    
    advanceTurn(room);
    expect(room.turnIndex).toBe(0);
  });

  test('advanceTurn skips disconnected players', () => {
    const room = createMockRoom(4);
    startGame(room, 12345);
    
    // Disconnect player 2
    room.players[1].connected = false;
    
    advanceTurn(room);
    // Should skip player 2 and go to player 3
    expect(room.turnIndex).toBe(2);
  });

  test('direction change reverses turn order', () => {
    const room = createMockRoom(4);
    startGame(room, 12345);
    room.direction = -1;
    
    advanceTurn(room);
    expect(room.turnIndex).toBe(3); // Wraps to last player
  });

  test('getNextConnectedPlayerIndex finds next connected', () => {
    const room = createMockRoom(4);
    startGame(room, 12345);
    room.players[1].connected = false;
    room.players[2].connected = false;
    
    const next = getNextConnectedPlayerIndex(room);
    expect(next).toBe(3);
  });
});

describe('canPlayCard', () => {
  test('allows matching color', () => {
    const room = createMockRoom(2);
    room.discardPile = [createCard('number', { color: 'red', value: 5 })];
    room.activeColor = 'red';
    
    const card = createCard('number', { color: 'red', value: 3 });
    expect(canPlayCard(room, card)).toBe(true);
  });

  test('allows matching number', () => {
    const room = createMockRoom(2);
    room.discardPile = [createCard('number', { color: 'red', value: 5 })];
    room.activeColor = 'red';
    
    const card = createCard('number', { color: 'blue', value: 5 });
    expect(canPlayCard(room, card)).toBe(true);
  });

  test('rejects non-matching card', () => {
    const room = createMockRoom(2);
    room.discardPile = [createCard('number', { color: 'red', value: 5 })];
    room.activeColor = 'red';
    
    const card = createCard('number', { color: 'blue', value: 3 });
    expect(canPlayCard(room, card)).toBe(false);
  });

  test('allows wild cards always', () => {
    const room = createMockRoom(2);
    room.discardPile = [createCard('number', { color: 'red', value: 5 })];
    room.activeColor = 'red';
    
    const wild = createCard('wild', { wildType: 'wild' });
    expect(canPlayCard(room, wild)).toBe(true);
    
    const wild4 = createCard('wild', { wildType: 'wild4' });
    expect(canPlayCard(room, wild4)).toBe(true);
  });

  test('allows matching action type', () => {
    const room = createMockRoom(2);
    room.discardPile = [createCard('action', { color: 'red', value: 'skip' })];
    room.activeColor = 'red';
    
    const card = createCard('action', { color: 'blue', value: 'skip' });
    expect(canPlayCard(room, card)).toBe(true);
  });
});

describe('playCard', () => {
  test('removes card from hand and adds to discard pile', () => {
    const room = createMockRoom(2);
    startGame(room, 12345);
    
    const playerId = room.players[0].playerId;
    const cardToPlay = room.players[0].hand.find(c => canPlayCard(room, c))!;
    
    const initialHandSize = room.players[0].hand.length;
    const result = playCard(room, playerId, cardToPlay.id);
    
    expect(result.ok).toBe(true);
    expect(room.players[0].hand.length).toBe(initialHandSize - 1);
    expect(room.discardPile[room.discardPile.length - 1].id).toBe(cardToPlay.id);
  });

  test('rejects play if not player turn', () => {
    const room = createMockRoom(2);
    startGame(room, 12345);
    
    const wrongPlayerId = room.players[1].playerId;
    const cardId = room.players[1].hand[0].id;
    
    const result = playCard(room, wrongPlayerId, cardId);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('NOT_YOUR_TURN');
  });

  test('rejects invalid play', () => {
    const room = createMockRoom(2);
    startGame(room, 12345);
    
    // Add a specific card that won't match
    const playerId = room.players[0].playerId;
    const player = room.players[0];
    
    // Force a non-matching card
    const nonMatchingCard = createCard('number', { 
      id: 'non-matching-card',
      color: 'yellow', 
      value: 9 
    });
    player.hand.push(nonMatchingCard);
    
    // Set discard to red 1
    room.discardPile = [createCard('number', { color: 'red', value: 1 })];
    room.activeColor = 'red';
    
    const result = playCard(room, playerId, 'non-matching-card');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('INVALID_PLAY');
  });

  test('wild card requires color choice', () => {
    const room = createMockRoom(2);
    startGame(room, 12345);
    
    const playerId = room.players[0].playerId;
    const player = room.players[0];
    
    const wildCard = createCard('wild', { id: 'wild-card', wildType: 'wild' });
    player.hand.push(wildCard);
    
    // Try without color
    const result = playCard(room, playerId, 'wild-card');
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('COLOR_REQUIRED');
    
    // Try with color
    const resultWithColor = playCard(room, playerId, 'wild-card', 'blue');
    expect(resultWithColor.ok).toBe(true);
    expect(room.activeColor).toBe('blue');
  });

  test('advances turn after valid play', () => {
    const room = createMockRoom(2);
    startGame(room, 12345);
    
    const playerId = room.players[0].playerId;
    const player = room.players[0];
    
    // Add a card that matches the current active color
    const matchingCard = createCard('number', { 
      id: 'matching-card', 
      color: room.activeColor!, 
      value: 2 
    });
    player.hand.push(matchingCard);
    
    playCard(room, playerId, 'matching-card');
    
    expect(room.activePlayerId).toBe(room.players[1].playerId);
  });
});

describe('drawCard', () => {
  test('adds card to player hand', () => {
    const room = createMockRoom(2);
    startGame(room, 12345);
    
    const playerId = room.players[0].playerId;
    const initialHandSize = room.players[0].hand.length;
    
    const result = drawCard(room, playerId);
    
    expect(result.ok).toBe(true);
    expect(room.players[0].hand.length).toBe(initialHandSize + 1);
  });

  test('advances turn after draw', () => {
    const room = createMockRoom(2);
    startGame(room, 12345);
    
    const playerId = room.players[0].playerId;
    drawCard(room, playerId);
    
    expect(room.activePlayerId).toBe(room.players[1].playerId);
  });

  test('rejects if not player turn', () => {
    const room = createMockRoom(2);
    startGame(room, 12345);
    
    const wrongPlayerId = room.players[1].playerId;
    const result = drawCard(room, wrongPlayerId);
    
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('NOT_YOUR_TURN');
  });
});

describe('win conditions', () => {
  test('playing last card wins the game', () => {
    const room = createMockRoom(2);
    startGame(room, 12345);
    
    const playerId = room.players[0].playerId;
    const player = room.players[0];
    
    // Give player only one card that matches
    player.hand = [createCard('number', { id: 'last-card', color: room.activeColor!, value: 1 })];
    player.handCount = 1;
    
    const result = playCard(room, playerId, 'last-card');
    
    expect(result.ok).toBe(true);
    expect(room.phase).toBe('finished');
    expect(room.winnerId).toBe(playerId);
    expect(room.winReason).toBe('empty-hand');
  });

  test('last connected player wins', () => {
    const room = createMockRoom(3);
    startGame(room, 12345);
    
    room.players[1].connected = false;
    room.players[2].connected = false;
    
    const won = checkLastPlayerStanding(room);
    
    expect(won).toBe(true);
    expect(room.phase).toBe('finished');
    expect(room.winnerId).toBe('player1');
    expect(room.winReason).toBe('last-player-connected');
  });
});

describe('special cards', () => {
  test('skip card skips next player', () => {
    const room = createMockRoom(3);
    startGame(room, 12345);
    
    const playerId = room.players[0].playerId;
    const player = room.players[0];
    
    // Give player a skip card that matches
    const skipCard = createCard('action', { id: 'skip-card', color: room.activeColor!, value: 'skip' });
    player.hand.push(skipCard);
    
    playCard(room, playerId, 'skip-card');
    
    // Should skip player 2 and go to player 3
    expect(room.activePlayerId).toBe('player3');
  });

  test('reverse card changes direction', () => {
    const room = createMockRoom(4);
    startGame(room, 12345);
    
    const playerId = room.players[0].playerId;
    const player = room.players[0];
    
    const reverseCard = createCard('action', { id: 'reverse-card', color: room.activeColor!, value: 'reverse' });
    player.hand.push(reverseCard);
    
    expect(room.direction).toBe(1);
    playCard(room, playerId, 'reverse-card');
    
    expect(room.direction).toBe(-1);
    expect(room.activePlayerId).toBe('player4'); // Goes backwards
  });

  test('draw two makes next player draw 2 and skip turn', () => {
    const room = createMockRoom(3);
    startGame(room, 12345);
    
    const playerId = room.players[0].playerId;
    const player = room.players[0];
    const initialPlayer2HandSize = room.players[1].hand.length;
    
    const draw2Card = createCard('action', { id: 'draw2-card', color: room.activeColor!, value: 'draw2' });
    player.hand.push(draw2Card);
    
    playCard(room, playerId, 'draw2-card');
    
    // Player 2 should have drawn 2 cards
    expect(room.players[1].hand.length).toBe(initialPlayer2HandSize + 2);
    // Turn should go to player 3 (skip player 2)
    expect(room.activePlayerId).toBe('player3');
  });

  test('wild draw four makes next player draw 4 and skip turn', () => {
    const room = createMockRoom(3);
    startGame(room, 12345);
    
    const playerId = room.players[0].playerId;
    const player = room.players[0];
    const initialPlayer2HandSize = room.players[1].hand.length;
    
    const wild4Card = createCard('wild', { id: 'wild4-card', wildType: 'wild4' });
    player.hand.push(wild4Card);
    
    playCard(room, playerId, 'wild4-card', 'blue');
    
    // Player 2 should have drawn 4 cards
    expect(room.players[1].hand.length).toBe(initialPlayer2HandSize + 4);
    // Turn should go to player 3 (skip player 2)
    expect(room.activePlayerId).toBe('player3');
    // Active color should be blue
    expect(room.activeColor).toBe('blue');
  });
});
