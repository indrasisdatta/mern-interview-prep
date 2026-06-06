// In-process token bucket rate limiter. See full design at
// NOTES/system-design/backend-system-design/02-RateLimiter/notes.md
//
// For production, swap with Redis-backed rate-limiter-flexible or the Lua-script
// token bucket from CODE/system-design/rate-limiter/

class TokenBucket {
  constructor({ capacity, refillPerSec }) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.buckets = new Map();   // key → { tokens, lastRefillTs }
  }

  tryAcquire(key, cost = 1) {
    const now = Date.now() / 1000;
    let state = this.buckets.get(key);
    if (!state) {
      state = { tokens: this.capacity, ts: now };
      this.buckets.set(key, state);
    }
    // Refill
    const elapsed = now - state.ts;
    state.tokens = Math.min(this.capacity, state.tokens + elapsed * this.refillPerSec);
    state.ts = now;

    if (state.tokens >= cost) {
      state.tokens -= cost;
      return { allowed: true, remaining: Math.floor(state.tokens), retryAfter: 0 };
    }
    const needed = cost - state.tokens;
    return { allowed: false, remaining: 0, retryAfter: needed / this.refillPerSec };
  }
}

function rateLimitMiddleware(bucket, keyGen) {
  return (req, res, next) => {
    const key = keyGen(req);
    const { allowed, remaining, retryAfter } = bucket.tryAcquire(key);
    res.setHeader("RateLimit-Limit", bucket.capacity);
    res.setHeader("RateLimit-Remaining", remaining);
    if (!allowed) {
      res.setHeader("Retry-After", Math.ceil(retryAfter));
      return res.status(429).json({ error: "rate_limit_exceeded", retryAfter });
    }
    next();
  };
}

module.exports = { TokenBucket, rateLimitMiddleware };
