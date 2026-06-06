// Sliding Window Log — exact rate limiter.
// Stores timestamps of every request in the window. Memory O(limit) per key.
// Use when correctness is critical (login limiters, regulated quotas).

class SlidingWindowLog {
  /**
   * @param {object} opts
   * @param {number} opts.limit     Max requests in window.
   * @param {number} opts.windowSec Window length in seconds.
   * @param {() => number} [opts.now] Time source.
   */
  constructor({ limit, windowSec, now = () => Date.now() / 1000 }) {
    if (limit <= 0) throw new Error("limit must be > 0");
    if (windowSec <= 0) throw new Error("windowSec must be > 0");
    this.limit = limit;
    this.windowSec = windowSec;
    this.now = now;
    this.logs = new Map();   // key -> array of timestamps (ascending)
  }

  tryAcquire(key) {
    const now = this.now();
    const cutoff = now - this.windowSec;
    let log = this.logs.get(key);
    if (!log) { log = []; this.logs.set(key, log); }

    // Drop expired (ascending list — drop from front)
    while (log.length && log[0] < cutoff) log.shift();

    if (log.length >= this.limit) {
      const retryAfter = log[0] + this.windowSec - now;
      return { allowed: false, remaining: 0, retryAfter };
    }
    log.push(now);
    return { allowed: true, remaining: this.limit - log.length, retryAfter: 0 };
  }

  size() { return this.logs.size; }
  clear() { this.logs.clear(); }
}

module.exports = { SlidingWindowLog };
