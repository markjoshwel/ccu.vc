import type { Card, CardWithId, CardColor, NumberCard, ActionCard, WildCard } from '@ccu/shared';
import { nanoid } from 'nanoid';

// UNO deck composition (per standard rules):
// - 4 colors (red, yellow, green, blue)
// - Each color has:
//   - One 0 card
//   - Two each of 1-9 (18 cards)
//   - Two Skip cards
//   - Two Reverse cards
//   - Two Draw Two cards
// - 4 Wild cards
// - 4 Wild Draw Four cards
// Total: 108 cards per deck

const COLORS: CardColor[] = ['red', 'yellow', 'green', 'blue'];
const NUMBERS: (0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9)[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const ACTION_VALUES: ('skip' | 'reverse' | 'draw2')[] = ['skip', 'reverse', 'draw2'];

/**
 * Generate a standard UNO deck
 */
export function generateDeck(deckCount: number = 1): Card[] {
  const deck: Card[] = [];

  for (let d = 0; d < deckCount; d++) {
    // Add number cards for each color
    for (const color of COLORS) {
      // One 0 card per color
      deck.push({ type: 'number', color, value: 0 } as NumberCard);

      // Two of each 1-9 per color
      for (const value of NUMBERS.slice(1)) {
        deck.push({ type: 'number', color, value } as NumberCard);
        deck.push({ type: 'number', color, value } as NumberCard);
      }

      // Two of each action card per color
      for (const actionValue of ACTION_VALUES) {
        deck.push({ type: 'action', color, value: actionValue } as ActionCard);
        deck.push({ type: 'action', color, value: actionValue } as ActionCard);
      }
    }

    // Add wild cards (4 of each type)
    for (let i = 0; i < 4; i++) {
      deck.push({ type: 'wild', wildType: 'wild' } as WildCard);
      deck.push({ type: 'wild', wildType: 'wild4' } as WildCard);
    }
  }

  return deck;
}

/**
 * Add unique IDs to cards
 */
export function addCardIds(cards: Card[]): CardWithId[] {
  return cards.map(card => ({
    ...card,
    id: nanoid(8)
  }));
}

/**
 * Shuffle an array in place using Fisher-Yates algorithm
 */
export function shuffle<T>(array: T[], rng: () => number = Math.random): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Create a seeded random number generator (for testing)
 */
export function seededRNG(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * Generate a complete shuffled deck with IDs
 */
export function generateShuffledDeck(deckCount: number = 1, rng?: () => number): CardWithId[] {
  const deck = generateDeck(deckCount);
  const shuffled = shuffle(deck, rng);
  return addCardIds(shuffled);
}

/**
 * Get deck size for validation
 */
export function getExpectedDeckSize(deckCount: number = 1): number {
  // Per deck: 4 colors * (1 zero + 18 numbered + 6 actions) + 8 wilds = 108
  return 108 * deckCount;
}

/**
 * Validate deck composition
 */
export function validateDeckComposition(deck: Card[], deckCount: number = 1): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  const expectedTotal = getExpectedDeckSize(deckCount);
  if (deck.length !== expectedTotal) {
    errors.push(`Expected ${expectedTotal} cards, got ${deck.length}`);
  }

  // Count card types
  const numberCards = deck.filter(c => c.type === 'number');
  const actionCards = deck.filter(c => c.type === 'action');
  const wildCards = deck.filter(c => c.type === 'wild');

  // Expected per deck:
  // Number cards: 4 colors * (1 zero + 18 others) = 76
  // Action cards: 4 colors * 6 = 24
  // Wild cards: 8
  const expectedNumberCards = 76 * deckCount;
  const expectedActionCards = 24 * deckCount;
  const expectedWildCards = 8 * deckCount;

  if (numberCards.length !== expectedNumberCards) {
    errors.push(`Expected ${expectedNumberCards} number cards, got ${numberCards.length}`);
  }
  if (actionCards.length !== expectedActionCards) {
    errors.push(`Expected ${expectedActionCards} action cards, got ${actionCards.length}`);
  }
  if (wildCards.length !== expectedWildCards) {
    errors.push(`Expected ${expectedWildCards} wild cards, got ${wildCards.length}`);
  }

  // Validate color distribution in number cards
  for (const color of COLORS) {
    const colorNumberCards = numberCards.filter(c => (c as NumberCard).color === color);
    const expectedColorCards = 19 * deckCount; // 1 zero + 18 others
    if (colorNumberCards.length !== expectedColorCards) {
      errors.push(`Expected ${expectedColorCards} ${color} number cards, got ${colorNumberCards.length}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
