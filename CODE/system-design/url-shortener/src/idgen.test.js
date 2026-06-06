const test = require("node:test");
const assert = require("node:assert/strict");
const { IdAllocator, START_OFFSET } = require("./idgen");

class FakeStore {
  constructor() { this.next = 0; this.calls = 0; }
  async allocateRange(size) {
    this.calls++;
    const start = this.next;
    this.next += size;
    return { start, count: size };
  }
}

test("hands out unique sequential IDs", async () => {
  const store = new FakeStore();
  const alloc = new IdAllocator(store, 10);
  const ids = [];
  for (let i = 0; i < 25; i++) ids.push(await alloc.next());
  const set = new Set(ids.map(String));
  assert.equal(set.size, 25, "all IDs unique");
  // 25 IDs from a batch size of 10 → 3 batches
  assert.equal(store.calls, 3);
});

test("IDs are >= START_OFFSET", async () => {
  const store = new FakeStore();
  const alloc = new IdAllocator(store, 5);
  const id = await alloc.next();
  assert.ok(id >= START_OFFSET);
});

test("concurrent requests share a refill", async () => {
  const store = new FakeStore();
  const alloc = new IdAllocator(store, 100);
  const ids = await Promise.all(Array.from({ length: 50 }, () => alloc.next()));
  // 50 IDs in one batch of 100 → single refill call
  assert.equal(store.calls, 1);
  assert.equal(new Set(ids.map(String)).size, 50);
});
