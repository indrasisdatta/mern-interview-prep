# Backend System Design — Rate Limiter

> Universal interview problem. Every API has one. Runnable code: [CODE/system-design/rate-limiter/](../../../../CODE/system-design/rate-limiter/).
>
> Cross-link: [URL Shortener](../01-URLShortener/notes.md) · [Node.js notes](../../../backend/nodejs/notes.md) · [General system design](../../general/notes.txt)

---

## 1. Problem statement

Design a rate limiter that protects an API from:

- Accidental misuse (buggy client retries)
- Intentional abuse (scraping, credential stuffing, DDoS)
- Capacity overload (cascading failures)

Used in: API gateways, login endpoints (especially), per-customer SaaS quotas, public APIs (Twitter, GitHub, Stripe).

---

## 2. Requirements

### 2.1 Functional

- **Throttle** requests beyond a configured rate (per-second / per-minute / per-day)
- **Different keys** — per user, per IP, per API key, global
- **Different scopes per endpoint** — e.g., login is 5/min, search is 100/min, list is 1000/min
- **Soft + hard limits** — warn before blocking
- **Inform clients** via response headers (`RateLimit-Limit`, `RateLimit-Remaining`, `Retry-After`)
- **Token bucket** semantics common: allow bursts up to bucket size, sustained rate = refill rate

### 2.2 Non-functional

- **Latency:** < 5ms overhead per request
- **Throughput:** handle every API request without bottlenecking (1M+ rps for big services)
- **Distributed:** work across N app instances with consistent counts
- **Resilient:** fail open (allow traffic) when rate-limit store is down, OR fail closed (reject)
- **Configurable hot-path:** policy changes don't require redeploy

---

## 3. Algorithms

Five canonical algorithms — know them all. Interviewers will ask "draw token bucket on whiteboard".

### 3.1 Fixed Window Counter

```
Window: [00:00 .. 00:59]  →  count
Window: [01:00 .. 01:59]  →  count
```

Each window has a counter. Increment on request, reject if count exceeds limit, reset to 0 at window boundary.

```ts
function fixedWindow(key, limit, windowSec) {
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const k = `rl:${key}:${window}`;
  const count = await redis.incr(k);
  if (count === 1) await redis.expire(k, windowSec);
  return count <= limit;
}
```

**Pros:** simplest, lowest memory (one counter per window).
**Cons:** boundary spike — a client can do 2× the limit by sending limit-1 at the end of one window and limit at the start of the next.

### 3.2 Sliding Window Log

Track timestamps of recent requests; count those within the last `windowSec`.

```ts
async function slidingLog(key, limit, windowSec) {
  const now = Date.now();
  const cutoff = now - windowSec * 1000;
  await redis.zremrangebyscore(`rl:${key}`, 0, cutoff);
  const count = await redis.zcard(`rl:${key}`);
  if (count >= limit) return false;
  await redis.zadd(`rl:${key}`, now, `${now}-${crypto.randomUUID()}`);
  await redis.expire(`rl:${key}`, windowSec);
  return true;
}
```

**Pros:** exact — no boundary issue.
**Cons:** memory O(limit) per key (large for high-limit endpoints).

### 3.3 Sliding Window Counter (hybrid)

Combine current and previous window counts, weighted by how much of the previous window overlaps with the current rolling view.

```
Current window:  [04:30 .. 04:35]  count = 30
Previous window: [04:25 .. 04:30]  count = 50
Now: 04:33  (3 minutes into current window, so 60% of current is "past")
Effective count = 30 + 50 × (1 - 3/5) = 30 + 50 × 0.4 = 50
```

```ts
async function slidingWindowCounter(key, limit, windowSec) {
  const now = Date.now() / 1000;
  const window = Math.floor(now / windowSec);
  const prev = window - 1;
  const into = (now - window * windowSec) / windowSec;
  const [curCnt, prevCnt] = await Promise.all([
    redis.get(`rl:${key}:${window}`).then((v) => parseInt(v ?? "0")),
    redis.get(`rl:${key}:${prev}`).then((v) => parseInt(v ?? "0")),
  ]);
  const effective = curCnt + prevCnt * (1 - into);
  if (effective >= limit) return false;
  await redis.incr(`rl:${key}:${window}`);
  return true;
}
```

**Pros:** small memory (two counters), avoids boundary issue (approximately).
**Cons:** approximate; uneven traffic distribution can fool it.

### 3.4 Token Bucket — the workhorse

Bucket has a max capacity (`burst`) and refills at `rate` tokens per second. Each request consumes 1 token (or N). Reject if bucket is empty.

```
Bucket(capacity=10, refill_rate=5/sec)

t=0:  bucket=10, request → bucket=9
t=0:  request → 8
... (10 requests within 1s) → bucket=0
t=1.0: refill → bucket=5, request → 4
```

**Pros:** natural fit for "allow burst up to N, sustained rate R" semantics; cheap (O(1)).
**Cons:** must track per-key bucket state.

```ts
class TokenBucket {
  constructor(public capacity: number, public refillRatePerSec: number) {}

  async tryAcquire(key: string, cost = 1): Promise<{ allowed: boolean; retryAfter: number }> {
    const now = Date.now() / 1000;
    const luaScript = `
      local key = KEYS[1]
      local capacity = tonumber(ARGV[1])
      local rate = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      local cost = tonumber(ARGV[4])
      
      local state = redis.call('HMGET', key, 'tokens', 'ts')
      local tokens = tonumber(state[1]) or capacity
      local last = tonumber(state[2]) or now
      
      -- Refill
      tokens = math.min(capacity, tokens + (now - last) * rate)
      
      local allowed = 0
      local retry = 0
      if tokens >= cost then
        tokens = tokens - cost
        allowed = 1
      else
        retry = (cost - tokens) / rate
      end
      
      redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
      redis.call('EXPIRE', key, math.ceil(capacity / rate * 2))
      return {allowed, tostring(retry)}
    `;
    const [allowed, retry] = await redis.eval(luaScript, 1, key, this.capacity, this.refillRatePerSec, now, cost);
    return { allowed: !!allowed, retryAfter: parseFloat(retry) };
  }
}
```

**Why Lua script:** Read + math + write is 3 operations. Without Lua, two concurrent requests race. Lua executes atomically on Redis.

### 3.5 Leaky Bucket

A queue with fixed drain rate. Requests join queue; processed at rate; queue overflow = reject.

```
Requests in →  [|||...]  → drain at 5/sec → API
                 queue
                 max=20

If queue full, reject.
```

**Pros:** smooths bursts — output rate is constant.
**Cons:** added latency (requests wait in queue); not ideal for HTTP (we want immediate reject, not buffer indefinitely).

In practice, the "leaky bucket as queue" interpretation is rare for HTTP rate limiters. The "leaky bucket as token-bucket-without-burst" interpretation is sometimes used interchangeably with token bucket.

---

## 4. Algorithm choice

For most APIs: **Token Bucket** (with Redis + Lua) or **Sliding Window Counter** (cheap, approximately exact).

| Use case | Algorithm |
|----------|-----------|
| Public REST API with burst tolerance | Token bucket |
| Login endpoint (need strict per-minute) | Sliding window log (exact) or fixed window with short windows |
| Per-tenant SaaS quotas | Token bucket per (tenant, endpoint) |
| Global throttle of one operation | Single bucket per operation |
| Multi-window (per-sec + per-min + per-day) | N parallel token buckets |

### 4.1 Multi-window (Stripe-style)

Stripe rate-limits at multiple windows simultaneously: 100/sec AND 1000/min AND 10000/day. Each is a separate token bucket; request allowed only if all pass.

```ts
async function checkLimits(key) {
  const checks = await Promise.all([
    bucketSec.tryAcquire(`${key}:sec`),
    bucketMin.tryAcquire(`${key}:min`),
    bucketDay.tryAcquire(`${key}:day`),
  ]);
  return checks.every((c) => c.allowed);
}
```

---

## 5. Distributed coordination

### 5.1 Where the state lives

| Store | Pros | Cons |
|-------|------|------|
| **In-memory (per-app instance)** | Sub-µs | Each instance limits independently → effective limit = limit × N |
| **Redis** | Centralized, fast (~1ms), Lua atomic | Single point if not replicated |
| **Memcached** | Fast, simple | No atomic compound ops, no Lua |
| **Persistent DB** (Postgres) | Durable | Too slow for high QPS |

**For real systems: Redis cluster.** Centralizes state across all app instances.

### 5.2 In-memory hybrid

For very high QPS, hybrid:

```
Each app instance has a local token bucket with the same params.
Periodically (every 100ms), sync local state to Redis via Lua.
Tolerate small over-limit at boundaries (e.g., 100/sec → 105 effective).
```

Trades exactness for latency. Used by Cloudflare and Google for L7 limiting.

### 5.3 Sticky routing

If your LB does sticky sessions (same user → same app instance), in-memory rate-limit "almost" works — but during instance restart or rebalance, state is lost. Sticky + Redis is good defense-in-depth.

---

## 6. Implementation in Node.js

### 6.1 Express middleware

```ts
import { Request, Response, NextFunction } from "express";

function rateLimit(opts: {
  keyGen: (req: Request) => string;
  limit: number;
  windowSec: number;
  algorithm: TokenBucket | SlidingWindow;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = opts.keyGen(req);
    const { allowed, retryAfter, remaining } = await opts.algorithm.tryAcquire(key);

    res.setHeader("RateLimit-Limit", opts.limit);
    res.setHeader("RateLimit-Remaining", remaining);
    res.setHeader("RateLimit-Reset", Math.ceil(Date.now() / 1000) + Math.ceil(retryAfter));

    if (!allowed) {
      res.setHeader("Retry-After", Math.ceil(retryAfter));
      return res.status(429).json({ error: "rate_limit_exceeded", retryAfter });
    }
    next();
  };
}

// Usage
app.post("/login",
  rateLimit({
    keyGen: (req) => `login:${req.ip}:${req.body.email}`,
    limit: 5,
    windowSec: 60,
    algorithm: new TokenBucket(5, 5/60),
  }),
  loginHandler
);
```

### 6.2 Recommended npm packages

- **`rate-limiter-flexible`** — battle-tested, supports Redis, Mongo, Memory; multiple algorithms
- **`express-rate-limit`** — simpler, in-memory or Redis store

For Citi/Verizon-tier services, write a thin wrapper around `rate-limiter-flexible` so you can swap stores per environment.

---

## 7. Response headers — IETF RateLimit standard

The IETF draft (`draft-ietf-httpapi-ratelimit-headers`):

```
RateLimit-Limit: 100; w=60          (limit per 60s window)
RateLimit-Remaining: 42
RateLimit-Reset: 1709213400        (Unix timestamp of next reset)
Retry-After: 18                     (seconds to wait — on 429 only)
```

Legacy (still widely used):

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1709213400
```

Always include both formats during migration to the IETF standard.

---

## 8. Failure modes

| Failure | Strategy |
|---------|----------|
| Redis down | **Fail open** for most APIs (allow traffic, log). **Fail closed** for sensitive (login, payment) — reject and degrade |
| Lua script error | Log; allow request (fail open) |
| Latency spike on Redis | Per-request timeout (10ms); fail open after timeout |
| Clock skew between Redis/clients | Use Redis-side `TIME` for `now`; don't trust client wall clock |
| Cache eviction (LRU) | Key not found = full bucket; acceptable behavior |

```ts
async function tryAcquireWithFallback(key) {
  try {
    return await Promise.race([
      tokenBucket.tryAcquire(key),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10)),
    ]);
  } catch (e) {
    metrics.increment("ratelimit.fallback_open");
    return { allowed: true, retryAfter: 0 };   // fail open
  }
}
```

---

## 9. Key design

Choose keys that match the threat model.

| Threat | Key |
|--------|-----|
| Single user abuse | `user_id` |
| IP-based abuse (anonymous) | `ip` |
| Credential stuffing | `ip + email` (per credential) AND `email` (per account) |
| Scraping by API key | `api_key` |
| Endpoint capacity | `endpoint` (global) |
| Free vs paid tiers | `user_id + tier` (different limits per tier) |

For login specifically:
- Per (IP) limit: 50/min
- Per (IP + email) limit: 5/min  ← catches credential stuffing
- Per (email) limit: 10/min       ← catches distributed credential stuffing on one account

Combine multiple keys (all must pass).

---

## 10. Observability

```ts
metrics.increment("ratelimit.allowed",  { endpoint, tier });
metrics.increment("ratelimit.rejected", { endpoint, tier });
metrics.histogram("ratelimit.check_ms", duration, { endpoint });

// Sample: log a small fraction of rejects for forensics
if (!allowed && Math.random() < 0.01) {
  logger.info("ratelimit reject", { endpoint, key: hash(key), retryAfter });
}
```

Dashboards:
- Rejects/sec by endpoint — find under-tuned limits
- p99 check latency — find Redis hot keys
- Top rejected IPs / users — abuse detection

---

## 11. Tier-based limits (SaaS)

```ts
const TIER_LIMITS = {
  free:    { requestsPerMin: 60,  requestsPerDay: 1000 },
  pro:     { requestsPerMin: 600, requestsPerDay: 100_000 },
  enterprise: { requestsPerMin: Infinity, requestsPerDay: Infinity },
};

function tierKey(req) {
  return `${req.user.id}:${req.user.tier}`;
}
```

Customers should be able to **view their current usage** (via API or dashboard) — bake this into the headers from day 1.

---

## 12. Special cases

### 12.1 Cost-based / weighted limits

Not all endpoints cost the same. Searching is cheap; image-generation is expensive.

```ts
// Each request costs N tokens
await bucket.tryAcquire(key, /* cost */ 10);   // image generation
await bucket.tryAcquire(key, /* cost */ 1);    // search
```

Stripe + OpenAI APIs both use this model.

### 12.2 Burst credits

User unused tokens accumulate (up to bucket cap). Natural with token bucket.

### 12.3 Whitelisting

```ts
const WHITELIST = new Set(["10.0.0.0/8", "office_ip", ...]);
function isWhitelisted(req) { return WHITELIST.has(req.ip) || isInternal(req); }
```

Internal services bypass.

### 12.4 IP-based — gotchas

- **NAT / shared IPs** — corporate offices, mobile carriers. Limit too low = false positives. Don't rely only on IP for login limiters.
- **IPv6** — limit per /64 not per full address (clients have many IPv6 addresses)
- **Proxy / CDN** — extract real IP from `X-Forwarded-For` (left-most untrusted) or `True-Client-IP` (CloudFront / Cloudflare)

```ts
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"]?.split(",")[0]?.trim();
  return xff ?? req.ip;
}
```

---

## 13. Trade-off matrix

| Decision | Option A | Option B | Choice + Why |
|----------|----------|----------|--------------|
| Algorithm | Fixed window | Token bucket | **Token bucket** — natural burst + sustained model |
| Storage | In-memory | Redis | **Redis** with optional in-memory fast path |
| Consistency | Exact | Approximate | **Approximate (sliding window counter)** for cheap throttling; **exact (Lua atomic)** for login |
| Fail mode | Open | Closed | **Open** for general APIs; **Closed** for sensitive (login, payment) |
| Key | IP only | Composite | **Composite (IP + user + endpoint)** — defense in depth |
| Response | 429 | Custom | **429** with IETF headers |
| Tiering | Static config | Per-tenant overrides | **Per-tenant + endpoint** — flexible quota model |

---

## 14. Architectural placement

Where in the request path?

```
Client → CDN/WAF → LB → API Gateway → App server → DB
                              ↑              ↑
                              │              │
                          gateway-level    app-level
                          rate limit       rate limit
```

| Layer | Best for |
|-------|----------|
| **CDN / WAF** (Cloudflare, AWS WAF) | IP-based, very high QPS, DDoS-tier |
| **API Gateway** (Kong, Apigee, AWS API Gateway, NGINX) | Per-API-key, tier-based |
| **App server middleware** | Business-logic-aware (per-account, per-endpoint) |
| **Service-to-service** (intra-microservices) | Token bucket on the client side |

**Defense in depth:** the strict per-user limit lives at the app server; broader DDoS protection lives at the CDN.

---

## 15. Login-specific rate limiter (real-world example)

Critical to defend against credential stuffing.

```ts
const ipBucket    = new TokenBucket(50, 50/60);   // 50/min per IP
const ipEmailBkt  = new TokenBucket(5, 5/60);     // 5/min per (IP, email)
const emailBkt    = new TokenBucket(10, 10/60);   // 10/min per email globally

app.post("/login", async (req, res) => {
  const ip = clientIp(req);
  const email = req.body.email?.toLowerCase();

  // Check all three; fail closed for login
  try {
    const results = await Promise.all([
      ipBucket.tryAcquire(`login:ip:${ip}`),
      ipEmailBkt.tryAcquire(`login:ip-email:${ip}:${email}`),
      emailBkt.tryAcquire(`login:email:${email}`),
    ]);
    if (results.some((r) => !r.allowed)) {
      return res.status(429).json({ error: "Too many login attempts" });
    }
  } catch (e) {
    // Fail CLOSED for login — better safe than sorry
    return res.status(503).json({ error: "Service temporarily unavailable" });
  }

  // Increment failed-attempts counter only on actual fail (separate logic)
  ...
});
```

Plus exponential backoff + CAPTCHA after N failures + account lockout.

---

## 16. Testing

### 16.1 Unit

- Token bucket math (refill, burst cap, cost > 1)
- Sliding window edges (boundary spike for fixed window)
- Concurrency: 100 parallel `tryAcquire` calls — verify only N pass

### 16.2 Integration

- Real Redis (testcontainers); verify Lua script atomicity
- Failure modes (Redis down → fallback)
- Header correctness

### 16.3 Load test

- Hammer at 10× the limit; assert ~limit pass and rest get 429
- Sustained load + verify no leak (Redis key TTL works)

---

## 17. Interview talking points

**Q: "Which algorithm would you choose?"**
A: Token bucket for general APIs — it naturally models "burst up to N, sustained rate R". Sliding window log when you need *exact* counts (e.g., legal compliance limits). Fixed window is the cheapest but has boundary spikes — fine for soft limits. Sliding window counter is the pragmatic middle — approximate but cheap.

**Q: "Why Lua script in Redis?"**
A: Atomicity. A naive impl is read-modify-write — two operations. Two concurrent requests can both read the same value, both decrement, both succeed — exceeding the limit by 2. Lua executes atomically on Redis, so the entire decrement-and-check is one operation.

**Q: "Distributed rate limiter — how do all app instances share state?"**
A: Centralized store (Redis), preferably with replication. Each request goes through Redis to check/decrement. Latency overhead ~1ms per request. For very high QPS, hybrid local + central — local bucket per instance, sync to Redis every 100ms. Tolerates slight over-limit during sync windows.

**Q: "What if Redis is down?"**
A: For general APIs, fail open — allow traffic, log, page on-call. The cost of false positives (rejecting legitimate users) is usually higher than the cost of allowing through an attack for a few minutes. For sensitive endpoints (login, payment), fail closed — better to take an outage than risk an unprotected window.

**Q: "How do you handle credential stuffing on login?"**
A: Three layers: (1) per-IP limit (50/min) catches a single bad actor; (2) per-(IP, email) (5/min) catches the same IP trying many passwords for one account; (3) per-email (10/min) catches distributed attacks targeting one account from many IPs. Plus CAPTCHA after N failures, account lockout, exponential backoff, and 2FA enforcement.

**Q: "Per-user limits behind NAT?"**
A: IP alone is too coarse — corporate offices NAT thousands of users. Use IP only as one signal; preferred is per-account or per-API-key once authenticated. For pre-auth (login), combine with other features: device fingerprint, session cookie. For IPv6, limit per /64 not per full address — single users get billions of v6 addresses.

**Q: "What about cost-based limits?"**
A: Different endpoints consume different amounts of tokens — search costs 1, image generation costs 10, model fine-tuning costs 100. The token bucket abstraction handles this naturally (`tryAcquire(key, cost)`). OpenAI, Stripe, Anthropic all use this model. Communicate the cost up front so clients can budget.

**Q: "Where should the rate limiter live architecturally?"**
A: Defense in depth. CDN/WAF handles DDoS-tier IP limits at the edge. API Gateway handles per-API-key + tier limits. App server middleware handles business-logic limits (per-customer, per-resource). Each layer protects against different attack profiles.

---

## 18. Diagram

```
                       Client request
                            │
                            ▼
                  ┌─────────────────────┐
                  │  CDN / WAF (L1)     │   DDoS-scale IP limits
                  └──────────┬──────────┘
                             ▼
                  ┌─────────────────────┐
                  │  API Gateway (L2)   │   API-key tier limits
                  └──────────┬──────────┘
                             ▼
                  ┌─────────────────────┐
                  │  App server (L3)    │   Business-logic limits
                  │  Express middleware │
                  └──────────┬──────────┘
                             │
                             ▼
                     ┌──────────────┐
                     │  Token bucket │
                     │   Lua script  │
                     └──────┬────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │  Redis cluster│
                     └──────────────┘
                            │
                            ▼ if allowed → next()
                  ┌─────────────────────┐
                  │  Business handler   │
                  └─────────────────────┘
                            │
                            ▼ response with RateLimit-* headers
```

---

## 19. Cross-links

- Runnable code: [CODE/system-design/rate-limiter/](../../../../CODE/system-design/rate-limiter/)
- [URL Shortener](../01-URLShortener/notes.md) — uses rate limiter
- [Node.js notes](../../../backend/nodejs/notes.md) — Express middleware patterns
- [General system design](../../general/notes.txt) — distributed coordination
- [Web Security](../../../frontend/performance-security/WebSecurity.md) — credential-stuffing defenses
