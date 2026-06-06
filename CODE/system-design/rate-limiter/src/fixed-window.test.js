const test = require("node:test");
const assert = require("node:assert/strict");
const { FixedWindowCounter } = require("./fixed-window");

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (sec) => { t += sec; } };
}

test("allows up to limit", () => {
  const clock = makeClock();
  const fw = new FixedWindowCounter({ limit: 3, windowSec: 60, now: clock.now });
  for (let i = 0; i < 3; i++) assert.equal(fw.tryAcquire("k").allowed, true);
  assert.equal(fw.tryAcquire("k").allowed, false);
});

test("resets at window boundary", () => {
  const clock = makeClock();
  const fw = new FixedWindowCounter({ limit: 1, windowSec: 60, now: clock.now });
  fw.tryAcquire("k");
  assert.equal(fw.tryAcquire("k").allowed, false);
  clock.advance(60);
  assert.equal(fw.tryAcquire("k").allowed, true);
});

test("boundary-spike (documented behavior)", () => {
  const clock = makeClock();
  const fw = new FixedWindowCounter({ limit: 5, windowSec: 60, now: clock.now });
  // 59s into window 0
  clock.advance(59);
  for (let i = 0; i < 5; i++) assert.equal(fw.tryAcquire("k").allowed, true);
  // Cross into window 1
  clock.advance(1);
  for (let i = 0; i < 5; i++) assert.equal(fw.tryAcquire("k").allowed, true);
  // Served 10 within ~1 second under a 5/min limit — the documented spike
});
