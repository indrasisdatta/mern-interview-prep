# Backend System Design — URL Shortener (bit.ly / TinyURL)

> The classic system-design interview question. Tests breadth: encoding, ID generation, storage choice, caching, sharding, analytics. Runnable code: [CODE/system-design/url-shortener/](../../../../CODE/system-design/url-shortener/).
>
> Cross-link: [General system design](../../general/notes.txt) · [Node.js notes](../../../backend/nodejs/notes.md) · [Rate Limiter](../02-RateLimiter/notes.md)

---

## 1. Problem statement

Design a URL shortening service that:

- Takes a long URL → returns a short URL (e.g., `https://sho.rt/aZ9b2c`)
- Resolving the short URL redirects to the long URL
- Optional custom alias (`/my-link`)
- Optional expiry (`expiresAt`)
- Tracks click analytics (count, geo, referrer)
- High read-to-write ratio (~100:1)
- Globally distributed users

Examples in the wild: bit.ly, tinyurl.com, goo.gl (deprecated), short.link.

---

## 2. Requirements

### 2.1 Functional

- `POST /shorten` — body `{ url, customAlias?, expiresAt? }` → `{ shortCode, shortUrl }`
- `GET /{shortCode}` — 301/302 redirect to long URL; record click event
- `GET /{shortCode}/stats` — return click count, geo breakdown, referrer breakdown
- Custom aliases (`POST /shorten` with `customAlias: "promo-q4"`)
- TTL expiry (per-URL)
- Rate-limit shorten + resolve

### 2.2 Non-functional

- **Latency:** redirect < 30ms p95 (it sits in browser navigation critical path)
- **Throughput:** 1B redirects/day = ~12k/sec, peak 50k/sec
- **Durability:** never lose a mapping
- **Uniqueness:** no two URLs map to the same short code
- **Read:write ratio:** ~100:1 (most users click, few create)
- **Globally distributed** — geo-replicated reads

### 2.3 Capacity estimation

- Writes: 100M new shortens/day → ~1200/sec avg, 5000/sec peak
- Reads: 10B/day → 115k/sec avg, 500k/sec peak
- Storage: 100M × 365 days × 5 years = ~180B URLs lifetime; ~500 bytes each → ~90TB raw
- Bandwidth (egress): mostly 301 redirects (~200B header) → ~25Gbps peak

---

## 3. Short code design

### 3.1 Length & alphabet

- **Alphabet:** Base62 (`[A-Za-z0-9]`, 62 chars) — URL-safe, dense
- **Length:** 7 chars = 62^7 ≈ 3.5 trillion combos (covers 180B easily, with low collision risk)

Why not Base64? `+` and `/` are URL-reserved.

### 3.2 Two approaches to short-code generation

**A. Hash the URL** — `MD5(url)[:7]`. Pros: deterministic (same URL → same code). Cons: collisions; need to handle "same URL submitted twice" (return existing).

**B. Counter-based ID** — incrementing counter encoded as Base62. Pros: no collisions; deterministic. Cons: coordination needed for distributed counter.

**Industry favorite: counter + Base62.**

### 3.3 Distributed ID generation

| Method | Pros | Cons |
|--------|------|------|
| **DB auto-increment** | Simple | Single point; not horizontally scalable |
| **UUID v4** | Distributed, no coord | 128-bit, too long for short URLs |
| **Snowflake** | Sortable, distributed | Needs node ID coordination; clock-skew |
| **UUID v7** | Time-sortable, distributed | 128-bit, must hash down |
| **Counter range allocation** | Each app server gets a range (1-10000), generates locally | Need a coordinator (e.g., ZooKeeper, etcd) |
| **DB sequence + cache** | Each server caches batch of 1000 IDs | DB sequence is the coord |

For URL shortener, **counter range allocation** is ideal:

```
Coordinator (Postgres / Redis):
  next_range = 50000
  
App server A requests range:
  → gets [40001, 50000]
  → coordinator increments next_range to 60000
  
App server A uses 40001 → 50000 locally (in-process counter, no network calls)
When exhausted, requests next batch.
```

### 3.4 Base62 encoder

```ts
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function encode(num: number): string {
  if (num === 0) return ALPHABET[0];
  let out = "";
  while (num > 0) {
    out = ALPHABET[num % 62] + out;
    num = Math.floor(num / 62);
  }
  return out;
}

function decode(str: string): number {
  let n = 0;
  for (const c of str) n = n * 62 + ALPHABET.indexOf(c);
  return n;
}

encode(1);          // "B"
encode(125);        // "Bb"
encode(125_000_000); // "h31a4"  (7 chars)
```

**Pad to minimum length** (e.g., 7) so short codes don't leak how new they are. Pad with random Base62 chars in unused high bits (not zeros — too obvious a pattern).

```ts
function pad(num: number, len = 7): string {
  const base = encode(num);
  if (base.length >= len) return base;
  // prepend random chars; remember the offset for decode
  return randomChars(len - base.length) + base;
}
```

Or, more simply, **start the counter at 62^6** so all encodings are exactly 7 chars naturally.

### 3.5 Custom aliases

```ts
async function createCustomAlias(alias: string, url: string, userId: string) {
  // Validate
  if (!/^[a-zA-Z0-9_-]{3,30}$/.test(alias)) throw new BadRequest("Invalid alias");
  
  // Check uniqueness
  const existing = await db.urls.findOne({ shortCode: alias });
  if (existing) throw new Conflict("Alias taken");
  
  // Reserved words
  if (RESERVED.has(alias)) throw new BadRequest("Reserved alias");
  
  // Insert with shortCode = alias
  await db.urls.insert({ shortCode: alias, url, userId, createdAt: now() });
  return alias;
}
```

Custom aliases live in the same `shortCode` namespace — so the generator must skip those values.

---

## 4. Storage choice

### 4.1 Schema

```sql
CREATE TABLE urls (
  short_code   VARCHAR(20) PRIMARY KEY,
  long_url     TEXT NOT NULL,
  user_id      BIGINT,                -- nullable for anonymous
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMP,
  is_active    BOOLEAN DEFAULT TRUE,
  click_count  BIGINT DEFAULT 0       -- denormalized for fast stats
);

CREATE INDEX urls_user_id_idx ON urls(user_id);
CREATE INDEX urls_expires_at_idx ON urls(expires_at) WHERE is_active = TRUE;
```

### 4.2 SQL vs NoSQL

| Aspect | PostgreSQL | DynamoDB / Cassandra |
|--------|-----------|---------------------|
| Query model | Lookups by short_code (PK) | Same (single-item GET) |
| Consistency | Strong (single node) | Eventual (DynamoDB) or strong (with cost) |
| Scaling | Read replicas + vertical | Native horizontal |
| Index on URL (find by long URL) | Yes (B-tree) | GSI |
| Operationally | Mature, well-known | Cloud-managed, less surprising tuning |
| Cost | Per-host | Per RCU/WCU |

**For URL shortener: NoSQL wins** because:
- Access pattern is point lookup by short_code — exactly what KV stores excel at
- Massive scale + global distribution favored
- Lower ops burden on the team

For a startup MVP, Postgres + Redis is fine and simpler. For scale, **DynamoDB** with global tables (multi-region replication).

### 4.3 DynamoDB design

```
Table: urls
  partition key: short_code
  attributes: long_url, user_id, created_at, expires_at, is_active, click_count
  TTL attribute: expires_at  (DynamoDB auto-deletes expired items)
  
Global Secondary Index (GSI): user_id-created_at-index
  partition key: user_id
  sort key: created_at
  attributes: short_code, long_url
  
GSI: long_url-hash (for dedup-by-URL)
  partition key: SHA256(long_url) (first 16 bytes hex)
  sort key: short_code
```

---

## 5. Read path — the redirect

This is the hot path. Optimize ruthlessly.

```
GET /aZ9b2c
   ↓
1. Edge cache (CloudFront / Fastly) → hit? return 301 immediately
   ↓ miss
2. App server checks Redis cache → hit? return 301, async record click
   ↓ miss
3. Read from DynamoDB → cache in Redis (TTL 10min) → return 301
   ↓
4. Async: write click event to Kafka
```

### 5.1 Code

```ts
app.get("/:code", async (req, res) => {
  const code = req.params.code;

  // 1. Redis cache
  let url = await redis.get(`url:${code}`);
  if (!url) {
    // 2. DB lookup
    const row = await db.urls.findOne({ shortCode: code });
    if (!row || !row.isActive || (row.expiresAt && row.expiresAt < new Date())) {
      return res.status(404).render("not-found");
    }
    url = row.longUrl;
    await redis.set(`url:${code}`, url, "EX", 600);   // 10min cache
  }

  // 3. Async click tracking — don't block redirect
  fireAndForget(() => kafka.send("clicks", {
    code,
    ts: Date.now(),
    ip: req.ip,
    ua: req.headers["user-agent"],
    referrer: req.headers.referer,
  }));

  // 4. Redirect
  res.set("Cache-Control", "private, max-age=300");   // browsers cache for 5min
  return res.redirect(301, url);
});
```

### 5.2 301 vs 302

| Status | Behavior |
|--------|----------|
| **301 Moved Permanently** | Browsers cache aggressively; subsequent requests skip server entirely |
| **302 Found** | Browsers don't cache; every click hits server |

**Analytics implication:** 301 = fewer click events recorded (browser cache skips us). Most providers use **302** to ensure every click reaches their analytics.

For high-throughput services that prioritize cost: 301 + short max-age (5-10min) balances both.

### 5.3 Hot-key strategy

Some URLs go viral. Single Redis key → single CPU → bottleneck.

**Mitigation:**
- **Edge cache** with high TTL (CloudFront — caches 301 responses)
- **App-level in-memory** LRU for top-N hot URLs
- **Read-through replication** — multiple Redis read replicas

```ts
const localLRU = new LRU<string, string>({ max: 10_000, ttl: 60_000 });

async function getUrl(code: string) {
  const local = localLRU.get(code);
  if (local) return local;
  const redisVal = await redis.get(`url:${code}`);
  if (redisVal) { localLRU.set(code, redisVal); return redisVal; }
  // ... DB
}
```

---

## 6. Write path — shortening

```
POST /shorten { url: "https://..." }
   ↓
1. Validate URL (well-formed, allowed scheme)
   ↓
2. Rate-limit (per user / per IP)
   ↓
3. Check if URL was shortened before by same user — return existing if so (dedup)
   ↓
4. Generate short_code (allocate from local counter range)
   ↓
5. Write to DB (conditional: only if shortCode doesn't exist)
   ↓
6. Cache in Redis (short TTL for fresh URLs)
   ↓
7. Return { shortCode, shortUrl }
```

### 6.1 URL validation

```ts
function validateUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); }
  catch { throw new BadRequest("Invalid URL"); }
  
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new BadRequest("Only http/https supported");
  }
  
  // Block recursive shortening (avoid infinite loops)
  if (url.host === MY_DOMAIN) throw new BadRequest("Cannot shorten our own links");
  
  // Block private IPs (SSRF defense if backend ever fetches URLs)
  if (isPrivateAddress(url.hostname)) throw new BadRequest("Invalid host");
  
  return url.toString();
}
```

### 6.2 Dedup

```ts
const longUrlHash = sha256(longUrl).slice(0, 16);
const existing = await db.urls.findOne({ longUrlHash, userId });
if (existing) return existing.shortCode;
```

For anonymous users, dedup might not be valuable — different users want their own analytics. Make dedup user-scoped.

### 6.3 Local counter pattern

```ts
class IdGenerator {
  private current = 0;
  private end = 0;
  private mutex = new Mutex();

  async next(): Promise<number> {
    return this.mutex.runExclusive(async () => {
      if (this.current >= this.end) {
        await this.refill();
      }
      return this.current++;
    });
  }

  private async refill() {
    const BATCH = 10_000;
    // Atomic Postgres: SELECT counter + BATCH, UPDATE — single transaction
    const row = await db.tx(async (tx) => {
      const r = await tx.one("SELECT value FROM counters WHERE name='url' FOR UPDATE");
      await tx.none("UPDATE counters SET value = value + $1 WHERE name='url'", [BATCH]);
      return r;
    });
    this.current = row.value;
    this.end = row.value + BATCH;
  }
}
```

A 10k-batch means we hit the central counter only every 10k writes. With 5000 writes/sec peak, that's once every 2 seconds — easily centralized.

---

## 7. Click analytics

### 7.1 Event flow

```
App server → Kafka topic "clicks" → ClickHouse / ELK / S3 (raw events)
                                  → Stream processor → aggregate counts → store
```

### 7.2 Why Kafka

- Buffer between app server and downstream — handles bursts
- Multiple consumers (real-time aggregation, audit log, ML)
- Replayable

### 7.3 ClickHouse for analytics

ClickHouse handles columnar OLAP queries on click streams beautifully.

```sql
CREATE TABLE clicks (
  short_code String,
  ts DateTime64(3),
  ip String,
  country FixedString(2),
  device String,
  referrer String,
  user_agent String
) ENGINE = MergeTree()
ORDER BY (short_code, ts)
PARTITION BY toYYYYMM(ts);
```

```sql
-- Total clicks per code (fast — sorted by short_code)
SELECT short_code, count() FROM clicks WHERE short_code='aZ9b2c' GROUP BY short_code;

-- Top countries
SELECT country, count() FROM clicks WHERE short_code='aZ9b2c' GROUP BY country ORDER BY 2 DESC LIMIT 10;

-- Clicks per day, last 30 days
SELECT toDate(ts), count() FROM clicks 
WHERE short_code='aZ9b2c' AND ts > now() - INTERVAL 30 DAY GROUP BY 1;
```

### 7.4 Incrementing the denormalized counter

The `click_count` column on `urls` is denormalized. Updating it on every click is expensive (DynamoDB UpdateItem at 100k/sec).

**Strategy:** batch increment via Kafka consumer.

```ts
// consumer batches increments per code
const buf = new Map<string, number>();

consumer.on("clicks", (event) => {
  buf.set(event.short_code, (buf.get(event.short_code) ?? 0) + 1);
  scheduleFlush();
});

async function flush() {
  const updates = Array.from(buf.entries());
  buf.clear();
  for (const [code, delta] of updates) {
    await ddb.updateItem({ key: { short_code: code }, addToCounter: { click_count: delta } });
  }
}
```

Flush every 1s or when buffer hits 1000 entries. Click count is eventually consistent (slight lag) — acceptable for analytics.

---

## 8. Caching strategy

| Layer | TTL | Why |
|-------|-----|-----|
| **Browser cache** (Cache-Control on 301) | 5min | Skip server entirely for repeat clicks |
| **CDN/edge cache** | 10min | Geo-distributed, shields origin |
| **Redis** | 10min for hot URLs; longer for popular | Sub-ms lookups |
| **App in-memory LRU** | 1min | Skip Redis for top-N |
| **DB** | — | Source of truth |

### 8.1 Cache invalidation

- URL deleted by user → invalidate Redis + send purge to CDN
- URL TTL expires → DB returns expired, app server returns 404 (Redis TTL aligned)
- Custom alias updated → invalidate all cache layers
- For most URL shorteners, **immutability** is the norm — once shortened, URL → mapping doesn't change. Makes caching trivial.

### 8.2 Negative caching

If a code doesn't exist, cache the 404 to prevent abuse (probing for codes):

```ts
const cached = await redis.get(`url:${code}`);
if (cached === "__404__") return res.status(404).end();
if (cached) return res.redirect(301, cached);
// ... DB lookup
if (!row) { await redis.set(`url:${code}`, "__404__", "EX", 60); return 404; }
```

---

## 9. Scaling

### 9.1 Sharding

For DB sharded by `short_code`:
- Hash(short_code) % N to find shard
- Each shard is a Postgres/Cassandra/DynamoDB partition

DynamoDB handles this transparently. With Postgres, use Vitess, Citus, or app-level sharding.

### 9.2 Read replicas

PostgreSQL with N read replicas; route reads geographically (nearest replica) via DNS or app logic.

### 9.3 Multi-region

| Component | Strategy |
|-----------|----------|
| App servers | Run in every region (US, EU, AP) |
| Redis | Region-local; warm cache via Redis Replication |
| DynamoDB Global Tables | Multi-master multi-region |
| Postgres | Primary in one region + read replicas in others |
| CDN | Edge in every PoP (CloudFront / Cloudflare) |
| Kafka | Per-region clusters; mirror to central analytics |

### 9.4 Read amplification

100:1 read ratio means reads dominate. Cache hit rate determines DB load.

- 99% cache hit → DB sees 1% of reads → 1150 reads/sec at peak (trivial)
- 90% cache hit → 11.5k reads/sec → significant

Aim for 99%+ cache hit rate. Achievable because URL mappings are immutable.

---

## 10. Security & abuse

### 10.1 Phishing / spam URLs

Bad actors shorten malicious links. Mitigations:

- **URL safety check** at shorten time — Google Safe Browsing API, custom blocklist
- **Async rescan** of all URLs periodically — flag newly-malicious URLs
- **Honeypot** at resolve time — for flagged URLs, show a warning page first

```ts
async function isSafe(url: string): Promise<boolean> {
  const res = await fetch("https://safebrowsing.googleapis.com/v4/threatMatches:find?key=...", {
    method: "POST",
    body: JSON.stringify({
      threatInfo: {
        threatTypes: ["MALWARE", "SOCIAL_ENGINEERING"],
        platformTypes: ["ANY_PLATFORM"],
        threatEntryTypes: ["URL"],
        threatEntries: [{ url }],
      },
    }),
  });
  const data = await res.json();
  return !data.matches?.length;
}
```

### 10.2 Rate limiting

See [Rate Limiter notes](../02-RateLimiter/notes.md). At minimum:
- Shorten: 10/min per IP, 100/min per authenticated user
- Resolve: 100/sec per IP

### 10.3 SSRF prevention

If our backend ever fetches a URL (e.g., to grab title for the dashboard), validate against private IPs:

```ts
function isPrivateAddress(host: string): boolean {
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 127.0.0.0/8, ::1, fc00::/7
  // resolve DNS first to catch IP-spoofing via hostnames
  // ...
}
```

### 10.4 PII / privacy

Click events contain IP, UA → PII. Honor GDPR / DSARs.

- Hash IPs (SHA-256 with daily salt) for analytics
- Retention policy: raw click events 90 days, aggregates indefinitely
- Right-to-delete: provide endpoint to delete user's URLs + analytics

---

## 11. Reliability

### 11.1 Failure modes

| Failure | Mitigation |
|---------|------------|
| Redis down | App falls through to DB; latency rises, no errors |
| DB primary down | Read from replica (read-only mode); writes queue or fail |
| Kafka down | Click events buffered in-process, lost if app crashes; OK trade-off |
| Counter coordinator down | Each app has cached range; lasts ~30 min before exhaust |
| CDN down | App handles redirect directly; latency rises |
| All caches cold | DB stampede; mitigated by request coalescing |

### 11.2 Stampede protection

When cache misses for a hot URL, 1000s of concurrent reads hit DB simultaneously. **Request coalescing:**

```ts
const inflight = new Map<string, Promise<string>>();

async function getUrl(code: string) {
  const cached = await redis.get(`url:${code}`);
  if (cached) return cached;
  
  if (inflight.has(code)) return inflight.get(code)!;
  
  const promise = (async () => {
    try {
      const row = await db.findOne({ shortCode: code });
      if (row) await redis.set(`url:${code}`, row.longUrl, "EX", 600);
      return row?.longUrl;
    } finally {
      inflight.delete(code);
    }
  })();
  
  inflight.set(code, promise);
  return promise;
}
```

---

## 12. Trade-off matrix

| Decision | Option A | Option B | Choice + Why |
|----------|----------|----------|--------------|
| Code generation | Hash URL | Counter + Base62 | **Counter** — no collisions, deterministic |
| Counter source | DB sequence | ZooKeeper/etcd | **DB sequence with batch caching** — simpler |
| Storage | PostgreSQL | DynamoDB | **DynamoDB** at scale; Postgres for MVP |
| Cache | App-only | Redis + CDN | **Redis + CDN** — geo coverage |
| Redirect status | 301 | 302 | **301 + short max-age** if analytics matters; 302 if fresh metrics required every click |
| Analytics | Inline incr | Kafka + ClickHouse | **Kafka + ClickHouse** — handles 100k/sec |
| Counter increment | Per-request | Batched | **Batched** — denormalized count eventually consistent |
| Multi-region | Single | Global | **Global** with DynamoDB Global Tables + CloudFront |

---

## 13. Interview talking points

**Q: "How do you generate the short code?"**
A: Counter + Base62 encoding. A global counter (DynamoDB sequence or Postgres atomic increment) allocates ranges to each app server in 10k batches. Locally, each request takes the next ID from its range and Base62-encodes it. 62^7 = 3.5T combos — plenty for 5+ years at 100M/day. No collisions, deterministic, URL-safe.

**Q: "Why Base62?"**
A: 62 chars (`A-Za-z0-9`) is URL-safe with no encoding needed. Base64 has `+` and `/` which need URL-escaping — defeats the "short" goal. We pad to 7 chars by starting the counter at 62^6 so all codes are uniform length.

**Q: "SQL or NoSQL?"**
A: For scale, NoSQL — DynamoDB. The access pattern is point lookup by short_code, which KV stores are perfect for. DynamoDB Global Tables give us multi-region replication with no operational burden. For MVP / smaller scale, Postgres + Redis is simpler.

**Q: "How do you handle the read load?"**
A: 99%+ cache hit rate via CDN + Redis. URL mappings are immutable (once shortened, the mapping doesn't change), so cache TTLs can be aggressive. CDN handles the geo distribution; Redis handles the in-region hot keys; app-level LRU shields Redis for the very top URLs. DB sees ~1% of traffic — easy to scale.

**Q: "301 vs 302?"**
A: Trade-off. 301 = browsers cache, fewer requests reach our analytics. 302 = every click hits us, accurate analytics but more load. Most URL shorteners pick 302 to preserve analytics; we can use 301 with a short max-age (~5 min) as a middle ground.

**Q: "How do you scale the counter?"**
A: Batched range allocation. Each app server pulls a 10k-ID range from the central counter (Postgres `SELECT FOR UPDATE` + atomic increment). It then issues IDs locally with no network hops. Coordinator load is `writes/sec ÷ batch_size` — at 5000 writes/sec and 10k batches, that's one coordinator hit every 2 seconds. Trivial.

**Q: "What about custom aliases?"**
A: Custom aliases live in the same `short_code` namespace. Validation: regex match (alphanumeric, `_`, `-`, length 3-30), uniqueness check (DB unique constraint), reserved-words blocklist (e.g., `api`, `admin`, `login`). If the alias collides with a generated code (rare but possible), allow custom to take precedence — generator just retries with the next ID.

**Q: "Click analytics — how do you handle 100k/sec writes?"**
A: Fire-and-forget Kafka publish from the redirect handler. Kafka buffers and feeds two consumers: (1) ClickHouse ingest for OLAP queries (top countries, time series); (2) batched counter incrementer (groups deltas per code and updates `click_count` on DynamoDB every second). The counter is eventually consistent — fine for analytics.

**Q: "How do you prevent malicious URLs?"**
A: At shorten time, check Google Safe Browsing API + internal blocklist. Async rescan periodically (newly-flagged URLs get rescanned). At resolve time, flagged URLs show a warning interstitial. We also reject obvious classes: file://, javascript:, our own domain (loop prevention), private IPs (SSRF if we ever fetch the URL).

**Q: "What's the hardest part operationally?"**
A: Hot keys. One viral URL can pin a Redis shard. We use multiple Redis replicas with read scaling, app-level LRU for top-N, and CDN edge caching with high TTL. For really pathological cases, ClickHouse-tracked hot codes get preemptively pinned to in-memory cache at all app servers.

---

## 14. Diagram

```
                    Client (browser)
                        │
                        │ GET /aZ9b2c
                        ▼
                   ┌──────────┐
                   │   CDN    │  ◄─── 301 cached (5min)
                   │ (edge)   │
                   └─────┬────┘
                         │ miss
                         ▼
                  ┌──────────────┐
                  │  LB (geo)    │
                  └──────┬───────┘
                         ▼
              ┌──────────────────────┐
              │  App server (Node)    │
              │  - in-mem LRU         │
              └──────┬────────────────┘
                     │ miss
                     ▼
              ┌──────────────────────┐
              │  Redis cluster        │
              └──────┬────────────────┘
                     │ miss
                     ▼
              ┌──────────────────────┐
              │  DynamoDB (global)    │
              │  PK: short_code       │
              └──────────────────────┘
                     │
                     │ (async)
                     ▼
              ┌──────────────────────┐
              │  Kafka "clicks"       │
              └──┬────────────┬───────┘
                 │            │
                 ▼            ▼
        ┌──────────────┐ ┌──────────────┐
        │ ClickHouse   │ │ Counter      │
        │ (analytics)  │ │ Incrementer  │
        └──────────────┘ └──────┬───────┘
                                │
                                ▼ batched updates
                          (DynamoDB click_count)
```

---

## 15. Cross-links

- Runnable code: [CODE/system-design/url-shortener/](../../../../CODE/system-design/url-shortener/)
- [Rate Limiter](../02-RateLimiter/notes.md) — for shorten/resolve rate limits
- [General system design](../../general/notes.txt) — CAP, consistency basics
- [Node.js notes](../../../backend/nodejs/notes.md) — Redis, Express patterns, observability
- [Web Security](../../../frontend/performance-security/WebSecurity.md) — SSRF, input validation
