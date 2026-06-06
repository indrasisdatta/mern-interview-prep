const test = require("node:test");
const assert = require("node:assert/strict");
const { SlidingWindowCounter } = require("./sliding-window-counter");

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (sec) => { t += sec; } };
}

test("allows up to limit within window", () => {
  // Start at the boundary so 'into' starts at 0 (previous weight = 1)
  const clock = makeClock(60);
  const sw = new SlidingWindowCounter({ limit: 5, windowSec: 60, now: clock.now });
  for (let i = 0; i < 5; i++) {
    assert.equal(sw.tryAcquire("k").allowed, true);
  }
  assert.equal(sw.tryAcquire("k").allowed, false);
});

test("rolls window and reduces effective count over time", () => {
  // Place us at the very start of window 1
  const clock = makeClock(60);
  const sw = new SlidingWindowCounter({ limit: 5, windowSec: 60, now: clock.now });
  // Fill the current window
  for (let i = 0; i < 5; i++) sw.tryAcquire("k");
  assert.equal(sw.tryAcquire("k").allowed, false);

  // Move to next window — now the previous-counter weight decays
  clock.advance(60);   // boundary: 100% previous weight
  // Effective = 0 + 5 * 1 = 5 → still rejected
  assert.equal(sw.tryAcquire("k").allowed, false);

  // Halfway into the new window: previous weight = 0.5
  clock.advance(30);
  // Effective starts at 0 + 5*0.5 = 2.5; algorithm allows while effective < limit (5).
  // Walkthrough: allows when current=0,1,2 (effective 2.5, 3.5, 4.5) → 3 allowed.
  let allowed = 0;
  for (let i = 0; i < 10; i++) if (sw.tryAcquire("k").allowed) allowed++;
  assert.equal(allowed, 3);

  // Fully into next window → all expired
  clock.advance(60);
  assert.equal(sw.tryAcquire("k").allowed, true);
});

test("per key isolated", () => {
  const sw = new SlidingWindowCounter({ limit: 1, windowSec: 60 });
  assert.equal(sw.tryAcquire("a").allowed, true);
  assert.equal(sw.tryAcquire("a").allowed, false);
  assert.equal(sw.tryAcquire("b").allowed, true);
});
