# FE System Design — Real-Time Dashboard (Verizon Auto-Triaging)

> Resume project: **Verizon Auto Triaging Digital First** — tracks order statuses across Verizon apps for support agents/managers.
>
> Cross-link: [FE System Design notes](../../../../system-design/frontend-system-design/FESystemDesignNotes.md) · [Virtualization](../../../react/virtualization.md) · [Browser rendering pipeline](../../browser-rendering-pipeline.md) · [Performance optimization](../../../performance-security/performance-optimization.txt)

---

## 1. Problem statement

Design the frontend for a real-time operations dashboard where front-line support staff view:

- A live table of in-flight orders (filterable, sortable, ~500-5000 visible rows)
- Per-order detail drawer with billing summary, status, MR/Jira links
- Live KPIs (open orders, SLA breach count, agent-load)
- Streaming charts (orders/min, errors/min)
- Alerts feed (real-time defects detected by the MCP triaging engine)

The backend pushes updates every few seconds (sometimes burstier — 100+ events/sec during incidents).

---

## 2. Requirements

### 2.1 Functional

- Display 1k–10k orders in a virtualized table with column sort/filter/group
- Stream updates (`order.updated`, `order.created`, `defect.detected`) and apply in-place
- Allow filtering by status, region, agent, time window
- Drill into a single order — opens a detail drawer with tabs (summary, timeline, items, defects, MR)
- KPI cards update in real-time without re-rendering the entire dashboard
- Chart timeseries (last 1h windowed)
- "Pause live updates" toggle (so agents can read stable data)
- Export filtered data (CSV)

### 2.2 Non-functional

- **Latency:** UI reflects backend update within 1 second p95
- **Performance:** 60 FPS scroll on 5000-row table; INP < 200ms
- **Reliability:** Survives reconnect / network blips; no UI freezes during update bursts
- **Accessibility:** WCAG 2.2 AA — keyboard nav, screen reader friendly
- **Scale:** Single user holds page open 8h shift, may receive 100k updates
- **Observability:** Real-user CWV + custom WS-lag metrics

---

## 3. High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser tab                                                     │
│                                                                  │
│  ┌─────────────────┐   ┌──────────────┐   ┌──────────────────┐   │
│  │ React UI layer  │←─►│ Store / Query│←─►│ Realtime layer    │   │
│  │  (components)   │   │ (Redux+RQ)   │   │  (WS/SSE client)  │   │
│  └────────┬────────┘   └──────────────┘   └────────┬─────────┘   │
│           │                    ↑                    │             │
│           ↓                    │                    ↓             │
│  ┌─────────────────┐    ┌──────┴────────┐    ┌──────────────┐    │
│  │ Virtualization  │    │ Selectors,    │    │ Reconnect /  │    │
│  │  (react-window) │    │ derived data  │    │ backoff      │    │
│  └─────────────────┘    └───────────────┘    └──────────────┘    │
│                                                                  │
│  Web Worker (heavy data shaping, CSV export, chart aggregation)  │
└─────────────────────────────────────────────────────────────────┘
                          ↑                  ↑
                          │                  │
                          │ WS                REST (initial load, drill-in)
                          │
                  ┌───────┴────────┐
                  │  API Gateway   │
                  │  (WS multi-    │
                  │   plex + LB)   │
                  └────────────────┘
```

---

## 4. State model — Redux vs React Query split

**The single most-asked question for real-time dashboards:** where does data live?

| Concern | Tool | Why |
|---------|------|-----|
| **Server data cache** (list of orders, detail) | React Query | Built-in stale time, refetch, dedupe, invalidation. Query keys serve as cache lookups. |
| **Streaming/in-flight updates** | React Query setQueryData (or Redux slice) | Apply WS messages by patching the query cache directly. |
| **UI state** (selected filters, expanded rows, drawer open) | Redux (or Zustand) | Persisted across navigation, observable, easy to URL-sync |
| **Local ephemeral** (input value, tooltip visibility) | useState | Component-local |

### 4.1 Why not Redux for everything?

The team you're inheriting will *want* to. The argument: "single source of truth for all data". The problem: you re-implement everything React Query gives you (request dedup, refetch, garbage collection, optimistic mutations) and write 4× more boilerplate.

**Recommended split:**
- React Query owns `["orders"]`, `["order", id]`, `["kpis"]` cache entries
- WS handler `queryClient.setQueryData(["orders"], (prev) => patch(prev, event))`
- Redux owns: `ui.filters`, `ui.selectedOrderId`, `ui.drawerOpen`, `ui.pausedLiveUpdates`

### 4.2 Streaming patch code

```ts
const handler = (event: OrderUpdateEvent) => {
  if (event.type === "order.updated") {
    // Patch the list cache
    queryClient.setQueryData<Order[]>(["orders"], (prev = []) =>
      prev.map((o) => o.id === event.orderId ? { ...o, ...event.changes } : o)
    );
    // Patch the detail cache (if exists)
    queryClient.setQueryData<Order>(["order", event.orderId], (prev) =>
      prev ? { ...prev, ...event.changes } : prev
    );
  } else if (event.type === "order.created") {
    queryClient.setQueryData<Order[]>(["orders"], (prev = []) => [event.order, ...prev]);
  }
};
```

---

## 5. Real-time transport — WebSocket vs SSE vs Long-polling

| Transport | Pros | Cons | When to use |
|-----------|------|------|-------------|
| **WebSocket** | Bidirectional, low overhead, browser-native | Stateful (sticky LB), proxy issues in some networks, no auto-reconnect | Two-way protocols, multiplexed channels |
| **SSE** (Server-Sent Events) | HTTP-based (proxy-friendly), auto-reconnect, simple API | Server → client only, 6-conn-per-origin browser limit | One-way streams; ideal for dashboards |
| **Long polling** | Works everywhere, no special infra | Higher latency, more server load | Fallback only |
| **HTTP/2 SSE / HTTP/3** | Multiplexed, no 6-conn limit | Slightly more complex server | Modern stacks |

### 5.1 For this dashboard — WebSocket

Reasons:
- Need request-response over the same channel ("subscribe to filter X")
- Verizon's existing infra is WS-based (Cognizant note)
- Burstable updates favor binary framing efficiency
- Multiplex multiple data streams over one connection

### 5.2 WS connection management — production checklist

```ts
class RealtimeClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private listeners = new Set<(msg: any) => void>();
  private pingTimer: number | null = null;
  private url: string;

  constructor(url: string) { this.url = url; }

  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.resubscribe();
    };
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "pong") return;
      this.listeners.forEach((l) => l(msg));
    };
    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.scheduleReconnect();
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private scheduleReconnect() {
    // Exponential backoff with jitter, max 30s
    const base = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    const jitter = Math.random() * 1000;
    setTimeout(() => { this.reconnectAttempts++; this.connect(); }, base + jitter);
  }

  private startHeartbeat() {
    this.pingTimer = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "ping" }));
    }, 30_000);
  }
  private stopHeartbeat() { if (this.pingTimer) clearInterval(this.pingTimer); }

  subscribe(filter: Filter) {
    this.ws?.send(JSON.stringify({ type: "subscribe", filter }));
  }
  private resubscribe() { /* re-send subscriptions stored locally */ }

  on(handler: (msg: any) => void) { this.listeners.add(handler); return () => this.listeners.delete(handler); }
}
```

### 5.3 Network resilience

- **Heartbeat ping every 30s** — detect dead connections faster than TCP timeout (~minutes)
- **Exponential backoff with jitter** — avoid thundering herd on backend recovery
- **Resubscribe on reconnect** — server doesn't remember subscriptions
- **Catch-up REST call** on reconnect — fetch deltas since last event timestamp (avoids missing events during disconnect)

```ts
ws.onopen = () => {
  const since = lastEventTimestamp || subscribeTime;
  fetch(`/api/orders/since/${since}`).then(applyMissedEvents);
};
```

---

## 6. Update throttling — burst protection

During incidents, the WS may emit 100+ events/sec. Each setQueryData triggers React reconciliation. Direct application kills performance.

### 6.1 Batched RAF flush

```ts
class UpdateBatcher {
  private queue: OrderUpdate[] = [];
  private flushScheduled = false;

  enqueue(update: OrderUpdate) {
    this.queue.push(update);
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      requestAnimationFrame(() => {
        const batch = this.queue;
        this.queue = [];
        this.flushScheduled = false;
        this.applyBatch(batch);
      });
    }
  }

  private applyBatch(batch: OrderUpdate[]) {
    // Merge updates by orderId — only latest wins
    const merged = new Map<string, OrderUpdate>();
    for (const u of batch) merged.set(u.orderId, u);

    queryClient.setQueryData<Order[]>(["orders"], (prev = []) =>
      prev.map((o) => merged.get(o.id) ? { ...o, ...merged.get(o.id)!.changes } : o)
    );
  }
}
```

Result: ≥30 updates/sec coalesce into 1 frame's worth of React work — 60 FPS preserved.

### 6.2 Drop policy under sustained load

If queue length exceeds a threshold, drop oldest deltas and rely on next REST poll:

```ts
if (this.queue.length > 1000) {
  this.queue = this.queue.slice(-500);
  console.warn("WS update backlog — dropping events, will refetch");
  queryClient.invalidateQueries({ queryKey: ["orders"] });
}
```

---

## 7. Virtualization — handling 5000-row tables

DOM with 5000 rows = 50k+ DOM nodes (each row has cells, buttons). Browsers choke. Use windowing.

```jsx
import { useVirtualizer } from "@tanstack/react-virtual";

function OrderTable({ orders }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,           // row height
    overscan: 10,                      // render ±10 outside viewport
  });

  return (
    <div ref={parentRef} className="table-scroll" style={{ height: "100%", overflow: "auto" }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const order = orders[virtualRow.index];
          return (
            <OrderRow
              key={order.id}
              order={order}
              style={{
                position: "absolute",
                top: 0, left: 0, right: 0,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
```

### 7.1 Row memo

```jsx
const OrderRow = memo(function OrderRow({ order, style }) {
  return (
    <div style={style} className="row">
      <Cell>{order.id}</Cell>
      <Cell>{order.status}</Cell>
      <Cell>{order.amount}</Cell>
      ...
    </div>
  );
}, (prev, next) => prev.order === next.order);   // shallow ref equality
```

For this to work, your update reducer must produce a **new object reference** for changed rows but keep references for unchanged rows. Immer or manual spread.

### 7.2 Sticky header within virtualization

```css
.table-scroll > .header {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--color-bg-canvas);
}
```

### 7.3 Variable row heights

Use `measureElement` from TanStack Virtual:

```jsx
<div ref={virtualizer.measureElement} data-index={virtualRow.index}>
  ...
</div>
```

---

## 8. Charts — Canvas vs SVG

Recharts/Victory use SVG (DOM-based). Fine for small charts; for real-time, Canvas wins.

| Approach | Rows | Performance | Notes |
|----------|------|-------------|-------|
| SVG (Recharts, Victory) | < 1k points | Good | Easy a11y, declarative |
| Canvas (chart.js, custom) | < 100k points | Very good | Hand-roll a11y (aria-describedby + table fallback) |
| WebGL (regl, deck.gl) | > 100k points | Excellent | Steep learning curve |
| OffscreenCanvas (worker) | High update rate | Excellent | Moves draw work off main thread |

For Verizon's "orders/min over last hour" timeseries (60 datapoints), SVG via Recharts is plenty. For a "live tick chart" with 10/sec updates, Canvas + RAF batching:

```jsx
function LiveChart({ stream }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dataRef = useRef<number[]>([]);

  useEffect(() => {
    const unsub = stream.subscribe((v) => { dataRef.current.push(v); });
    let frame: number;
    const draw = () => {
      const ctx = canvasRef.current!.getContext("2d")!;
      const data = dataRef.current.slice(-60);  // last 60 points
      ctx.clearRect(0, 0, 800, 200);
      ctx.beginPath();
      data.forEach((v, i) => {
        const x = (i / 59) * 800;
        const y = 200 - (v / 100) * 200;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "#0066cc";
      ctx.stroke();
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => { unsub(); cancelAnimationFrame(frame); };
  }, [stream]);

  return (
    <>
      <canvas ref={canvasRef} width={800} height={200}
              aria-label="Orders per minute, last hour"
              aria-describedby="liveChartSummary" />
      <p id="liveChartSummary" className="sr-only">
        Real-time chart updates every second.
      </p>
      <button onClick={() => announceSnapshot(dataRef.current)}>
        Read current value
      </button>
    </>
  );
}
```

---

## 9. KPI cards — minimize re-render scope

```jsx
function OpenOrdersKPI() {
  // Select ONLY the count — no re-render unless count changes
  const count = useAppSelector((s) => s.metrics.openOrders);
  return <KPICard label="Open Orders" value={count} />;
}
```

For Redux + reselect (Toolkit's `createSelector`):

```ts
const selectOpenOrdersCount = createSelector(
  (s: RootState) => s.orders.byId,
  (byId) => Object.values(byId).filter(o => o.status === "open").length
);
```

If using React Query `select` for the same effect:

```ts
useQuery({
  queryKey: ["orders"],
  queryFn: fetchOrders,
  select: (data) => data.filter(o => o.status === "open").length,
  // only this component re-renders when count changes
});
```

---

## 10. Pause live updates

Operator may want to read stable data. Implement as a flag that *queues* updates instead of applying:

```ts
const paused = useAppSelector(s => s.ui.pausedLiveUpdates);
const pendingRef = useRef<OrderUpdate[]>([]);

useEffect(() => {
  const unsub = realtime.on((event) => {
    if (paused) {
      pendingRef.current.push(event);
    } else {
      batcher.enqueue(event);
    }
  });
  return unsub;
}, [paused]);

// On unpause — flush pending, deduped
useEffect(() => {
  if (!paused && pendingRef.current.length) {
    pendingRef.current.forEach((e) => batcher.enqueue(e));
    pendingRef.current = [];
  }
}, [paused]);

// Show user "X updates pending — click to resume"
```

---

## 11. Drill-in drawer — code splitting

The detail drawer is heavy (timeline component, MR viewer, syntax-highlighted log diff). Lazy-load:

```jsx
const OrderDetailDrawer = lazy(() => import("./OrderDetailDrawer"));

function App() {
  const open = useAppSelector(s => s.ui.drawerOpen);
  return (
    <>
      <OrderTable />
      <Suspense fallback={<Spinner />}>
        {open && <OrderDetailDrawer />}
      </Suspense>
    </>
  );
}
```

First click cost: 200ms; subsequent: instant.

### 11.1 Prefetch on hover

```jsx
<OrderRow
  onMouseEnter={() => queryClient.prefetchQuery({
    queryKey: ["order", order.id],
    queryFn: () => fetchOrderDetail(order.id),
  })}
  onClick={() => openDrawer(order.id)}
>
```

---

## 12. CSV export — Web Worker

5000 rows × 20 cols = ~1MB string. Building on main thread freezes UI:

```ts
// worker.ts
self.onmessage = (e) => {
  const { rows, cols } = e.data;
  const header = cols.map(c => c.label).join(",") + "\n";
  const body = rows.map(r => cols.map(c => JSON.stringify(r[c.key] ?? "")).join(",")).join("\n");
  const blob = new Blob([header, body], { type: "text/csv;charset=utf-8" });
  self.postMessage(blob);
};

// main
const worker = new Worker("/csv-worker.js");
worker.postMessage({ rows: filtered, cols });
worker.onmessage = (e) => {
  const url = URL.createObjectURL(e.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = `orders-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
```

---

## 13. Accessibility

- **Table:** `<table>` with `<th scope="col">`, `<caption>`. Use ARIA for virtualized table if `<table>` semantics break — `role="grid"` + `role="rowgroup"`/`row`/`gridcell`.
- **Sort:** `aria-sort="ascending|descending|none"` on header
- **Filter changes:** Live region announces "X orders matching filter"
- **Drawer:** Native `<dialog>` with `showModal()` — gets focus trap, ESC, top-layer placement free
- **Live KPIs:** debounce announcements (every 30s, not every tick) via polite live region
- **Charts:** `aria-label` + tabular alternative via "View data table" toggle (see [accessibility.md](../../accessibility.md))
- **Reduced motion:** disable chart transitions if `prefers-reduced-motion: reduce`

---

## 14. Performance budgets

| Metric | Target | Strategy |
|--------|--------|----------|
| LCP | < 2s | Inline critical CSS, preload hero data, skeleton placeholders |
| INP | < 200ms | RAF-batched updates, virtualization, code splitting |
| CLS | < 0.05 | Fixed-height rows, skeleton matches final layout |
| Main bundle | < 250KB gzipped | Code-split charts, drawer, export |
| WS lag (p95) | < 1s | Heartbeat, reconnect, catch-up |
| Memory (8h session) | < 500MB | Garbage-collect old rows, cap query cache size |

### 14.1 Long-session memory

8-hour sessions accumulate. Set React Query cache GC:

```ts
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 5 * 60_000,            // unused query data evicted after 5min
      staleTime: 60_000,
    },
  },
});
```

Cap event history (alerts feed):

```ts
state.alerts = state.alerts.slice(-1000);  // keep last 1000 only
```

---

## 15. Error handling & UX

| Scenario | UX |
|----------|-----|
| WS disconnects briefly (< 5s) | Subtle indicator; auto-recover, no toast |
| WS disconnects long (> 5s) | Toast "Live updates paused — reconnecting…"; switch to REST polling |
| Server returns 5xx for refetch | Retry with backoff (3x); toast "Couldn't refresh data — try again" |
| Update applies invalid state | Sentry breadcrumb; eject corrupted row from cache and refetch |
| Drawer fetch fails | Drawer shows error component + Retry button (don't close drawer) |
| User action mutation fails | Optimistic update reverts; toast with reason |
| Browser tab in background | Pause animations (`document.visibilityState`), batch updates more aggressively |

---

## 16. Testing strategy

| Test type | What |
|-----------|------|
| Unit | Update batcher, reconnect backoff, selectors |
| Integration | Filter → table update → drawer open (MSW for REST, mock WS) |
| Visual regression | KPI card states (loading / OK / breach), chart renders |
| E2E (Playwright) | Login → connect WS → see live order → drill in → approve → see status change |
| Load | Replay 10k events/sec into UI; assert 60 FPS scroll |
| A11y | jest-axe + axe-core/playwright on key pages; manual NVDA pass |

---

## 17. Observability

```ts
// Real User Monitoring
import { onCLS, onINP, onLCP } from "web-vitals";
onCLS((m) => track("cls", m.value));
onINP((m) => track("inp", m.value, { route, userId }));
onLCP((m) => track("lcp", m.value));

// Custom WS lag metric
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.eventTimestamp) {
    track("ws_lag", Date.now() - msg.eventTimestamp);
  }
  ...
};

// Long-task tracking
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.duration > 100) track("long_task", entry.duration);
  }
}).observe({ entryTypes: ["longtask"] });
```

Dashboard the metrics in Grafana / Datadog → alert when p95 INP > 300ms or WS lag > 5s.

---

## 18. Trade-off matrix

| Decision | Option A | Option B | Choice + Why |
|----------|----------|----------|--------------|
| Real-time transport | WebSocket | SSE | **WS** — bidirectional, multiplex, fits existing infra |
| Server data | React Query | Redux | **RQ** — built-in stale/refetch/dedup, less code |
| UI state | Redux | Zustand | **Redux** — team familiarity, devtools, time-travel debugging |
| Update batching | Per-event | RAF batch | **RAF batch** — handles bursts without UI freeze |
| List rendering | DOM table | Virtualized | **Virtualized** — handles 5k+ rows at 60 FPS |
| Chart lib | Recharts | Canvas | **Recharts for static, Canvas for live tick streams** |
| CSV export | Main thread | Web Worker | **Worker** — keeps UI responsive |
| Bundle strategy | Single bundle | Code-split | **Code-split** — initial < 250KB |

---

## 19. Interview talking points

**Q: "How would you handle WebSocket disconnections?"**
A: Three layers: (1) heartbeat ping every 30s to detect dead conns earlier than TCP timeout; (2) exponential backoff with jitter on reconnect (1s → 2s → 4s → max 30s + random 0-1s jitter to avoid thundering herd); (3) on reconnect, fetch deltas since last received event timestamp via REST so we don't miss events. UI shows a subtle indicator after 5s disconnect; toast after 30s.

**Q: "What if you get 1000 updates per second?"**
A: RAF-batched flush. Queue events, schedule a single `requestAnimationFrame` callback that drains and applies in one setQueryData call. Within the batch, merge events by orderId so only the latest state of each order is applied. If queue exceeds 1000 events, drop and force a refetch — better than freezing the UI.

**Q: "Redux or React Query for the orders list?"**
A: React Query for *server-cached* data. Redux for *UI state* (filters, drawer open, paused flag). Mixing matches the model — RQ caches what came from the server; Redux models UI. Less boilerplate than re-implementing dedup/refetch/staleness in Redux.

**Q: "Virtualization gotchas?"**
A: (1) Sticky headers need explicit z-index and background — easy to miss. (2) Variable row heights — TanStack Virtual's `measureElement` solves it but slow without ResizeObserver. (3) Scroll restoration when the dataset changes — need a stable key on each row. (4) Memo on row component is critical — without it, scrolling re-renders all visible rows when any unrelated state changes.

**Q: "How do you make a Canvas chart accessible?"**
A: `aria-label` summarizing trend, `aria-describedby` pointing to a hidden text summary, plus a toggle "View data table" that shows a real `<table>` alternative. For live updates, add a "Read current value" button that announces the latest data point via a live region — screen-reader users don't perceive Canvas paint changes.

**Q: "Performance budget — INP < 200ms. How do you achieve that?"**
A: (1) RAF-batched updates so input handlers don't compete with state updates; (2) virtualize big lists; (3) lazy-load heavy components (drawer, export, charts not on initial route); (4) move heavy work to Web Workers (CSV, large aggregations); (5) `useDeferredValue` for non-urgent re-renders (chart data); (6) measure with `web-vitals` in prod, alert at p75 > 200ms.

**Q: "An 8-hour shift session — how do you prevent memory bloat?"**
A: Cap React Query cache via `gcTime`. Trim alert/event history arrays to last N. Use `WeakMap` for cache where possible. Set `document.visibilityState` to pause animations and reduce work when tab is backgrounded. Monitor `performance.memory.usedJSHeapSize` and warn at threshold (Chrome only). Reconnect WS rather than holding stale buffers.

**Q: "How do you handle pause-live-updates?"**
A: A `paused` flag that queues incoming events into a ref array instead of applying. UI shows "N updates pending — click to resume". On unpause, drain queue through the same batcher to coalesce duplicates. The cleanly typed event handlers stay the same; the divergence is purely in the apply step.

---

## 20. Follow-up architecture questions interviewers love

1. **How do you multiplex multiple data streams over one WebSocket?**
   Topic-based subscription protocol: client sends `{"type":"subscribe","topic":"orders","filter":{...}}`; server prefixes each message with topic. Client routes by topic to appropriate handler.

2. **What if the user has multiple tabs open?**
   Each tab opens its own WS. To dedupe (and to share state), use a **SharedWorker** with one WS connection serving all tabs in the same origin. Or use `BroadcastChannel` to share REST cache updates.

3. **How would you implement collaborative cursors / presence?**
   Add a `presence` channel: each client publishes `{user, view, cursorRow}` every 5s. Server broadcasts to others. Render small avatars in the row gutter for shared awareness.

4. **What's your monitoring & alerting setup?**
   Sentry for errors. Datadog RUM for CWV. Custom WS-lag metric. Synthetic uptime checks on the dashboard route. PagerDuty when p95 INP > 500ms for 5 minutes or WS connection rate drops below baseline.

5. **How do you A/B test in this UI?**
   Feature flags via Statsig/Unleash. Variant assignment in user session, applied at render. Track via the same RUM pipeline + experiment dimensions.

---

## 21. Diagram

```
                  ┌────────────────────────────────────────────┐
                  │           User's Browser                    │
                  │                                             │
                  │   ┌──────────────────────────────────┐      │
                  │   │  React UI                         │      │
                  │   │  ┌──────────┐  ┌─────────────┐    │      │
                  │   │  │ Header / │  │ Order Table │    │      │
                  │   │  │ Filters  │  │ (virtualized│    │      │
                  │   │  └─────┬────┘  │  5k rows)   │    │      │
                  │   │        │       └─────────────┘    │      │
                  │   │        │                          │      │
                  │   │  ┌─────▼──────┐  ┌─────────────┐  │      │
                  │   │  │ KPI Cards  │  │ Live Charts │  │      │
                  │   │  └────────────┘  │ (Canvas)    │  │      │
                  │   │                  └─────────────┘  │      │
                  │   └──────────────────────────────────┘      │
                  │   ┌──────────────────────────────────┐      │
                  │   │  State                            │      │
                  │   │  React Query: ["orders"], ["kpis"]│      │
                  │   │  Redux: ui.filters, ui.drawer     │      │
                  │   └──────────┬───────────────────────┘      │
                  │              │                              │
                  │   ┌──────────▼───────────────────────┐      │
                  │   │  Realtime Client                  │      │
                  │   │  WS + RAF batcher + reconnect     │      │
                  │   └──────────┬───────────────────────┘      │
                  │              │                              │
                  │   ┌──────────▼───────────────────────┐      │
                  │   │  Web Worker (CSV export, chart   │      │
                  │   │  aggregation)                     │      │
                  │   └──────────────────────────────────┘      │
                  └─────────────┬───────────────────┬───────────┘
                                │ WS                │ REST
                                │                   │
                          ┌─────▼───────────────────▼──────┐
                          │      Backend / API Gateway      │
                          │  (sticky LB for WS, normal LB   │
                          │   for REST)                     │
                          └────────────┬────────────────────┘
                                       │
                            ┌──────────┴──────────┐
                            │                     │
                       ┌────▼────┐         ┌──────▼─────┐
                       │ Order   │         │ Defect /   │
                       │ Service │         │ MCP Engine │
                       └─────────┘         └────────────┘
```

---

## 22. References & cross-links

- [FE System Design notes](../../../../system-design/frontend-system-design/FESystemDesignNotes.md) — base framework: TTFB/FCP/LCP/INP/CLS, SSE vs WS vs polling
- [Virtualization notes](../../../react/virtualization.md) — react-window/react-virtualized comparison
- [Browser rendering pipeline](../../browser-rendering-pipeline.md) — RAF, layout/paint/composite
- [Performance optimization](../../../performance-security/performance-optimization.txt) — CWV details
- [Redux notes](../../../react/redux.md) — Redux Toolkit, RTK Query, when to use Context
- [TanStack Query](../../../react/tanstack-query.txt) — cache invalidation, optimistic updates
- [Accessibility](../../accessibility.md) — live regions, table semantics, ARIA grid
