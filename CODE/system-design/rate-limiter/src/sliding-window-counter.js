// Sliding Window Counter — cheap approximation.
//
// Keeps two counters: current window and previous. Effective count is:
//   current + previous * (1 - elapsed_into_current / windowSec)
//
// Memory: O(2) per key. Avoids boundary spike of fixed-window, but approximate.

class SlidingWindowCounter {
  constructor({ limit, windowSec, now = () => Date.now() / 1000 }) {
    if (limit <= 0) throw new Error("limit must be > 0");
    if (windowSec <= 0) throw new Error("windowSec must be > 0");
    this.limit = limit;
    this.windowSec = windowSec;
    this.now = now;
    this.state = new Map();   // key -> { window, current, previous }
  }

  tryAcquire(key) {
    const now = this.now();
    const w = Math.floor(now / this.windowSec);
    const into = (now - w * this.windowSec) / this.windowSec;   // 0..1

    let s = this.state.get(key);
    if (!s) { s = { window: w, current: 0, previous: 0 }; this.state.set(key, s); }

    if (s.window !== w) {
      // Roll
      if (w === s.window + 1) { s.previous = s.current; s.current = 0; }
      else { s.previous = 0; s.current = 0; }
      s.window = w;
    }

    const effective = s.current + s.previous * (1 - into);

    if (effective >= this.limit) {
      const retryAfter = (1 - into) * this.windowSec;
      return { allowed: false, remaining: 0, retryAfter };
    }

    s.current++;
    return {
      allowed: true,
      remaining: Math.floor(this.limit - effective - 1),
      retryAfter: 0,
    };
  }

  size() { return this.state.size; }
  clear() { this.state.clear(); }
}

module.exports = { SlidingWindowCounter };
