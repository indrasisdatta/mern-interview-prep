const test = require("node:test");
const assert = require("node:assert/strict");
const { LRUCache } = require("./cache");

test("set + get returns value", () => {
  const c = new LRUCache();
  c.set("k", "v");
  assert.equal(c.get("k"), "v");
});

test("evicts oldest at max size", () => {
  const c = new LRUCache({ max: 3 });
  c.set("a", 1); c.set("b", 2); c.set("c", 3);
  c.set("d", 4);
  assert.equal(c.get("a"), undefined, "a evicted");
  assert.equal(c.get("d"), 4);
});

test("TTL expiry", async () => {
  const c = new LRUCache({ ttlMs: 30 });
  c.set("k", "v");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(c.get("k"), undefined);
});

test("LRU access updates recency", () => {
  const c = new LRUCache({ max: 3 });
  c.set("a", 1); c.set("b", 2); c.set("c", 3);
  c.get("a");          // bump a to most-recent
  c.set("d", 4);       // should evict b (now oldest)
  assert.equal(c.get("a"), 1);
  assert.equal(c.get("b"), undefined);
});

test("getOrLoad runs loader once for concurrent callers", async () => {
  const c = new LRUCache();
  let calls = 0;
  const loader = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return "value"; };
  const results = await Promise.all(Array.from({ length: 10 }, () => c.getOrLoad("k", loader)));
  assert.equal(calls, 1, "single-flight: loader called only once");
  results.forEach((r) => assert.equal(r, "value"));
});

test("getOrLoad does not cache undefined/null returns", async () => {
  const c = new LRUCache();
  await c.getOrLoad("missing", async () => null);
  assert.equal(c.get("missing"), undefined);
});
