# Backend System Design — Marketplace Platform

> Resume project: **Lystant** — marketplace platform where sellers list items, buyers purchase via intermediaries (lystants), with secure payments and pickup/delivery management.
>
> Cross-link: [Payment System](../04-PaymentSystem/notes.md) · [Notification Service](../03-NotificationService/notes.md) · [Rate Limiter](../02-RateLimiter/notes.md)

---

## 1. Problem statement

Design a marketplace where:

- **Sellers** (individuals + businesses) list items for sale
- **Buyers** browse, search, purchase
- **Intermediaries** ("lystants") manage deals — handle pickup/delivery, payment escrow, dispute resolution
- **Secure payments** with escrow (released on delivery)
- **Search + filter** (by category, location, price, ratings)
- **Ratings + reviews** for sellers + lystants
- **Disputes** resolution workflow
- **Multi-currency + multi-region** support

Comparable: eBay, Amazon Marketplace, Etsy, Mercari, OfferUp.

---

## 2. Requirements

### 2.1 Functional

- Seller: create/edit/delete listing; manage inventory
- Buyer: search, view, save, purchase
- Lystant: claim deal, coordinate, mark delivered
- Order lifecycle: created → paid (escrow) → in-transit → delivered → released
- Ratings + reviews
- Messaging between buyer/seller/lystant
- Disputes + admin tools
- Notifications throughout

### 2.2 Non-functional

- **Scale:** 10M users, 100k listings, 1k orders/sec peak
- **Search latency:** < 200ms p95
- **Inventory consistency:** never oversell
- **Payments:** never lose money, never double-charge (see [Payment System](../04-PaymentSystem/notes.md))
- **Availability:** 99.95%
- **Multi-region:** localized listings (geo-search)
- **Mobile-first:** image-heavy; bandwidth-aware

---

## 3. Service decomposition

```
                        ┌──────────────────────────┐
                        │   API Gateway / BFF       │
                        └───┬──────────────────────┘
                            │
        ┌──────────┬────────┼────────┬──────────────┐
        ▼          ▼        ▼        ▼              ▼
    ┌────────┐ ┌────────┐ ┌──────┐ ┌──────────┐ ┌────────┐
    │ Catalog│ │ Search │ │Order │ │ Payment  │ │ Reviews│
    │  svc   │ │  svc   │ │ svc  │ │  svc     │ │  svc   │
    └────────┘ └────────┘ └──┬───┘ └────┬─────┘ └────────┘
                              │           │
                              │           │
                       ┌──────▼─────┐ ┌───▼──────┐
                       │ Inventory  │ │ Escrow   │
                       │   svc      │ │  svc     │
                       └────────────┘ └──────────┘
                              │
                       ┌──────▼──────┐
                       │ Logistics   │  (Lystant
                       │   svc       │   coordination)
                       └─────────────┘
        ┌──────────┐ ┌────────┐ ┌────────┐ ┌─────────────┐
        │ User     │ │ Notif  │ │ Msg    │ │ Disputes    │
        │ Profile  │ │  svc   │ │ svc    │ │  svc        │
        └──────────┘ └────────┘ └────────┘ └─────────────┘
```

Each service owns its own DB. Services communicate via REST (synchronous) or Kafka (asynchronous events).

### 3.1 Why microservices here?

- Independent scaling — Search needs more capacity than Reviews
- Different storage needs — Catalog wants Postgres + S3, Search wants Elasticsearch
- Independent deployment — payment changes need separate caution
- Team boundaries (Conway's Law) — different teams own different services

For small/early stage, **start as a modular monolith**, split later when boundaries are clear.

---

## 4. Data model — core entities

### 4.1 Catalog (Postgres)

```sql
CREATE TABLE listings (
  id           UUID PRIMARY KEY,
  seller_id    UUID NOT NULL,
  title        VARCHAR(200) NOT NULL,
  description  TEXT,
  category_id  UUID NOT NULL,
  price_cents  BIGINT NOT NULL,
  currency     CHAR(3) NOT NULL,
  condition    VARCHAR(20),                  -- new | like_new | good | fair | poor
  status       VARCHAR(20) DEFAULT 'draft',  -- draft | active | sold | removed | suspended
  location     GEOGRAPHY(POINT),             -- PostGIS for geo
  shipping_options JSONB,
  inventory    INT DEFAULT 1,                -- can model as separate table for >1
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX listings_seller_idx ON listings(seller_id);
CREATE INDEX listings_status_idx ON listings(status) WHERE status = 'active';
CREATE INDEX listings_location_idx ON listings USING GIST(location);

CREATE TABLE listing_images (
  listing_id  UUID NOT NULL,
  url         VARCHAR(500) NOT NULL,
  thumbnail   VARCHAR(500),
  position    INT NOT NULL,
  PRIMARY KEY (listing_id, position)
);
```

### 4.2 Orders

```sql
CREATE TABLE orders (
  id          UUID PRIMARY KEY,
  buyer_id    UUID NOT NULL,
  seller_id   UUID NOT NULL,
  lystant_id  UUID,                           -- nullable, assigned later
  listing_id  UUID NOT NULL,
  quantity    INT DEFAULT 1,
  amount_cents BIGINT NOT NULL,
  currency    CHAR(3) NOT NULL,
  status      VARCHAR(20) NOT NULL,           -- pending | paid | in_transit | delivered | released | disputed | cancelled | refunded
  shipping    JSONB,
  payment_intent_id VARCHAR(100),             -- Stripe reference
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX orders_buyer_idx ON orders(buyer_id, created_at DESC);
CREATE INDEX orders_seller_idx ON orders(seller_id, status);
CREATE INDEX orders_lystant_idx ON orders(lystant_id, status);
```

### 4.3 Reviews

```sql
CREATE TABLE reviews (
  id           UUID PRIMARY KEY,
  order_id     UUID NOT NULL,
  reviewer_id  UUID NOT NULL,
  reviewee_id  UUID NOT NULL,
  role         VARCHAR(20),    -- "seller_rating" | "buyer_rating" | "lystant_rating"
  rating       INT NOT NULL,    -- 1-5
  comment      TEXT,
  created_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE(order_id, reviewer_id, role)
);

CREATE INDEX reviews_reviewee_idx ON reviews(reviewee_id);
```

Denormalized aggregate stored on user profile:

```sql
ALTER TABLE users ADD COLUMN avg_rating NUMERIC(2,1);
ALTER TABLE users ADD COLUMN review_count INT;
```

Updated via Kafka event on review insert.

---

## 5. Search — Elasticsearch

Postgres `LIKE` queries on 100k+ listings won't scale. Use Elasticsearch.

### 5.1 Index

```json
PUT /listings
{
  "mappings": {
    "properties": {
      "id": { "type": "keyword" },
      "title": {
        "type": "text",
        "analyzer": "english",
        "fields": { "raw": { "type": "keyword" } }
      },
      "description": { "type": "text", "analyzer": "english" },
      "category_id": { "type": "keyword" },
      "price_cents": { "type": "long" },
      "currency": { "type": "keyword" },
      "condition": { "type": "keyword" },
      "status": { "type": "keyword" },
      "seller_id": { "type": "keyword" },
      "seller_rating": { "type": "float" },
      "location": { "type": "geo_point" },
      "created_at": { "type": "date" },
      "image_url": { "type": "keyword", "index": false }
    }
  }
}
```

### 5.2 Indexing pipeline

Catalog service emits events on listing changes → Kafka → indexer consumes → updates ES.

```ts
catalogService.on("listing.upserted", (listing) => {
  kafka.send("listings.changes", listing);
});

// Indexer consumer
consumer.on("listings.changes", async (msg) => {
  const listing = JSON.parse(msg.value);
  if (listing.status === "removed") {
    await es.delete({ index: "listings", id: listing.id });
  } else {
    await es.index({
      index: "listings",
      id: listing.id,
      body: enrichForIndex(listing),
    });
  }
});
```

Eventually consistent — small delay between change and searchability. Acceptable for marketplaces.

### 5.3 Search query

```ts
async function search({ q, category, minPrice, maxPrice, near, radiusKm, sort, page }) {
  const must = [];
  if (q) must.push({ multi_match: { query: q, fields: ["title^3", "description"] } });
  if (category) must.push({ term: { category_id: category } });
  const filter = [{ term: { status: "active" } }];
  if (minPrice != null) filter.push({ range: { price_cents: { gte: minPrice } } });
  if (maxPrice != null) filter.push({ range: { price_cents: { lte: maxPrice } } });
  if (near) filter.push({
    geo_distance: { distance: `${radiusKm}km`, location: near },
  });

  const sortOption = {
    relevance: ["_score"],
    newest: [{ created_at: "desc" }],
    price_asc: [{ price_cents: "asc" }],
    price_desc: [{ price_cents: "desc" }],
    rating: [{ seller_rating: "desc" }],
  }[sort] ?? ["_score"];

  return es.search({
    index: "listings",
    body: {
      query: { bool: { must, filter } },
      sort: sortOption,
      from: (page - 1) * 20,
      size: 20,
    },
  });
}
```

### 5.4 Autocomplete

Separate index optimized for type-ahead. Use ES's `completion` suggester or n-gram analyzer.

---

## 6. Inventory & "never oversell"

The most subtle correctness problem. Race conditions on hot items cause overselling.

### 6.1 Single-item listings

For unique items (used goods), `inventory = 1`. The first buyer wins. Two-step:

```ts
async function purchase(listingId, buyerId) {
  return db.tx(async (tx) => {
    const listing = await tx.one("SELECT * FROM listings WHERE id=$1 FOR UPDATE", [listingId]);
    if (listing.status !== "active") throw new Conflict("Not available");
    
    await tx.none("UPDATE listings SET status='sold' WHERE id=$1", [listingId]);
    const order = await tx.one("INSERT INTO orders(...) VALUES (...) RETURNING *", [...]);
    return order;
  });
}
```

`SELECT FOR UPDATE` locks the row; concurrent attempts block until the first transaction commits.

### 6.2 Multi-quantity listings (e.g., wholesaler)

```sql
CREATE TABLE inventory_holds (
  id          UUID PRIMARY KEY,
  listing_id  UUID NOT NULL,
  quantity    INT NOT NULL,
  buyer_id    UUID NOT NULL,
  expires_at  TIMESTAMP NOT NULL,
  status      VARCHAR(20)            -- held | committed | released | expired
);
```

```
1. Buyer initiates: create hold (status=held, expires=now+10min), decrement listing.available
2. Buyer pays: commit hold, create order
3. Buyer abandons: hold expires, cron releases (increment available)
```

This is what eBay / Shopify do for high-traffic items.

### 6.3 Stock-keeping atomicity

Use Postgres `UPDATE ... WHERE inventory >= $qty` — only succeeds if enough; check rowcount:

```ts
const result = await tx.result(
  "UPDATE listings SET inventory = inventory - $1 WHERE id=$2 AND inventory >= $1 AND status='active'",
  [qty, listingId]
);
if (result.rowCount === 0) throw new Conflict("Out of stock");
```

Race-free — Postgres handles the lock internally for `UPDATE`.

---

## 7. Order lifecycle (saga)

```
   buyer clicks "Buy"
        ↓
   ┌────────────┐
   │  pending   │  (order created, payment intent created)
   └─────┬──────┘
         │  buyer completes payment (Stripe)
         ▼
   ┌────────────┐
   │   paid     │  (funds in escrow account)
   └─────┬──────┘
         │  lystant claims + arranges pickup
         ▼
   ┌────────────┐
   │ in_transit │
   └─────┬──────┘
         │  delivery confirmed (lystant marks + buyer confirms or auto after N days)
         ▼
   ┌────────────┐
   │ delivered  │  (3-day window for buyer to dispute)
   └─────┬──────┘
         │  no dispute
         ▼
   ┌────────────┐
   │  released  │  (escrow released; seller paid; lystant fee paid)
   └────────────┘

Branches:
   - cancellation pre-payment → cancelled
   - payment fails → cancelled, inventory restored
   - dispute opens → disputed → admin review → resolved/refunded
```

Implemented as a saga orchestrator (Temporal or AWS Step Functions). Each state transition is an event that triggers next steps.

### 7.1 Transition handlers

```ts
async function onPaymentSucceeded(event) {
  await orderService.markPaid(event.orderId);
  await escrowService.creditEscrow(event.orderId, event.amount);
  await notificationService.notify(event.sellerId, "ORDER_PAID", { orderId: event.orderId });
  await logisticsService.publishToLystantQueue(event.orderId);
}

async function onDelivered(event) {
  await orderService.markDelivered(event.orderId);
  await scheduleAutoRelease(event.orderId, addDays(new Date(), 3));   // 3-day dispute window
}

async function onReleased(event) {
  await escrowService.releaseToSeller(event.orderId);
  await escrowService.releaseToLystant(event.orderId);
  await notificationService.notify(event.buyerId, "ORDER_COMPLETE", { orderId: event.orderId });
}
```

### 7.2 Compensation

Inventory reservation: release if payment fails or order cancelled.
Escrow credit: only ever moves *out* via release or refund — never deleted (audit).

---

## 8. Lystant coordination

When an order needs delivery, available lystants in the buyer's area are notified to bid/claim.

### 8.1 Job queue

```sql
CREATE TABLE lystant_jobs (
  id          UUID PRIMARY KEY,
  order_id    UUID NOT NULL,
  status      VARCHAR(20),   -- open | claimed | in_progress | completed
  lystant_id  UUID,
  location    GEOGRAPHY(POINT),
  reward_cents BIGINT,
  expires_at  TIMESTAMP
);
```

### 8.2 Geo-aware matching

```sql
-- Find lystants within 10km of pickup
SELECT id, ST_Distance(location, ST_GeographyFromText('POINT($lon $lat)')) AS dist
FROM lystants
WHERE status='available'
  AND ST_DWithin(location, ST_GeographyFromText('POINT($lon $lat)'), 10000)
ORDER BY dist
LIMIT 50;
```

Publish to those lystants via push notification + WebSocket; first to accept claims the job.

### 8.3 First-come-first-serve claim

Race condition: two lystants tap "accept" simultaneously. Postgres lock:

```ts
async function claimJob(jobId, lystantId) {
  return db.tx(async (tx) => {
    const job = await tx.one(
      "SELECT * FROM lystant_jobs WHERE id=$1 AND status='open' FOR UPDATE",
      [jobId]
    );
    if (job.status !== "open") throw new Conflict("Job no longer available");
    await tx.none(
      "UPDATE lystant_jobs SET status='claimed', lystant_id=$1 WHERE id=$2",
      [lystantId, jobId]
    );
    return tx.one("SELECT * FROM lystant_jobs WHERE id=$1", [jobId]);
  });
}
```

`FOR UPDATE` ensures only one transaction succeeds.

---

## 9. Messaging

In-app chat between buyer/seller/lystant.

### 9.1 Schema

```sql
CREATE TABLE conversations (
  id           UUID PRIMARY KEY,
  order_id     UUID NOT NULL,
  participants UUID[] NOT NULL,
  created_at   TIMESTAMP DEFAULT NOW(),
  last_msg_at  TIMESTAMP
);

CREATE TABLE messages (
  id              UUID PRIMARY KEY,
  conversation_id UUID NOT NULL,
  sender_id       UUID NOT NULL,
  body            TEXT NOT NULL,
  attachments     JSONB,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at);
```

### 9.2 Live delivery

WebSocket / SSE for active conversations. See [Notification Service](../03-NotificationService/notes.md) for cross-channel notifications.

### 9.3 Moderation

- Filter PII (phone numbers, emails) — encourages off-platform deals which evade fees
- Profanity / threat detection
- Report button → escalates to admins
- ML classifier flags suspicious patterns ("come to my house at 9pm")

---

## 10. Disputes

```
   buyer reports problem
        ↓
   ┌────────────┐
   │  filed     │ → notify seller + lystant
   └─────┬──────┘
         │  parties exchange evidence
         ▼
   ┌────────────┐
   │ in_review  │ → admin investigates
   └─────┬──────┘
         │  decision
         ▼
   ┌─────────────┬─────────────┐
   │ refund      │ split       │
   │ buyer       │ resolution  │
   └─────────────┴─────────────┘
```

Decisions create ledger entries that reverse / partially-reverse the escrow.

---

## 11. Image / asset handling

Listings have 1-10 photos. Mobile-friendly delivery is critical.

### 11.1 Upload flow

```
1. App requests pre-signed S3 URL (per image)
2. App uploads directly to S3 (see File Upload UI for resumable patterns)
3. S3 event triggers Lambda → generate thumbnails (256, 512, 1024)
4. Update listing record with image URLs
```

### 11.2 Delivery

- CloudFront / Cloudflare in front of S3
- Responsive images: `<img srcset="...">` with multiple sizes
- AVIF + WebP with JPEG fallback
- Lazy-load below the fold

---

## 12. Localization & multi-region

- Listings localized (title, description) for international sellers — translation service or seller-provided
- Currency conversion at display time (lock at checkout)
- Geo-search: respect user's location for relevance + shipping eligibility
- Multi-region DB: shard by region for write locality; read replicas global

---

## 13. Fraud & abuse

| Risk | Mitigation |
|------|------------|
| Stolen-item listings | KYC for sellers; ML on listing photos vs known-stolen |
| Fake listings (scam) | Velocity caps on new sellers; mandatory escrow |
| Payment fraud | Stripe Radar; chargeback monitoring |
| Account takeover | 2FA; suspicious-login alerts |
| Off-platform deal evasion (no fees) | Message PII filtering; rating bonus for in-platform |
| Review fraud | Verified-purchase only reviews; ML cluster detection |

---

## 14. Trade-off matrix

| Decision | Option A | Option B | Choice + Why |
|----------|----------|----------|--------------|
| Architecture | Monolith | Microservices | **Modular monolith → microservices as scale demands** |
| Storage | Single DB | Per-service DB | **Per-service** for independent scaling |
| Search | Postgres LIKE | Elasticsearch | **Elasticsearch** — beyond ~10k listings |
| Inventory | Soft check | Pessimistic lock | **Pessimistic (`FOR UPDATE`)** — never oversell |
| Order orchestration | Choreography | Orchestration (saga) | **Orchestration (Temporal)** — explicit, debuggable |
| Escrow | Same-service ledger | Dedicated svc | **Dedicated svc** — payment isolation |
| Images | Through API | Direct to S3 | **Direct to S3** — cost + latency |
| Reviews | Synchronous | Async aggregate | **Async aggregate** — avoid hot keys |
| Notifications | Inline | Dedicated svc | **Dedicated svc** (see Notification Service) |

---

## 15. Failure modes

| Failure | Mitigation |
|---------|------------|
| Payment provider down | Allow checkout to queue; retry async; UI shows "Processing" |
| ES down | Fall back to Postgres `LIKE` for basic search; degraded UX, no crash |
| Inventory race | DB lock; tested with chaos suite |
| Lystant doesn't respond | Auto-reassign after timeout; escalate to admin |
| Disputed and parties go silent | Admin review window; auto-decision after N days |
| Buyer/seller fraud | KYC required; blocklist; manual review for high-value |
| Image upload partial | Resumable upload (see File Upload UI); orphan cleanup cron |

---

## 16. Interview talking points

**Q: "How do you prevent overselling?"**
A: Postgres `SELECT FOR UPDATE` on the listing row when accepting a purchase. For multi-quantity items, atomic `UPDATE inventory SET qty = qty - $1 WHERE id=$2 AND qty >= $1` — if rowcount = 0, it's out of stock. Single transaction handles both inventory decrement and order creation. Race-free.

**Q: "Escrow — how does it work?"**
A: Funds debit from buyer at checkout, credited to a dedicated `escrow_account` (a normal ledger account in our system; the actual money sits with Stripe in our connected account or our bank's clearing account). On delivery confirmation + dispute window expiry, ledger entries transfer from escrow to seller account (minus platform fee + lystant fee). Disputes pause the auto-release. Refunds reverse via compensating entries. See [Payment System](../04-PaymentSystem/notes.md) for the ledger pattern.

**Q: "Why microservices?"**
A: Different services have very different scaling profiles — Search is read-heavy and needs ES; Payment must be SOC-2 isolated; Notifications need queue capacity for blasts. Microservices let teams scale and deploy independently. We started Lystant as a modular monolith (one DB, modular code) and split out services as the org grew. Don't start with microservices unless you must.

**Q: "Search performance — Postgres or ES?"**
A: ES once you cross ~10k listings or need faceted filtering + fulltext + geo all together. ES handles compound queries (e.g., "wireless headphones under $50 within 10km of my zip, rated 4+") at sub-100ms; Postgres with all the indexes still struggles. Trade-off: eventual consistency between Catalog DB and ES (~seconds). Acceptable.

**Q: "How do you match lystants to orders?"**
A: PostGIS for geo-indexed lookups. Query: lystants within radius R of pickup point, available status, ordered by distance. Notify the top 50 via push + WS. First to accept claims the job (Postgres `FOR UPDATE` race protection). Higher-rated lystants get a small relevance boost.

**Q: "Reviews — how to prevent fake reviews?"**
A: (1) Reviews only allowed on verified completed orders. (2) ML model flags suspicious clusters (same IP block, same writing style, sudden burst). (3) Public display includes verified-purchase badge. (4) Sellers can dispute reviews to admin. (5) Adjust rating weight by reviewer's own history.

**Q: "Order lifecycle — choreography or orchestration?"**
A: Orchestration via Temporal. Explicit state machine — pending → paid → in_transit → delivered → released. Each transition is a clear function with compensation. Choreography (services emit events, others listen) is decoupled but hard to debug — when an order is stuck, finding *why* requires tracing across N services. Orchestration centralizes the workflow.

**Q: "What's the riskiest part of a marketplace?"**
A: Trust. New buyer, new seller, new lystant — none has reputation yet. Mitigations: mandatory escrow for everyone in the first N transactions; KYC; explicit dispute process; insurance/buyer protection program; gradual trust accrual (verified-payments, age-of-account, ratings). Without strong trust infrastructure, marketplaces fail to thousands of "I never received my item" claims.

**Q: "How do you handle abandoned carts and partial state?"**
A: Inventory holds with TTL (10 min). If buyer never completes payment, hold expires → cron releases inventory → listing back to active. Order in `pending` state for ≥1h auto-cancels. Buyer can return and start a new order. Stripe payment intents we cancel via API. Never let resources stay reserved indefinitely.

---

## 17. Diagram

```
                                      ┌─────────────────┐
                                      │   Frontend       │
                                      │   (Web + Mobile) │
                                      └────────┬─────────┘
                                               │
                                               ▼
                                      ┌──────────────────┐
                                      │  API Gateway     │
                                      │  (BFF + auth)    │
                                      └────────┬─────────┘
                                               │
              ┌───────────┬───────────┬────────┴────────┬───────────┬───────────┐
              ▼           ▼           ▼                 ▼           ▼           ▼
        ┌─────────┐ ┌──────────┐ ┌────────┐    ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Catalog │ │  Search  │ │ Order  │    │ Payment  │ │ Reviews  │ │  User    │
        │  svc    │ │  (ES)    │ │  svc   │    │  svc     │ │  svc     │ │  Profile │
        └────┬────┘ └──────────┘ └───┬────┘    └────┬─────┘ └──────────┘ └──────────┘
             │     ▲                  │             │
             │ idx │                  │             ▼
             ▼     │             ┌────▼────────┐ ┌─────────┐
        ┌─────────┐│             │ Inventory   │ │ Escrow  │
        │ Kafka   ├┘             │   svc       │ │  svc    │
        │ events  │               └─────────────┘ └────┬────┘
        └─────────┘                                    │ (Stripe)
                                                       ▼
              ┌──────────┐                       ┌──────────┐
              │ Logistics│   ←─ messages ─→      │ Notif    │
              │   svc    │                       │  svc     │
              └────┬─────┘                       └──────────┘
                   ▼
              ┌──────────┐         ┌──────────┐
              │ Lystant  │         │ Disputes │
              │ workers  │         │  svc     │
              └──────────┘         └──────────┘
```

---

## 18. Cross-links

- [Payment System](../04-PaymentSystem/notes.md) — ledger, escrow, payouts
- [Notification Service](../03-NotificationService/notes.md) — order notifications
- [Rate Limiter](../02-RateLimiter/notes.md) — protect against scraping listings
- [URL Shortener](../01-URLShortener/notes.md) — short URLs for shared listings
- [File Upload UI](../../../frontend/core-concepts/frontend-system-design-practice/practice-questions/8-FileUploadUI/notes.md) — listing image uploads
- [Node.js notes](../../../backend/nodejs/notes.md) — circuit breaker, BullMQ for job queue
- [General system design](../../general/notes.txt) — saga pattern, sharding strategies
