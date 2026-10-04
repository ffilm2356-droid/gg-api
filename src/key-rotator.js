/**
 * Multi-key rotator with rate limit tracking and automatic failover.
 * Each key tracks its own rate limit state independently.
 */
class KeyRotator {
  constructor(apiKeys, opts = {}) {
    this.intervalMs = opts.rateLimitIntervalMs || 4200;
    this.maxRetries = opts.maxRetries || 5;

    this.keys = apiKeys.map((key, i) => ({
      key: key.trim(),
      index: i,
      lastUsed: 0,
      requestCount: 0,
      errorCount: 0,
      rateLimited: false,
      rateLimitUntil: 0,
      consecutiveErrors: 0,
    }));

    this.currentIndex = 0;
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.totalRateLimits = 0;
  }

  get availableCount() {
    const now = Date.now();
    return this.keys.filter(k => !k.rateLimited || now >= k.rateLimitUntil).length;
  }

  getNext() {
    const now = Date.now();
    const len = this.keys.length;

    for (let attempt = 0; attempt < len * 2; attempt++) {
      const idx = (this.currentIndex + attempt) % len;
      const entry = this.keys[idx];

      if (entry.rateLimited && now < entry.rateLimitUntil) continue;

      if (entry.rateLimited && now >= entry.rateLimitUntil) {
        entry.rateLimited = false;
        entry.consecutiveErrors = 0;
      }

      const timeSinceLast = now - entry.lastUsed;
      if (timeSinceLast < this.intervalMs) continue;

      entry.lastUsed = now;
      entry.requestCount++;
      this.currentIndex = (idx + 1) % len;
      this.totalRequests++;
      return entry;
    }

    // All keys on cooldown - find the one with shortest wait
    let earliest = Infinity;
    let bestEntry = null;
    for (const entry of this.keys) {
      const readyAt = entry.rateLimited
        ? entry.rateLimitUntil
        : entry.lastUsed + this.intervalMs;
      if (readyAt < earliest) {
        earliest = readyAt;
        bestEntry = entry;
      }
    }

    const waitMs = Math.max(0, earliest - now);
    return { wait: waitMs, entry: bestEntry };
  }

  async waitForKey() {
    while (true) {
      const result = this.getNext();
      if (result.wait !== undefined) {
        await new Promise(r => setTimeout(r, result.wait + 50));
        continue;
      }
      return result;
    }
  }

  markSuccess(entry) {
    entry.consecutiveErrors = 0;
  }

  markError(entry, statusCode) {
    entry.errorCount++;
    entry.consecutiveErrors++;
    this.totalErrors++;

    if (statusCode === 429 || statusCode === 503) {
      entry.rateLimited = true;
      // Exponential backoff: 30s, 60s, 120s, 240s max
      const backoffMs = Math.min(30000 * Math.pow(2, entry.consecutiveErrors - 1), 240000);
      entry.rateLimitUntil = Date.now() + backoffMs;
      this.totalRateLimits++;
      return backoffMs;
    }

    if (entry.consecutiveErrors >= 5) {
      entry.rateLimited = true;
      entry.rateLimitUntil = Date.now() + 60000;
    }

    return 0;
  }

  getStats() {
    return {
      totalKeys: this.keys.length,
      available: this.availableCount,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
      totalRateLimits: this.totalRateLimits,
      perKey: this.keys.map(k => ({
        index: k.index,
        requests: k.requestCount,
        errors: k.errorCount,
        rateLimited: k.rateLimited,
      })),
    };
  }
}

export default KeyRotator;
