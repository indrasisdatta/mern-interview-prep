-- Atomic Redis-backed token bucket.
-- Usage: redis.eval(luaScript, 1, key, capacity, refillRatePerSec, nowSec, cost)
--
-- Returns: { allowedFlag (1/0), remainingTokens, retryAfterSec }
--
-- Why Lua: read-modify-write on Redis without Lua is two round trips, racy with
-- concurrent clients. Lua runs atomically on the Redis server.

local key       = KEYS[1]
local capacity  = tonumber(ARGV[1])
local rate      = tonumber(ARGV[2])
local now       = tonumber(ARGV[3])
local cost      = tonumber(ARGV[4]) or 1

local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local lastTs = tonumber(state[2])

if tokens == nil then tokens = capacity end
if lastTs == nil then lastTs = now end

-- Refill
local delta = math.max(0, now - lastTs)
tokens = math.min(capacity, tokens + delta * rate)

local allowed = 0
local retryAfter = 0

if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
else
  retryAfter = (cost - tokens) / rate
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
-- TTL: 2x the time to fully refill, so idle buckets eventually evict
redis.call('EXPIRE', key, math.ceil(capacity / rate * 2) + 60)

-- Return integers + numeric string for retryAfter (Lua can't return floats reliably)
return { allowed, math.floor(tokens), tostring(retryAfter) }
