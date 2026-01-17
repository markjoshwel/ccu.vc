import type { Card } from 'shared';

export class Deck {
  cards: Card[];

  constructor() {
    this.cards = [];
  }

  static createStandardDeck(): Deck {
    const deck = new Deck();
    const colors: Array<'red' | 'yellow' | 'green' | 'blue'> = ['red', 'yellow', 'green', 'blue'];

    colors.forEach(color => {
      deck.cards.push({ color, value: '0' });

      for (let i = 1; i <= 9; i++) {
        deck.cards.push({ color, value: i.toString() });
        deck.cards.push({ color, value: i.toString() });
      }

      deck.cards.push({ color, value: 'skip' });
      deck.cards.push({ color, value: 'skip' });
      deck.cards.push({ color, value: 'reverse' });
      deck.cards.push({ color, value: 'reverse' });
      deck.cards.push({ color, value: 'draw2' });
      deck.cards.push({ color, value: 'draw2' });
    });

    for (let i = 0; i < 4; i++) {
      deck.cards.push({ color: 'wild', value: 'wild' });
    }

    for (let i = 0; i < 4; i++) {
      deck.cards.push({ color: 'wild', value: 'wild_draw4' });
    }

    return deck;
  }

  shuffle(rng?: () => number): void {
    const random = rng || (() => Math.random());
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  draw(): Card | undefined {
    return this.cards.pop();
  }

  get size(): number {
    return this.cards.length;
  }

  isEmpty(): boolean {
    return this.cards.length === 0;
  }
}
