const test = require("node:test");
const assert = require("node:assert/strict");
const { TokenBucket } = require("./token-bucket");

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (sec) => { t += sec; } };
}

test("allows up to capacity immediately (burst)", () => {
  const clock = makeClock();
  const tb = new TokenBucket({ capacity: 5, refillPerSec: 1, now: clock.now });
  for (let i = 0; i < 5; i++) assert.equal(tb.tryAcquire("k").allowed, true);
  assert.equal(tb.tryAcquire("k").allowed, false);
});

test("refills at configured rate", () => {
  const clock = makeClock();
  const tb = new TokenBucket({ capacity: 5, refillPerSec: 2, now: clock.now });
  // Drain
  for (let i = 0; i < 5; i++) tb.tryAcquire("k");
  assert.equal(tb.tryAcquire("k").allowed, false);

  // After 0.5s, 1 token should be available
  clock.advance(0.5);
  assert.equal(tb.tryAcquire("k").allowed, true);
  assert.equal(tb.tryAcquire("k").allowed, false);

  // After 2.5s more, 5 tokens (capped at capacity)
  clock.advance(2.5);
  for (let i = 0; i < 5; i++) assert.equal(tb.tryAcquire("k").allowed, true);
  assert.equal(tb.tryAcquire("k").allowed, false);
});

test("retryAfter is correct when starved", () => {
  const clock = makeClock();
  const tb = new TokenBucket({ capacity: 1, refillPerSec: 1, now: clock.now });
  tb.tryAcquire("k");   // consume
  const r = tb.tryAcquire("k");
  assert.equal(r.allowed, false);
  assert.ok(Math.abs(r.retryAfter - 1) < 0.001);
});

test("buckets are per-key isolated", () => {
  const clock = makeClock();
  const tb = new TokenBucket({ capacity: 2, refillPerSec: 1, now: clock.now });
  assert.equal(tb.tryAcquire("a").allowed, true);
  assert.equal(tb.tryAcquire("a").allowed, true);
  assert.equal(tb.tryAcquire("a").allowed, false);
  // b's bucket is fresh
  assert.equal(tb.tryAcquire("b").allowed, true);
  assert.equal(tb.tryAcquire("b").allowed, true);
  assert.equal(tb.tryAcquire("b").allowed, false);
});

test("cost > 1 deducts proportionally", () => {
  const clock = makeClock();
  const tb = new TokenBucket({ capacity: 10, refillPerSec: 1, now: clock.now });
  assert.equal(tb.tryAcquire("k", 7).allowed, true);
  assert.equal(tb.tryAcquire("k", 4).allowed, false);  // only 3 remaining
  assert.equal(tb.tryAcquire("k", 3).allowed, true);
});

test("cost > capacity always rejects", () => {
  const tb = new TokenBucket({ capacity: 5, refillPerSec: 1 });
  assert.equal(tb.tryAcquire("k", 10).allowed, false);
});

test("sweepIdle removes stale keys", () => {
  const clock = makeClock();
  const tb = new TokenBucket({ capacity: 1, refillPerSec: 1, now: clock.now });
  tb.tryAcquire("a"); tb.tryAcquire("b");
  assert.equal(tb.size(), 2);
  clock.advance(7200);   // 2 hours
  tb.sweepIdle(3600);    // older than 1 hour
  assert.equal(tb.size(), 0);
});

test("peek does not consume", () => {
  const tb = new TokenBucket({ capacity: 5, refillPerSec: 1 });
  assert.equal(tb.peek("k"), 5);
  assert.equal(tb.peek("k"), 5);   // still 5
  tb.tryAcquire("k");
  assert.equal(Math.floor(tb.peek("k")), 4);
});

test("concurrent burst: only capacity succeeds", () => {
  // Even with synchronous JS, simulate concurrent attempts via parallel array
  const tb = new TokenBucket({ capacity: 100, refillPerSec: 1 });
  const attempts = Array.from({ length: 200 }, () => tb.tryAcquire("k"));
  const allowed = attempts.filter((r) => r.allowed).length;
  assert.equal(allowed, 100, "exactly capacity allowed in burst");
});
