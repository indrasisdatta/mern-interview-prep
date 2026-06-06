# FE System Design — Stock Trading / Fund NAV Dashboard

> Resume project: **Citibank Clarity Workflow Oversight (CWO)** — fund NAV module, daily fund-data loading from Saturn/CADIS, role-based approval workflows.
>
> Cross-link: [Real-Time Dashboard](../6-RealTimeDashboard/notes.md) · [Micro-frontend Architecture](../7-MicroFrontendArchitecture/notes.md) · [Browser rendering pipeline](../../browser-rendering-pipeline.md)

---

## 1. Problem statement

Design a UI for a financial trading / fund-NAV dashboard:

- **Real-time price ticks** (10-100 updates/sec per instrument, hundreds of instruments)
- **Order book** (top N levels, redraws on every market data update)
- **Candlestick chart** with multiple timeframes (1m, 5m, 1h, 1d) and indicators (SMA, EMA, RSI)
- **Watchlist** of instruments with running P&L
- **Order entry panel** (buy/sell, limit/market, with depth-aware pricing)
- **Open orders + recent fills** table (live, server-pushed)
- **Multi-screen layout** — users have multiple monitors, deep customization
- **Decimal precision** — financial values must never lose precision (no float arithmetic!)

Used by professional traders. Latency to perceive price changes < 100ms. Trader interactions (place order, cancel) < 50ms perceived.

---

## 2. Requirements

### 2.1 Functional

- Live price ticker with last/bid/ask + delta indicator
- Order book heatmap (depth visualization)
- Candlestick chart, configurable timeframes, technical indicators
- Order entry form with type-ahead instrument lookup
- Open orders, working orders, fill history (live)
- Customizable layout — drag-and-drop panels, save layouts
- Multi-instrument watchlist
- Trade history search/filter
- Role-based access (junior trader, senior trader, head, compliance, audit)

### 2.2 Non-functional

- **Latency:** tick → screen < 50ms p95
- **Throughput:** sustain 1000 ticks/sec aggregated across instruments
- **Precision:** financial calculations exact (no `0.1 + 0.2 ≠ 0.3` errors)
- **Reliability:** survives WS reconnect; never loses an order state
- **Audit:** every user action logged with timestamp + role
- **Accessibility:** WCAG 2.2 AA (yes, even pro UIs — Citi compliance)
- **Performance:** 60 FPS scrolling, INP < 100ms (pro UX)

---

## 3. High-level architecture

```
                        Browser tab (single trader)
   ┌────────────────────────────────────────────────────────────────────┐
   │                                                                      │
   │   ┌──────────┐   ┌─────────┐   ┌──────────┐   ┌─────────┐            │
   │   │ Watchlist │   │ Order   │   │  Chart   │   │  Order   │            │
   │   │           │   │  Book   │   │ (Canvas) │   │  Entry   │            │
   │   └─────┬─────┘   └────┬────┘   └────┬─────┘   └────┬────┘            │
   │         │              │             │              │                  │
   │         └──────┬───────┴─────────────┴──────────────┘                  │
   │                ▼                                                       │
   │   ┌────────────────────────────────────────────┐                       │
   │   │  Market Data Store (per instrument)         │                       │
   │   │  - last price, bid/ask, OHLC, volume        │                       │
   │   │  - decimal-safe (Big.js / Decimal.js)       │                       │
   │   └────────────────────────────────────────────┘                       │
   │                                                                       │
   │   ┌────────────────────────────────────────────┐                       │
   │   │  Order Store (in-flight, working, filled)   │                       │
   │   └────────────────────────────────────────────┘                       │
   │                                                                       │
   │   ┌────────────────────────────────────────────┐                       │
   │   │  WS Multiplexer                              │                       │
   │   │  - subscribe to instruments                  │                       │
   │   │  - dispatch by topic                          │                       │
   │   └─────┬───────────────────────────────┬─────────┘                     │
   │         │                                │                              │
   │         ▼ market-data WS                 ▼ orders WS                    │
   │  ┌──────────────┐                ┌──────────────┐                       │
   │  │ Tick Worker  │                │ Order Worker │                       │
   │  │ - parse,      │                │  - parse,    │                       │
   │  │   coalesce    │                │   reconcile │                       │
   │  │ - throttle    │                │ - persist    │                       │
   │  └──────────────┘                └──────────────┘                       │
   │                                                                       │
   └────────────┬─────────────────────────────────┬──────────────────────────┘
                ↑                                  ↑
                │                                  │ REST (place / cancel order)
        ┌───────┴────────┐                  ┌──────┴──────────┐
        │  Market Data   │                  │ Order Gateway   │
        │  Gateway       │                  │ (FIX, OMS)      │
        └────────────────┘                  └─────────────────┘
```

---

## 4. Decimal precision — the #1 financial UI bug

```js
0.1 + 0.2 === 0.3   // false — JS double precision
0.1 + 0.2           // 0.30000000000000004
```

Never use float for prices, quantities, or balances. Use:

- **decimal.js** / **big.js** / **bignumber.js** (libraries)
- **strings** for transport over network (server sends "102.45" not 102.45)
- **integer cents/satoshis** for highest performance (multiply by 10^N for the decimals you need)

### 4.1 Decimal-safe arithmetic

```ts
import { Decimal } from "decimal.js";

const price = new Decimal("102.45");
const qty   = new Decimal("100");
const cost  = price.mul(qty);     // Decimal { "10245" }
cost.toFixed(2);                   // "10245.00"
```

### 4.2 Formatting for display

```ts
function formatCurrency(value: Decimal | string, currency = "USD", decimals = 2): string {
  const d = new Decimal(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(d.toNumber());   // narrow cast only at display layer
}
```

Use `toNumber()` only at the very last step (display). Arithmetic stays in `Decimal`.

---

## 5. Real-time tick handling

### 5.1 The 1000-tick/sec problem

If every tick triggers React re-render → ~16ms work each → backlog → frozen UI.

**Solution: store ticks outside React, render on RAF.**

```ts
class TickStore {
  private latest = new Map<string, Tick>();         // instrument -> latest tick
  private dirty = new Set<string>();                // instruments needing render
  private subscribers = new Map<string, Set<() => void>>();   // per-instrument listeners

  push(tick: Tick) {
    this.latest.set(tick.symbol, tick);
    this.dirty.add(tick.symbol);
    this.scheduleFlush();
  }

  private flushScheduled = false;
  private scheduleFlush() {
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      requestAnimationFrame(() => {
        const dirty = Array.from(this.dirty);
        this.dirty.clear();
        this.flushScheduled = false;
        for (const sym of dirty) {
          const subs = this.subscribers.get(sym);
          if (subs) for (const cb of subs) cb();
        }
      });
    }
  }

  get(symbol: string) { return this.latest.get(symbol); }

  subscribe(symbol: string, cb: () => void) {
    if (!this.subscribers.has(symbol)) this.subscribers.set(symbol, new Set());
    this.subscribers.get(symbol)!.add(cb);
    return () => this.subscribers.get(symbol)!.delete(cb);
  }
}
```

### 5.2 React integration via `useSyncExternalStore`

```ts
function useTick(symbol: string) {
  return useSyncExternalStore(
    (cb) => tickStore.subscribe(symbol, cb),
    () => tickStore.get(symbol)
  );
}

function PriceCell({ symbol }) {
  const tick = useTick(symbol);
  if (!tick) return <span>—</span>;
  return <span className={`price ${tick.delta > 0 ? "up" : "down"}`}>{tick.last}</span>;
}
```

Only `PriceCell` components for *changed instruments* re-render per frame. 1000 ticks → ~50 unique instruments → ~50 re-renders / frame at 60 FPS. Smooth.

---

## 6. Order book — heatmap visualization

Order book shows N bid + N ask levels (e.g., 10 each). Each level updates 5-50 times/sec.

### 6.1 Per-row vs full-redraw

**Per-row** (DOM updates): 20 rows × 30 updates/sec = 600 DOM mutations/sec. Acceptable for normal markets, edge of comfort during volatility.

**Canvas full-redraw**: clear + redraw 20 rows = ~0.2ms per frame. Solidly within budget.

For high-traffic books (crypto, top FX), Canvas wins. For Citi fund-NAV-style "daily price set" (one update per day per fund), DOM is fine.

### 6.2 Canvas order book

```jsx
function OrderBook({ symbol }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const draw = () => {
      const book = orderBookStore.get(symbol);
      const ctx = canvasRef.current!.getContext("2d")!;
      ctx.clearRect(0, 0, 400, 600);

      book.asks.slice(0, 10).forEach((lvl, i) => {
        const y = i * 30;
        ctx.fillStyle = `rgba(255,99,71,${lvl.size / book.maxSize})`;
        ctx.fillRect(0, y, lvl.size / book.maxSize * 400, 28);
        ctx.fillStyle = "#000";
        ctx.fillText(`${lvl.price}  ${lvl.size}`, 10, y + 18);
      });
      // ... bids
    };

    const unsub = orderBookStore.subscribe(symbol, draw);
    draw();
    return unsub;
  }, [symbol]);

  return <canvas ref={canvasRef} width={400} height={600} role="img"
                 aria-label={`Order book for ${symbol}`} />;
}
```

---

## 7. Candlestick chart

Candlestick chart with multiple resolutions (1m, 5m, 1h, 1d) requires:

- Server provides historical bars on initial load
- Live ticks aggregated into the current bar
- Pan/zoom over historical data
- Tooltip with crosshair
- Technical indicators (SMA, EMA, RSI, MACD)

### 7.1 Libraries

| Library | Notes |
|---------|-------|
| **TradingView's Lightweight Charts** | Free, Canvas-based, financial-domain primitives (candles, volume, indicators built in). Recommended for new builds. |
| **Highcharts Stock** | Paid, mature, lots of features |
| **ECharts** | Free, more general-purpose, can do finance |
| **D3.js + Canvas** | Roll your own — only if you need bespoke behavior |

For Citi-grade UI, Lightweight Charts (BSD 3-clause for non-public-marketdata uses) or Highcharts Stock (paid, robust support).

### 7.2 Aggregating live ticks into current bar

```ts
function updateCurrentBar(bar: OHLC, tick: Tick) {
  return {
    open: bar.open,                    // unchanged
    high: Decimal.max(bar.high, tick.last).toString(),
    low:  Decimal.min(bar.low, tick.last).toString(),
    close: tick.last,                  // latest
    volume: new Decimal(bar.volume).plus(tick.size).toString(),
  };
}

tickStore.subscribe(symbol, () => {
  const tick = tickStore.get(symbol)!;
  const currentBar = chartStore.getCurrentBar(symbol);
  if (currentBar && tickWithinBar(tick, currentBar)) {
    chartStore.updateBar(symbol, updateCurrentBar(currentBar, tick));
  } else {
    chartStore.appendBar(symbol, newBarFromTick(tick));
  }
});
```

### 7.3 Indicators — compute incrementally

Don't recompute SMA over 1000 bars every tick. Maintain a running window:

```ts
class SMA {
  private window: Decimal[] = [];
  constructor(private n: number) {}
  push(v: string): string | null {
    this.window.push(new Decimal(v));
    if (this.window.length > this.n) this.window.shift();
    if (this.window.length < this.n) return null;
    return this.window.reduce((a, b) => a.plus(b), new Decimal(0))
                      .div(this.n).toString();
  }
}
```

For EMA, the formula `EMA_t = α·price_t + (1-α)·EMA_{t-1}` is naturally incremental.

---

## 8. Order entry — precision and safety

### 8.1 The form

```jsx
function OrderEntry({ symbol }) {
  const tick = useTick(symbol);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [type, setType] = useState<"market" | "limit">("limit");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");

  const placeOrder = useMutation({
    mutationFn: (payload) => api.placeOrder(payload),
    onMutate: (payload) => {
      // optimistic: show pending order
      orderStore.addPending(payload);
    },
    onError: (err, payload) => {
      orderStore.removePending(payload.clientOrderId);
      toast.error(`Order rejected: ${err.message}`);
    },
    onSuccess: (server, payload) => {
      orderStore.confirmPending(payload.clientOrderId, server);
    },
  });

  const submit = () => {
    if (!isValidQuantity(qty) || !isValidPrice(price)) return;
    const clientOrderId = generateId();    // idempotency
    placeOrder.mutate({
      clientOrderId, symbol, side, type, qty, price,
      ts: Date.now(),
    });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <RoleGate require="trader">
        ...
        <button type="submit" disabled={placeOrder.isPending}>
          {placeOrder.isPending ? "Placing…" : `Place ${side.toUpperCase()}`}
        </button>
      </RoleGate>
    </form>
  );
}
```

### 8.2 Idempotency

Every order has a client-generated `clientOrderId` (UUID v7 or ULID). If the request retries (network blip), server dedups. Without idempotency, double-submits = duplicate orders = lost money.

### 8.3 Optimistic updates

Show order as "pending" immediately for snappy UX. On server response: confirm or reject. On error: revert.

### 8.4 Confirm dialog for large orders

```jsx
const requiresConfirmation = (qty, price, instrument) => {
  const notional = new Decimal(qty).mul(price);
  return notional.gt(instrument.confirmThreshold);
};
```

WCAG 3.3.4: "Error Prevention (Legal, Financial, Data)" — reversible, checked, or confirmed.

---

## 9. Open orders + fills — live tables

Similar to [Real-Time Dashboard](../6-RealTimeDashboard/notes.md) — virtualized table with WS-driven updates. Specifics for trading:

- Highlight row briefly when fill received ("animation-only flash, not layout shift")
- Order status: working / partial / filled / cancelled / rejected
- Cancellation: optimistic — mark order as "cancelling" until server confirms
- Filter by working / completed; default to working-only

```css
@keyframes flash {
  0%   { background: var(--color-flash); }
  100% { background: transparent; }
}
.row.flash { animation: flash 600ms; }

@media (prefers-reduced-motion: reduce) {
  .row.flash { animation: none; background: var(--color-flash-static); }
}
```

---

## 10. Layout customization

Pro traders want custom multi-monitor layouts. Implement:

- **Drag-and-drop panel** rearrangement (`react-grid-layout`, `react-mosaic`, `golden-layout`)
- **Layouts persistence** — server-side per user
- **Multi-window** via `window.open` + BroadcastChannel for cross-window state sync

### 10.1 Saved layouts API

```ts
// REST
GET /api/users/me/layouts       → [{ id, name, schema }, ...]
POST /api/users/me/layouts      → save
PUT /api/users/me/layouts/{id}  → update

// schema is a serializable tree of panels:
{
  type: "row",
  children: [
    { type: "tile", component: "Chart", props: { symbol: "AAPL" } },
    { type: "tile", component: "OrderBook", props: { symbol: "AAPL" } },
  ],
}
```

### 10.2 Multi-window

```js
const popout = window.open("/popout/chart?symbol=AAPL", "_blank", "popup,width=800,height=600");
const channel = new BroadcastChannel("market-data");
// All windows on same origin share the same TickStore via SharedWorker for one WS conn
```

A `SharedWorker` holds the single WS connection and broadcasts ticks to all tabs / windows on the same origin.

---

## 11. Role-based UI

Citi CWO had junior trader, senior trader, supervisor, compliance, audit.

### 11.1 RBAC helper

```jsx
function useHasRole(...required: string[]) {
  const { roles } = useAuth();
  return useMemo(() => required.every(r => roles.includes(r)), [roles, required]);
}

function RoleGate({ require, fallback = null, children }) {
  const allowed = useHasRole(...require);
  return allowed ? children : fallback;
}

<RoleGate require={["trader.execute"]}>
  <OrderEntry />
</RoleGate>

<RoleGate require={["compliance.override"]}>
  <ForceCancelButton />
</RoleGate>
```

### 11.2 UI gates are NOT security

UI hides actions for UX; server enforces RBAC for security. A junior who manually crafts a request must still be rejected.

### 11.3 Disabled vs hidden

- **Hidden:** the action is irrelevant to this user (cleaner UI)
- **Disabled with tooltip:** the action is restricted but the user benefits from seeing it exists (e.g., "requires manager approval")

---

## 12. Audit logging

Every user-initiated action publishes an audit event:

```ts
function audit(action: string, payload: any) {
  navigator.sendBeacon("/audit", JSON.stringify({
    user: currentUser.id,
    role: currentUser.roles[0],
    action,
    payload,
    ts: Date.now(),
    sessionId,
    page: window.location.pathname,
  }));
}

audit("order.place", { clientOrderId, symbol, side, qty, price });
audit("order.cancel", { orderId });
```

`navigator.sendBeacon` is fire-and-forget; survives page close.

---

## 13. Performance budgets

| Metric | Target | Strategy |
|--------|--------|----------|
| LCP | < 1.5s | Inline critical CSS, preload market data WS endpoint via `<link rel="preconnect">` |
| INP | < 100ms | Throttled tick flush via RAF; canvas redraws off DOM |
| Tick → screen | < 50ms p95 | TickStore + useSyncExternalStore; minimal React work per tick |
| Order action → confirm | < 200ms p95 | Optimistic UI; React Query mutation |
| Bundle initial | < 200KB | Code-split panels, lazy charts |
| 60 FPS in volatility | always | Canvas for high-update panels, RAF batching |

---

## 14. Accessibility — pro UI is no exception

Even "high-density expert UIs" must comply:

- All actionable cells keyboard reachable
- Color is not sole signal (red = down → also "+/−" prefix, "▲▼" icons)
- Order book and chart have text-summary alternatives (`aria-describedby`)
- Live regions with reasonable rate-limit (announce P&L change every 30s, not every tick)
- Reduced-motion mode disables flashes, uses static highlighting
- WCAG 2.2 SC 1.4.11 (non-text contrast): focus rings on chart crosshair, button borders

```css
.price.up { color: var(--color-up); }
.price.up::before { content: "+ "; }
.price.down { color: var(--color-down); }
.price.down::before { content: "− "; }
```

---

## 15. Failure modes

| Failure | UX |
|---------|----|
| Market data WS drops | Stale-indicator on prices; reconnect in BG; if >10s, banner "Data delayed" |
| Order gateway WS drops | Order placement disabled; show "Trading paused — connection issue" |
| Order timeout (no ack in 5s) | Show "Sending…" then "Unknown — check Orders" — don't auto-retry place orders |
| Server rejects order | Inline error in form with reason code (e.g., "Insufficient margin") |
| Stale price warning | If last tick is >2s old (in market hours), grey the price, show "Stale" |
| User runs out of session | Modal: "Session expiring in 60s — reauth?" |

### 15.1 Trading-specific safety: never auto-retry order placement

Place-order requests are NOT idempotent at the human level even with `clientOrderId` (if your client crashes mid-request and there's no clientOrderId tracking). Show the trader the ambiguous state and let them resolve. Auto-retries have caused billion-dollar incidents (Knight Capital).

---

## 16. Testing

| Layer | What |
|-------|------|
| Unit | Decimal arithmetic, indicator calculations, order validation, RBAC predicates |
| Integration | Order placement flow with MSW mocking Order gateway; verify optimistic + error path |
| E2E (Playwright) | Login → watchlist → place order → see in Open Orders → cancel → see in Cancelled |
| Load test | Simulate 5000 ticks/sec; verify 60 FPS sustained, INP < 100ms |
| Visual regression | Chart rendering for various states (loading, sparse data, dense intraday) |
| Mutation testing | Stryker on Decimal arithmetic — catches lazy tests |
| Manual a11y | NVDA pass on price/order/chart panels; keyboard-only flow |

---

## 17. Trade-off matrix

| Decision | Option A | Option B | Choice + Why |
|----------|----------|----------|--------------|
| Numbers | float | Decimal.js + string transport | **Decimal/strings** — financial correctness |
| State on tick | useState / Redux | External store + useSyncExternalStore | **External + RAF** — handles 1000 ticks/sec |
| Order book | DOM | Canvas | **Canvas** for high-rate; DOM for low-rate (Citi fund NAV: DOM is enough) |
| Chart lib | D3 from scratch | TradingView Lightweight | **Lightweight Charts** — domain primitives |
| Layout | Fixed | Custom drag-drop | **Custom drag-drop** for pro UI; fixed for retail-grade |
| Multi-window | Separate WS per window | SharedWorker + BC | **SharedWorker** — single WS, deduped state |
| Order retry | Auto-retry | Manual on ambiguous state | **Manual** — financial safety |
| RBAC | UI-only | UI + server enforced | **Both** — UI for UX, server for security |

---

## 18. Architecture decisions reflecting Citi CWO

- **Daily NAV** (not real-time): updates happen end-of-day from Saturn/CADIS, so the heavy real-time tick infrastructure simplifies to a refresh on schedule + WS push when NAV is computed
- **Role-based workflow:** junior submits NAV → senior reviews → publishes → compliance audit log
- **Multi-step approval form** with intermediate-state persistence (user closes browser, returns to draft)
- **GraphQL** + Socket.io for queries + notifications respectively
- **Decimal precision** still essential — NAVs are 4-6 decimals; aggregate billions in AUM

CWO is a **workflow** UI, not an HFT UI. Borrows the precision and audit patterns of trading; doesn't need 60 FPS tick rendering. Many of this note's patterns scale down naturally to that case.

---

## 19. Interview talking points

**Q: "How do you handle 1000 ticks per second?"**
A: Store ticks outside React in a plain Map keyed by symbol. Subscribe components via `useSyncExternalStore` with per-symbol granularity — only changed instruments re-render. Flush dirty set per `requestAnimationFrame` (60 Hz max regardless of incoming rate). High-update panels (order book) draw on Canvas, not DOM.

**Q: "Why not just use floats for prices?"**
A: JS doubles can't represent decimal fractions exactly — `0.1 + 0.2 = 0.30000000000000004`. Accumulating errors over thousands of trades produces material misstatements. Use Decimal.js (arbitrary precision) and pass strings over the wire. Convert to Number only at the display step via `Intl.NumberFormat`.

**Q: "How do you ensure an order isn't double-placed?"**
A: Client generates a `clientOrderId` (UUID v7 or ULID) before sending. Server dedups by that ID. Retries with the same ID are safe — the second request returns the first's result. Critical because network blips during order placement are common and double-sending real orders is a regulatory event.

**Q: "Why optimistic UI for orders but not auto-retries?"**
A: Optimistic UI shows the order as pending immediately for snappy feel; if rejected, revert. Auto-retries on placement, by contrast, can cause duplicate orders when the network was actually fine and only the response was lost. We make the trader decide on ambiguous states — "is your order in or not? Check Orders panel" — rather than risk a duplicate.

**Q: "How would you make a high-density pro UI accessible?"**
A: (1) Color + symbol prefixes (▲▼, +/−) so colorblind users perceive deltas; (2) Live regions for price changes, rate-limited (every 5-30s, not every tick); (3) Chart has tabular alternative via "View data" toggle; (4) All actions keyboard reachable; (5) `prefers-reduced-motion` disables flashes; (6) `aria-describedby` on order entry to announce notional + warnings. Pro UIs aren't exempt from WCAG — banks still have ADA exposure.

**Q: "Multi-window support — how?"**
A: SharedWorker holds the single WS connection and `BroadcastChannel` distributes ticks to all tabs/popouts on the same origin. Each window can subscribe to a subset of instruments via the channel. Single connection saves quota on the broker side; deduped state stays consistent across windows.

**Q: "How do you persist a user's custom layout?"**
A: Serialize the panel tree to JSON. POST/PUT to `/api/users/me/layouts/{id}`. On load, fetch + restore. Use react-grid-layout / react-mosaic / golden-layout as the drag-drop primitive — they all serialize their layout cleanly.

**Q: "If WS lag spikes, how does the UI behave?"**
A: TickStore tracks `lastTickTimestamp` per symbol. UI components flag prices as "stale" if older than 2s during market hours. After 10s, banner appears: "Data delayed". Order placement disables if order gateway WS specifically is disconnected. User is always informed; the UI never lies about data freshness.

---

## 20. Diagram

```
   Market           ┌──── Browser ───────────────────────────────────┐
   Gateway          │                                                 │
       │            │   ┌────────────────────────────┐               │
       │ ticks WS   │   │ React UI                    │               │
       └────────────│──►│  - Watchlist  - OrderBook   │               │
                    │   │  - Chart      - OrderEntry  │               │
                    │   │  - OpenOrders - Fills       │               │
                    │   └─────────┬──────────────────┘               │
                    │             │ useSyncExternalStore             │
                    │   ┌─────────▼──────────────────┐               │
                    │   │   Stores (outside React)     │               │
                    │   │   TickStore  OrderStore      │               │
                    │   │   ChartStore BookStore       │               │
                    │   │   Decimal-safe values        │               │
                    │   └─────────┬──────────────────┘               │
                    │             │                                  │
                    │   ┌─────────▼──────────────────┐               │
                    │   │  WS Multiplexer + RAF flush│               │
                    │   └────┬───────────────────┬───┘               │
                    │        │                   │                   │
                    │        │ market WS          │ orders WS         │
                    │        │                   │                   │
   Order Gateway    │        │                   │                   │
       │            │        │                   │                   │
       │  ◄─────────│────────│───────────────────┘                   │
       │            │        │                                       │
       │            │        ▼                                       │
       └────────────│───┐  REST (place/cancel) with clientOrderId    │
                    │   │                                            │
                    │   ▼                                            │
                    │   ┌────────────────────────────┐               │
                    │   │ Audit beacon ──► /audit     │               │
                    │   └────────────────────────────┘               │
                    └─────────────────────────────────────────────────┘
```

---

## 21. Cross-links

- [Real-Time Dashboard](../6-RealTimeDashboard/notes.md) — WS reconnect, virtualization, RAF batching
- [Micro-frontend Architecture](../7-MicroFrontendArchitecture/notes.md) — Citi CWO patterns
- [Browser rendering pipeline](../../browser-rendering-pipeline.md) — Canvas vs DOM
- [Accessibility](../../accessibility.md) — pro-UI a11y
- [TypeScript advanced](../../typescript-advanced.md) — branded types for OrderId, FundId, Price
- [React advanced topics](../../../react/advanced-topics.md) — useSyncExternalStore
