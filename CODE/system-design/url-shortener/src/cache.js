// LRU cache with request-coalescing (avoids cache stampede on cold misses).
// In production: drop-in replace with Redis (`get`, `set`, `del`) — same interface.

class LRUCache {
  constructor({ max = 10_000, ttlMs = 600_000 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map();           // key → { value, expiresAt }
    this._inflight = new Map();     // key → Promise (for single-flight loads)
  }

  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt < Date.now()) { this.map.delete(key); return undefined; }
    // Move to end (LRU)
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (this.map.size > this.max) {
      // delete oldest (Map iterates in insertion order)
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
  }

  del(key) { this.map.delete(key); }

  /**
   * Get-or-load with single-flight protection. If many concurrent callers miss the
   * cache for the same key, only one loader runs.
   */
  async getOrLoad(key, loader, ttlMs = this.ttlMs) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;

    if (this._inflight.has(key)) return this._inflight.get(key);

    const promise = (async () => {
      try {
        const value = await loader();
        if (value !== undefined && value !== null) this.set(key, value, ttlMs);
        return value;
      } finally {
        this._inflight.delete(key);
      }
    })();
    this._inflight.set(key, promise);
    return promise;
  }

  size() { return this.map.size; }
  clear() { this.map.clear(); this._inflight.clear(); }
}

module.exports = { LRUCache };
