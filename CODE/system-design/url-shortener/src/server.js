const express = require("express");
const path = require("path");
const { Store } = require("./store");
const { IdAllocator } = require("./idgen");
const { encode } = require("./base62");
const { LRUCache } = require("./cache");
const { TokenBucket, rateLimitMiddleware } = require("./ratelimiter");
const { ClickAnalytics } = require("./analytics");

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const RESERVED = new Set([
  "api", "admin", "login", "logout", "signup", "register",
  "stats", "shorten", "health", "_", "favicon.ico",
]);

function validateUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new HttpError(400, "Invalid URL"); }
  if (!["http:", "https:"].includes(u.protocol)) throw new HttpError(400, "Only http/https supported");
  return u.toString();
}

function validateAlias(alias) {
  if (!/^[A-Za-z0-9_-]{3,30}$/.test(alias)) throw new HttpError(400, "Invalid alias (alphanumeric, _, -, 3-30 chars)");
  if (RESERVED.has(alias.toLowerCase())) throw new HttpError(400, "Reserved alias");
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function createApp() {
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  const store = new Store();
  const idgen = new IdAllocator(store, 10_000);
  const cache = new LRUCache({ max: 10_000, ttlMs: 600_000 });
  const analytics = new ClickAnalytics(store);

  // Two rate limit buckets — distinct policies per endpoint
  const shortenBucket = new TokenBucket({ capacity: 10, refillPerSec: 10 / 60 });    // 10/min per IP
  const resolveBucket = new TokenBucket({ capacity: 200, refillPerSec: 100 });        // 100/sec per IP

  const ipKey = (req) => req.ip || req.headers["x-forwarded-for"] || "unknown";

  app.use((req, res, next) => {
    res.setHeader("X-Service", "url-shortener");
    next();
  });

  // Health
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Shorten
  app.post("/shorten",
    rateLimitMiddleware(shortenBucket, ipKey),
    async (req, res) => {
      try {
        const { url, customAlias, userId, expiresAt } = req.body || {};
        if (!url) throw new HttpError(400, "Missing url");
        const validated = validateUrl(url);

        // Dedup: same URL by same user returns existing
        const existing = await store.findByLongUrl(validated, userId ?? null);
        if (existing) {
          return res.json({ shortCode: existing.short_code, shortUrl: `${BASE_URL}/${existing.short_code}`, deduplicated: true });
        }

        let shortCode;
        if (customAlias) {
          validateAlias(customAlias);
          shortCode = customAlias;
        } else {
          const id = await idgen.next();
          shortCode = encode(id);
        }

        try {
          await store.insertOne({ shortCode, longUrl: validated, userId, expiresAt });
        } catch (e) {
          if (e.code === "DUPLICATE_SHORT_CODE" && customAlias) throw new HttpError(409, "Alias taken");
          throw e;
        }

        return res.status(201).json({ shortCode, shortUrl: `${BASE_URL}/${shortCode}` });
      } catch (e) {
        if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
        console.error(e);
        return res.status(500).json({ error: "Internal" });
      }
    }
  );

  // Stats
  app.get("/:code/stats", async (req, res) => {
    const row = await store.findByCode(req.params.code);
    if (!row) return res.status(404).json({ error: "Not found" });
    return res.json({
      shortCode: row.short_code,
      longUrl: row.long_url,
      clickCount: row.click_count,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    });
  });

  // Resolve / redirect
  app.get("/:code",
    rateLimitMiddleware(resolveBucket, ipKey),
    async (req, res) => {
      const code = req.params.code;
      if (code.includes(".")) return res.status(404).end();    // ignore favicon etc

      try {
        const longUrl = await cache.getOrLoad(`u:${code}`, async () => {
          const row = await store.findByCode(code);
          if (!row || !row.is_active) return null;
          if (row.expires_at && row.expires_at < Date.now()) return null;
          return row.long_url;
        });

        if (!longUrl) {
          // negative-cache 404s briefly to dampen probing
          cache.set(`u:${code}`, "__404__", 60_000);
          return res.status(404).send("Not found");
        }
        if (longUrl === "__404__") return res.status(404).send("Not found");

        // Fire-and-forget click tracking
        analytics.record(code);

        // 302 to preserve click analytics (see notes — 301 is also valid)
        res.setHeader("Cache-Control", "private, max-age=60");
        return res.redirect(302, longUrl);
      } catch (e) {
        console.error(e);
        return res.status(500).end();
      }
    }
  );

  // Graceful shutdown hook
  app.locals.shutdown = async () => {
    await analytics.shutdown();
    store.close();
  };

  return app;
}

if (require.main === module) {
  createApp().then((app) => {
    const server = app.listen(PORT, () => {
      console.log(`url-shortener listening on ${BASE_URL}`);
    });
    const shutdown = async (signal) => {
      console.log(`\nReceived ${signal}, shutting down...`);
      server.close(async () => {
        await app.locals.shutdown();
        process.exit(0);
      });
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  });
}

module.exports = { createApp };
