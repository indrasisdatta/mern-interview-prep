# MERN Lead / Architect — Interview Prep (Round 2)

**Candidate:** Indrasis Datta · **Role:** UI Lead / MERN & GenAI Architect (11+ YOE)
**Purpose:** Full breakdown of 7 questions — your answer, the gaps, and an elaborate model answer with practical examples — followed by the topic areas covered and study notes.

> **How to use this:** Read each model answer out loud until it feels natural. The goal isn't to memorize wording — it's to internalize the *structure* so you can reconstruct it under pressure. Code blocks are there to make abstract points concrete.

---

## Question 1 — MongoDB Data Modeling

**Question:** Design the schema for an order-tracking system. Each order has a customer, multiple line items, and moves through many status changes (each with timestamp + actor). Agents query heavily by status, by customer, and by date range. Decide embed vs reference for each relationship, and index it for those queries.

**Your answer (summary):** Order with `status`, `customerId` (ref), `orderCreationTimestamp`, and embedded `lineItems`. Customer as a separate collection. Embedded line items because they're tightly bound to the order. After a nudge, you correctly moved status history to a separate `StatusEvents` collection. On indexing you knew you needed compound indexes but couldn't recall the rule.

**Gaps:**
- Initially modeled only a single `status` field and missed the *history* (the core of the question) until prompted.
- Didn't know the **ESR rule** or the **prefix rule** for compound indexes.

### Model answer

The first decision in MongoDB is always **embed vs reference**, and there's a simple rule of thumb:

> **Embed** when the child is accessed *together* with the parent, is *bounded* in size, and has *no independent life*. **Reference** when the child exists *independently*, is *shared*, *grows unbounded*, or is *queried on its own*.

Applying that to three relationships:

**Line items → embed.** They're always read with the order, they're bounded (an order has maybe 5–50 items, not 50,000), and they don't exist without the order. Embedding means one read fetches the whole order.

**Customer → reference.** A customer exists independently, is shared across many orders, and gets queried on their own ("show me everything for customer X"). Embedding would duplicate customer data into every order.

**Status history → reference (separate collection).** This is the subtle one. The order moves through *many* status changes over time — an append-only audit trail that grows unbounded. If you embed it as an array inside the order, three things go wrong: (1) every order fetch drags the entire history into memory even when you only need the current status; (2) the document keeps growing and risks MongoDB's **16 MB document limit**; (3) unbounded array growth is a known anti-pattern that hurts write performance. So you keep the *current* status denormalized on the order for the hot path, and push the full history to a separate collection.

```js
// orders
{
  _id: ObjectId,
  customerId: ObjectId,            // reference
  status: "shipped",               // current status, denormalized for fast reads
  orderCreationTimestamp: ISODate,
  lineItems: [                     // embedded — bounded, read together
    { itemName, itemPrice, quantity, discount, totalPrice }
  ]
}

// customers  (separate — independent, shared)
{ _id, firstName, lastName, email /* auth/credentials kept separate, never plaintext */ }

// statusEvents  (separate — unbounded audit trail)
{ _id, orderId, status, updatedBy, updatedAt }
```

**Indexing — the ESR rule.** When you build a compound index, order the fields as **E**quality → **S**ort → **R**ange:

- **Equality:** fields matched exactly (`customerId`, `status`)
- **Sort:** fields you `.sort()` by
- **Range:** fields with `$gt`/`$lt` / date ranges

For the query *"orders for customer X, status shipped, created in the last 7 days, newest first"*:

```js
db.orders.createIndex({ customerId: 1, status: 1, orderCreationTimestamp: -1 })
// Equality: customerId, status → Sort+Range: orderCreationTimestamp
```

The timestamp sits last and serves *both* the sort and the date range. Also remember the **prefix rule**: this index can serve queries on `customerId`, on `customerId + status`, or all three — but **not** `status` alone, because `status` isn't a left-prefix. So you design indexes around your *real* query shapes, and you'll often have 2–3 compound indexes for the 2–3 dominant access patterns rather than one index per field.

**Practical note:** the `status` field appears in *both* the order (current) and `statusEvents` (history). That's deliberate denormalization — the cost is you update two places on a status change, the benefit is the common "show current state" read never touches the history collection. That read/write trade-off is the heart of MongoDB modeling.

---

## Question 2 — TypeScript Depth

**Question:** You're designing a shared types package. The `/notifications` endpoint returns one of three shapes (`OrderUpdate`, `PaymentAlert`, `SystemMessage`). How do you type the return so a consumer can safely tell which one it holds? How does the consumer narrow it? And at an unknown boundary like `JSON.parse`, do you use `any` or `unknown`?

**Your answer (summary):** Union type with the pipe (`OrderUpdate | PaymentAlert | SystemMessage`). Consumer uses `instanceof`. `unknown` is stricter than `any`; "any can be undefined."

**Gaps:**
- `instanceof` only works on **class instances** — JSON responses are plain objects, so it won't work here.
- Missed the **discriminated (tagged) union** pattern — the actual mechanism.
- `unknown` vs `any` reasoning was muddled (it isn't about `undefined`).

### Model answer

A bare union (`A | B | C`) is the right *start*, but on its own TypeScript can't tell the members apart at runtime. The pattern that makes that safe is a **discriminated (tagged) union**: every member carries a shared **literal** field that acts as a tag.

```ts
type OrderUpdate   = { kind: "order";   orderId: string; status: string };
type PaymentAlert  = { kind: "payment"; amount: number;  currency: string };
type SystemMessage = { kind: "system";  message: string };

type Notification = OrderUpdate | PaymentAlert | SystemMessage;
```

The consumer narrows by checking the discriminant — and TypeScript *knows* the exact type inside each branch:

```ts
function render(n: Notification) {
  switch (n.kind) {
    case "order":   return `Order ${n.orderId} → ${n.status}`;   // n is OrderUpdate
    case "payment": return `Charged ${n.amount} ${n.currency}`;  // n is PaymentAlert
    case "system":  return n.message;                            // n is SystemMessage
    default:
      const _exhaustive: never = n;  // compile error if a new kind is added but unhandled
      return _exhaustive;
  }
}
```

That `never` check gives you **exhaustiveness**: the day someone adds a fourth notification type, this function fails to compile until it's handled. That's a huge real-world safety win in a shared types package consumed by many remotes.

`instanceof` is the wrong tool here because it walks the **prototype chain** to test class membership — but `JSON.parse` produces plain objects, not class instances. `instanceof` is for `if (err instanceof HttpError)`, not for tagged data.

If you can't add a discriminant (e.g., a third-party shape), use a **user-defined type guard**:

```ts
function isPayment(n: Notification): n is PaymentAlert {
  return (n as any).currency !== undefined;
}
```

**`unknown` vs `any` — the operational difference.** It's not about `undefined`. The difference is what the compiler *lets you do*:

- **`any`** switches type-checking *off*. You can read any property, call it, assign it anywhere — no errors, no safety. It's an escape hatch that quietly spreads.
- **`unknown`** is the *safe* counterpart. You can assign anything *to* it, but you can't *do* anything with it until you **narrow** it.

```ts
const raw: unknown = JSON.parse(body);
// raw.kind          ❌ compile error — must narrow first
if (typeof raw === "object" && raw && "kind" in raw) { /* now usable */ }
```

So the rule at any boundary (parsed JSON, `localStorage`, an API edge): **type it `unknown`, then validate** — ideally with a schema validator like **Zod**, which gives you a *runtime*-checked, *compile-time*-typed object in one step:

```ts
const Notification = z.discriminatedUnion("kind", [/* ...schemas... */]);
const n = Notification.parse(JSON.parse(body)); // throws if shape is wrong; typed if not
```

**Practical note:** discriminated unions + Zod at the edges is the single most valuable TS pattern for a MERN app — it turns "the server sent something unexpected and the UI exploded three components deep" into a single, clear error at the boundary.

---

## Question 3 — Auth & Security Across Micro-frontends

**Question:** In a micro-frontend banking app, where do you store the auth token and why? Which attack (XSS or CSRF) does your choice invite, and how do you defend? How do all remotes share the session without re-implementing login?

**Your answer (summary):** Refresh token in `httpOnly`+`Secure`+`SameSite=Lax` cookie; access token in memory (Redux); silent refresh via interceptor. localStorage invites XSS. Cross-remote: host exposes `isAuthenticated()`/`logout()` helpers; sync via custom events or an RxJS observable.

**Gaps:**
- Slightly tangled the attack mapping (attributed CSRF prevention partly to `httpOnly`).
- Said in-memory storage "prevents XSS" — it doesn't; it only limits exfiltration.
- Didn't name the *primary* XSS control (output encoding / React escaping / DOMPurify).

### Model answer

This was your strongest area; the model answer just makes the mapping airtight.

**Token storage.** Two tokens, two homes:

- **Refresh token →** `httpOnly; Secure; SameSite` cookie. `httpOnly` means JS can't read it (so XSS can't steal it), `Secure` means HTTPS-only, `SameSite` means it isn't sent on cross-site requests.
- **Access token →** in **memory** (a module variable or Redux), short-lived (5–15 min). Not in `localStorage`, because anything in `localStorage` is readable by any script on the page and *persists* — a single XSS hole exfiltrates it permanently.
- **Silent refresh:** when the access token is missing/expired, an Axios interceptor calls `/refresh`; the browser automatically attaches the `httpOnly` refresh cookie, and you get a fresh access token without the user re-logging-in.

**The attack mapping — memorize it 1:1:**

| Attribute | Stops | Mechanism |
|-----------|-------|-----------|
| `httpOnly` | **XSS** token theft | JS can't *read* the cookie |
| `SameSite` | **CSRF** | cookie not *sent* on cross-site requests |
| `Secure` | MITM | HTTPS only |

`httpOnly` does **not** stop CSRF — `SameSite` does. Keep them separate.

**Does in-memory storage prevent XSS? No.** If an attacker lands an XSS payload, their script runs *inside your page's context* — it can read your in-memory variables and fire authenticated API calls as the victim. In-memory only stops *cross-session exfiltration* (there's nothing persisted to steal later). So storage location is *damage limitation*, not prevention.

**The actual XSS defense is layered, and storage isn't the first layer:**

1. **Primary — don't inject untrusted data as HTML.** React already does this for you: `{userInput}` is escaped by default. The rule is simply *never* pass untrusted input to `dangerouslySetInnerHTML`.
2. **If you must render user HTML** (e.g., a rich-text comment) → sanitize with **DOMPurify** first.
3. **Backstop — CSP** (`Content-Security-Policy: script-src 'self'`) blocks injected/inline/external scripts in case something slips through.

So: React escaping → DOMPurify for raw HTML → CSP backstop. CSP is the net, not the first line.

**Cross-remote session.** The host owns auth and exposes a shared **singleton auth service** (shared via Module Federation), not duplicated logic. Remotes consume it and stay in sync via an **observable**:

```ts
// host: shared singleton
authService.user$  // BehaviorSubject<User | null>
authService.login(), authService.logout()

// any remote
useEffect(() => authService.user$.subscribe(setUser).unsubscribe, []);
```

When the host logs out, it pushes `null` to `user$`; every subscribed remote reacts instantly. (Custom DOM events work too, but an observable is cleaner because new subscribers immediately get the current value.)

**Practical note for a banking panel:** add **CSRF tokens (double-submit)** on top of `SameSite` for older browsers and for any state-changing GET, and mention **short access-token TTL + rotation of refresh tokens** — those details signal you've shipped real auth, not just read about it.

---

## Question 4 — RAG Evaluation

**Question:** Your RAG system was working; then a big batch of new docs was ingested and answers got worse. How do you diagnose it? What metrics catch this regression automatically? Name the retrieval metrics and the generation metrics.

**Your answer (summary):** Check retrieval vs generation. For retrieval, check embeddings/chunking. Put MRR + reranking + BM25 under "generation." Track precision/recall/groundedness/MRR via LangSmith in prod.

**Gaps:**
- Repeatedly mis-sorted **MRR, reranking, BM25, hybrid search into "generation"** — they're all **retrieval**.
- Didn't reach the specific diagnostic (re-run the golden eval set, compare recall before/after).

### Model answer

A RAG system is **two stages**, and almost every quality problem belongs to exactly one. Getting the split automatic is the whole skill:

```
            RETRIEVAL                         GENERATION
query → [vector search] → top-k chunks → [prompt + LLM] → answer
```

**Stage 1 — Retrieval** (which chunks come back, and in what rank order):
- **Metrics:** `recall@k` (did the correct chunk make the top-k?), `precision@k`, **MRR / NDCG** (how *high* did it rank?), hit rate.
- **Fixes:** chunking strategy, embedding model, **reranking** (cross-encoder), **hybrid search** (semantic + **BM25** keyword), raising k.
- **Memory hook:** MRR = Mean Reciprocal **Rank**. Anything about *ranking which docs come back* is retrieval.

**Stage 2 — Generation** (the LLM turning chunks into an answer):
- **Metrics:** **faithfulness / groundedness** (is the answer supported by the retrieved chunks, i.e., not hallucinated?), answer relevance, correctness.
- **Fixes:** prompt design, context ordering, removing distractor chunks, lowering temperature, a stronger model.
- **The defining test:** it's only a *generation* problem if the correct chunk **was retrieved and ranked well** but the LLM still answered wrong.

So MRR/reranking/BM25/hybrid → **retrieval**. Groundedness → **generation**. That single boundary is what a GenAI panel checks.

**Diagnosing the actual scenario.** "Answers got worse right after ingesting new docs" is almost always a *retrieval* regression, and here's how you prove it in one run:

1. **Re-run your golden eval set.** You should already maintain a labelled set of `question → known-correct chunk` pairs. Run it against the *new* index and compare **recall@k before vs after**.
2. If recall **dropped**, the new documents are acting as **distractors** — semantically similar but irrelevant chunks crowding the truly-correct chunk out of the top-k. That's a pure retrieval problem.
3. **Fixes, in order of effort:** add a **reranker** so the right chunk floats back to the top even in a noisier pool; move to **hybrid search** (BM25 + semantic) so exact terms like policy codes aren't lost; re-examine **chunking** (semantic / parent-child retrieval beats naive `RecursiveCharacterTextSplitter` for varied docs); raise k modestly.

**Catching it automatically in prod:** run the golden eval set on every index rebuild in CI (a regression gate), and in production track `recall@k`, `groundedness`, and answer relevance with **RAGAS** and **LangSmith**, alerting when groundedness or recall crosses a threshold — so you find the regression before agents complain.

**Practical note:** the most common real-world RAG failure is *exactly* this — quality silently degrades as the corpus grows because retrieval gets noisier. Teams that win build the golden-eval-set gate early; teams that lose ship "it felt fine in the demo" and discover the regression from angry users.

---

## Question 5 — Leadership Under Deadline Pressure

**Question:** A hard external deadline is two weeks out and you won't finish everything at the quality you'd want. How do you decide what to cut? How do you communicate the slip/scope-cut *upward*? What stays non-negotiable?

**Your answer (summary):** Don't compromise security/code-quality. Discuss priorities with stakeholders. Show dummy data for low-priority screens in a demo. Communicate the moment it's clear (2 weeks out). Lower unit coverage to ~70% on low-priority screens; log as tech debt for next sprint.

**Gaps:**
- Skimmed the *upward communication craft* — said "help us prioritize" rather than bringing options + a recommendation.
- Started absolutist ("never compromise quality") which contradicts cutting scope; needed an honest, contained trade-off (which you reached on the follow-up).

### Model answer

A senior lead handles a crunch in three moves: **prioritize with a method, communicate up with options, and protect a small set of non-negotiables.**

**1. Prioritize with a method, not vibes.** Sort the remaining work by *value × risk* (or MoSCoW — Must / Should / Could / Won't). Anchor on the event: for a *demo*, "Must" = the screens that tell the story end-to-end; for a *regulatory* date, "Must" = whatever is legally required. Everything else is negotiable.

**2. Communicate upward early — and bring options, not a problem.** The moment the risk is real (not the night before), go to the date-owner. The junior move is "we're going to slip, help us prioritize." The senior move is to **own the analysis and present scoped options with a recommendation**:

> "We can hit the date three ways:
> **A —** full scope, but we slip one week.
> **B —** ship the core flow on time, defer screens X and Y to a fast-follow next sprint. *(My recommendation.)*
> **C —** all screens on time, secondary ones on dummy data with a clear 'preview' label.
> I recommend **B** because the core flow is what the client evaluates, and X/Y are low-traffic.
> Which trade-off do you want to make?"

You did the thinking; they make the call (they own the date). That framing reads as leadership, not escalation.

**3. Protect non-negotiables; make everything else *deliberate* debt.** Be honest — you *do* trade things under a crunch; the skill is trading the *right* things and containing the risk:

- **Never compromise:** security, data integrity, and correctness on the **critical path** (auth, payments, anything irreversible in prod). These are one-way doors.
- **Willing to trade (deliberately):** test coverage on **low-risk** screens (keep it high on payments/auth), refactoring/polish, a known limitation behind a flag with a fast-follow.
- **Make the debt safe:** write it down (ticket + owner + payback sprint), feature-flag anything risky so it's reversible, and never let "temporary" debt go untracked.

**The mental model:** flex on **two-way doors** (reversible — implementation details, polish, coverage on low-risk paths); hold firm on **one-way doors** (expensive or impossible to undo — security, data, public contracts). That single framing answers most leadership questions cleanly.

**Practical note:** have *one real story* ready where you held a one-way-door line under pressure (e.g., refused client-only auth checks, moved enforcement server-side, ate a sprint of friction, and a later audit proved you right). Structure: *it was a one-way door → here's what I refused → here's the cost I paid → here's how it paid off.*

---

## Question 6 — System Design & Resilience

**Question:** A dashboard must show an order's full state aggregated from 4 services (billing, shipping, CRM, inventory) in under 200ms for thousands of concurrent agents. Architect the read path. Inventory is slow/flaky (3s or failing) — stop it from blowing the budget. Name the resilience patterns.

**Your answer (summary):** Frontend: parallel calls, per-section skeletons, Suspense, ErrorBoundary, manual retry button. On follow-up: TanStack Query caching, exponential backoff + jitter (429 + Retry-After), and a correct circuit-breaker state machine; said "send 429" when a service is down.

**Gaps:**
- Answered mostly at the **UI layer**; missed the **BFF / aggregation** architecture pattern.
- Missed **timeout** — the first-line control for a latency budget.
- Fumbled the **fallback**: sent `429` (rate-limit) instead of `503` + serving **cached/stale** data.

### Model answer

This is two layers: **the architecture (how data is composed)** and **the resilience stack (how you survive a slow dependency)**. You were strong on the *UI* resilience; here's the full picture.

**Architecture — put a BFF in front.** Don't have thousands of browsers each fire four calls to four services. Introduce a **Backend-for-Frontend (BFF) / aggregation service**: the dashboard calls **one** endpoint; the BFF fans out to the four services **server-to-server** (low-latency, parallel), composes one response, and becomes the single place to apply caching and resilience.

```
[browser] → GET /dashboard/order/123 → [BFF]
                                          ├─▶ billing
                                          ├─▶ shipping
                                          ├─▶ crm
                                          └─▶ inventory  (slow/flaky)
                                        composes one JSON, returns in budget
```

This buys you: fewer client round-trips, **server-side caching** (cache the slow/stable inventory data so most requests never hit it), one consistent contract, and resilience in *one* place instead of re-implemented per remote.

**The resilience stack — in order:**

1. **Timeout (first line, the direct answer to the latency budget).** Cap each downstream call — e.g., inventory at 150ms. The instant it exceeds, you abandon it. This is what stops a *single* 3s call from blowing 200ms; the circuit breaker only helps *after repeated* failures. **Always name timeout first** in a latency-budget question.
2. **Circuit breaker (stop hammering a dead service).** Track failures: **Closed** (normal) → on a failure threshold → **Open** (fail fast immediately, don't even call) → after a cooldown → **Half-Open** (let a few trial requests through) → all succeed → **Closed**. This prevents pile-ups against a service that's already down.
3. **Fallback / graceful degradation (what you serve when it's down).** Don't fail the page and don't send `429` (that's *rate limiting*; "down" is **`503`**). Instead, serve **cached/stale** inventory or a placeholder ("inventory temporarily unavailable") for *that section* while billing, shipping, and CRM render fully and in budget. **Degrade the section, not the page** — which is exactly the per-section skeleton/ErrorBoundary instinct you had at the UI, now mirrored server-side.
4. **Retry with backoff + jitter (for transient blips).** On a transient failure, retry with **exponential backoff + random jitter** (and honor `Retry-After` on a `429`). Jitter prevents a thundering herd where every client retries at the same instant. Keep retries *bounded* — naive retries against a struggling service make it worse.
5. **Bulkhead (isolation).** Give inventory its own connection/thread pool so its slowness can't exhaust the resources the other three services need. One failing dependency stays contained.

**Putting it together:** BFF aggregates → each call has a **timeout** → a **circuit breaker** guards the flaky one → on failure, serve **cached/stale fallback** → transient errors get **bounded backoff+jitter retries** → **bulkheads** isolate the blast radius. The dashboard returns a useful, in-budget response even when inventory is on fire.

**Practical note:** the one-liner that lands in interviews — *"the 200ms budget means inventory's freshness is negotiable; I'd time it out fast and serve last-known-good, because an agent needs the order's billing/shipping state* now *more than a perfectly-fresh inventory count."* That shows you're optimizing for the *user's* need, not just for green checkmarks.

---

## Question 7 — Testing Strategy

**Question:** Describe your testing pyramid for a large React app — what's unit, what's integration, where's the weight. What does MSW give your RTL tests that mocking `fetch` doesn't? And what makes an individual test *valuable* (vs passing-but-catching-nothing)?

**Your answer (summary):** Unit = isolated components with mocks; integration = components together with MSW-mocked API. MSW decouples from the HTTP client (fetch vs axios). Beyond coverage, you need visual/manual/a11y (axe-core) testing.

**Gaps:**
- Pyramid was half-answered — no weighting, no **E2E** layer.
- On "what makes a test valuable" you pivoted to test *types* instead of **assertion quality** (behavior vs implementation).

### Model answer

**The pyramid (or, for React, the "trophy").** Three layers, and the *weight* matters:

- **Unit (some):** pure logic — utils, reducers, hooks, formatting. Fast, but a passing unit test on an isolated component tells you little about real behavior.
- **Integration (the most weight, for React):** a component or feature rendered with its real children and an **MSW-mocked** API, driven the way a user drives it. This is the best confidence-per-effort tier — it catches the bugs that actually happen (wiring, data flow, conditional rendering). The modern "testing trophy" deliberately puts the *bulge* here, not at the unit layer.
- **E2E (a few):** **Playwright/Cypress** over a handful of *critical* flows (login, checkout) against a real-ish stack. High confidence, but slow and flaky, so you keep them few.

Saying "I weight integration heaviest because that's where real bugs live, with a thin E2E layer over critical paths" is the senior framing.

**Why MSW over mocking `fetch`.** MSW intercepts at the **network layer** (a service worker / request interceptor), so:
- It's **HTTP-client-agnostic** — switch `fetch` → `axios` and not a single test changes.
- Your test **exercises your real data-fetching code** (the actual request goes out and is intercepted at the boundary) instead of stubbing the function away. You're testing more real code, so the test is more trustworthy.
- The same handlers can power tests *and* a local dev mock server — one source of truth.

```ts
// one handler, reused by every test (and dev)
http.get("/api/order/:id", () => HttpResponse.json({ id: "123", status: "shipped" }));
```

**What makes a test *valuable* — behavior, not implementation.** This is the crux. A valuable RTL test asserts **what the user observes**, not how the component is built:

```ts
test("shows the order status after it loads", async () => {
  render(<OrderCard id="123" />);
  // query the way a USER finds things — by role/label/text
  expect(await screen.findByText(/shipped/i)).toBeInTheDocument();
});

test("retries when the user clicks Retry", async () => {
  render(<OrderCard id="123" />);
  await userEvent.click(screen.getByRole("button", { name: /retry/i }));
  expect(await screen.findByText(/shipped/i)).toBeInTheDocument();
});
```

What makes these good: they query by **accessible role/text** (so they also pin a11y), they simulate **real user interaction** with `userEvent`, and they assert on **rendered output**. What they *avoid*: reaching into internal state, asserting "this function was called," or querying by brittle `data-testid`s. A test coupled to implementation passes while catching nothing and **breaks on every refactor** — that's negative value. RTL's guiding line says it best:

> *The more your tests resemble the way your software is used, the more confidence they give you.*

**On coverage:** a coverage *number* (line/branch/function) measures what code *ran*, not what was *verified* — you can hit 90% with assertions that prove nothing. Use coverage to find *untested* areas, never as the definition of "well tested." Your additions (visual regression, `axe-core` for a11y) are correct *complements* — just remember they answer "is it tested *enough/other ways*," not "is *this* test good."

**Practical note:** if a panel asks for a single principle, give them "test behavior, not implementation," then show the `getByRole` + `userEvent` example. It instantly signals you've written tests that survived real refactors.

---

## Areas Covered + Study Notes

A map of the topic areas these seven questions touched, with a short note on what to lock in for each.

### 1. NoSQL data modeling (MongoDB)
Embed-vs-reference decision rule; the 16 MB document limit and the unbounded-array anti-pattern; denormalizing current state for hot reads while keeping history separate. **Indexing:** the **ESR rule** (Equality → Sort → Range) and the **prefix rule** for compound indexes. *Note: design indexes around real query shapes, not per-field.*

### 2. TypeScript type system
**Discriminated (tagged) unions** + narrowing + `never`-based exhaustiveness; **type guards** (`x is T`); `instanceof` is for classes only; **`unknown` vs `any`** (operational difference — `unknown` forces narrowing); validate boundaries with **Zod**. *Note: this was the biggest fresh gap — highest-ROI study area.*

### 3. Web security & auth
Token storage (refresh in `httpOnly`+`Secure`+`SameSite` cookie, access in memory, silent refresh); the 1:1 attack mapping (`httpOnly`→XSS read, `SameSite`→CSRF, `Secure`→MITM); **XSS defense is layered** — React escaping (primary) → DOMPurify → CSP (backstop); cross-remote session via a shared singleton auth service + observable. *Note: confirmed strength — keep it.*

### 4. RAG / GenAI architecture & evaluation
The **two-stage pipeline** and which metrics each stage owns — **retrieval** (recall@k, precision@k, MRR/NDCG; fixes: chunking, embeddings, reranking, hybrid/BM25, k) vs **generation** (faithfulness/groundedness, relevance; fixes: prompt, context, temperature, model). **Diagnosis:** golden eval set + recall@k before/after; distractor chunks as the corpus grows. Tools: RAGAS, LangSmith. *Note: the retrieve-vs-generate boundary still needs to become reflexive.*

### 5. Technical leadership & stakeholder management
Prioritization method (value×risk / MoSCoW); **upward communication = options + recommendation, you own analysis, they own the decision**; non-negotiables (security, data integrity, critical-path correctness); **deliberate, contained tech debt** with a payback plan; the **two-way vs one-way door** framing. *Note: improved a lot from round 1 — finish by polishing the "bring options" move and prepping one hold-firm story.*

### 6. Distributed system design & resilience
**BFF / aggregation** layer for fan-out + central caching/resilience; the resilience stack in order — **timeout → circuit breaker → fallback (cached/stale, degrade the section) → backoff+jitter retries → bulkhead**; correct status codes (`503` down, `429` rate-limit + `Retry-After`). *Note: force yourself to answer architecture questions from the **service boundary**, not the UI — that was the recurring gap.*

### 7. Testing strategy
The pyramid/**trophy** with weight on **integration**, thin **E2E** (Playwright); **MSW** intercepts at the network layer (client-agnostic, exercises real fetch code); **value = behavior over implementation** (query by role/text, `userEvent`, avoid internal-state/`data-testid` assertions); coverage finds gaps, doesn't define quality. *Note: lead with "test behavior, not implementation" + the `getByRole` example.*

---

### Priority order for revision
1. **TypeScript depth** (discriminated unions, `unknown`/`any`, guards) — fresh, high-ROI.
2. **Backend system-design patterns** (BFF + the timeout→breaker→fallback→backoff stack) — answer from the service boundary.
3. **RAG retrieve-vs-generate boundary** — make it automatic.
4. **Testing philosophy** (behavior over implementation; trophy weighting; E2E).
5. **MongoDB indexing** (ESR + prefix) — now learned, just reinforce.

*Strengths to keep sharp and lean on in real loops: security/auth and frontend resilience.*