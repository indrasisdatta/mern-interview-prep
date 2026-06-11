# FE System Design — Real-Time Dashboard (Verizon Auto-Triaging)

> Resume project: **Verizon Auto Triaging Digital First** — tracks order statuses across Verizon apps for support agents/managers.
>
> Cross-link: [FE System Design notes](../../../../system-design/frontend-system-design/FESystemDesignNotes.md) · [Virtualization](../../../react/virtualization.md) · [Browser rendering pipeline](../../browser-rendering-pipeline.md) · [Performance optimization](../../../performance-security/performance-optimization.txt)

---

## How to read these notes — RADIO

These notes follow the **RADIO** framework so you can deliver them as an interview answer top-to-bottom:

- **R** — Requirements exploration (clarify scope, functional + non-functional)
- **A** — Architecture / high-level design (boxes, responsibilities, data flow)
- **D** — Data model (where state lives, query keys, the patch pipeline)
- **I** — Interface definition (REST endpoints, the realtime event contract, key hook/module signatures)
- **O** — Optimizations & deep dives (the part interviewers actually probe)

Three deliberate style choices vs. a "textbook" answer, all worth saying out loud:

1. **No classes — modules + factory functions + closures.** Easier to tree-shake, trivial to mock in tests, no `this` binding traps, and pure transforms separate cleanly from side effects.
2. **WebSocket (via Socket.io), not SSE — despite SSE being the dashboard default.** Honest history: the 2023 build used WebSocket and we reused it in 2025 rather than rewrite working infra. It also happens to fit — the dashboard is a two-way conversation (agents change filters / open live detail; the server responds), which is WebSocket's shape, not SSE's. Full version in O1.1; Socket.io-vs-raw-WS is O1.2.

3. **`useLayoutEffect` only where paint timing genuinely matters** — not as a blanket replacement for `useEffect`. The precise rule is the deep dive in O3 (short version: subscriptions stay in `useEffect`; pre-paint DOM reads/writes go in `useLayoutEffect`).

---

## R — Requirements exploration

### R.0 Clarifying questions to ask first

In the interview, open by scoping. Good questions:

- Read-only dashboard, or do agents take actions (approve / reassign / annotate)? → affects mutation + optimistic-update design.
- How many concurrent rows realistically visible — hundreds or thousands? → drives virtualization.
- Peak event rate? "A few/sec normally, 100+/sec during incidents" → drives batching + drop policy.
- One tab or many per agent? → SharedWorker / BroadcastChannel question.
- Is the backend already Socket.io-capable, or raw WS / SSE? → see O1 trade-off (this is a real constraint, not a free choice).
- Hard latency SLA? "≤1s p95" → sets the WS-lag budget.

### R.1 Functional

- Live, virtualized order table (1k–10k rows) with column sort / filter / group.
- Stream `order.created`, `order.updated`, `defect.detected`; apply in place.
- Filter by status, region, agent, time window.
- Drill into one order → detail drawer with tabs (summary, timeline, items, defects, MR).
- KPI cards update in real time without re-rendering the whole dashboard.
- Timeseries charts (last 1h window).
- "Pause live updates" toggle (agents read stable data).
- Export filtered data to CSV.

### R.2 Non-functional

| Attribute | Target |
|---|---|
| Latency | UI reflects backend update within **1s p95** |
| Performance | 60 FPS scroll on 5000-row table; **INP < 200ms** |
| Reliability | Survives reconnect / blips; no freeze during bursts |
| Accessibility | **WCAG 2.2 AA** — keyboard nav, screen-reader friendly |
| Scale | One agent, page open 8h, up to ~100k updates |
| Observability | Real-user CWV + custom WS-lag metric |

### R.3 Out of scope (state it, it shows judgment)

Backend fan-out architecture, auth/SSO internals, and the MCP triaging model itself. We consume its `defect.detected` events; we don't design it.

---

## A — Architecture / high-level design

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser tab                                                     │
│                                                                  │
│  ┌─────────────────┐   ┌──────────────┐   ┌──────────────────┐   │
│  │ React UI layer  │←─►│ Store / Query│←─►│ Realtime layer    │   │
│  │  (components)   │   │ (Redux + RQ) │   │ (socket.io client)│   │
│  └────────┬────────┘   └──────────────┘   └────────┬─────────┘   │
│           │                    ↑                    │             │
│           ↓                    │                    ↓             │
│  ┌─────────────────┐    ┌──────┴────────┐    ┌──────────────┐    │
│  │ Virtualization  │    │ Selectors,    │    │ RAF batcher  │    │
│  │ (TanStack       │    │ derived data  │    │ + catch-up   │    │
│  │  Virtual)       │    └───────────────┘    └──────────────┘    │
│  └─────────────────┘                                             │
│                                                                  │
│  Web Worker (CSV export, heavy chart/data aggregation)           │
└─────────────────────────────────────────────────────────────────┘
                          ↑                  ↑
                          │ Socket.io         │ REST (initial load,
                          │ (over WS)         │ drill-in, catch-up)
                  ┌───────┴────────┐
                  │  API Gateway   │
                  │ (sticky LB for │
                  │  socket.io)    │
                  └────────────────┘
```

### Layer responsibilities

- **Realtime layer** — a single `realtimeClient` module owns the Socket.io connection, subscriptions, and reconnect/catch-up. It exposes a tiny `on()` subscribe API; it does **not** know about React Query.
- **RAF batcher** — a separate `updateBatcher` module coalesces a burst of events into one flush per animation frame, then calls a pure `applyOrderEvent` into the cache.
- **Store / Query** — React Query owns server data; Redux owns UI state (O… D below).
- **UI layer** — dumb-ish components reading selectors / query `select`. Memoized rows.
- **Web Worker** — anything that would block the main thread (CSV string build, large aggregations).

The key seam: **transport → batcher → pure apply → cache → selectors → components.** Each hop is a separately testable module.

---

## D — Data model: where does state live?

The single most-asked question for real-time dashboards. Answer: **split by ownership, not by convenience.**

| Concern | Tool | Why |
|---|---|---|
| Server data cache (orders list, detail, KPIs) | **React Query** | Built-in stale time, refetch, dedupe, invalidation, GC. |
| Streaming patches | **React Query `setQueryData`** | Patch the existing cache in place; selectors recompute. |
| UI state (filters, selected id, drawer open, paused) | **Redux Toolkit** | Persisted across nav, observable, URL-syncable, devtools/time-travel. |
| Local ephemeral (input value, tooltip) | **`useState`** | Component-local, no reason to lift. |

### D.1 Why not Redux for everything?

The inherited team will want one store "for a single source of truth." But server data and UI state have different lifecycles. Putting server data in Redux means re-implementing request dedupe, refetch, staleness, GC, and optimistic mutations by hand — 4× the boilerplate for a worse result. React Query already *is* a normalized async cache. Redux models *UI*, which React Query has no opinion about. Use each for what it's good at.

### D.2 Query keys

```
["orders"]                  // the live list (patched by the stream)
["order", id]               // a single drilled-in order
["kpis"]                    // aggregate counters (or derived via select)
["alerts"]                  // defect feed, capped to last 1000
```

### D.3 The patch pipeline — pure transforms, no class

Separate the **pure transform** (testable, no side effects) from the **side-effecting apply**:

```ts
// orderCache.ts

// Pure: take a list + an event, return a new list. Easy to unit test.
export function patchOrderInList(
  orders: Order[] = [],
  id: string,
  changes: Partial<Order>,
): Order[] {
  // New ref only for the changed row; unchanged rows keep identity → memo holds.
  return orders.map((o) => (o.id === id ? { ...o, ...changes } : o));
}

// Side-effecting: apply one event to the relevant caches.
export function applyOrderEvent(qc: QueryClient, event: ServerEvent): void {
  switch (event.type) {
    case "order.updated":
      qc.setQueryData<Order[]>(["orders"], (prev) =>
        patchOrderInList(prev, event.orderId, event.changes),
      );
      qc.setQueryData<Order>(["order", event.orderId], (prev) =>
        prev ? { ...prev, ...event.changes } : prev,
      );
      return;
    case "order.created":
      qc.setQueryData<Order[]>(["orders"], (prev = []) => [event.order, ...prev]);
      return;
    case "defect.detected":
      qc.setQueryData<Alert[]>(["alerts"], (prev = []) =>
        [event.alert, ...prev].slice(0, 1000), // cap history (8h session memory)
      );
      return;
  }
}
```

> **Memo invariant:** the reducer/transform must mint a **new object reference for changed rows** and **preserve references for unchanged rows**. That's what lets `React.memo` on the row skip 99% of re-renders during a burst. Immer or manual spread both satisfy this — `patchOrderInList` above does it by hand.

---

## I — Interface definition

### I.1 REST (initial load + drill-in + catch-up)

```
GET  /api/orders?status=&region=&agent=&from=&to=     → Order[]   (initial / refetch)
GET  /api/orders/:id                                   → OrderDetail (drawer)
GET  /api/orders/since/:ts                             → ServerEvent[] (reconnect catch-up)
GET  /api/kpis                                          → Kpis
POST /api/orders/:id/approve                            → mutation (optimistic)
```

### I.2 Realtime event contract (over Socket.io)

```ts
// Server → client
type ServerEvent =
  | { type: "order.updated";  orderId: string; changes: Partial<Order>; ts: number }
  | { type: "order.created";  order: Order;                              ts: number }
  | { type: "defect.detected"; alert: Alert;                             ts: number };

// Client → server
//   emit("subscribe",   { topic: "orders", filter: Filter })
//   emit("unsubscribe", { topic: "orders" })
```

Topic-based subscription lets us multiplex multiple streams (orders, alerts, presence) over one connection. Each event carries `ts` — used both for ordering and for the `ws_lag = Date.now() - ts` metric.

### I.3 Key module / hook signatures (the public surface)

```ts
createRealtimeClient(url: string): RealtimeClient
  // { connect, disconnect, subscribe(topic, filter), on(handler) → unsub, lastEventTs() }

createUpdateBatcher(apply: (batch: ServerEvent[]) => void): UpdateBatcher
  // { enqueue(event), size() }

useOrderStream(client, batcher): void        // wires transport → batcher (useEffect)
useScrollRestore(ref, depKey): void          // pre-paint scroll restore (useLayoutEffect)
```

---

## O — Optimizations & deep dives

### O1 — Real-time transport (two decisions)

This is really **two** decisions, and interviewers conflate them. Keep them separate:

1. **WebSocket family vs SSE** — what *protocol shape*? (O1.1)
2. **Socket.io vs raw `WebSocket`** — within the WS family, what *client*? (O1.2)

#### O1.1 — Why WebSocket, not SSE (the one to defend)

**The simple, honest version (lead with this):** the first version of this dashboard was built on WebSocket back in **2023**. When we picked it up again in **2025**, the real-time layer already worked, so we extended it instead of rewriting the transport. *You don't rip out working real-time infra without a strong reason* — that's the primary reason, and it's a legitimate engineering call, not a cop-out. The rest of this section is me **sanity-checking that the inherited choice was actually a good fit** — which it was.

**The reason it isn't SSE here:** this dashboard is **not a passive feed — it's an interactive, server-side-filtered query surface.** The agent continuously re-targets *what gets streamed*:

- filter by status / region / agent / time-window (changes many times per shift),
- open a drawer → subscribe to **one order's** high-frequency detail/timeline stream; close it → unsubscribe,
- pause/resume, presence, and (next) collaborative "who's viewing this order".

That re-targeting is a **control loop**, and it must run on the **same ordered, persistent channel** as the events — otherwise `subscribe`/`unsubscribe` can race the deltas they're meant to scope, and you need a server ack that the new filter is live before you tear down the old view. That is bidirectional by nature. Three concrete consequences:

| Need | With WebSocket | With SSE |
|---|---|---|
| Change subscription | `emit("subscribe", {filter})` on the **same** socket; ack confirms | separate `POST /subscribe` side-channel; server must map *which* SSE connection it belongs to, and you police ordering between the POST and the stream |
| Stream only matching rows | server filters per-subscription → push ~200 rows, not all 5000 | possible, but the re-target round-trip is a fresh HTTP request each time |
| Per-order detail stream on drawer-open | another topic over the one connection | another `EventSource` (eats a connection slot) or another side-channel |

**This is the strong, specific reason:** *the value of the dashboard is dynamic, client-driven, server-side subscription, and that control channel is inherently two-way.* Server-side filtering is also what lets us hit the latency/bandwidth budget — we stream the ~200 rows the current filter matches instead of firehosing 5000. SSE can't carry the "what I want" half of that loop on the same channel.

**Two supporting reasons (real, but conditional — say so):**

- **HTTP/1.1 connection budget.** Over HTTP/1.1, a long-lived SSE stream permanently occupies **one of the browser's ~6 connections/origin** — for an 8h shift — while the same page fires REST for drill-in, catch-up, KPI refetch, and hover-prefetch. With multiple tabs you can starve REST. A WS connection is a single upgraded socket and Chrome allows far more (~255). **Caveat:** under HTTP/2+ this largely evaporates (multiplexed streams), so I only lean on it if the gateway is HTTP/1.1.
- **Burst framing.** During incidents (100+ events/sec) WS binary framing (or MessagePack over WS) is leaner than SSE's text-only `data:`-prefixed events. Minor — small JSON makes this nearly a wash — so I don't lead with it.

**What I give up vs SSE, and how I get it back:** SSE's free auto-reconnect and proxy-friendliness are the things you'd miss. Socket.io hands reconnect/`Last-Event-ID`-style replay back to me (O1.2) and can fall back to HTTP long-polling through hostile proxies — so the practical SSE advantages mostly come back inside the WS-family choice.

**One-line answer:** *"A dashboard is usually SSE territory, and if this were a passive feed I'd agree. But here the client continuously renegotiates what's streamed — filters, per-order detail subscriptions, pause, presence — so server-side subscription is the core feature, and that control loop is bidirectional. That pushes it to WebSocket; SSE would force a separate side-channel and lose ordering against the stream."*

#### O1.2 — Within the WebSocket family: Socket.io over raw WebSocket

**Why Socket.io here.** A raw `WebSocket` gives you the socket and nothing else — you hand-roll reconnect, exponential backoff, jitter, heartbeat/dead-connection detection, and resubscribe. Socket.io ships all of that. The hand-written `RealtimeClient` class from the old notes (reconnect scheduler + heartbeat timer + backoff math) collapses into config.

**Trade-offs (say these — it shows you didn't pick it blindly):**

| | Raw WebSocket | Socket.io |
|---|---|---|
| Reconnect / backoff / jitter | hand-rolled | built in (`reconnectionDelay*`, `randomizationFactor`) |
| Heartbeat / dead-conn detect | hand-rolled ping timer | built in (engine.io ping/pong) |
| Multiplexing | manual topic prefix | namespaces + rooms (still using topic emit here) |
| Request/response | manual correlation id | acks (callback on `emit`) |
| Missed-event replay | manual REST catch-up | optional server `connectionStateRecovery` |
| Bundle | ~0 | ~15KB gz client |
| **Server requirement** | any WS server | **must speak the Socket.io/engine.io protocol** |

The last row is the real constraint: **you can't point a Socket.io client at a plain WS endpoint.** If Verizon's gateway is raw WS, either put a Socket.io-compatible layer in front or keep raw WS + the manual resilience code. Flagging this trade-off is the answer interviewers want, not "Socket.io is just better."

**Connection module — factory + closure, no class:**

```ts
// realtimeClient.ts
import { io, type Socket } from "socket.io-client";

export interface RealtimeClient {
  connect(): void;
  disconnect(): void;
  subscribe(topic: string, filter: Filter): void;
  on(handler: (event: ServerEvent) => void): () => void;
  lastEventTs(): number;
}

export function createRealtimeClient(url: string): RealtimeClient {
  let socket: Socket | null = null;
  const listeners = new Set<(event: ServerEvent) => void>();
  const subscriptions = new Map<string, Filter>(); // for resubscribe on reconnect
  let lastTs = 0;

  function resubscribe() {
    for (const [topic, filter] of subscriptions) {
      socket?.emit("subscribe", { topic, filter });
    }
  }

  function connect() {
    if (socket) return;
    socket = io(url, {
      transports: ["websocket"],     // skip the long-poll → WS upgrade dance
      reconnection: true,
      reconnectionDelay: 1_000,      // base backoff (1s → 2s → 4s …)
      reconnectionDelayMax: 30_000,  // cap at 30s
      randomizationFactor: 0.5,      // jitter — avoids thundering herd on recovery
    });

    // engine.io runs ping/pong heartbeat for us — no manual timer needed.
    socket.on("connect", resubscribe);
    socket.on("server:event", (event: ServerEvent) => {
      lastTs = event.ts ?? lastTs;
      listeners.forEach((l) => l(event));
    });
    socket.io.on("reconnect", () => {
      resubscribe();
      void catchUp(); // fetch deltas missed while we were down
    });
  }

  async function catchUp() {
    const missed: ServerEvent[] = await fetch(`/api/orders/since/${lastTs}`).then((r) => r.json());
    missed.forEach((e) => listeners.forEach((l) => l(e)));
  }

  function subscribe(topic: string, filter: Filter) {
    subscriptions.set(topic, filter);
    socket?.emit("subscribe", { topic, filter });
  }

  function on(handler: (event: ServerEvent) => void) {
    listeners.add(handler);
    return () => void listeners.delete(handler);
  }

  function disconnect() {
    socket?.disconnect();
    socket = null;
  }

  return { connect, disconnect, subscribe, on, lastEventTs: () => lastTs };
}
```

> If the server enables Socket.io v4 **`connectionStateRecovery`**, it buffers and replays missed events on reconnect automatically — you can drop the manual `catchUp()` REST call entirely. Mention both; pick based on backend support.

**Resilience summary:** reconnect + backoff + jitter (Socket.io), heartbeat (engine.io), resubscribe on reconnect (we store subs locally), catch-up via REST `since/:ts` (or `connectionStateRecovery`). UI shows a subtle indicator after ~5s down, a toast after ~30s, and can fall back to REST polling if the socket stays dead.

#### O1.3 — Myth check: "WS only sends small events; SSE sends the whole response"

**False — and worth correcting cleanly in an interview.** Payload size is an **application-design choice, not a transport limit.** Both transports carry tiny flags *or* full payloads:

- **WebSocket** — text *or* binary; message size is server-configurable (defaults around ~1 MiB, tunable), and the protocol fragments large messages across frames. You can send a full `Order`, a full list, or a binary blob.
- **SSE** — also sends arbitrarily large payloads, but **text-only (UTF-8)**; binary must be base64'd (~33% inflation). So for large/binary, WS is the *better* fit, not the worse one.

The "flag then API call" you described is one of **three event-payload patterns** — and the pattern, not the transport, is what you're really choosing:

| Pattern | Event carries | Refetch? | Use when |
|---|---|---|---|
| **Thin event / notification** | "id X changed" | yes (round-trip per event) | must read authoritative state every time; or event must not expose sensitive fields; low event rate |
| **Event-carried state transfer (fat)** | full updated entity | no | consumers want to apply directly; decouple from read API |
| **Delta / patch** | changed fields only | no (client holds base + applies) | high-frequency small changes on objects the client already has |

This doc uses **fat + delta over WebSocket**, never flag-then-refetch: `order.created` ships the whole `Order` (fat); `order.updated` ships `changes: Partial<Order>` (delta, see D.3). The delta pattern needs the client to already hold the row and a way to recover missed events — which is exactly what the `/orders/since/:ts` catch-up (O1) is for.

**Why not flag-then-refetch here?** It's the worst fit for this app: a 100-events/sec incident burst would fire 100 refetches and stampede the read API, and the refetches would race each other. Delta-over-the-channel + RAF batching (O2) avoids both.

**Where the "SSE = whole response" intuition comes from:** LLM/RAG token streaming. That's actually *many small events* concatenated client-side, not one big payload — and it works identically over WebSocket. So it's not an SSE-only capability.

**The hybrid we actually use:** REST for the initial full **snapshot** (list load, and the drawer's detail on open), then WS **deltas** for live updates. "Snapshot + stream" is the standard pattern; the snapshot is a full response over HTTP, the stream is incremental over WS — both carry real data.

**One-liner:** *"Both can send anything; size is a design decision. We send full entities on create and deltas on update over the socket — not a 'go refetch' flag — because flag-then-refetch would stampede the API during bursts. WS is actually better for large/binary since SSE is text-only."*

---

### O2 — Update throttling: RAF-batched flush + drop policy

100+ events/sec means 100+ `setQueryData` calls/sec, each triggering reconciliation. Coalesce into **one flush per frame**.

```ts
// updateBatcher.ts — module factory, no class
export interface UpdateBatcher {
  enqueue(event: ServerEvent): void;
  size(): number;
}

export function createUpdateBatcher(
  apply: (batch: ServerEvent[]) => void,
  onOverflow?: () => void,
): UpdateBatcher {
  let queue: ServerEvent[] = [];
  let scheduled = false;

  function flush() {
    const batch = queue;
    queue = [];
    scheduled = false;
    apply(batch);
  }

  function enqueue(event: ServerEvent) {
    queue.push(event);

    // Drop policy under sustained load: keep newest, force a refetch instead of freezing.
    if (queue.length > 1_000) {
      queue = queue.slice(-500);
      onOverflow?.(); // e.g. queryClient.invalidateQueries(["orders"])
    }

    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(flush);
    }
  }

  return { enqueue, size: () => queue.length };
}
```

The `apply` callback merges by id (latest wins) before touching the cache:

```ts
const batcher = createUpdateBatcher(
  (batch) => {
    // collapse a frame's worth of events to the latest per order
    const merged = new Map<string, ServerEvent>();
    for (const e of batch) merged.set(keyOf(e), e);
    for (const e of merged.values()) applyOrderEvent(queryClient, e);
  },
  () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
);
```

Result: ≥30 updates/sec coalesce into one frame of React work → 60 FPS preserved, INP protected.

---

### O3 — `useEffect` vs `useLayoutEffect` for RAF-driven work (the deep dive)

> The instinct — *"paint timing matters, so reach for `useLayoutEffect`"* — is right to be thinking about paint. But `useLayoutEffect` is **not** a blanket upgrade. Here's the precise rule, and it's a great thing to say in an interview because it shows you understand the render→commit→paint cycle rather than cargo-culting.

**The three timings:**

| Hook / API | When it runs | Use for |
|---|---|---|
| `useEffect` | **after** paint, async | subscriptions, fetches, anything that schedules a state update |
| `useLayoutEffect` | after DOM mutation, **before** paint, sync | read layout (`getBoundingClientRect`) or write DOM (`scrollTop`, canvas size) to avoid a visible flicker |
| `requestAnimationFrame` | **before the next paint**, regardless of which effect started it | the actual draw / flush work |

**Why the batcher subscription stays in `useEffect`:**

`requestAnimationFrame` schedules its callback before the next paint *no matter where you called it from*. So whether you register the stream subscription in `useEffect` or `useLayoutEffect`, the **flush fires at the identical moment** (the next frame). The only difference is that `useLayoutEffect` runs **synchronously and blocks paint on mount** — which buys nothing here and directly works against the INP < 200ms budget. So: **subscription → `useEffect`.**

```ts
// useOrderStream.ts — async wiring, must NOT block paint → useEffect
export function useOrderStream(client: RealtimeClient, batcher: UpdateBatcher) {
  const paused = useAppSelector((s) => s.ui.pausedLiveUpdates);
  const pending = useRef<ServerEvent[]>([]);

  useEffect(() => {
    return client.on((event) => {
      if (paused) pending.current.push(event);
      else batcher.enqueue(event);
    });
  }, [client, batcher, paused]);

  // Drain queued events when unpausing (same batcher → dedup still applies)
  useEffect(() => {
    if (!paused && pending.current.length) {
      pending.current.forEach((e) => batcher.enqueue(e));
      pending.current = [];
    }
  }, [paused]);
}
```

**Where `useLayoutEffect` + RAF genuinely wins** — pre-paint DOM work, where `useEffect` would cause a visible flash:

1. **Scroll restoration** when the virtualized dataset's identity changes (filter applied, list swapped). Set `scrollTop` before paint or the user sees a jump.

```ts
// useScrollRestore.ts — write DOM before paint → no flash
export function useScrollRestore(ref: RefObject<HTMLElement>, depKey: string) {
  const saved = useRef(0);
  useLayoutEffect(() => {
    if (ref.current) ref.current.scrollTop = saved.current; // before paint
  }, [depKey]);
  // (capture saved.current on scroll elsewhere)
}
```

2. **Canvas live chart** — start the RAF draw loop in `useLayoutEffect` so the first frame paints a line instead of a blank canvas (avoids a one-frame empty flash). The loop itself is still RAF.

```jsx
function LiveChart({ stream }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const data = useRef<number[]>([]);

  // useLayoutEffect: ensures first draw lands before the initial paint (no blank flash)
  useLayoutEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    let frame = 0;
    const loop = () => {
      drawSeries(ctx, data.current.slice(-60)); // pure module helper, not inline
      frame = requestAnimationFrame(loop);
    };
    const unsub = stream.subscribe((v) => data.current.push(v));
    frame = requestAnimationFrame(loop);
    return () => { unsub(); cancelAnimationFrame(frame); };
  }, [stream]);

  return (
    <>
      <canvas ref={canvasRef} width={800} height={200}
              aria-label="Orders per minute, last hour"
              aria-describedby="liveChartSummary" />
      <p id="liveChartSummary" className="sr-only">Real-time chart, updates each second.</p>
      <button onClick={() => announceSnapshot(data.current)}>Read current value</button>
    </>
  );
}
```

3. **Measure-then-size** a row before paint (variable-height virtualization), where reading layout in `useEffect` would flash an unmeasured row.

**One-line interview takeaway:** *"`useLayoutEffect` is for synchronous, pre-paint DOM reads/writes that prevent flicker — scroll restore, canvas first-frame, measurement. Subscriptions and the RAF batcher go in `useEffect` because RAF already syncs to paint and `useLayoutEffect` would only block paint and hurt INP."*

---

### O4 — Virtualization (5000-row table)

5000 rows × ~10 cells = 50k+ DOM nodes; browsers choke. Window it with TanStack Virtual.

```jsx
import { useVirtualizer } from "@tanstack/react-virtual";

function OrderTable({ orders }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="table-scroll" style={{ height: "100%", overflow: "auto" }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vr) => {
          const order = orders[vr.index];
          return (
            <OrderRow
              key={order.id}                 // stable key → scroll restoration survives data swaps
              order={order}
              style={{ position: "absolute", top: 0, left: 0, right: 0,
                       transform: `translateY(${vr.start}px)` }}
            />
          );
        })}
      </div>
    </div>
  );
}

const OrderRow = memo(
  function OrderRow({ order, style }) {
    return (
      <div style={style} className="row">
        <Cell>{order.id}</Cell><Cell>{order.status}</Cell><Cell>{order.amount}</Cell>
      </div>
    );
  },
  (prev, next) => prev.order === next.order, // ref equality — relies on the patch invariant (D.3)
);
```

**Gotchas to name:** sticky header needs explicit `z-index` + background; variable heights need `measureElement` (+ ResizeObserver, else slow); scroll restoration needs a stable per-row key; and `memo` on the row is non-negotiable — without it any unrelated state change re-renders every visible row.

---

### O5 — Charts: Canvas vs SVG

| Approach | Points | Notes |
|---|---|---|
| SVG (Recharts/Victory) | < 1k | declarative, easy a11y |
| Canvas (custom/chart.js) | < 100k | hand-roll a11y (label + table fallback) |
| WebGL (regl/deck.gl) | > 100k | steep curve |
| OffscreenCanvas (worker) | high update rate | draw off main thread |

For "orders/min last hour" (~60 points) → **SVG/Recharts** is plenty. For a high-rate **live tick** chart → **Canvas + RAF** (see O3's `LiveChart`). For a11y on Canvas: `aria-label` + `aria-describedby` summary + a "View data table" toggle rendering a real `<table>`, plus a "Read current value" button announcing via a live region.

---

### O6 — KPI cards: minimize re-render scope

Select **only** the scalar each card needs.

```jsx
function OpenOrdersKPI() {
  const count = useAppSelector((s) => s.metrics.openOrders); // re-render only when count changes
  return <KPICard label="Open Orders" value={count} />;
}
```

Reselect (RTK `createSelector`) for derived counts, or React Query `select` to derive from the cached list:

```ts
useQuery({
  queryKey: ["orders"],
  queryFn: fetchOrders,
  select: (data) => data.filter((o) => o.status === "open").length, // only this component re-renders
});
```

---

### O7 — Pause live updates

A `paused` flag that **queues** instead of applying (already wired in `useOrderStream`, O3). On unpause, drain through the same batcher so duplicates coalesce. Show "N updates pending — click to resume."

---

### O8 — Drill-in drawer: code splitting + prefetch

```jsx
const OrderDetailDrawer = lazy(() => import("./OrderDetailDrawer"));

function App() {
  const open = useAppSelector((s) => s.ui.drawerOpen);
  return (
    <>
      <OrderTable />
      <Suspense fallback={<Spinner />}>{open && <OrderDetailDrawer />}</Suspense>
    </>
  );
}
```

Prefetch on hover so the first click feels instant:

```jsx
onMouseEnter={() => queryClient.prefetchQuery({
  queryKey: ["order", order.id],
  queryFn: () => fetchOrderDetail(order.id),
})}
```

---

### O9 — CSV export: Web Worker

5000 rows × 20 cols ≈ 1MB string — building it on the main thread freezes the UI. Push it to a worker (functional message handler, no class).

```ts
// csv.worker.ts
self.onmessage = (e: MessageEvent<{ rows: Row[]; cols: Col[] }>) => {
  const { rows, cols } = e.data;
  const header = cols.map((c) => c.label).join(",") + "\n";
  const body = rows
    .map((r) => cols.map((c) => JSON.stringify(r[c.key] ?? "")).join(","))
    .join("\n");
  self.postMessage(new Blob([header, body], { type: "text/csv;charset=utf-8" }));
};
```

```ts
// main — thin helper
export function exportCsv(rows: Row[], cols: Col[]) {
  const worker = new Worker(new URL("./csv.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<Blob>) => {
    const url = URL.createObjectURL(e.data);
    const a = Object.assign(document.createElement("a"), { href: url, download: `orders-${Date.now()}.csv` });
    a.click();
    URL.revokeObjectURL(url);
    worker.terminate();
  };
  worker.postMessage({ rows, cols });
}
```

---

### O10 — Accessibility (WCAG 2.2 AA)

- **Table:** prefer real `<table>` + `<th scope="col">` + `<caption>`. If virtualization breaks table semantics, use `role="grid"` with `rowgroup`/`row`/`gridcell`.
- **Sort:** `aria-sort="ascending|descending|none"` on the active header.
- **Filter results:** polite live region announces "X orders match."
- **Drawer:** native `<dialog>` + `showModal()` → free focus trap, ESC, top-layer.
- **Live KPIs:** debounce announcements (~30s) via a polite live region — don't narrate every tick.
- **Charts:** `aria-label` + "View data table" toggle (real `<table>` alternative).
- **Reduced motion:** disable chart transitions under `prefers-reduced-motion: reduce`.

---

### O11 — Performance budgets + long-session memory

| Metric | Target | Strategy |
|---|---|---|
| LCP | < 2s | inline critical CSS, preload hero data, skeletons |
| INP | < 200ms | RAF-batched updates, virtualization, code splitting, `useDeferredValue` for non-urgent renders |
| CLS | < 0.05 | fixed-height rows, skeleton matches layout |
| Main bundle | < 250KB gz | code-split charts/drawer/export (note: +~15KB for Socket.io client) |
| WS lag p95 | < 1s | heartbeat, reconnect, catch-up |
| Memory (8h) | < 500MB | GC old rows, cap caches |

```ts
const queryClient = new QueryClient({
  defaultOptions: { queries: { gcTime: 5 * 60_000, staleTime: 60_000 } },
});
// cap event history
state.alerts = state.alerts.slice(-1000);
```

8h sessions accumulate: cap `gcTime`, trim history arrays, pause animations when `document.visibilityState === "hidden"`, watch `performance.memory.usedJSHeapSize` (Chrome) and warn at threshold.

---

### O12 — Error handling & UX

| Scenario | UX |
|---|---|
| Socket down < 5s | subtle indicator; auto-recover, no toast |
| Socket down > 5s | toast "Live updates paused — reconnecting…"; fall back to REST polling |
| Refetch 5xx | retry w/ backoff (3×); toast "Couldn't refresh — try again" |
| Invalid patch | Sentry breadcrumb; evict the row, refetch it |
| Drawer fetch fails | inline error + Retry; don't close drawer |
| Mutation fails | revert optimistic update; toast with reason |
| Tab backgrounded | pause animations, batch more aggressively |

---

### O13 — Observability

```ts
import { onCLS, onINP, onLCP } from "web-vitals";
onCLS((m) => track("cls", m.value));
onINP((m) => track("inp", m.value, { route, userId }));
onLCP((m) => track("lcp", m.value));

// WS lag — event carries server ts (see I.2)
client.on((event) => { if (event.ts) track("ws_lag", Date.now() - event.ts); });

new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (e.duration > 100) track("long_task", e.duration);
}).observe({ entryTypes: ["longtask"] });
```

Dashboard in Grafana/Datadog; alert when p95 INP > 300ms or WS lag > 5s.

---

## Testing strategy

| Type | What |
|---|---|
| Unit | `patchOrderInList`, `createUpdateBatcher` coalescing/overflow, selectors, reconnect/catch-up logic (mock socket) |
| Integration | filter → table update → drawer open (MSW for REST, mock socket.io) |
| Visual regression | KPI states (loading/OK/breach), chart renders |
| E2E (Playwright) | connect → see live order → drill in → approve → see status change |
| Load | replay 10k events/sec; assert 60 FPS scroll + bounded queue |
| A11y | jest-axe + axe-playwright on key pages; manual NVDA/VoiceOver pass |

> Functional modules pay off here: `createUpdateBatcher(applySpy)` and `createRealtimeClient` with an injected fake socket are trivial to test in isolation — no class instantiation, no `this`, no DOM.

---

## Trade-off matrix

| Decision | Option A | Option B | Choice + why |
|---|---|---|---|
| Transport *shape* | **WebSocket** | SSE | **WS** — client continuously re-targets the stream (filters, per-order detail, presence); that control loop is bidirectional. SSE only if it were a passive feed. |
| WS *client* | **Socket.io** | raw WS | **Socket.io** — built-in reconnect/backoff/jitter/heartbeat + long-poll fallback; *requires Socket.io-compatible server* |
| Server data | React Query | Redux | **RQ** — built-in stale/refetch/dedup/GC, less code |
| UI state | Redux | Zustand | **Redux** — team familiarity, devtools, time-travel |
| State units | classes | **modules/factories** | **Modules** — tree-shake, mockable, no `this`, pure transforms split from effects |
| Update batching | per-event | **RAF batch** | **RAF batch** — handles bursts without freeze |
| Effect for batcher | useLayoutEffect | **useEffect** | **useEffect** — RAF already syncs to paint; useLayoutEffect only blocks paint |
| Effect for scroll/canvas | useEffect | **useLayoutEffect** | **useLayoutEffect** — pre-paint write avoids flicker |
| List rendering | DOM table | **Virtualized** | **Virtualized** — 5k rows @ 60 FPS |
| Chart lib | Recharts | Canvas | **Recharts (static), Canvas (live tick)** |
| CSV export | main thread | **Worker** | **Worker** — keeps UI responsive |
| Bundle | single | **code-split** | **Code-split** — initial < 250KB |

---

**Q: "A dashboard is one-way server→client — why not SSE?"**
Two parts. Honestly: the 2023 version was built on WebSocket, and when we resumed in 2025 the real-time layer worked, so we reused it instead of rewriting the transport — I'm not going to rip out working infra without a strong reason. Then I checked whether that inherited choice still made sense, and it does: this dashboard isn't a passive feed, it's a two-way conversation. The agent keeps telling the server what to show — filter by region, open one order's live timeline, pause — and the server answers on the same connection. SSE is one-way (a radio broadcast), so the "what I want to watch" half would need a separate channel. WebSocket (a phone call) carries both. If it were a feed you just watch, I'd have moved it to SSE.

**Q: "Can't WebSocket only send small events — so you flag, then refetch over REST? Doesn't SSE send the whole response?"**
That's a payload-design question, not a transport one. Both WS and SSE can send a 2-byte flag or a full entity; WS is even better for large/binary since SSE is text-only and would base64-inflate it. The three patterns are thin event (flag + refetch), event-carried state transfer (full entity), and delta (changed fields). We use fat-on-create and delta-on-update over the socket — `order.created` carries the whole order, `order.updated` carries just the changed fields — never flag-then-refetch, because under a 100/sec burst that would fire 100 refetches and stampede the read API. The "SSE sends the whole response" idea comes from LLM token streaming, which is really many small events assembled client-side — and works the same over WS.

## Interview talking points (Q&A)

**Q: "A dashboard is one-way server→client — why not SSE?"**
Agreed as a default — for a *passive* feed (notifications, RAG token streaming, a metrics ticker) I'd pick SSE: plain HTTP, proxy-friendly, free auto-reconnect. But this dashboard isn't passive. The agent constantly re-targets *what* is streamed — filter by status/region/agent/time-window, subscribe to one order's detail stream when the drawer opens, pause, presence. That's a control loop, and it has to ride the *same ordered channel* as the events so subscribe/unsubscribe can't race the deltas, with an ack that the new filter is live. That's bidirectional, which is WebSocket's job. With SSE I'd need a separate `POST /subscribe` side-channel plus server-side mapping of which SSE connection it belongs to, and I'd have to police ordering between the POST and the stream. Server-side subscription is also what keeps us in budget — we stream the ~200 rows matching the filter, not all 5000. If it were a fixed firehose, I'd switch back to SSE.

**Q: "Can't WebSocket only send small events — so you flag, then refetch over REST? Doesn't SSE send the whole response?"**
That's a payload-design question, not a transport one. Both WS and SSE can send a 2-byte flag or a full entity; WS is even better for large/binary since SSE is text-only and would base64-inflate it. The three patterns are thin event (flag + refetch), event-carried state transfer (full entity), and delta (changed fields). We use fat-on-create and delta-on-update over the socket — `order.created` carries the whole order, `order.updated` carries just the changed fields — never flag-then-refetch, because under a 100/sec burst that would fire 100 refetches and stampede the read API. The "SSE sends the whole response" idea comes from LLM token streaming, which is really many small events assembled client-side — and works the same over WS.

**Q: "How would you handle Socket.io disconnections?"**
Mostly the library handles it: `reconnection` with `reconnectionDelay` → `reconnectionDelayMax` and `randomizationFactor` give exponential backoff with jitter; engine.io's ping/pong detects dead connections faster than TCP timeout. My code only adds two things on top: resubscribe on `connect`/`reconnect` (server doesn't remember subs) and a catch-up REST call (`/orders/since/:ts`) so we don't miss events from the downtime — or, if the server enables `connectionStateRecovery`, the library replays them and I drop the catch-up. UI shows a subtle indicator after 5s, a toast after 30s.

**Q: "Why Socket.io instead of raw WebSocket?"**
It removes the reconnect/backoff/heartbeat boilerplate I'd otherwise hand-write, and adds acks (request/response) and namespaces (multiplexing). The cost is ~15KB and — the real constraint — the server must speak the Socket.io protocol; you can't aim it at a plain WS endpoint. If Verizon's gateway is raw WS, I'd either front it with a Socket.io layer or keep raw WS and write the resilience code myself. So it's a trade-off, not a free win.

**Q: "1000 updates per second?"**
RAF-batched flush. Events queue; one `requestAnimationFrame` drains and applies them in a single pass, merged by id (latest wins). If the queue exceeds 1000, drop to the newest 500 and force a refetch — better than freezing. The batcher is a plain factory so I can unit-test coalescing and the overflow path directly.

**Q: "Redux or React Query for the orders list?"**
React Query for server-cached data (list, detail, KPIs) because it already does dedupe/refetch/staleness/GC. Redux for UI state (filters, selected id, drawer, paused). Mixing them matches their lifecycles instead of re-implementing an async cache inside Redux.

**Q: "Why modules/factories instead of classes?"**
Tree-shaking, no `this`-binding bugs, and testability — `createUpdateBatcher(spy)` or `createRealtimeClient(fakeUrl)` with an injected fake socket are trivial to test. I also split pure transforms (`patchOrderInList`) from side effects (`applyOrderEvent`) so the logic is unit-testable without a query client.

**Q: "useEffect or useLayoutEffect for the realtime updates?"**
`useEffect` for the subscription. `requestAnimationFrame` schedules the flush before the next paint regardless of where it was registered, so `useLayoutEffect` buys nothing there and only blocks paint, hurting INP. I reserve `useLayoutEffect` for pre-paint DOM work that would otherwise flicker — scroll restoration when the dataset swaps, the canvas first-frame, and row measurement.

**Q: "Virtualization gotchas?"**
Sticky header z-index/background; variable heights via `measureElement` + ResizeObserver; stable per-row keys for scroll restoration; and `memo` on the row backed by the patch invariant (new ref only for changed rows) so a burst doesn't re-render every visible row.

**Q: "INP < 200ms — how?"**
RAF-batched updates, virtualization, lazy-loaded drawer/export/charts, Web Workers for CSV/aggregation, `useDeferredValue` for non-urgent renders, and `web-vitals` RUM alerting at p75 > 200ms.

**Q: "8-hour session memory?"**
Cap RQ `gcTime`, trim alert/event arrays to last N, pause work when the tab is hidden, monitor `usedJSHeapSize`, and reconnect rather than holding stale buffers.

---

## Follow-up architecture questions interviewers love

1. **Multiplex multiple streams over one connection?** Topic-based: `emit("subscribe", { topic, filter })`; server tags each event with its topic; client routes by topic. Socket.io namespaces/rooms do the same at the protocol level.
2. **Multiple tabs?** Each tab opens its own socket by default. To share one connection + cache, use a **SharedWorker** holding the single Socket.io connection, or **BroadcastChannel** to fan out cache updates between tabs.
3. **Collaborative presence/cursors?** A `presence` channel: each client emits `{user, view, cursorRow}` every ~5s; server broadcasts; render avatars in the row gutter.
4. **Monitoring/alerting?** Sentry (errors), Datadog RUM (CWV), custom `ws_lag`, synthetic uptime on the dashboard route, PagerDuty when p95 INP > 500ms for 5min or socket connect rate drops below baseline.
5. **A/B testing?** Flags via Statsig/Unleash; variant assigned in session, applied at render; tracked through the same RUM pipeline with an experiment dimension.

---

## Appendix — full component diagram

```
                  ┌────────────────────────────────────────────┐
                  │           User's Browser                    │
                  │   ┌──────────────────────────────────┐      │
                  │   │  React UI                         │      │
                  │   │  ┌──────────┐  ┌─────────────┐    │      │
                  │   │  │ Header / │  │ Order Table │    │      │
                  │   │  │ Filters  │  │ (virtualized│    │      │
                  │   │  └─────┬────┘  │  5k rows)   │    │      │
                  │   │        │       └─────────────┘    │      │
                  │   │  ┌─────▼──────┐  ┌─────────────┐  │      │
                  │   │  │ KPI Cards  │  │ Live Charts │  │      │
                  │   │  └────────────┘  │ (Canvas)    │  │      │
                  │   │                  └─────────────┘  │      │
                  │   └──────────────────────────────────┘      │
                  │   ┌──────────────────────────────────┐      │
                  │   │  State                            │      │
                  │   │  React Query: ["orders"],["kpis"] │      │
                  │   │  Redux: ui.filters, ui.drawer     │      │
                  │   └──────────┬───────────────────────┘      │
                  │   ┌──────────▼───────────────────────┐      │
                  │   │  realtimeClient (socket.io)       │      │
                  │   │  + updateBatcher (RAF)            │      │
                  │   │  + catch-up / resubscribe         │      │
                  │   └──────────┬───────────────────────┘      │
                  │   ┌──────────▼───────────────────────┐      │
                  │   │  Web Worker (CSV, aggregation)    │      │
                  │   └──────────────────────────────────┘      │
                  └─────────────┬───────────────────┬───────────┘
                                │ socket.io          │ REST
                          ┌─────▼───────────────────▼──────┐
                          │      Backend / API Gateway      │
                          │ (sticky LB for socket.io,       │
                          │  normal LB for REST)            │
                          └────────────┬────────────────────┘
                            ┌──────────┴──────────┐
                       ┌────▼────┐         ┌──────▼─────┐
                       │ Order   │         │ Defect /   │
                       │ Service │         │ MCP Engine │
                       └─────────┘         └────────────┘
```

---

## References & cross-links

- [FE System Design notes](../../../../system-design/frontend-system-design/FESystemDesignNotes.md) — RADIO, CWV, SSE vs WS vs polling
- [Virtualization notes](../../../react/virtualization.md) — windowing comparison
- [Browser rendering pipeline](../../browser-rendering-pipeline.md) — RAF, layout/paint/composite, useLayoutEffect timing
- [Performance optimization](../../../performance-security/performance-optimization.txt) — CWV details
- [Redux notes](../../../react/redux.md) — RTK, RTK Query, Context
- [TanStack Query](../../../react/tanstack-query.txt) — invalidation, optimistic updates
- [Accessibility](../../accessibility.md) — live regions, table semantics, ARIA grid
- Socket.io client options — `reconnection*`, `randomizationFactor`, `connectionStateRecovery`