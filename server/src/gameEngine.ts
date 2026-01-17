import type { 
  RoomState, 
  CardWithId, 
  CardColor, 
  ActionAck,
  TurnDirection
} from '@ccu/shared';
import { generateShuffledDeck, seededRNG } from './deck';

const INITIAL_HAND_SIZE = 7;

/**
 * Start the game: deal initial hands and set up discard pile
 */
export function startGame(room: RoomState, seed?: number): void {
  if (room.phase !== 'lobby') {
    throw new Error('Game already started');
  }
  if (room.players.length < 2) {
    throw new Error('Need at least 2 players to start');
  }

  // Generate shuffled deck
  const rng = seed !== undefined ? seededRNG(seed) : undefined;
  room.deck = generateShuffledDeck(room.settings.deckCount, rng);

  // Deal initial hands
  for (const player of room.players) {
    player.hand = [];
    for (let i = 0; i < INITIAL_HAND_SIZE; i++) {
      const card = room.deck.pop();
      if (card) {
        player.hand.push(card);
        player.handCount = player.hand.length;
      }
    }
  }

  // Find a valid starting card (not wild or action card)
  let startingCard: CardWithId | undefined;
  while (room.deck.length > 0) {
    const card = room.deck.pop()!;
    if (card.type === 'number') {
      startingCard = card;
      break;
    } else {
      // Put non-number cards back at bottom of deck
      room.deck.unshift(card);
    }
  }

  if (!startingCard) {
    throw new Error('No valid starting card found');
  }

  room.discardPile = [startingCard];
  // startingCard is guaranteed to be a number card due to the filter above
  if (startingCard.type === 'number') {
    room.activeColor = startingCard.color;
  }
  room.phase = 'playing';
  room.turnIndex = 0;
  room.direction = 1;
  room.activePlayerId = room.players[0].playerId;
  room.lastClockStartMs = Date.now();
}

/**
 * Find the next connected player index
 */
export function getNextConnectedPlayerIndex(room: RoomState): number {
  const playerCount = room.players.length;
  let nextIndex = room.turnIndex;
  
  // Try up to playerCount times to find a connected player
  for (let i = 0; i < playerCount; i++) {
    nextIndex = (nextIndex + room.direction + playerCount) % playerCount;
    if (room.players[nextIndex].connected) {
      return nextIndex;
    }
  }
  
  // No connected players found (shouldn't happen in normal gameplay)
  return room.turnIndex;
}

/**
 * Get count of connected players
 */
export function getConnectedPlayerCount(room: RoomState): number {
  return room.players.filter(p => p.connected).length;
}

/**
 * Advance to the next turn
 */
export function advanceTurn(room: RoomState, skipCount: number = 1): void {
  const playerCount = room.players.length;
  
  for (let i = 0; i < skipCount; i++) {
    room.turnIndex = (room.turnIndex + room.direction + playerCount) % playerCount;
    
    // Skip disconnected players
    let attempts = 0;
    while (!room.players[room.turnIndex].connected && attempts < playerCount) {
      room.turnIndex = (room.turnIndex + room.direction + playerCount) % playerCount;
      attempts++;
    }
  }
  
  room.activePlayerId = room.players[room.turnIndex].playerId;
  room.lastClockStartMs = Date.now();
}

/**
 * Check if only one player is connected (auto-win condition)
 */
export function checkLastPlayerStanding(room: RoomState): boolean {
  if (room.phase !== 'playing') return false;
  
  const connectedCount = getConnectedPlayerCount(room);
  if (connectedCount === 1) {
    const winner = room.players.find(p => p.connected);
    if (winner) {
      room.phase = 'finished';
      room.winnerId = winner.playerId;
      room.winReason = 'last-player-connected';
      return true;
    }
  }
  return false;
}

/**
 * Validate if a card can be played
 */
export function canPlayCard(room: RoomState, card: CardWithId): boolean {
  if (room.discardPile.length === 0) return true;
  
  const topCard = room.discardPile[room.discardPile.length - 1];
  const activeColor = room.activeColor;

  // Wild cards can always be played
  if (card.type === 'wild') {
    return true;
  }

  // Check color match
  if (card.type === 'number' || card.type === 'action') {
    if (card.color === activeColor) {
      return true;
    }
  }

  // Check value/symbol match
  if (topCard.type === 'number' && card.type === 'number') {
    if (topCard.value === card.value) {
      return true;
    }
  }

  if (topCard.type === 'action' && card.type === 'action') {
    if (topCard.value === card.value) {
      return true;
    }
  }

  return false;
}

/**
 * Play a card
 */
export function playCard(
  room: RoomState, 
  playerId: string, 
  cardId: string, 
  chosenColor?: CardColor
): ActionAck {
  // Check if it's this player's turn
  if (room.activePlayerId !== playerId) {
    return { actionId: '', ok: false, errorCode: 'NOT_YOUR_TURN' };
  }

  // Check game is in playing state
  if (room.phase !== 'playing') {
    return { actionId: '', ok: false, errorCode: 'GAME_NOT_PLAYING' };
  }

  const player = room.players.find(p => p.playerId === playerId);
  if (!player) {
    return { actionId: '', ok: false, errorCode: 'PLAYER_NOT_FOUND' };
  }

  const cardIndex = player.hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) {
    return { actionId: '', ok: false, errorCode: 'CARD_NOT_IN_HAND' };
  }

  const card = player.hand[cardIndex];

  // Validate play
  if (!canPlayCard(room, card)) {
    return { actionId: '', ok: false, errorCode: 'INVALID_PLAY' };
  }

  // Wild cards require a color choice
  if (card.type === 'wild' && !chosenColor) {
    return { actionId: '', ok: false, errorCode: 'COLOR_REQUIRED' };
  }

  // Close any UNO window when player takes action (before we modify hands)
  closeUnoWindow(room);

  // Remove card from hand and add to discard pile
  player.hand.splice(cardIndex, 1);
  player.handCount = player.hand.length;
  room.discardPile.push(card);

  // Set active color
  if (card.type === 'wild' && chosenColor) {
    room.activeColor = chosenColor;
  } else if (card.type === 'number' || card.type === 'action') {
    room.activeColor = card.color;
  }

  // Handle special cards
  let skipCount = 1;
  const playerCount = room.players.filter(p => p.connected).length;

  if (card.type === 'action') {
    switch (card.value) {
      case 'skip':
        skipCount = 2; // Skip next player
        break;
      case 'reverse':
        if (playerCount === 2) {
          // In 2-player, reverse acts like skip
          skipCount = 2;
        } else {
          room.direction = (room.direction * -1) as TurnDirection;
        }
        break;
      case 'draw2':
        // Apply draw 2 to next player and skip their turn
        const nextPlayerIndex = getNextConnectedPlayerIndex(room);
        const nextPlayer = room.players[nextPlayerIndex];
        for (let i = 0; i < 2; i++) {
          const drawnCard = room.deck.pop();
          if (drawnCard) {
            nextPlayer.hand.push(drawnCard);
            nextPlayer.handCount = nextPlayer.hand.length;
          }
        }
        skipCount = 2; // Skip the player who drew
        break;
    }
  }

  if (card.type === 'wild' && card.wildType === 'wild4') {
    // Wild Draw Four: next player draws 4 and loses turn
    const nextPlayerIndex = getNextConnectedPlayerIndex(room);
    const nextPlayer = room.players[nextPlayerIndex];
    for (let i = 0; i < 4; i++) {
      const drawnCard = room.deck.pop();
      if (drawnCard) {
        nextPlayer.hand.push(drawnCard);
        nextPlayer.handCount = nextPlayer.hand.length;
      }
    }
    skipCount = 2; // Skip the player who drew
  }

  // Check win condition
  if (player.hand.length === 0) {
    room.phase = 'finished';
    room.winnerId = playerId;
    room.winReason = 'empty-hand';
    room.unoWindow = null;
    return { actionId: '', ok: true };
  }

  // Open UNO window if player has 1 card left
  if (player.hand.length === 1) {
    room.unoWindow = {
      playerId: playerId,
      calledUno: false
    };
  }

  // Advance turn
  advanceTurn(room, skipCount);

  return { actionId: '', ok: true };
}

/**
 * Draw a card
 */
export function drawCard(room: RoomState, playerId: string): ActionAck {
  // Check if it's this player's turn
  if (room.activePlayerId !== playerId) {
    return { actionId: '', ok: false, errorCode: 'NOT_YOUR_TURN' };
  }

  // Check game is in playing state
  if (room.phase !== 'playing') {
    return { actionId: '', ok: false, errorCode: 'GAME_NOT_PLAYING' };
  }

  const player = room.players.find(p => p.playerId === playerId);
  if (!player) {
    return { actionId: '', ok: false, errorCode: 'PLAYER_NOT_FOUND' };
  }

  // Draw a card from deck
  const card = room.deck.pop();
  if (card) {
    player.hand.push(card);
    player.handCount = player.hand.length;
  }

  // Reshuffle if deck is empty
  if (room.deck.length === 0 && room.discardPile.length > 1) {
    // Keep top card, shuffle rest back into deck
    const topCard = room.discardPile.pop()!;
    room.deck = [...room.discardPile];
    room.discardPile = [topCard];
    // Shuffle
    for (let i = room.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [room.deck[i], room.deck[j]] = [room.deck[j], room.deck[i]];
    }
  }

  // Close any UNO window when player takes action (draw counts as action)
  closeUnoWindow(room);

  // End turn
  advanceTurn(room);

  return { actionId: '', ok: true };
}

/**
 * Close the UNO window when next player takes action
 */
export function closeUnoWindow(room: RoomState): void {
  if (room.unoWindow && room.activePlayerId !== room.unoWindow.playerId) {
    // Window closes when a different player takes action
    room.unoWindow = null;
  }
}

/**
 * Call UNO (player announces they have one card)
 */
export function callUno(room: RoomState, playerId: string): ActionAck {
  if (room.phase !== 'playing') {
    return { actionId: '', ok: false, errorCode: 'GAME_NOT_PLAYING' };
  }

  // Check if there's an open UNO window for this player
  if (!room.unoWindow || room.unoWindow.playerId !== playerId) {
    return { actionId: '', ok: false, errorCode: 'NO_UNO_WINDOW' };
  }

  // Mark as called
  room.unoWindow.calledUno = true;

  return { actionId: '', ok: true };
}

/**
 * Catch a player who failed to call UNO
 */
export function catchUno(room: RoomState, catcherId: string): ActionAck {
  if (room.phase !== 'playing') {
    return { actionId: '', ok: false, errorCode: 'GAME_NOT_PLAYING' };
  }

  // Check if there's an open UNO window
  if (!room.unoWindow) {
    return { actionId: '', ok: false, errorCode: 'NO_UNO_WINDOW' };
  }

  // Can't catch yourself
  if (room.unoWindow.playerId === catcherId) {
    return { actionId: '', ok: false, errorCode: 'CANT_CATCH_SELF' };
  }

  // If player already called UNO, can't catch them
  if (room.unoWindow.calledUno) {
    return { actionId: '', ok: false, errorCode: 'ALREADY_CALLED_UNO' };
  }

  // Apply penalty: player who failed to call UNO draws 2 cards
  const penalizedPlayer = room.players.find(p => p.playerId === room.unoWindow!.playerId);
  if (penalizedPlayer) {
    for (let i = 0; i < 2; i++) {
      const drawnCard = room.deck.pop();
      if (drawnCard) {
        penalizedPlayer.hand.push(drawnCard);
        penalizedPlayer.handCount = penalizedPlayer.hand.length;
      }
    }
  }

  // Close the window
  room.unoWindow = null;

  return { actionId: '', ok: true, caughtPlayerId: penalizedPlayer?.playerId };
}
