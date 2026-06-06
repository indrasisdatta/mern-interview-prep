// Batched ID allocator.
// Pattern: each process holds [current, end). When exhausted, asks store for next batch.
// In production, "store" is Postgres SELECT ... FOR UPDATE / DynamoDB atomic increment / etcd.
// Here we use SQLite SELECT + UPDATE inside a transaction.

const START_OFFSET = 62n ** 6n;   // start at 62^6 so codes are always 7 chars

class IdAllocator {
  constructor(store, batchSize = 10_000) {
    this.store = store;
    this.batchSize = batchSize;
    this.current = 0n;
    this.end = 0n;
    this._refilling = null;
  }

  async next() {
    if (this.current >= this.end) {
      // Single-flight refill — concurrent callers wait on the same promise
      if (!this._refilling) {
        this._refilling = (async () => {
          const { start, count } = await this.store.allocateRange(this.batchSize);
          this.current = BigInt(start);
          this.end = this.current + BigInt(count);
        })().finally(() => { this._refilling = null; });
      }
      await this._refilling;
    }
    const id = this.current;
    this.current++;
    return id + START_OFFSET;   // ensure codes never collapse to short lengths
  }
}

module.exports = { IdAllocator, START_OFFSET };
