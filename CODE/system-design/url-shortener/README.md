# URL Shortener — Reference Implementation

Reference Node.js implementation for the system-design case study at [NOTES/system-design/backend-system-design/01-URLShortener/notes.md](../../../NOTES/system-design/backend-system-design/01-URLShortener/notes.md).

Zero external services required — uses SQLite (file) for storage and an in-memory LRU for cache. Drops into Redis trivially by swapping the cache module.

## What it demonstrates

- **Base62 short-code generation** with batch ID allocation
- **Counter range allocation** (each Node process pulls 10k IDs at a time)
- **Multi-layer caching** (in-memory LRU → SQLite)
- **Request coalescing** to prevent cache stampede
- **Token-bucket rate limiting** (per-IP for `/shorten`, per-IP for `/:code`)
- **Click analytics** with batched counter updates
- **Custom alias support** with reserved-words blocklist
- **TTL / expiry** with auto-404
- **Idempotent shorten** by `(longUrl, userId)` hash

## Run

```bash
cd CODE/system-design/url-shortener
npm install
npm start          # listens on http://localhost:3000
```

## Demo

```bash
# In another terminal:
npm run demo
```

The demo script creates 5 short URLs, resolves each, prints analytics.

## Try by hand

```bash
# Shorten a URL
curl -X POST http://localhost:3000/shorten \
  -H "Content-Type: application/json" \
  -d '{"url":"https://anthropic.com","customAlias":"claude"}'
# → { "shortCode": "claude", "shortUrl": "http://localhost:3000/claude" }

# Resolve
curl -i http://localhost:3000/claude
# → HTTP/1.1 301 Moved Permanently
#   Location: https://anthropic.com

# Stats
curl http://localhost:3000/claude/stats
# → { "shortCode": "claude", "clickCount": 1, "createdAt": ... }
```

## Run tests

```bash
npm test
```

Tests cover: Base62 encoder, counter allocator, LRU cache, request coalescing.

## File layout

```
src/
├── server.js          Express app + routes
├── base62.js          Base62 encode/decode
├── idgen.js           Batch counter allocator
├── store.js           SQLite-backed URL storage
├── cache.js           In-memory LRU with request coalescing
├── ratelimiter.js     Token bucket
├── analytics.js       Batched click counter
├── demo.js            CLI demo script
└── *.test.js          Unit tests
```

## Switching to Redis

Replace `cache.js` with a thin Redis wrapper (`redis.get`, `redis.set`), keep the same interface (`get`, `set`, `del`). Tests and server code remain unchanged.

## Switching to PostgreSQL / DynamoDB

`store.js` exposes a small interface (`findByCode`, `insertOne`, `incrementClicks`, `findByLongUrlHash`). Swap the SQLite impl with a Postgres/DynamoDB driver — server code is storage-agnostic.

## What's NOT included (production gaps)

- Multi-region replication
- Edge caching (CDN)
- Kafka for click events (just an in-process buffer here)
- Malicious-URL screening (Google Safe Browsing API)
- Authentication / user accounts (open shortener for demo)
- Geo-IP for analytics
- HTTPS / TLS (run behind a reverse proxy)
- Horizontal counter range coordination (single-process here)

These are discussed in the design note.
