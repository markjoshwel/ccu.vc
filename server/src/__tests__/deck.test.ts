import { describe, expect, test } from 'bun:test';
import { 
  generateDeck, 
  shuffle, 
  generateShuffledDeck, 
  getExpectedDeckSize, 
  validateDeckComposition,
  seededRNG,
  addCardIds
} from '../deck';
import type { NumberCard, ActionCard, WildCard } from '@ccu/shared';

describe('UNO Deck Generation', () => {
  test('generates a standard UNO deck with correct size (108 cards)', () => {
    const deck = generateDeck();
    expect(deck.length).toBe(108);
    expect(getExpectedDeckSize(1)).toBe(108);
  });

  test('generates correct number of cards per type', () => {
    const deck = generateDeck();
    const validation = validateDeckComposition(deck);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  test('has correct number card distribution', () => {
    const deck = generateDeck();
    const numberCards = deck.filter(c => c.type === 'number') as NumberCard[];
    
    // Should have 76 number cards total
    expect(numberCards.length).toBe(76);
    
    // Each color should have 19 number cards (1 zero + 18 others)
    const redCards = numberCards.filter(c => c.color === 'red');
    const yellowCards = numberCards.filter(c => c.color === 'yellow');
    const greenCards = numberCards.filter(c => c.color === 'green');
    const blueCards = numberCards.filter(c => c.color === 'blue');
    
    expect(redCards.length).toBe(19);
    expect(yellowCards.length).toBe(19);
    expect(greenCards.length).toBe(19);
    expect(blueCards.length).toBe(19);
    
    // Each color should have exactly 1 zero
    expect(redCards.filter(c => c.value === 0).length).toBe(1);
    expect(yellowCards.filter(c => c.value === 0).length).toBe(1);
    expect(greenCards.filter(c => c.value === 0).length).toBe(1);
    expect(blueCards.filter(c => c.value === 0).length).toBe(1);
    
    // Each color should have exactly 2 of each 1-9
    for (let i = 1; i <= 9; i++) {
      expect(redCards.filter(c => c.value === i).length).toBe(2);
    }
  });

  test('has correct action card distribution', () => {
    const deck = generateDeck();
    const actionCards = deck.filter(c => c.type === 'action') as ActionCard[];
    
    // Should have 24 action cards total (4 colors * 6 per color)
    expect(actionCards.length).toBe(24);
    
    // Each color should have 6 action cards (2 skip, 2 reverse, 2 draw2)
    for (const color of ['red', 'yellow', 'green', 'blue'] as const) {
      const colorActions = actionCards.filter(c => c.color === color);
      expect(colorActions.length).toBe(6);
      expect(colorActions.filter(c => c.value === 'skip').length).toBe(2);
      expect(colorActions.filter(c => c.value === 'reverse').length).toBe(2);
      expect(colorActions.filter(c => c.value === 'draw2').length).toBe(2);
    }
  });

  test('has correct wild card distribution', () => {
    const deck = generateDeck();
    const wildCards = deck.filter(c => c.type === 'wild') as WildCard[];
    
    // Should have 8 wild cards total
    expect(wildCards.length).toBe(8);
    expect(wildCards.filter(c => c.wildType === 'wild').length).toBe(4);
    expect(wildCards.filter(c => c.wildType === 'wild4').length).toBe(4);
  });

  test('multiple decks scale correctly', () => {
    const deck2 = generateDeck(2);
    expect(deck2.length).toBe(216);
    expect(getExpectedDeckSize(2)).toBe(216);
    
    const validation = validateDeckComposition(deck2, 2);
    expect(validation.valid).toBe(true);
  });
});

describe('Shuffle', () => {
  test('shuffle produces a permutation of the same length', () => {
    const deck = generateDeck();
    const shuffled = shuffle(deck);
    
    expect(shuffled.length).toBe(deck.length);
  });

  test('shuffle contains all original cards', () => {
    const deck = generateDeck();
    const shuffled = shuffle(deck);
    
    // All cards should still be present (check by type counts)
    const originalValidation = validateDeckComposition(deck);
    const shuffledValidation = validateDeckComposition(shuffled);
    
    expect(shuffledValidation.valid).toBe(originalValidation.valid);
  });

  test('shuffle with seeded RNG is deterministic', () => {
    const deck = generateDeck();
    
    const rng1 = seededRNG(12345);
    const shuffled1 = shuffle([...deck], rng1);
    
    const rng2 = seededRNG(12345);
    const shuffled2 = shuffle([...deck], rng2);
    
    // Same seed should produce same order
    expect(shuffled1).toEqual(shuffled2);
  });

  test('different seeds produce different orders', () => {
    const deck = generateDeck();
    
    const rng1 = seededRNG(12345);
    const shuffled1 = shuffle([...deck], rng1);
    
    const rng2 = seededRNG(67890);
    const shuffled2 = shuffle([...deck], rng2);
    
    // Different seeds should produce different orders
    // Check first 10 cards to be reasonably confident
    let sameOrder = true;
    for (let i = 0; i < 10; i++) {
      if (JSON.stringify(shuffled1[i]) !== JSON.stringify(shuffled2[i])) {
        sameOrder = false;
        break;
      }
    }
    expect(sameOrder).toBe(false);
  });
});

describe('generateShuffledDeck', () => {
  test('creates deck with unique IDs', () => {
    const deck = generateShuffledDeck();
    
    // All cards should have IDs
    expect(deck.every(c => c.id && c.id.length > 0)).toBe(true);
    
    // All IDs should be unique
    const ids = new Set(deck.map(c => c.id));
    expect(ids.size).toBe(deck.length);
  });

  test('addCardIds preserves card data', () => {
    const deck = generateDeck();
    const withIds = addCardIds(deck);
    
    expect(withIds.length).toBe(deck.length);
    
    // Verify card data is preserved
    for (let i = 0; i < deck.length; i++) {
      expect(withIds[i].type).toBe(deck[i].type);
      if (deck[i].type === 'number') {
        const original = deck[i] as NumberCard;
        const withId = withIds[i];
        expect(withId.type).toBe('number');
        if (withId.type === 'number') {
          expect(withId.color).toBe(original.color);
          expect(withId.value).toBe(original.value);
        }
      }
    }
  });
});
