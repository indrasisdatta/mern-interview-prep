# Backend System Design — Notification Service

> Resume project: **Verizon Auto Triaging** — defect notifications to support agents; MCP-driven workflow alerts.
>
> Cross-link: [URL Shortener](../01-URLShortener/notes.md) · [Rate Limiter](../02-RateLimiter/notes.md) · [Node.js notes](../../../backend/nodejs/notes.md) · [Kafka notes](../../../devops-infrastructure/kafka/)

---

## 1. Problem statement

Design a notification service that delivers:

- **Multi-channel:** email, push (web/mobile), SMS, in-app
- **High volume:** 100M+ notifications/day; bursts during incidents
- **Per-user preferences:** opt-in/out per channel + per category
- **Templates:** parameterized templates (text + HTML)
- **Reliable:** at-least-once delivery, retry, DLQ
- **Idempotent:** same trigger shouldn't double-send
- **Rate-capped per user:** don't spam (e.g., max 5 emails/day, but unlimited critical alerts)
- **Auditable:** every send logged for compliance
- **Pluggable providers:** SendGrid, AWS SES, Twilio, FCM, APNs — swap without code change

Used by: every SaaS, banks, logistics, e-commerce. Verizon Auto Triaging notifies agents of defects/MRs in real time.

---

## 2. Requirements

### 2.1 Functional

- API to enqueue notification: `POST /notifications` `{ userId, category, template, data, channels[] }`
- Background workers fan out to each channel
- Templating engine renders per-channel content
- Track delivery status per channel
- Bounce / unsubscribe handling (webhook from provider)
- Scheduled / delayed notifications (`sendAt`)
- Aggregation / digest (batch into "5 new defects in last hour" instead of 5 individual)
- Per-user preferences UI + API

### 2.2 Non-functional

- **Throughput:** 100M/day = ~1.2k/sec avg, 50k/sec peak (incident broadcast)
- **Latency:** p95 enqueue → email sent < 30s for transactional; SMS/push < 10s
- **Reliability:** at-least-once; persistent storage of pending notifications
- **Provider failover:** if SendGrid down, fall over to AWS SES
- **Backpressure:** Don't overwhelm providers (per-provider rate limits)
- **Compliance:** GDPR, CAN-SPAM (unsub link), TCPA (SMS consent)

---

## 3. High-level architecture

```
                                ┌──────────────────────────┐
                                │  Producer apps           │
                                │  (Verizon Order service, │
                                │   MCP triage engine,     │
                                │   etc.)                  │
                                └────────┬─────────────────┘
                                         │ POST /notify
                                         ▼
                          ┌────────────────────────────────┐
                          │   Notification API              │
                          │   - validate, dedup, persist    │
                          └────────┬───────────────────────┘
                                   │
                                   ▼
                          ┌────────────────────────────────┐
                          │   Kafka: notifications.queue    │
                          └────────┬───────────────────────┘
                                   │ fan-out
                          ┌────────┼────────────┬─────────┐
                          ▼        ▼            ▼         ▼
                  ┌──────────┐ ┌──────┐ ┌─────────┐ ┌─────────┐
                  │  Email   │ │ SMS  │ │  Push    │ │  In-App │
                  │ Worker   │ │Worker│ │ Worker   │ │ Worker  │
                  └────┬─────┘ └──┬───┘ └────┬─────┘ └────┬────┘
                       │          │          │            │
                       ▼          ▼          ▼            ▼
                  ┌──────────┐ ┌──────┐ ┌─────────┐ ┌─────────┐
                  │ SendGrid │ │Twilio│ │ FCM/APNs│ │ WebSocket│
                  │ AWS SES  │ │      │ │          │ │ Inbox DB │
                  └─────┬────┘ └──┬───┘ └────┬─────┘ └─────────┘
                        │ webhook ▼ webhook ▼
                        └─────┴─────────┴───────────────────────┐
                                                                ▼
                                              ┌───────────────────┐
                                              │ Delivery Status   │
                                              │ Aggregator        │
                                              └───────────────────┘
```

---

## 4. Data model

### 4.1 Tables

```sql
-- Notifications (one record per trigger)
CREATE TABLE notifications (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL,
  category      VARCHAR(40) NOT NULL,       -- e.g., "order.shipped", "defect.detected"
  template_id   VARCHAR(40) NOT NULL,
  payload       JSONB NOT NULL,             -- template variables
  channels      TEXT[] NOT NULL,            -- subset of [email, sms, push, inapp]
  priority      VARCHAR(10) DEFAULT 'normal', -- low | normal | high | critical
  scheduled_for TIMESTAMP,                  -- null = immediate
  dedup_key     VARCHAR(200),               -- idempotency
  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE (dedup_key, user_id)
);

-- Delivery attempts (one per channel per send attempt)
CREATE TABLE deliveries (
  id              UUID PRIMARY KEY,
  notification_id UUID REFERENCES notifications(id),
  channel         VARCHAR(20) NOT NULL,
  provider        VARCHAR(40),              -- "sendgrid", "ses", "twilio", ...
  status          VARCHAR(20),              -- queued | sent | delivered | bounced | failed
  provider_msg_id VARCHAR(200),
  error           TEXT,
  attempted_at    TIMESTAMP,
  delivered_at    TIMESTAMP
);

-- User preferences
CREATE TABLE user_preferences (
  user_id    UUID NOT NULL,
  category   VARCHAR(40) NOT NULL,
  channel    VARCHAR(20) NOT NULL,
  enabled    BOOLEAN DEFAULT TRUE,
  digest     VARCHAR(10) DEFAULT 'instant', -- instant | hourly | daily
  PRIMARY KEY (user_id, category, channel)
);

-- Per-user channel addresses
CREATE TABLE user_channels (
  user_id    UUID NOT NULL,
  channel    VARCHAR(20) NOT NULL,
  address    VARCHAR(500) NOT NULL,         -- email / phone / device token
  verified   BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (user_id, channel, address)
);
```

### 4.2 Idempotency via `dedup_key`

When a producer emits "defect detected for order X", retries may resend the same event. The producer supplies a `dedup_key` (e.g., `defect:ORDER-12345:2026-06-06`). Database `UNIQUE(dedup_key, user_id)` rejects duplicates.

```ts
async function enqueueNotification(req) {
  try {
    const row = await db.notifications.insert({
      id: uuid(),
      userId: req.userId,
      category: req.category,
      templateId: req.templateId,
      payload: req.data,
      channels: req.channels,
      dedupKey: req.dedupKey,
      ...
    });
    await kafka.send("notifications.queue", { notificationId: row.id });
    return row;
  } catch (e) {
    if (e.code === "23505") {   // unique violation
      const existing = await db.notifications.findOne({ dedupKey: req.dedupKey, userId: req.userId });
      return existing;   // idempotent return
    }
    throw e;
  }
}
```

---

## 5. The dispatch pipeline

### 5.1 Enqueue → Kafka → workers

Kafka topic `notifications.queue` per channel? Or single topic + worker filter?

**Trade-off:**

| Single topic | Per-channel topic |
|--------------|-------------------|
| Simpler to operate | More routing complexity |
| Workers filter unwanted messages | Workers see only their messages |
| Sharing partition count | Tune partition count per channel |

For 100M/day, **per-channel topics** wins — each channel has different rate limits, retry policies, partition strategies.

```
notifications.queue.email
notifications.queue.sms
notifications.queue.push
notifications.queue.inapp
```

Producer publishes to one topic; orchestrator service consumes and re-publishes to per-channel topics.

```ts
// Orchestrator
consumer.subscribe("notifications.queue");
consumer.on("message", async (msg) => {
  const { notificationId } = JSON.parse(msg.value);
  const notif = await db.notifications.findOne({ id: notificationId });
  const userPrefs = await db.userPreferences.find({ userId: notif.userId, category: notif.category });

  for (const channel of notif.channels) {
    const pref = userPrefs.find((p) => p.channel === channel);
    if (!pref?.enabled) continue;   // user opted out
    
    if (pref.digest === "instant") {
      await kafka.send(`notifications.queue.${channel}`, { notificationId, channel });
    } else {
      await digestBuffer.add(notif, pref.digest);   // hourly / daily aggregation
    }
  }
});
```

### 5.2 Per-channel workers

```ts
// Email worker
consumer.subscribe("notifications.queue.email");
consumer.on("message", async (msg) => {
  const { notificationId } = JSON.parse(msg.value);
  const notif = await db.notifications.findOne({ id: notificationId });
  const address = await db.userChannels.findOne({ userId: notif.userId, channel: "email", verified: true });
  if (!address) return;   // no verified email

  const rendered = render(notif.templateId, notif.payload, "email");
  
  const delivery = await db.deliveries.insert({
    notificationId,
    channel: "email",
    provider: "sendgrid",
    status: "queued",
    attemptedAt: new Date(),
  });
  
  try {
    const providerMsgId = await emailProvider.send({
      to: address.address,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: {
        "X-Notification-ID": notif.id,
        "List-Unsubscribe": `<${unsubLink(notif.userId, "email", notif.category)}>`,
      },
    });
    await db.deliveries.update(delivery.id, { status: "sent", providerMsgId });
  } catch (e) {
    if (isRetryable(e)) throw e;   // Kafka redelivers
    await db.deliveries.update(delivery.id, { status: "failed", error: e.message });
    // Don't throw — move on
  }
});
```

### 5.3 Retry + DLQ

Kafka with consumer groups: failed processing causes consumer to NOT commit offset → message redelivered. Combined with exponential backoff:

```ts
const RETRY_DELAYS = [1, 5, 30, 120, 600];   // seconds, 5 attempts max

async function processWithRetry(msg) {
  const attempt = parseInt(msg.headers["attempt"] ?? "0");
  try {
    await processMessage(msg);
  } catch (e) {
    if (!isRetryable(e) || attempt >= RETRY_DELAYS.length) {
      await kafka.send("notifications.dlq", { ...msg, error: e.message, attempts: attempt });
      return;
    }
    await kafka.send("notifications.queue.email.retry", msg, {
      delayMs: RETRY_DELAYS[attempt] * 1000,
      headers: { attempt: String(attempt + 1) },
    });
  }
}
```

Kafka doesn't have native delayed messages — use a delay topic with a "scheduled at" header + a slow consumer that holds messages until due time. Or use **AWS SQS** (native delay) or **BullMQ** (Redis-backed, native delay).

### 5.4 Provider failover

```ts
const providers = [primarySendGrid, fallbackSes];

async function send(message) {
  for (const provider of providers) {
    try {
      if (await provider.isHealthy()) {
        return await provider.send(message);
      }
    } catch (e) {
      log.warn(`Provider ${provider.name} failed, trying next`, e);
    }
  }
  throw new Error("All providers failed");
}
```

Health check: cached for ~30s; consult provider's status API if available.

---

## 6. Templating

### 6.1 Template format

Store as records in DB or files in S3:

```json
{
  "id": "defect_detected",
  "subject": "Defect detected on order {{ orderId }}",
  "channels": {
    "email": {
      "subject": "Defect on {{ orderId }}",
      "html": "<p>Hi {{ user.firstName }},</p><p>A defect was detected on order {{ orderId }}: {{ summary }}.</p><p><a href='{{ url }}'>View defect</a></p>",
      "text": "Hi {{ user.firstName }},\n\nA defect was detected on order {{ orderId }}: {{ summary }}.\n\nView: {{ url }}"
    },
    "sms": {
      "text": "Order {{ orderId }} defect: {{ summary }}. {{ url }}"
    },
    "push": {
      "title": "Defect on {{ orderId }}",
      "body": "{{ summary }}",
      "data": { "url": "{{ url }}" }
    },
    "inapp": {
      "title": "Defect on order {{ orderId }}",
      "body": "{{ summary }}",
      "icon": "alert"
    }
  }
}
```

### 6.2 Template engine

**Recommended: MJML** for email HTML — handles dark-mode, retina, Outlook quirks. Pair with Handlebars for variable interpolation.

```ts
import Handlebars from "handlebars";
import mjml2html from "mjml";

function renderEmail(template, payload) {
  const subject = Handlebars.compile(template.subject)(payload);
  const mjmlSource = Handlebars.compile(template.mjml)(payload);
  const { html } = mjml2html(mjmlSource);
  const text = htmlToText(html);    // for plaintext fallback
  return { subject, html, text };
}
```

### 6.3 Localization

Each template has variants per locale (`en-US`, `es-ES`, ...). Render based on user's preferred locale.

```ts
const template = await db.templates.findOne({
  id: notif.templateId,
  locale: user.locale ?? "en-US",
}) ?? await db.templates.findOne({ id: notif.templateId, locale: "en-US" });
```

Use ICU MessageFormat for plural/gender:

```
{count, plural, =0 {no defects} =1 {one defect} other {# defects}}
```

### 6.4 Preview tool

Build an internal "send to email" preview tool for template authors — render with sample payload and send to a chosen test inbox. Catches HTML rendering issues across clients (Outlook, Gmail, Apple Mail).

---

## 7. Channel deep-dives

### 7.1 Email

| Provider | Notes |
|----------|-------|
| **SendGrid** | Mature, good deliverability, webhook events |
| **AWS SES** | Cheap, integrates with Lambda |
| **Mailgun** | Strong API, dev-friendly |
| **Postmark** | Great for transactional |

**Deliverability concerns:**
- **SPF** record set on sending domain
- **DKIM** signing
- **DMARC** policy
- **Dedicated IP** for high-volume sends (warm it up)
- **Bounce handling** — hard bounce → mark email invalid → don't retry
- **Suppression list** — opt-outs honored before send

### 7.2 SMS / Voice

| Provider | Notes |
|----------|-------|
| **Twilio** | Industry standard, broad coverage |
| **AWS SNS / Pinpoint** | If already on AWS |
| **MessageBird** | EU-friendly |

**Compliance:**
- **TCPA** (US): explicit opt-in for marketing; transactional ok with prior business relationship
- **STIR/SHAKEN** for voice
- **Sender IDs** (short codes vs long codes vs alphanumeric)
- **Quiet hours** — don't text at 3am (per local time zone)

### 7.3 Push

- **Web Push** — VAPID, browser PushManager + Service Worker
- **iOS** — APNs with .p8 token-based auth
- **Android** — FCM with HTTP v1 API
- **Tokens expire** — handle "invalid token" responses by deleting + asking user to re-register

```ts
async function sendWebPush(subscription, payload) {
  const webpush = require("web-push");
  webpush.setVapidDetails("mailto:ops@example.com", VAPID_PUBLIC, VAPID_PRIVATE);
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (e) {
    if (e.statusCode === 410) {   // Gone
      await db.userChannels.delete({ address: subscription.endpoint });
    }
    throw e;
  }
}
```

### 7.4 In-app

The most flexible — entirely under your control. Pattern:

- Persist to `inbox` table per user
- WS push to live user; fallback to badge count on next page load
- Mark-as-read API
- Bulk APIs for "mark all read", "delete"

```sql
CREATE TABLE inbox (
  user_id   UUID NOT NULL,
  id        UUID NOT NULL,
  title     VARCHAR(200),
  body      TEXT,
  url       VARCHAR(500),
  icon      VARCHAR(20),
  category  VARCHAR(40),
  is_read   BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX inbox_unread_idx ON inbox(user_id, is_read, created_at DESC);
```

---

## 8. Aggregation / digest

User says "send me emails hourly, not per event". Buffer events and consolidate.

### 8.1 Buffer + scheduled flush

```ts
class DigestBuffer {
  async add(notif, freq /* hourly | daily */) {
    const flushTime = nextBoundary(freq);   // e.g., next top of the hour
    await redis.zadd(`digest:${notif.userId}:${freq}`, flushTime, JSON.stringify(notif));
  }
}

// Cron job runs every minute
async function flushDigestsDue() {
  const now = Date.now();
  const userKeys = await redis.keys("digest:*");
  for (const key of userKeys) {
    const items = await redis.zrangebyscore(key, 0, now);
    if (!items.length) continue;
    const notifs = items.map(JSON.parse);
    await renderAndSendDigest(notifs);
    await redis.zremrangebyscore(key, 0, now);
  }
}
```

For 100M users, `redis.keys("digest:*")` won't scale. Use a separate index of "users with pending digests".

---

## 9. Personalization & smart timing

For non-urgent notifications:
- **Time-zone-aware delivery** — send during user's waking hours
- **Engagement-optimized** — ML model picks best time per user based on past open rates (advanced)
- **Frequency capping** — max 5 notifications per day per user across all channels

```ts
async function shouldSendNow(userId, category) {
  const user = await db.users.findOne({ id: userId });
  const userLocalHour = nowInTimezone(user.timezone);
  if (userLocalHour < 8 || userLocalHour > 22) return false;   // unless critical
  
  const dailyCount = await redis.get(`notifcount:${userId}:${todayDate()}`);
  if (dailyCount > MAX_DAILY) return false;
  
  return true;
}
```

Critical notifications (security alerts, payment failures) bypass these — always send.

---

## 10. Tracking & analytics

### 10.1 Event types from providers

| Event | Notes |
|-------|-------|
| `sent` | Provider accepted from API |
| `delivered` | Successfully handed to recipient's server |
| `opened` | Tracking pixel loaded (email) |
| `clicked` | User clicked a link |
| `bounced` (soft/hard) | Recipient server rejected |
| `complained` | User marked as spam |
| `unsubscribed` | User clicked unsub link |

Providers POST webhook to your endpoint:

```ts
app.post("/webhooks/sendgrid", verifySignature, async (req, res) => {
  const events = req.body;
  for (const ev of events) {
    await db.deliveries.update(
      { providerMsgId: ev.sg_message_id },
      { status: ev.event, deliveredAt: ev.timestamp }
    );
    if (ev.event === "bounce" && ev.type === "hard") {
      await db.userChannels.update({ address: ev.email, channel: "email" }, { verified: false });
    }
    if (ev.event === "spamreport") {
      await db.userPreferences.upsert({ userId, channel: "email", category: "*", enabled: false });
    }
  }
  res.sendStatus(200);
});
```

### 10.2 Engagement metrics

Aggregate per template / category / channel:
- Send rate
- Open rate (email)
- Click rate
- Unsubscribe rate
- Bounce rate

Drive ML model for "best time to send" and template optimization.

---

## 11. Backpressure & rate limiting (provider-side)

Each provider has limits (SendGrid: 100/sec for shared IP, more for dedicated). Workers must respect.

```ts
import Bottleneck from "bottleneck";

const sendgridLimiter = new Bottleneck({ minTime: 10, maxConcurrent: 50 });   // 100/sec
const twilioLimiter = new Bottleneck({ minTime: 30 });                        // ~33/sec

async function sendEmail(msg) {
  return sendgridLimiter.schedule(() => sendgridClient.send(msg));
}
```

Combined with circuit breakers — if provider 503s for 30s, halt sends, fail-over to backup. See [Node.js notes](../../../backend/nodejs/notes.md) (circuit breaker section).

---

## 12. Scaling

### 12.1 Kafka partitioning

- Partition key: `user_id` — preserves per-user ordering
- Partition count: scale with worker count (rule of thumb: 2-3× number of parallel consumers)
- For 50k/sec peak: 50-100 partitions per channel topic

### 12.2 Worker autoscaling

Kubernetes HPA based on Kafka consumer lag (custom metric via Prometheus exporter):

```yaml
metrics:
  - type: External
    external:
      metric: { name: kafka_consumer_lag, selector: { matchLabels: { topic: notifications.queue.email } } }
      target: { type: AverageValue, averageValue: 1000 }
```

Scale workers when lag > 1000 messages.

### 12.3 Multi-region

For global apps:
- Region-local Kafka clusters
- Provider selection per region (e.g., AWS SES in us-east-1, eu-west-1)
- User's preference for region (data residency)

---

## 13. Security

### 13.1 Unsubscribe — required by law

**Every email** must contain:
- Visible "Unsubscribe" link
- `List-Unsubscribe` header (RFC 8058)

```
List-Unsubscribe: <https://app.com/unsub?token=...>, <mailto:unsubscribe@app.com?subject=remove>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

One-Click unsubscribe (RFC 8058) lets Gmail / Apple Mail unsubscribe with a single click (no auth needed). Token should be unique per (user, list).

### 13.2 Webhook verification

Provider webhooks must be verified (signature) or someone can spoof delivery events.

```ts
function verifySendGridSignature(req) {
  const sig = req.headers["x-twilio-email-event-webhook-signature"];
  const ts  = req.headers["x-twilio-email-event-webhook-timestamp"];
  const payload = ts + req.rawBody;
  const expected = crypto.createPublicKey(SENDGRID_PUBLIC_KEY).verify(payload, sig, "base64");
  if (!expected) throw new Forbidden("Invalid signature");
}
```

### 13.3 PII

Email addresses, phone numbers = PII. Encrypt at rest, audit access, support DSARs (data subject access requests).

---

## 14. Reliability patterns

### 14.1 At-least-once delivery

Default Kafka semantics. Workers must be **idempotent** — re-processing the same message produces the same outcome (don't double-send). Idempotency via:

- Marking notifications with `(userId, dedupKey)` unique constraint
- Tracking `delivery_id` per send attempt — if exists and status=sent, skip

### 14.2 Outbox pattern

Producer apps wanting to send notifications:

```
BEGIN TX
  INSERT INTO orders (...) VALUES (...);
  INSERT INTO outbox (event_type, payload) VALUES ('order.shipped', '{...}');
COMMIT;

-- Outbox poller reads new rows, publishes to Kafka, marks consumed
```

Guarantees the notification ENQUEUE is atomic with the business operation. Without it, you can ship an order but fail to send the email (or vice versa).

### 14.3 Saga / compensation

If sending money + notification, the saga handles failures: if notification fails, decide whether to roll back the payment or accept partial success (usually accept — money already moved, send retry async).

---

## 15. Trade-off matrix

| Decision | Option A | Option B | Choice + Why |
|----------|----------|----------|--------------|
| Queue | RabbitMQ | Kafka | **Kafka** — throughput + replay |
| Topology | Single topic | Per-channel | **Per-channel** — channel-specific scaling |
| Delivery semantics | Exactly-once | At-least-once + idempotent | **At-least-once + idempotent** — exactly-once is impractical |
| Provider | Single | Multi w/ failover | **Multi** — reliability |
| Template store | DB | S3 / git repo | **DB** for runtime; mirrored to S3 for backup |
| Templating | JSX-like | Handlebars + MJML | **Handlebars + MJML** — proven for email |
| Idempotency | None | Dedup key | **Dedup key (producer-supplied)** — survives retries |
| Digest | Real-time | Batched | **User-configurable** per category |

---

## 16. Failure modes

| Failure | Mitigation |
|---------|------------|
| Provider 5xx | Retry with backoff; fail over after N attempts |
| Provider down (sustained) | Circuit breaker; queue grows; SRE paged |
| User email bounces | Mark verified=false; pause sends until user re-verifies |
| Spam complaint | Auto-unsubscribe all categories for user |
| Kafka outage | Producer queues to local disk (DLQ-on-producer); workers backed up |
| Worker crash | Kafka rebalances partitions to other workers |
| Templates with bad data | Render-time validation; fall back to text-only |
| Webhook spoofing | Signature verification |
| Mis-targeted blast | Audit log + "kill switch" endpoint to halt all sends |

---

## 17. Interview talking points

**Q: "How do you guarantee delivery exactly once?"**
A: You don't — exactly-once distributed delivery is provably impossible. Use at-least-once with idempotency. The producer supplies a `dedup_key`; database has `UNIQUE(dedup_key, user_id)` so duplicate enqueues are no-ops. Worker side, each send attempt is keyed to a `delivery_id` — re-processing the same Kafka message won't double-send because we check `status=sent` first.

**Q: "Why Kafka and not a queue like RabbitMQ?"**
A: Throughput (100M/day) + replayability. Kafka's partitioned log model gives ordering per user (partition by user_id), high throughput, and the ability to rebuild aggregates by replaying. RabbitMQ is fine for lower scale or when you want fan-out exchanges, but Kafka's operational story is cleaner at scale.

**Q: "How do you handle SendGrid being down?"**
A: Provider failover via a chain: SendGrid → AWS SES → Mailgun. Each provider client has a healthcheck (cached for 30s). When the primary returns 5xx or times out, the next provider in the chain is tried. Circuit breaker prevents repeated hits to a known-down provider. Templates are channel-agnostic — same render works on any.

**Q: "User preferences — how do you store and look up at scale?"**
A: A small table keyed by (user_id, category, channel). For 100M users × 20 categories × 4 channels = 8B rows — partition by user_id. Most reads happen at fan-out; cache hot users' prefs in Redis. Common case "user opted into all defaults" can be implicit — store only overrides.

**Q: "Digest aggregation — how?"**
A: Per user with `digest=hourly` or `daily`, buffer in Redis sorted set scored by next-flush-time. Cron job runs every minute, fetches due entries, renders a single email/inapp message with all aggregated content, and delivers. For 100M users, the cron must shard the lookup (one job per partition of users).

**Q: "How do you handle email bounces and unsubscribes?"**
A: Provider webhooks → our webhook endpoint (signature-verified). Hard bounce or "user marked spam" → mark email channel as not-verified, suppress future sends. Unsubscribe link uses a tokenized URL (HMAC of user+list+timestamp) so we can identify the user without requiring them to log in. RFC 8058 one-click unsubscribe for Gmail/Apple Mail.

**Q: "How do you ensure ordering for a user's notifications?"**
A: Partition Kafka topic by `user_id`. All notifications for one user go to the same partition; consumed by one worker at a time. Ordering preserved. Trade-off: a stuck user (e.g., bouncing email loop) can block their partition; we mitigate by per-partition idle timeout + DLQ for stuck messages.

**Q: "What's the hardest reliability problem you solved here?"**
A: Burst handling during incident broadcasts. When a major outage triggers 1M notifications in 60s, three things happen: (1) provider rate limits hit; (2) downstream Kafka topics back up; (3) workers fall behind. Solution: per-channel token bucket on send (bottleneck.js); critical-priority queue jumps the line; non-critical sends throttled to keep critical path moving. Plus, broadcast detection — if many users get the same payload simultaneously, batch under a single provider call (SendGrid supports multi-recipient with personalization).

---

## 18. Diagram

```
                  Producer apps
                      │
                      ▼
            ┌──────────────────┐
            │ Notification API │  ← idempotent (dedup_key)
            └────────┬─────────┘
                     │ persist + enqueue
                     ▼
            ┌──────────────────┐         ┌──────────────────┐
            │  notifications   │         │  Outbox table    │
            │       DB         │         │  (transactional) │
            └──────────────────┘         └────────┬─────────┘
                                                  │
                                                  ▼
                                    ┌──────────────────────┐
                                    │  Kafka:               │
                                    │  notifications.queue  │
                                    └──────────┬───────────┘
                                               │
                                               ▼
                                    ┌──────────────────────┐
                                    │  Orchestrator         │
                                    │  - check prefs        │
                                    │  - per-channel route  │
                                    │  - digest aggregator  │
                                    └──┬─────┬──────┬─────┬─┘
                                       │     │      │     │
                                       ▼     ▼      ▼     ▼
                                  email   sms    push   inapp
                                  topic   topic  topic  topic
                                       │     │      │     │
                                  ┌────▼─┐ ┌─▼──┐ ┌─▼──┐ ┌▼────┐
                                  │email │ │sms │ │push│ │inapp│
                                  │worker│ │wkr │ │wkr │ │wkr  │
                                  └──┬───┘ └─┬──┘ └─┬──┘ └──┬──┘
                                     ▼       ▼      ▼       ▼
                            ┌─────────┐ ┌──────┐ ┌─────┐ ┌────────┐
                            │SendGrid │ │Twilio│ │FCM  │ │Inbox DB│
                            │ AWS SES │ │      │ │APNs │ │ + WS   │
                            └────┬────┘ └──┬───┘ └──┬──┘ └────────┘
                                 │webhook  │webhook │
                                 └────┬────┴────────┘
                                      ▼
                            ┌──────────────────┐
                            │ Status updater   │
                            │ + analytics      │
                            └──────────────────┘
```

---

## 19. Cross-links

- [Rate Limiter](../02-RateLimiter/notes.md) — per-provider rate caps + per-user frequency caps
- [URL Shortener](../01-URLShortener/notes.md) — shorten links inside SMS templates
- [Node.js notes](../../../backend/nodejs/notes.md) — circuit breaker, BullMQ
- [Kafka notes](../../../devops-infrastructure/kafka/) — partition strategy, consumer groups
- [General system design](../../general/notes.txt) — saga, outbox patterns
- [Web Security](../../../frontend/performance-security/WebSecurity.md) — webhook signature verification
