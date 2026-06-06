// Compares all four algorithms side-by-side. Run with `npm run demo`.

const { TokenBucket } = require("./token-bucket");
const { SlidingWindowLog } = require("./sliding-window");
const { SlidingWindowCounter } = require("./sliding-window-counter");
const { FixedWindowCounter } = require("./fixed-window");

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (sec) => { t += sec; } };
}

function bench(name, limiterFactory) {
  const clock = makeClock(60);   // start at a clean window boundary
  const limiter = limiterFactory(clock.now);

  let allowed = 0, rejected = 0;

  // Phase 1: burst 20 requests instantly
  for (let i = 0; i < 20; i++) {
    if (limiter.tryAcquire("user1").allowed) allowed++; else rejected++;
  }
  const phase1 = { allowed, rejected };

  // Phase 2: 10 requests, 1 every 200ms (sustained)
  allowed = 0; rejected = 0;
  for (let i = 0; i < 10; i++) {
    if (limiter.tryAcquire("user1").allowed) allowed++; else rejected++;
    clock.advance(0.2);
  }
  const phase2 = { allowed, rejected };

  // Phase 3: idle 5s, then send 20 again
  clock.advance(5);
  allowed = 0; rejected = 0;
  for (let i = 0; i < 20; i++) {
    if (limiter.tryAcquire("user1").allowed) allowed++; else rejected++;
  }
  const phase3 = { allowed, rejected };

  console.log(`\n${name}`);
  console.log(`  Phase 1 (burst 20/instant):       ${phase1.allowed} allowed, ${phase1.rejected} rejected`);
  console.log(`  Phase 2 (10 over 2s, 5/sec rate): ${phase2.allowed} allowed, ${phase2.rejected} rejected`);
  console.log(`  Phase 3 (5s idle, then burst 20): ${phase3.allowed} allowed, ${phase3.rejected} rejected`);
}

console.log("Rate limiter algorithm comparison");
console.log("Limit: 10 requests per 60 seconds (where applicable: refill rate 10/60 ≈ 0.167/s, burst 10)");
console.log("=".repeat(80));

bench("TokenBucket (capacity=10, refill=10/60s)",
  (now) => new TokenBucket({ capacity: 10, refillPerSec: 10 / 60, now }));

bench("SlidingWindowLog (limit=10, window=60s)",
  (now) => new SlidingWindowLog({ limit: 10, windowSec: 60, now }));

bench("SlidingWindowCounter (limit=10, window=60s)",
  (now) => new SlidingWindowCounter({ limit: 10, windowSec: 60, now }));

bench("FixedWindowCounter (limit=10, window=60s)",
  (now) => new FixedWindowCounter({ limit: 10, windowSec: 60, now }));

console.log("\n" + "=".repeat(80));
console.log(`
Reading the results:
- TokenBucket: phase 1 allows up to capacity (10) and refills slowly; phase 2 some
  pass after the initial burst as tokens refill; phase 3 refills happen during idle.
- SlidingWindowLog: exact — phase 1 allows exactly limit; phase 3 only allows what
  fits the rolling 60s window.
- SlidingWindowCounter: similar to log but approximate at boundaries.
- FixedWindowCounter: cheap; can exhibit boundary spike (not demonstrated here, since
  clock doesn't cross a fixed boundary, but see fixed-window.test.js).
`);
