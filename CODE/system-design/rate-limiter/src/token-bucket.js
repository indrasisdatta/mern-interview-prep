// Token Bucket — in-memory implementation.
//
// Semantics: each key has a bucket with capacity C tokens and refill rate R/sec.
// A request consumes `cost` tokens; if not enough, reject and report retryAfter.
//
// For distributed use, see redis-token-bucket.lua and redis-adapter.js.example.

class TokenBucket {
  /**
   * @param {object} opts
   * @param {number} opts.capacity     Max tokens (burst size).
   * @param {number} opts.refillPerSec Refill rate (steady state).
   * @param {() => number} [opts.now]  Time source (overridable for tests).
   */
  constructor({ capacity, refillPerSec, now = () => Date.now() / 1000 }) {
    if (capacity <= 0) throw new Error("capacity must be > 0");
    if (refillPerSec <= 0) throw new Error("refillPerSec must be > 0");
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.now = now;
    this.buckets = new Map();   // key -> { tokens, ts }
  }

  /**
   * Try to acquire `cost` tokens for `key`. Atomic per single-threaded JS.
   * @param {string} key
   * @param {number} cost
   * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
   */
  tryAcquire(key, cost = 1) {
    if (cost > this.capacity) {
      return { allowed: false, remaining: 0, retryAfter: Infinity };
    }
    const now = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, ts: now };
      this.buckets.set(key, b);
    }
    // Refill
    const elapsed = now - b.ts;
    b.tokens = Math.min(this.capacity, b.tokens + elapsed * this.refillPerSec);
    b.ts = now;

    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { allowed: true, remaining: Math.floor(b.tokens), retryAfter: 0 };
    }
    return {
      allowed: false,
      remaining: Math.floor(b.tokens),
      retryAfter: (cost - b.tokens) / this.refillPerSec,
    };
  }

  /** Inspect current tokens for a key (without consuming). */
  peek(key) {
    const b = this.buckets.get(key);
    if (!b) return this.capacity;
    const now = this.now();
    const refilled = Math.min(this.capacity, b.tokens + (now - b.ts) * this.refillPerSec);
    return refilled;
  }

  /** Free memory for keys not touched recently. */
  sweepIdle(maxIdleSec = 3600) {
    const cutoff = this.now() - maxIdleSec;
    for (const [k, v] of this.buckets) {
      if (v.ts < cutoff) this.buckets.delete(k);
    }
  }

  size() { return this.buckets.size; }
  clear() { this.buckets.clear(); }
}

module.exports = { TokenBucket };
