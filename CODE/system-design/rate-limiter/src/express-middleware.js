const { TokenBucket } = require("./token-bucket");

/**
 * Drop-in Express middleware backed by an injected limiter (TokenBucket /
 * SlidingWindowLog / etc — anything with a tryAcquire(key) method).
 *
 * Sets IETF RateLimit-* response headers; returns 429 with Retry-After on reject.
 */
function rateLimit({ limiter, keyGen, cost = 1, headerNamePrefix = "RateLimit", limit }) {
  if (!limiter || typeof limiter.tryAcquire !== "function") {
    throw new Error("limiter is required and must implement tryAcquire()");
  }
  if (!keyGen) throw new Error("keyGen is required");

  return (req, res, next) => {
    const key = keyGen(req);
    const { allowed, remaining, retryAfter } = limiter.tryAcquire(key, typeof cost === "function" ? cost(req) : cost);

    res.setHeader(`${headerNamePrefix}-Limit`, limit ?? limiter.capacity ?? limiter.limit ?? "unknown");
    res.setHeader(`${headerNamePrefix}-Remaining`, remaining);

    if (!allowed) {
      res.setHeader("Retry-After", Math.ceil(retryAfter));
      return res.status(429).json({ error: "rate_limit_exceeded", retryAfter });
    }
    next();
  };
}

/**
 * Stack multiple limiters; all must pass for the request to proceed.
 * Pattern: per-second + per-minute + per-day limits (Stripe / Cloudflare style).
 */
function stackedRateLimit(layers) {
  // layers: [{ limiter, keyGen, cost?, name? }, ...]
  return (req, res, next) => {
    for (const layer of layers) {
      const key = layer.keyGen(req);
      const cost = typeof layer.cost === "function" ? layer.cost(req) : (layer.cost ?? 1);
      const { allowed, remaining, retryAfter } = layer.limiter.tryAcquire(key, cost);
      const name = layer.name ?? "default";
      res.setHeader(`RateLimit-${name}-Remaining`, remaining);
      if (!allowed) {
        res.setHeader("Retry-After", Math.ceil(retryAfter));
        return res.status(429).json({
          error: "rate_limit_exceeded",
          tier: name,
          retryAfter,
        });
      }
    }
    next();
  };
}

/** Default key generators. */
const KEYS = {
  ip: (req) => req.ip || req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown",
  userId: (req) => req.user?.id ?? "anonymous",
  apiKey: (req) => req.headers["x-api-key"] ?? "unkeyed",
  ipPath: (req) => `${KEYS.ip(req)}:${req.path}`,
  loginIpEmail: (req) => `${KEYS.ip(req)}:${(req.body?.email ?? "").toLowerCase()}`,
};

module.exports = { rateLimit, stackedRateLimit, KEYS, TokenBucket };
