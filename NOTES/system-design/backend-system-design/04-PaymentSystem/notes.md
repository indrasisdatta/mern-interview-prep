# Backend System Design — Payment / Billing System

> Resume project: **Cantor Fitzgerald Prime Billing** — finance-driven daily calculation model, asset billing, role-based approval workflows. Also relevant to **Lystant** marketplace billing/escrow.
>
> Cross-link: [URL Shortener](../01-URLShortener/notes.md) · [Rate Limiter](../02-RateLimiter/notes.md) · [Notification Service](../03-NotificationService/notes.md)

---

## 1. Problem statement

Design a payment processing service that:

- Charges customers (one-time + subscription)
- Pays out to merchants / sellers / fund recipients
- Maintains an immutable **ledger** of all money movements
- Is **idempotent** — never double-charges, never double-credits
- Handles **distributed transactions** across multiple services
- Reconciles with banks / payment processors (Stripe, Adyen, ACH partners)
- Audit-trail every operation
- **Eventually consistent** with the bank's record (the bank is source of truth for actual money)

---

## 2. Requirements

### 2.1 Functional

- **Charge** a customer (credit/debit card, ACH, wire)
- **Refund** (full / partial)
- **Subscription billing** (recurring, multiple plans, upgrades/downgrades, proration)
- **Payouts** to merchants/users (Lystant sellers, Cantor counterparties)
- **Escrow** holds (Lystant: held until delivery confirmed)
- **Multi-currency** with conversion
- **Tax** calculation (sales tax, VAT, GST per jurisdiction)
- **Invoicing** (PDF, line items, taxes, discounts)
- **Refund chain** (full money trail visible)

### 2.2 Non-functional

- **Correctness:** never lose a cent, never double-charge, ACID for financial state
- **Idempotency:** every operation safe to retry
- **Audit:** every state change written to immutable log
- **Reconciliation:** daily match against bank records
- **Compliance:** PCI-DSS (no raw card numbers in our DB), SOX, KYC/AML where applicable
- **Latency:** charge attempt → user feedback < 2s p95
- **Availability:** 99.99% (4 nines)

---

## 3. The cardinal rule: ledger over balance

**Don't store balances. Store transactions.**

```sql
-- BAD
CREATE TABLE accounts (
  id      UUID PRIMARY KEY,
  balance NUMERIC(20, 4)    -- mutable, easy to corrupt
);
```

```sql
-- GOOD
CREATE TABLE ledger_entries (
  id          UUID PRIMARY KEY,
  account_id  UUID NOT NULL,
  amount      NUMERIC(20, 4) NOT NULL,   -- positive=credit, negative=debit
  currency    CHAR(3) NOT NULL,
  type        VARCHAR(40) NOT NULL,       -- "charge", "refund", "payout", "fee"
  ref_id      VARCHAR(100),               -- foreign reference (order, charge id)
  ref_table   VARCHAR(40),
  created_at  TIMESTAMP DEFAULT NOW(),
  CONSTRAINT immutable_ledger NO UPDATE   -- enforce via triggers or APP-only
);

-- Balance is a SUM:
SELECT account_id, currency, SUM(amount) AS balance
FROM ledger_entries
WHERE account_id = $1
GROUP BY account_id, currency;
```

### 3.1 Double-entry bookkeeping

Every transaction is **two entries** that sum to zero:

```
Customer pays $100 for an order:
  ledger_entries:
    (customer_cash_account,    -100, "charge", order_123)
    (revenue_account,          +100, "charge", order_123)

We refund $30:
    (customer_cash_account,    +30, "refund", order_123)
    (revenue_account,          -30, "refund", order_123)
```

Both rows share a `transaction_id` (the order). System invariant: **sum of all ledger entries per transaction = 0**.

Lystant marketplace:
```
Buyer pays $100 for an item:
  (buyer_wallet,          -100, "charge", order_X)
  (escrow_account,        +100, "charge", order_X)

Delivery confirmed:
  (escrow_account,         -97, "release", order_X)
  (seller_wallet,          +97, "release", order_X)
  (escrow_account,          -3, "platform_fee", order_X)
  (platform_revenue,        +3, "platform_fee", order_X)
```

This is **the** pattern. Stripe, banks, Square all model this way.

### 3.2 Why never mutate ledger entries

- **Audit:** every change is a new row; you see who did what when
- **Reconciliation:** sum the ledger; compare to provider statement
- **Replay:** rebuild any state from scratch by replaying entries
- **Debug:** "where did this money go?" → trace through entries

To fix mistakes: write **compensating entries**, never edit history.

---

## 4. Decimal precision — never floats

JavaScript `number` is float — fails financial math:

```js
0.1 + 0.2  // 0.30000000000000004
```

**Three approaches:**

1. **Integer cents** (or smallest unit) — `$1.23 → 123`. Fast, simple.
2. **Decimal.js / BigNumber.js** — arbitrary precision. Slower but clearer.
3. **Postgres NUMERIC(20, 4)** for storage; integer or Decimal in app.

For payments, **integer cents** is industry standard (Stripe API exposes amounts in cents). Postgres `NUMERIC` stores without precision loss.

```ts
const subtotal = 999;   // $9.99 in cents
const tax      = Math.round(subtotal * 0.08);   // 80 cents
const total    = subtotal + tax;
```

Storage as `BIGINT cents` or `NUMERIC(20,4)` — never `FLOAT`/`REAL`.

---

## 5. Idempotency

The MOST important property. Network failures mean clients retry. Without idempotency, retries double-charge.

### 5.1 Client-supplied idempotency keys

```
POST /charges
Idempotency-Key: 0e7bf6df-2c4c-4e8e-9b3a-6c4a8c9f7e8e
{
  "amount": 9999,
  "currency": "USD",
  "customer": "cus_abc123",
  ...
}
```

Server stores `(idempotency_key, request_hash, response, status)`:

```sql
CREATE TABLE idempotent_requests (
  key            VARCHAR(100) PRIMARY KEY,
  request_hash   VARCHAR(64) NOT NULL,
  response_body  JSONB,
  status_code    INT,
  created_at     TIMESTAMP DEFAULT NOW()
);
```

```ts
async function handleCharge(req) {
  const key = req.headers["idempotency-key"];
  if (!key) throw new BadRequest("Idempotency-Key required");
  
  const existing = await db.idempotentRequests.findOne({ key });
  if (existing) {
    if (existing.requestHash !== hash(req.body)) {
      throw new Conflict("Idempotency-Key reused with different body");
    }
    return { status: existing.statusCode, body: existing.responseBody };
  }
  
  // Mark as in-progress (race protection)
  try {
    await db.idempotentRequests.insert({ key, requestHash: hash(req.body), statusCode: 0 });
  } catch (e) {
    if (e.code === "23505") {   // concurrent insert
      await sleep(1000);
      return handleCharge(req);   // retry — original is presumably in-flight
    }
  }
  
  const result = await processCharge(req.body);
  await db.idempotentRequests.update({ key }, {
    responseBody: result.body, statusCode: result.status
  });
  return result;
}
```

Retention: keep idempotency records for 24-48 hours (Stripe: 24h). After that, retries become new requests.

### 5.2 Internal operations

Inside the system, every state-changing operation gets its own internal idempotency key (UUID v7 from generator). When a worker retries (Kafka redelivery), the operation is a no-op.

---

## 6. PCI-DSS — never store raw card numbers

If you store PANs (Primary Account Numbers) or CVV, you become **PCI-DSS Level 1 or 2** — full audit, dedicated environments, $$$ compliance.

**Solution: tokenization.** Use Stripe/Adyen/Braintree to vault the card; you get a `pm_xxx` token. Store the token, not the card.

```
Frontend → Stripe.js (collects card directly in their iframe)
              ↓ token (pm_abc123)
            Your backend
              ↓ token
            Charge API: { customer, payment_method: "pm_abc123", amount: 9999 }
```

The raw card never touches your server. Your PCI scope shrinks dramatically (SAQ-A).

For your own payment processing (rare — most companies use Stripe), you'd need full PCI-DSS certification.

---

## 7. Distributed transactions — saga pattern

Many operations span services. Example: place an order.

```
Order Service:    create order (status=PENDING)
Inventory:        reserve item
Payment:          charge customer
Order Service:    mark PAID
Shipping:         schedule pickup
Notification:     send confirmation email
```

These can't all be in one ACID transaction (different DBs, services). Use **saga** — a sequence of local transactions, each with a compensating action if a later step fails.

### 7.1 Choreography vs orchestration

**Choreography:** services emit events; others listen.

```
OrderCreated → InventoryService reserves
              → PaymentService charges → PaymentSucceeded
              → ShippingService schedules
              → NotificationService emails
```

**Pros:** loosely coupled, no central authority.
**Cons:** hard to reason about; failure handling is implicit; debugging is detective work.

**Orchestration:** central coordinator drives the workflow.

```ts
async function placeOrderSaga(orderInput) {
  const sagaId = uuid();
  const order = await orderService.create(orderInput, sagaId);
  try {
    await inventoryService.reserve(order.items, sagaId);
    try {
      await paymentService.charge(order.customer, order.total, sagaId);
      await orderService.markPaid(order.id, sagaId);
      await shippingService.schedule(order, sagaId);
      await notificationService.notify(order.customer, "ORDER_CONFIRMED", sagaId);
      return order;
    } catch (e) {
      await inventoryService.release(order.items, sagaId);
      throw e;
    }
  } catch (e) {
    await orderService.cancel(order.id, sagaId);
    await notificationService.notify(order.customer, "ORDER_FAILED", sagaId);
    throw e;
  }
}
```

**Pros:** explicit workflow; clear failure-handling.
**Cons:** orchestrator becomes critical service; coupling.

For payment flows specifically, **orchestration** is usually clearer. Use [Temporal](https://temporal.io/), [Camunda](https://camunda.com/), or [AWS Step Functions] for production-grade orchestrators — they handle persistence, retries, observability, history.

### 7.2 Compensating actions

| Forward action | Compensation |
|----------------|--------------|
| Reserve inventory | Release inventory |
| Charge customer | Refund customer |
| Send confirmation | Send cancellation |
| Issue invoice | Mark invoice void |

Compensations should themselves be idempotent — they may be retried.

### 7.3 Why not two-phase commit (2PC)?

- Blocks resources until completion
- Single point of failure (coordinator)
- Requires all participants to support XA — most cloud services don't
- Saga + compensation is the modern alternative for microservices

---

## 8. Charge flow (Stripe-backed)

```
1. Customer enters card on FE → Stripe.js tokenizes → pm_xxx
2. FE submits to BE: { paymentMethodId: pm_xxx, amount, currency }
3. BE creates idempotent charge request
4. BE → Stripe API: PaymentIntents.create({ amount, currency, payment_method, confirm: true })
5. Stripe returns succeeded / requires_action (3DS) / failed
6. If succeeded: write ledger entries (charge: debit customer, credit revenue)
7. Return result to FE
8. Async: Stripe webhook confirms (in case of polling/network failures)
```

### 8.1 3D Secure (SCA)

In EU, PSD2 requires Strong Customer Authentication. Stripe handles this — your BE may get `requires_action`:

```
{ status: "requires_action", next_action: { type: "use_stripe_sdk", ... } }
```

FE shows the 3DS challenge (via Stripe.js); after auth, FE confirms. Server gets webhook `payment_intent.succeeded`.

### 8.2 Webhooks

Stripe (or any payment provider) sends webhooks for async events:

| Event | Action |
|-------|--------|
| `payment_intent.succeeded` | Mark charge succeeded; trigger fulfillment |
| `payment_intent.payment_failed` | Mark failed; release reserved inventory |
| `charge.dispute.created` | Open dispute; suspend account if pattern |
| `charge.refunded` | Update refund status |
| `invoice.payment_succeeded` | Renewal succeeded; extend subscription |
| `customer.subscription.deleted` | Mark sub cancelled |

```ts
app.post("/webhooks/stripe", express.raw({type: "application/json"}), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return res.status(400).send("Invalid signature");
  }
  
  // Idempotent (event.id de-dup'd in DB)
  if (await alreadyProcessed(event.id)) return res.sendStatus(200);
  
  await handleStripeEvent(event);
  await markProcessed(event.id);
  res.sendStatus(200);
});
```

**Always verify signature.** And dedupe by `event.id` — Stripe may redeliver.

---

## 9. Subscription billing

### 9.1 Concepts

- **Plan** — a SKU with price, interval (monthly/yearly), features
- **Subscription** — customer instance of a plan; states: trialing / active / past_due / canceled / unpaid
- **Invoice** — generated at each renewal; line items + tax + discounts
- **Prorated amount** — when upgrading/downgrading mid-period, calculate the diff
- **Dunning** — retry sequence after failed payment

### 9.2 Billing engine outline

```ts
// Daily cron
async function processRenewals() {
  const due = await db.subscriptions.find({
    status: "active",
    nextBillingAt: { $lte: new Date() },
  });
  for (const sub of due) {
    await processRenewal(sub);
  }
}

async function processRenewal(sub) {
  const plan = await db.plans.findOne({ id: sub.planId });
  const invoice = await createInvoice(sub, plan);
  
  try {
    const charge = await chargeCustomer(sub.customerId, invoice.total, {
      idempotencyKey: `renewal:${sub.id}:${invoice.periodStart.toISOString()}`,
    });
    await markInvoicePaid(invoice.id, charge.id);
    await advanceSubscriptionPeriod(sub);
    await sendReceipt(sub, invoice);
  } catch (e) {
    await markInvoicePastDue(invoice.id);
    await scheduleDunning(sub.id);
  }
}
```

### 9.3 Proration on upgrade

```ts
function calculateProration(sub, newPlan, asOf = new Date()) {
  const remaining = (sub.periodEnd - asOf) / (sub.periodEnd - sub.periodStart);
  const oldRefund = -Math.round(sub.plan.price * remaining);
  const newCharge = Math.round(newPlan.price * remaining);
  return { oldRefund, newCharge, net: newCharge + oldRefund };
}
```

Add as line items to next invoice (Stripe convention) or charge immediately. Communicate clearly to user — "you'll be charged $X today for the difference".

### 9.4 Dunning

After failed payment:
- Day 0: failed. Email "your payment failed".
- Day 3: retry. If fails, email "retry today".
- Day 7: retry. Email + in-app banner.
- Day 14: retry. Cancellation warning.
- Day 21: cancel subscription.

Stripe Smart Retries handles this; for custom billing, model as a state machine.

---

## 10. Payouts (Lystant sellers, Cantor counterparties)

```sql
CREATE TABLE payouts (
  id           UUID PRIMARY KEY,
  account_id   UUID NOT NULL,
  amount       BIGINT NOT NULL,   -- cents
  currency     CHAR(3) NOT NULL,
  method       VARCHAR(20),       -- "ach", "wire", "paypal"
  status       VARCHAR(20),       -- pending | submitted | settled | failed
  external_id  VARCHAR(100),      -- bank reference
  created_at   TIMESTAMP,
  settled_at   TIMESTAMP
);
```

### 10.1 Payout flow

```
1. Cron job determines payout-eligible accounts (balance > threshold, no holds)
2. Create payout record (status=pending)
3. Submit to bank/Stripe Connect (status=submitted)
4. Receive webhook on settlement → mark settled
5. Write ledger entries: debit account, credit external bank
```

### 10.2 Risk holds

For marketplaces: hold funds for a "risk window" (3-14 days) before paying out — covers chargebacks, disputes, fraud.

```ts
const availableBalance = totalBalance - heldBalance(account);

function heldBalance(account) {
  // Funds from sales in the last N days held back
  return db.ledger.sum({
    accountId: account.id,
    type: "sale",
    createdAt: { $gt: subDays(new Date(), HOLD_DAYS) },
  });
}
```

---

## 11. Reconciliation

Daily, match our ledger against the bank/provider's statement.

```
For each day:
  bank_statement.sum() = ledger.sum_for(account, day)
```

Discrepancies investigated. Common sources:
- Timing (event fired today but bank settled tomorrow)
- Fees (provider charged a fee we forgot to record)
- Disputes (chargeback issued by bank)
- Bank errors (rare but real)

```sql
WITH our_ledger AS (
  SELECT date_trunc('day', created_at) AS d, SUM(amount) AS s
  FROM ledger_entries
  WHERE account_id = 'stripe_clearing'
  GROUP BY 1
),
bank AS (
  SELECT date AS d, amount AS s FROM bank_statements
)
SELECT our_ledger.d, our_ledger.s AS ours, bank.s AS theirs, our_ledger.s - bank.s AS diff
FROM our_ledger LEFT JOIN bank USING(d)
WHERE our_ledger.s != bank.s OR bank.s IS NULL;
```

Build a daily report that auto-flags anomalies.

---

## 12. Fraud prevention

| Signal | Use |
|--------|-----|
| Velocity (charges/minute per IP/card) | Block on threshold |
| BIN country vs IP country mismatch | Flag for review |
| Card / customer chargeback history | Block known-bad cards |
| 3DS challenge result | Always prefer 3DS-passed for high-value |
| ML model (Stripe Radar) | Reject high-risk |

Maintain blocklists (`bad_cards`, `bad_emails`, `bad_ips`) maintained by ops. Cross-link [Rate Limiter](../02-RateLimiter/notes.md) for velocity checks.

---

## 13. Currency

### 13.1 Storage

- All amounts in minor units (cents, pence) as `BIGINT`
- Always tagged with `currency` (CHAR(3) ISO-4217)
- One account per currency per entity

### 13.2 Conversion

When charging in customer's currency but settling in your currency:

```
charge customer  $100 USD
settle bank      €92.50 EUR  (using FX rate at time of capture)
```

Record three entries:
1. Customer debit $100 USD
2. FX gain/loss in USD
3. Bank credit €92.50 EUR

Use Stripe's auto-conversion when available; for custom flows, lock in FX rate at authorization time. The treasury team owns the conversion strategy.

---

## 14. Tax

- US: per-state sales tax. Avalara, TaxJar, Stripe Tax automate.
- EU: VAT — must validate VAT IDs (VIES); reverse charge for B2B
- GST: India, Australia, Singapore
- Tax rate determined by (origin, destination, product type, buyer type)

For most teams: integrate with Stripe Tax or Avalara. Don't build your own tax engine — the rules change quarterly.

---

## 15. Audit & compliance

- Every operation logged to immutable audit table
- Records retained for **7 years** (SOX, IRS, tax authorities)
- PII fields encrypted at rest (KMS)
- Access logged + reviewed quarterly
- SOC 2 controls (segregation of duties — devs can't approve their own changes)

### 15.1 Cantor Fitzgerald approval workflow

```sql
CREATE TABLE approval_requests (
  id          UUID PRIMARY KEY,
  operation   VARCHAR(50),    -- "wire_transfer", "manual_adjustment"
  payload     JSONB,
  requested_by UUID NOT NULL,
  approvers   UUID[] NOT NULL,
  approvals   JSONB[],
  status      VARCHAR(20),    -- pending | approved | rejected | executed
  created_at  TIMESTAMP
);
```

Operations above a threshold require N approvers (e.g., 2 for $10k+, 3 for $1M+). Each approval is a signed event. After approval, the operation executes; before, it's just a request.

---

## 16. Trade-off matrix

| Decision | Option A | Option B | Choice + Why |
|----------|----------|----------|--------------|
| Storage | Mutable balance | Immutable ledger | **Ledger** — auditable, debuggable |
| Numbers | Float | Integer cents / Decimal | **Integer cents** — exact |
| Idempotency | Per-endpoint custom | Client-supplied key | **Client-supplied** (Stripe convention) |
| Distributed TX | 2PC | Saga | **Saga + orchestration** — modern, microservices-friendly |
| Card storage | Self-vault (PCI-DSS L1) | Provider tokens | **Provider tokens** — drastically reduces PCI scope |
| Subscription engine | Custom | Stripe Billing | **Stripe Billing** for B2C SaaS; custom for enterprise/complex |
| Reconciliation | Manual ops | Automated daily | **Automated daily** — anomalies surface fast |
| Tax | Self-built | Service (Stripe Tax / Avalara) | **Service** — rules change too often |

---

## 17. Failure modes

| Failure | Mitigation |
|---------|------------|
| Stripe API 5xx during charge | Retry with same idempotency key; if persistent, return ambiguous error to client |
| Network drop after charge but before persist | Webhook arrives later → reconcile; idempotency prevents double-credit on retry |
| Ledger entry inconsistent (only one side written) | Atomic transaction wraps both entries; constraint on sum=0 per transaction_id |
| Webhook signature spoofed | Verify signature; reject |
| Webhook delivered twice | Dedup by event.id |
| Refund processed twice | Compensating entry has its own idempotency key |
| Currency mismatch in arithmetic | Type system enforces `Amount<Currency>`; runtime check too |
| Race on concurrent charges (e.g., balance check + debit) | DB-level lock on account row (`SELECT FOR UPDATE`) or optimistic locking via version column |

---

## 18. Interview talking points

**Q: "How do you ensure no double-charges?"**
A: Idempotency keys. Every charge request carries an `Idempotency-Key` header (UUID). Server stores `(key, request_hash, response)`. If we see the same key, we return the original response without re-executing. Stripe's pattern. Retention 24-48h. Client retries are safe by construction.

**Q: "Why ledger over balance?"**
A: Immutable history. Balance is a derived sum — corrupting balance is a corruption that needs rollback recovery. Ledger entries are append-only; you can always reconstruct any historical state. Easier to audit, debug, reconcile, and dispute. Industry standard (Stripe, every bank).

**Q: "Float vs decimal for amounts?"**
A: Never floats — `0.1 + 0.2 ≠ 0.3` in IEEE 754, and these errors compound. Use integer cents (`$1.23 → 123`) or arbitrary-precision Decimal. Postgres `NUMERIC(20,4)` for storage. Stripe API exposes everything in minor units; we mirror that on the wire.

**Q: "How do you handle PCI compliance?"**
A: Never store raw card numbers. Tokenize via Stripe/Adyen — their SDK collects card data in an iframe; we get back `pm_xxx`. We store the token, charge the token. PCI scope reduces to SAQ-A (lightest). Building a card vault is technically possible but adds annual audits, dedicated environments, $$$$.

**Q: "Distributed transactions — 2PC or saga?"**
A: Saga, every time, for modern microservices. 2PC blocks resources, requires all participants to support XA (most cloud services don't), and has a coordinator as single point of failure. Saga is a sequence of local transactions with compensating actions. Orchestrate via Temporal or AWS Step Functions for production-grade workflow.

**Q: "How do you handle a Stripe webhook arriving twice?"**
A: Dedup by `event.id`. Insert into `processed_events` table; if conflict on insert, skip. Always verify signature (`stripe.webhooks.constructEvent`). Webhooks have to be idempotent because Stripe will retry on 5xx response or timeout.

**Q: "What's the hardest part of subscription billing?"**
A: Proration on upgrades/downgrades. User upgrades mid-period: charge the difference for the remaining time. Downgrade: credit the difference. Then there are pause/resume, trial extensions, dunning retries, currency changes... Stripe Billing handles 95% of this; for the last 5% (custom logic), you build on top of it. Don't roll your own subscription engine unless you have a specific reason — there's a year of edge cases hiding.

**Q: "How do you reconcile against the bank?"**
A: Daily automated job. Pull bank statements (via Plaid / direct integration). Group our ledger entries by day and clearing account. Compare sums. Flag any mismatch. Common sources of mismatch: timing (we record today, bank settles tomorrow), fees we didn't anticipate, chargebacks. Each flag is investigated by ops. Anomalies above a threshold page on-call.

**Q: "Tell me about an approval workflow."**
A: Cantor Fitzgerald required dual-control for any wire transfer above $10k and triple-control above $1M. Modeled as an `approval_requests` table — the operation is staged but not executed; N approvers must sign off (each approval signed and timestamped); only then does a worker execute. Segregation of duties: the requester cannot approve their own request. Audit trail meets SOX requirements.

---

## 19. Diagram

```
                    Customer
                      │
                      ▼
              ┌────────────────────┐
              │  Frontend          │
              │  (Stripe.js iframe)│
              └────────┬───────────┘
                       │ pm_xxx token
                       ▼
              ┌──────────────────────────────┐
              │  Payment API                  │
              │  - idempotency check          │
              │  - validate                    │
              └────────┬─────────────────────┘
                       │
        ┌──────────────┼────────────────┐
        │              │                │
        ▼              ▼                ▼
  ┌──────────┐  ┌──────────┐    ┌──────────────┐
  │ Ledger    │  │ Stripe   │    │ Idempotency  │
  │  DB       │  │   API    │    │  store       │
  └───────────┘  └────┬─────┘    └──────────────┘
                      │ webhook
                      ▼
              ┌──────────────────┐
              │ Webhook Handler  │
              │ - verify sig     │
              │ - dedup by event │
              │ - update ledger  │
              └─────┬────────────┘
                    ▼
              ┌──────────────────┐
              │ Saga Orchestrator│
              │ (Temporal)        │
              └─────┬────────────┘
                    ▼
              ┌──────────────────┐
              │ Reconciliation   │
              │ (daily cron)     │
              └──────────────────┘
```

---

## 20. Cross-links

- [Rate Limiter](../02-RateLimiter/notes.md) — velocity-based fraud signals
- [Notification Service](../03-NotificationService/notes.md) — invoices, receipts, dunning
- [Marketplace Platform](../05-MarketplacePlatform/notes.md) — Lystant escrow + payouts
- [URL Shortener](../01-URLShortener/notes.md) — receipts may include short links
- [Node.js notes](../../../backend/nodejs/notes.md) — circuit breaker for Stripe outages
- [General system design](../../general/notes.txt) — saga pattern, ACID, eventual consistency
- [Web Security](../../../frontend/performance-security/WebSecurity.md) — webhook verification, PCI
