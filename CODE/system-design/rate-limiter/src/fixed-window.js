// Fixed Window Counter — simplest, cheapest, has boundary-spike issue.
//
// Boundary spike example: limit=100/min. Client sends 100 at 12:00:59, then 100
// at 12:01:00 — within ~1 second, served 200 requests under a 100/min limit.

class FixedWindowCounter {
  constructor({ limit, windowSec, now = () => Date.now() / 1000 }) {
    if (limit <= 0) throw new Error("limit must be > 0");
    if (windowSec <= 0) throw new Error("windowSec must be > 0");
    this.limit = limit;
    this.windowSec = windowSec;
    this.now = now;
    this.state = new Map();   // key -> { window, count }
  }

  tryAcquire(key) {
    const now = this.now();
    const w = Math.floor(now / this.windowSec);
    let s = this.state.get(key);
    if (!s || s.window !== w) {
      s = { window: w, count: 0 };
      this.state.set(key, s);
    }
    if (s.count >= this.limit) {
      const windowEnd = (w + 1) * this.windowSec;
      return { allowed: false, remaining: 0, retryAfter: windowEnd - now };
    }
    s.count++;
    return { allowed: true, remaining: this.limit - s.count, retryAfter: 0 };
  }

  size() { return this.state.size; }
  clear() { this.state.clear(); }
}

module.exports = { FixedWindowCounter };
