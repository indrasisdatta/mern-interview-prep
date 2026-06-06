// Batched click counter. Buffers increments and flushes to the store periodically.
// In production: events go to Kafka → ClickHouse for OLAP queries + a separate
// counter incrementer worker batched as we do here.

class ClickAnalytics {
  constructor(store, { flushMs = 1000 } = {}) {
    this.store = store;
    this.flushMs = flushMs;
    this.buffer = new Map();
    this._timer = null;
  }

  record(shortCode) {
    this.buffer.set(shortCode, (this.buffer.get(shortCode) ?? 0) + 1);
    this._scheduleFlush();
  }

  _scheduleFlush() {
    if (this._timer) return;
    this._timer = setTimeout(() => this.flush().catch(console.error), this.flushMs);
  }

  async flush() {
    this._timer = null;
    if (this.buffer.size === 0) return;
    const updates = this.buffer;
    this.buffer = new Map();
    await this.store.incrementClicks(updates);
  }

  async shutdown() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    await this.flush();
  }
}

module.exports = { ClickAnalytics };
