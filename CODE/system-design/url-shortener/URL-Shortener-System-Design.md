# System Design - URL Shortener

> Living doc. Each new problem adds reusable blocks here. Start with the framework, lean on the building blocks, and use the URL Shortener as a worked reference.

---

## 1. The Reusable Framework

Works for almost any design problem. **Requirements and scale drive everything downstream — never jump to architecture first.**

1. **Requirements** — functional + non-functional + explicitly out of scope.
2. **Scale estimate** — QPS, storage, bandwidth (back-of-envelope, show the arithmetic).
3. **API design** — endpoints, methods, request/response, status codes.
4. **Data model / schema** — fields, keys, SQL vs NoSQL (justify by access pattern).
5. **High-level architecture** — request flow for read path and write path.
6. **Deep dive** — the 1–2 genuinely interesting components.
7. **Bottlenecks & tradeoffs** — where it breaks, what you traded, remaining SPOFs.

### 1.1 The RADIO Framework (memorize this spine)

RADIO is a 5-letter mnemonic for the same flow. The 7 steps above are the *expanded* version; **RADIO is what you recall under pressure** and recite to the interviewer at minute zero ("I'll work through this with RADIO: requirements, architecture, data model, interface, optimizations").

| Letter | Stage | What you actually do | Common mistakes |
|---|---|---|---|
| **R** | **Requirements exploration** | Clarify *functional* (what it must do) + *non-functional* (latency, availability, durability, read/write skew) + scope + assumptions. Ask before assuming. Fold **scale estimation** in here (QPS, storage, bandwidth). | Listing solutions (e.g. "caching") as requirements; skipping out-of-scope; not quantifying NFRs. |
| **A** | **Architecture / high-level design** | Draw the boxes and arrows: client → LB → app servers → cache → DB, plus async/queues. Name each component's responsibility. Walk the **read path and write path** separately. | Jumping here before R; one giant blob with no request flow. |
| **D** | **Data model** | Entities, fields, keys, relationships; storage choice (SQL vs NoSQL) justified by **access pattern**, not buzzword. | Modeling relations that don't exist; choosing DB by popularity. |
| **I** | **Interface definition (API)** | Contracts: client↔server endpoints *and* service↔service calls. Method, path, request/response, status codes, idempotency. | Vague endpoints; ignoring status-code semantics (301 vs 302). |
| **O** | **Optimizations & deep dive** | Pick 1–2 interesting components and go deep. Then bottlenecks, scaling moves, tradeoffs, edge cases, SPOFs. | Going broad-and-shallow instead of deep; no tradeoffs named. |

**Ordering nuance worth knowing:** RADIO puts **A (architecture) before D and I**, which suits front-end / breadth-first interviews. The Alex-Xu / back-end style (and the 7-step list above) often does **API and data model *before* architecture**, because the contract and schema make the boxes obvious. Both are correct — pick one, state it, and stay consistent. Also note **RADIO folds scale estimation into R**; if your interviewer is back-end-leaning, call out estimation as its own explicit beat so you don't skip the arithmetic.

> Origin: RADIO is popularized by GreatFrontEnd for front-end system design, but the acronym generalizes cleanly to back-end problems too.

---

## 2. Building Block — Load Balancing

**Job:** spread traffic across servers so none is overwhelmed, and the system survives a node dying.

- **L4 vs L7**
  - **L4** — routes on IP/port (TCP/UDP). Fast, doesn't inspect the request.
  - **L7** — routes on HTTP content (path, headers, cookies). Smarter routing (path-based, SSL termination), slightly more overhead. *Default choice when you need content-aware routing.*
- **Algorithms:** round robin, weighted round robin, least connections, least response time, IP hash, **consistent hashing** (minimizes reshuffle when nodes join/leave).
- **Health checks** — stop routing to dead nodes automatically.
- **Gotchas:** sticky sessions / session affinity, SSL termination at the LB, and the **LB itself as a SPOF** → solve with active-active or active-passive redundancy.
- **Stateless app servers** are what make LB failover invisible: any server handles any request, so a node death just gets removed from rotation.
- **Examples:** NGINX, HAProxy, AWS ALB (L7) / NLB (L4).

---

## 3. Building Block — Caching

**Job:** keep frequently accessed data faster/closer to cut latency and offload the backend. Headline metric: **hit ratio**.

- **Where caches live:** browser → CDN (edge) → reverse proxy → app/in-memory → distributed cache (Redis, Memcached) → DB cache.
- **Read patterns:**
  - **Cache-aside (lazy)** — app checks cache; on miss, reads DB and populates cache with a TTL. *Most common.*
  - **Read-through** — cache itself loads from DB on miss.
- **Write patterns:**
  - **Write-through** — write to cache + DB synchronously (consistent, slower writes).
  - **Write-back** — write to cache, flush to DB async (fast, risks data loss).
  - **Write-around** — write to DB only, skip cache (avoids caching write-once data).
- **Eviction:** LRU, LFU, FIFO, TTL.
- **Hard problems:**
  - **Invalidation / staleness** — bound it with TTLs.
  - **Cache stampede / thundering herd** — a hot key not in cache → many simultaneous misses hammer the DB. Mitigate with **request coalescing/locking** (first miss fetches, others wait), **staggered/jittered TTLs**, and **proactive warming**.
  - **Hot keys** — disproportionate traffic to a few keys.

---

## 4. Worked Reference — URL Shortener

### 4.1 Requirements

**Functional**
- Given a long URL, generate a unique short URL.
- Given a short URL, **look up** and redirect to the original long URL.
  - ⚠️ It's a **lookup** (stored mapping `short_code → long_url`), **not** an encode/decode. 7 chars can't reversibly contain a 200-char URL → you need a store, not a reversible algorithm.
- *Optional (surface, ask interviewer, don't commit):* custom aliases, link expiration/TTL, click analytics, access control.

**Non-functional**
- **Low latency** on redirects (e.g. p99 < 100ms) — a slow redirect defeats the purpose.
- **High availability** — the redirect path must almost always be up (AP-leaning in CAP).
- **Durability** — a created mapping must never be silently lost.
- **Read-heavy** — *the* defining property. Justifies caching + read replicas + CDN.
- ⚠️ Caching is a *mechanism*, not an NFR. Don't put solutions in the requirements stage.

**Out of scope**
- Editing a link's destination, full user-account/auth systems, spam/malware URL scanning.

### 4.2 Scale Estimate

Assumptions: 1M active users, ~3 links created/user/day.

- **Writes:** 3M/day ÷ 86,400 ≈ **35 writes/sec avg**, ~**70–100/sec peak** (peak ≈ 2–3× avg).
- **Reads:** at **100:1** read:write → ~**3,500 reads/sec avg**, ~**7k–10k/sec peak**.
  - Why 100:1: a link is created once, then clicked many times by many people. A 2:1 ratio would make the product pointless.
- **Storage:** 3M/day × 365 × 5 ≈ **5.5B records** × ~500 bytes/record ≈ **~2.7 TB** over 5 years → exceeds one node → **shard**.
- 🧮 *Always do an order-of-magnitude sanity check:* 3×10⁶ ÷ ~10⁵ ≈ 3×10¹ ≈ 30/sec. Catches off-by-10× slips.

### 4.3 API Design

**Create**
```
POST /api/v1/urls
Request:  { "long_url": "https://example.com/very/long/path?x=1",
            "custom_alias": "optional", "expires_at": "optional" }
Response: { "short_url": "https://sho.rt/aB3xK9z" }
Status:   201 Created     (409 if a requested custom_alias is taken)
```

**Redirect**
```
GET /{short_code}              e.g. GET /aB3xK9z
Response: HTTP 302 Found
          Location: https://example.com/very/long/path?x=1
```

**301 vs 302 — the classic tradeoff (know this cold):**

| | Browser caches redirect? | Server sees each click? | Can repoint/expire? | Load |
|---|---|---|---|---|
| **301 Permanent** | Yes | ❌ No | ❌ No | Lower |
| **302 Found (temp)** | No | ✅ Yes | ✅ Yes | Higher |

> Default **302**: analytics and repoint/expire are core to a shortener, and the read path is cache-optimized so the extra hits are cheap. Switch to 301 only if analytics aren't needed and you want to shed load.

### 4.4 Data Model

```
short_code   (PK, indexed)   "aB3xK9z"     ← the index IS the redirect lookup
long_url                     "https://example.com/..."
created_at
expires_at   (nullable)
created_by   (nullable, for analytics/ownership)
click_count  (optional, or log clicks to a separate store)
```

- ⚠️ **Don't store the full `short_url`** — domain is constant; reconstruct at response time (`domain + "/" + code`). Saves space across billions of rows; survives domain changes.
- A **custom alias is just a user-chosen `short_code`** — one column, one lookup path. Don't split into separate fields.

**SQL vs NoSQL → NoSQL (key-value store: DynamoDB / Cassandra).**
- Not "because read-heavy" (SQL handles that fine via replicas/caching).
- **Because:** (1) pure **key→value** lookup, no joins/relations/cross-row transactions; (2) needs **horizontal sharding** at ~2.7 TB — shards cleanly on the key via consistent hashing.
- MongoDB works but is document-oriented — overkill for `key→value`.

### 4.5 High-Level Architecture

**Components:** `Client → (CDN/edge for redirects) → ALB (L7) → Stateless App Servers → Redis → (miss) → DB`

**Read path (redirect) — cache-aside:**
1. Check **Redis** for `short_code`.
2. **Hit** → return `long_url` immediately.
3. **Miss** → read DB → **populate Redis with a TTL** → return.
- LRU handles recency internally; TTL bounds staleness.

**Write path (create):**
1. `POST /urls` → ALB → app server.
2. **Generate** `short_code` (unique-by-design — see deep dive).
3. Write `{short_code, long_url, ...}` to DB; **PK constraint** is the collision backstop.
4. *(Optional)* warm the cache with the new mapping.
5. Return `short_url`.
- ⚠️ The write path **does not read the cache**. Caches accelerate reads. Don't use a cache to check uniqueness — it's partial/evicting and tells you nothing about absence.

**Load balancing here:** **L7 (ALB)** — route `POST /urls` vs `GET /{code}` to different pools, SSL-terminate, path-based routing (L4 can't see the path). Health checks + stateless servers make a node death invisible.

### 4.6 Deep Dive — Short Code Generation

**Why 7 chars + base62 (`[a-z A-Z 0-9]`):**
- 62⁷ ≈ **3.5 × 10¹²** (3.5 trillion) vs ~5.5B records → **~640× headroom**.
- Neighbors: 62⁶ ≈ 56B (tight), 62⁵ ≈ 916M (not enough). **6–7 chars is the sweet spot.**

**Strategy — encode a globally-unique number into base62:**
- ✅ **Unique number → base62** → no collisions *by construction* (distinct numbers → distinct codes).
- ❌ **Raw URL hashing** (e.g. MD5 → 7 chars) risks **collisions** (different URLs → same code) and dedupes URLs in ways that break per-user analytics/expiry.

**Where the unique number comes from:**
- **DB auto-increment** — simple, but central bottleneck + SPOF.
- **ID-range allocation** — a service hands each app server a block of IDs (1–1000, 1001–2000…) → no per-request contention.
- **Snowflake IDs** — 64-bit = `timestamp + machine_id + per-machine sequence`. Each machine generates independently, globally unique via differing `machine_id` bits. **Most interview-friendly distributed answer.**
- Subtlety: sequential counters → **guessable** codes. Scramble or use a larger random space if guessability matters.

**Why you never check uniqueness on the hot path:**
- "Generate → read DB to check → write" doubles DB ops **and** has a **race condition** (two servers see "free," both write).
- Fix: **generate unique-by-design → write blindly → let the PK constraint reject the one-in-a-trillion dup → regenerate + retry.** Check on *failure*, never per request.

### 4.7 Bottlenecks & Tradeoffs

**Where it breaks & the scaling move:**
- **App servers** — stateless → scale **horizontally** behind the LB; autoscale on CPU/QPS.
- **Database** — read pressure → **read replicas** + cache; size/writes → **shard** on `short_code` (consistent hashing).
- **Cache** — hot keys / stampede → request coalescing, jittered TTLs, warming; capacity → cluster Redis (sharded/replicated).
- **ID generator** — central counter is the bottleneck/SPOF → **Snowflake** or **pre-allocated ID ranges** (no coordination).

**Consistency tradeoff knowingly made:**
- 302 + caching + AP-leaning availability → accepting **eventual consistency / brief staleness**: a repointed or expired link may serve the old target until its TTL lapses. Acceptable for a shortener; prioritizes uptime + latency over strict freshness.

**Remaining SPOFs & removal:**
- **Load balancer** → redundant LBs (active-active/passive), multi-AZ.
- **ID generator** → decentralize (Snowflake) so no single node is required.
- **Cache** → replication so a node loss doesn't cause a stampede.
- **DB** → replicas + multi-AZ + backups for durability.

---

## 5. Cross-Questions & Answers (interviewer follow-ups)

The design above is the "happy path." Interviews live in the follow-ups. Practice answering these out loud — concise, tradeoff-first.

**Q: Why base62 and not base64?**
A: base64 includes `+`, `/`, and `=`, which aren't URL-safe (they need escaping). base62 (`a–z A–Z 0–9`) is clean in a URL with no encoding. Some systems even drop visually ambiguous chars (`0/O`, `1/l/I`) for human-typability.

**Q: What if two users shorten the *same* long URL — same code or different?**
A: Design choice. **Different codes** (default) keeps per-user analytics, custom expiry, and ownership clean. **Same code** dedupes storage but couples users. I'd default to different codes unless storage dedup is an explicit requirement.

**Q: How do custom aliases coexist with generated codes without collisions?**
A: Same namespace, same PK. On a custom-alias create, attempt the insert; the **PK uniqueness constraint** rejects a taken alias → return **409 Conflict**. Generated codes come from the unique-by-design ID space, so they won't collide with each other; a reserved-prefix or separate length convention can keep generated vs custom from clashing if needed.

**Q: Snowflake IDs depend on the clock — what if a node's clock moves backward (NTP sync)?**
A: A backward clock can produce duplicate IDs. Standard mitigation: the generator **refuses to issue IDs** (waits/errors) while `current_time < last_timestamp`, and you monitor clock drift. Alternative: use ID-range allocation, which doesn't depend on wall-clock time.

**Q: How do you do analytics (click counts) without slowing the redirect?**
A: Never write to the DB synchronously on the hot read path. **Fire an event to a message queue** (Kafka/Kinesis) and return the redirect immediately; a consumer aggregates counts asynchronously. This keeps redirect latency low and decouples analytics load.

**Q: What happens if Redis goes down entirely?**
A: The system **degrades, doesn't fail**: redirects fall through to the DB (higher latency, more DB load). Protect the DB with read replicas, connection limits, and a **circuit breaker**. Replicate/cluster Redis so a single node loss doesn't wipe the cache and trigger a stampede.

**Q: A link goes viral — one code gets millions of hits. How do you handle the hot key?**
A: It's a hot-key + potential stampede problem. Serve it from the **CDN/edge** (redirects are cacheable), keep it in Redis with **request coalescing** on miss and **jittered TTLs**, and optionally pin known-hot keys with no eviction. Reads are idempotent, so edge caching is safe.

**Q: How do you expire links and reclaim space?**
A: Store `expires_at`; the redirect path checks it and returns **410 Gone** if expired. Actual deletion runs as a **background batch/TTL job** (or DB-native TTL in DynamoDB/Cassandra) — never inline on the request.

**Q: Just-created link returns 404 because of read-replica lag — how do you fix it?**
A: Classic **replication lag** read-after-write problem. Options: route reads for *recently created* keys to the **primary**, **read-your-writes** by warming the cache on create (so the creator's immediate read hits cache), or accept brief eventual consistency given the AP lean.

**Q: How do you prevent abuse — malicious URLs, spam, scraping?**
A: **Rate limiting** at the API gateway (token bucket per IP/user), URL **validation** + optional safe-browsing/malware checks on create (async, can quarantine), and auth for high-volume API clients.

**Q: How do you scale to global users with low latency?**
A: **Multi-region** deployment with GeoDNS routing users to the nearest region, **CDN at the edge** for redirects, and regional cache + read replicas. Writes can stay in a primary region (writes are rare here) with async cross-region replication.

**Q: You picked 302 for analytics — what's the cost, and when would 301 be right?**
A: 302 means every click hits the origin → more load (acceptable, since the read path is cache/CDN-optimized). 301 is right only when you **don't need analytics or repoint/expire** and want the browser to cache the redirect to shed load. Tie the choice to requirements, not habit.

**Q: How do you guarantee a given short_code always lands on the same shard?**
A: Shard by **consistent hashing on `short_code`** — the same key always maps to the same shard, and adding/removing shards reshuffles only a fraction of keys. The lookup and the write both hash the same key, so they agree.

---

## 6. Reusable Principles (the part that transfers)

- **Requirements & scale drive the design** — don't architect before you've sized.
- **Order-of-magnitude sanity-check every estimate** — powers of 10 catch off-by-N errors.
- **Pick the read:write ratio deliberately and defend it** — it dictates the whole read-optimization story.
- **Never trust a cache for correctness** — it's partial and evicting; correctness lives in the source of truth.
- **Push correctness to the right layer** — generate IDs unique-by-design; let the PK constraint be the backstop, not a per-request check.
- **Storage = record count × size per record** — records aren't bytes; always carry the unit.
- **Choose SQL vs NoSQL by access pattern, not by buzzword** — key→value + sharding → NoSQL; relations/transactions → SQL.
- **Name tradeoffs out loud and tie them back to requirements** (301 vs 302, AP vs CP) — that's what separates strong answers.
- **Stateless app servers** make horizontal scaling and LB failover trivial.

---

## 7. Resources

- **System Design Interview, Vol 1 & 2** — Alex Xu (URL shortener is a chapter).
- **The System Design Primer** — donnemartin (GitHub, free, great for building blocks).
- **Designing Data-Intensive Applications** — Martin Kleppmann (deeper: caching, partitioning, consistency).
- **ByteByteGo** — Alex Xu's visual explainers for these exact blocks.

---

## 8. Related Concepts to Revise

Adjacent topics that kept brushing against this design. Revise these next — they're the building blocks for the *next* problems.

**Consistency & distribution**
- **CAP theorem** and **PACELC** (the "else, latency vs consistency" extension).
- Consistency models: **strong vs eventual**, read-your-writes, monotonic reads.
- **Idempotency** (why GET/redirect is safe to retry; idempotency keys for writes).

**Data layer**
- **Consistent hashing** (deeper — virtual nodes, rebalancing).
- **Sharding / partitioning** strategies (range vs hash vs directory).
- **Replication** (leader-follower, multi-leader, quorum reads/writes) and **replication lag**.
- Storage internals: **B-trees vs LSM-trees** (why Cassandra/Dynamo write fast), indexing.
- **NoSQL data modeling** for DynamoDB/Cassandra (partition key + sort key design).

**Caching & edge**
- Cache patterns recap (cache-aside / read-through / write-through / write-back / write-around).
- **Cache stampede / thundering herd** mitigations (coalescing, jitter, warming).
- **CDN internals** (edge caching, cache-control headers, invalidation).
- **Bloom filters** — fast "does this key probably exist?" to avoid pointless DB hits.

**Traffic & resilience**
- **Load balancing** recap (L4 vs L7, algorithms, health checks).
- **Rate limiting** algorithms (token bucket, leaky bucket, sliding window).
- **Circuit breakers**, retries with backoff, **backpressure**, graceful degradation.
- **API gateways** and reverse proxies.

**Async & scale-out**
- **Message queues / streaming** (Kafka, SQS/Kinesis) for async analytics and decoupling.
- **Distributed unique ID generation** (Snowflake, ticket servers, ID-range allocation, UUIDs).
- **Multi-region** architecture and GeoDNS.

**Operability**
- **Observability**: metrics, structured logging, distributed tracing.
- SLAs / SLOs / SLIs; the meaning of "p99 latency" and "five nines."