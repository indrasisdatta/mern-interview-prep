const test = require("node:test");
const assert = require("node:assert/strict");
const { SlidingWindowLog } = require("./sliding-window");

function makeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (sec) => { t += sec; } };
}

test("allows up to limit", () => {
  const clock = makeClock();
  const sw = new SlidingWindowLog({ limit: 3, windowSec: 60, now: clock.now });
  assert.equal(sw.tryAcquire("k").allowed, true);
  assert.equal(sw.tryAcquire("k").allowed, true);
  assert.equal(sw.tryAcquire("k").allowed, true);
  assert.equal(sw.tryAcquire("k").allowed, false);
});

test("releases old entries after window passes", () => {
  const clock = makeClock();
  const sw = new SlidingWindowLog({ limit: 2, windowSec: 60, now: clock.now });
  sw.tryAcquire("k"); sw.tryAcquire("k");
  assert.equal(sw.tryAcquire("k").allowed, false);

  clock.advance(61);
  assert.equal(sw.tryAcquire("k").allowed, true);
});

test("partial recovery in the middle of the window", () => {
  const clock = makeClock();
  const sw = new SlidingWindowLog({ limit: 3, windowSec: 60, now: clock.now });
  sw.tryAcquire("k");
  clock.advance(30);
  sw.tryAcquire("k");
  sw.tryAcquire("k");
  assert.equal(sw.tryAcquire("k").allowed, false);
  // 30s more — first request falls out of window
  clock.advance(31);
  assert.equal(sw.tryAcquire("k").allowed, true);
});

test("retryAfter reports correct value", () => {
  const clock = makeClock();
  const sw = new SlidingWindowLog({ limit: 1, windowSec: 60, now: clock.now });
  sw.tryAcquire("k");
  const r = sw.tryAcquire("k");
  assert.equal(r.allowed, false);
  assert.ok(Math.abs(r.retryAfter - 60) < 0.001);
});

test("isolates per key", () => {
  const sw = new SlidingWindowLog({ limit: 1, windowSec: 60 });
  assert.equal(sw.tryAcquire("a").allowed, true);
  assert.equal(sw.tryAcquire("a").allowed, false);
  assert.equal(sw.tryAcquire("b").allowed, true);
});

test("no boundary spike (vs fixed window)", () => {
  // This is the SlidingWindow's selling point: sustained ≤ limit over any window
  const clock = makeClock();
  const sw = new SlidingWindowLog({ limit: 5, windowSec: 60, now: clock.now });
  for (let i = 0; i < 5; i++) sw.tryAcquire("k");
  // 30 seconds later, all are still within window
  clock.advance(30);
  assert.equal(sw.tryAcquire("k").allowed, false);
  // 31s more — first one expires
  clock.advance(31);
  assert.equal(sw.tryAcquire("k").allowed, true);
});
