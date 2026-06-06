# Rate Limiter — Reference Implementations

Standalone Node.js implementations for the system-design case study at [NOTES/system-design/backend-system-design/02-RateLimiter/notes.md](../../../NOTES/system-design/backend-system-design/02-RateLimiter/notes.md).

**Zero external dependencies** — runs with stock Node 20+.

## Algorithms included

| File | Algorithm | When to use |
|------|-----------|-------------|
| `src/token-bucket.js` | Token bucket | Default — natural burst + sustained-rate model |
| `src/sliding-window.js` | Sliding window log | Exact counts (login limiters, regulated quotas) |
| `src/sliding-window-counter.js` | Sliding window counter | Cheap approximation, no boundary spike |
| `src/fixed-window.js` | Fixed window counter | Simplest; boundary-spike caveat |

Each implementation has the same public API:

```js
const result = limiter.tryAcquire(key, cost = 1);
// → { allowed: boolean, remaining: number, retryAfter: number }
```

## Run

```bash
cd CODE/system-design/rate-limiter
npm install            # no deps to install, just creates lock-free env
npm test               # runs all unit tests
npm run demo           # interactive demo of each algorithm
```

## Distributed version (with Redis)

`src/redis-token-bucket.lua` is the Lua script you'd run via `redis.eval()` for a Redis-backed token bucket — atomic, single-round-trip, no race conditions across N app instances.

`src/redis-adapter.js.example` shows how to wire it up via `ioredis` (uncomment imports to use).

## File layout

```
src/
├── token-bucket.js                  In-memory token bucket
├── sliding-window.js                Sliding window log (exact)
├── sliding-window-counter.js        Two-counter approximation
├── fixed-window.js                  Simplest, boundary-spike caveat
├── express-middleware.js            Drop into Express
├── redis-token-bucket.lua           Atomic Lua script
├── redis-adapter.js.example         Redis-backed wrapper template
├── demo.js                          CLI walkthrough
└── *.test.js                        Unit tests
```

## Comparing algorithms

Run `npm run demo` to see them side by side. The demo:
- Bursts 20 requests in 1ms; observes which algorithm allowed how many
- Then drips 10 requests over 2s; observes consistent allow rate
- Then idles 5s; observes refill behavior

## Verizon-style stacked limits

`src/express-middleware.js` shows composing 3 token buckets (per-second, per-minute, per-day) — Stripe / Cloudflare pattern. Request allowed only if all pass.

## Production hardening (not included here)

- Memory pressure: bucket map grows with unique keys. Add a periodic GC of idle buckets.
- Redis: prefer Lua script for atomicity (provided), with per-call timeout + fallback policy (fail-open for general APIs, fail-closed for sensitive).
- Observability: emit metrics (allowed / rejected / check_ms) per endpoint.
- IP extraction: `X-Forwarded-For` left-most or `True-Client-IP` when behind a trusted proxy.

These are discussed in the design note.
