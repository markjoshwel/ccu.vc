export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(maxTokens: number = 3, refillRate: number = 1) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  tryConsume(): boolean {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    const elapsedSeconds = elapsedMs / 1000;

    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + (elapsedSeconds * this.refillRate)
    );

    this.lastRefill = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }
}
