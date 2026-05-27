# Frontend Architect Interview Notes
### Lead / Architect Level 
### Project Context: Auto Triaging Platform @ Verizon

---

## 1. Intersection Observer — Why Can't It Maintain Scroll Position?

### Answer

Intersection Observer is a browser API designed to **asynchronously observe** whether a target element enters or exits the viewport (or a parent container). It's fire-and-forget — it tells you *when* visibility changes, but it doesn't know about scroll position, and it doesn't control or persist it.

The core reason it can't "maintain" scroll position is that it's **read-only and passive** — it reacts to layout changes but doesn't interact with the scroll engine. When new content is injected above the fold (e.g., infinite scroll prepending older messages), the browser recalculates layout, shifting content downward, and IO has no mechanism to compensate for that.

### The Real Problem: Content Shift on Insertion

```
Before insert:         After inserting 3 items above:
┌─────────────┐        ┌─────────────┐
│  [Sentinel] │◄── IO  │  [New Item] │
│  Item A     │  fires │  [New Item] │
│  Item B     │        │  [New Item] │
│  [Item C]   │◄── was │  [Sentinel] │
│   visible   │  here  │  [Item A]   │◄── pushed down
└─────────────┘        │  [Item B]   │
                       │  [Item C]   │ ← user loses position
                       └─────────────┘
```

### Practical Real-World Example

In our Auto Triaging Platform, the log timeline view renders thousands of log entries for a given Order ID or Session ID. When the ops team scrolls up to load older log entries, we prepend them to the DOM. IO fires correctly when the sentinel enters the viewport — but without scroll anchoring, the user's view jumps up to the newly prepended content, losing their reading position entirely.

```js
// IO fires when sentinel enters viewport → fetch older log entries
// But after prepending log rows, the scroll jumps UP
// IO has no API to say "stay where you were"

const observer = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) {
    loadOlderLogs(); // this prepends DOM nodes → layout shift
  }
});
observer.observe(sentinelRef.current);
```

### The Fix — Use `scroll-anchoring` or Manual Anchor

**Option 1: CSS Scroll Anchoring (modern browsers)**
```css
.log-timeline-container {
  overflow-anchor: auto; /* default — browser tries to anchor */
}
.sentinel {
  overflow-anchor: none; /* prevent sentinel from being the anchor */
}
```

**Option 2: Manual anchor with `scrollHeight` diff**
```js
async function loadOlderLogs() {
  const container = containerRef.current;
  const prevScrollHeight = container.scrollHeight;

  await fetchAndPrepend(); // DOM updated

  // Restore scroll position
  container.scrollTop += container.scrollHeight - prevScrollHeight;
}
```

**Option 3: Virtual list for large log tables** — we used `react-window` in the triaging platform for rendering thousands of log rows. With virtualization, only visible rows are in the DOM so prepending is cheaper and scroll anchoring isn't needed.

### In One Line for the Interviewer
> "IO is a visibility detector, not a scroll controller. It fires callbacks when elements cross thresholds, but has no write access to scroll position. When content is prepended — like loading older logs in a timeline — you need to manually compensate using scrollHeight deltas or rely on CSS scroll-anchoring."

---

### Follow-up Questions

**Q: Can `MutationObserver` help here?**
> It can detect DOM insertions, which lets you trigger the scrollHeight diff correction. Used in combination with IO — IO detects the need to load, MutationObserver detects when DOM is updated, then you correct position.

**Q: What's the difference between IO root margin and threshold?**
> `rootMargin` pre-loads data before the element is visible (e.g., `200px` triggers 200px before sentinel hits viewport). `threshold` (0 to 1.0) determines what fraction of the element must be visible before firing. In the triaging platform, for lazy loading screenshots in the log timeline, I use `rootMargin: '200px'` and `threshold: 0` — so screenshots start loading before the user actually scrolls to them.

**Q: IO vs scroll event listener — which is better for performance?**
> IO is always better. Scroll events fire on every pixel of scroll (60fps = 60 events/sec), require manual debounce/throttle, and block the main thread. IO runs off the main thread and fires only on threshold crossings — far cheaper and no jank. In a log table with thousands of rows, scroll listeners would have been a performance disaster.

**Q: Where else did you use IO in your project?**
> Three places: (1) lazy loading screenshots in the log timeline — images only load when they're about to enter the viewport, with Blob caching so they don't refetch on revisit; (2) the infinite scroll sentinel for paginating log entries; (3) triggering skeleton-to-content transitions for the AI summary panel when it scrolls into view.

---

---

## 2. How to Improve LCP, INP, CLS?

### Answer

These are Google's **Core Web Vitals** — they directly impact SEO ranking and perceived UX quality. On the Auto Triaging Platform, the primary users are internal ops and support teams, but the same principles apply — a slow dashboard costs real productivity. Our main challenge was INP: heavy log tables and filter interactions were causing 600–800ms interaction delays.

### LCP — Largest Contentful Paint (target: < 2.5s)

LCP measures how fast the largest visible element loads. Usually a hero image or H1 text.

**Common culprits and fixes:**

| Culprit | Fix |
|---|---|
| Hero image loaded lazily | Remove `loading="lazy"` from LCP image |
| Image not preloaded | Add `<link rel="preload" as="image">` in `<head>` |
| Render-blocking JS/CSS | Use `async`/`defer` on scripts; inline critical CSS |
| Slow server (TTFB) | Use CDN, Edge functions, HTTP/2 |
| Large image size | Use WebP/AVIF, proper `srcset`, image CDN like Cloudinary |

**Real fix:**
```html
<!-- In <head> — preload the hero image before anything else -->
<link rel="preload" as="image" href="/hero.webp" fetchpriority="high" />

<!-- DO NOT lazy load the LCP element -->
<img src="/hero.webp" alt="Hero" fetchpriority="high" />
```

In our dashboard, the LCP element was the order flow graph visualizer — a heavy D3 component. We lazy-loaded it with `React.lazy()` and showed a skeleton placeholder immediately, so LCP was the skeleton (fast paint) and the real component hydrated after.

```jsx
// Lazy load heavy modules — graph visualizer, AI summary, screenshot viewer
const GraphVisualizer = React.lazy(() => import('./GraphVisualizer'));
const AISummary = React.lazy(() => import('./AISummary'));

<Suspense fallback={<GraphSkeleton />}>
  <GraphVisualizer orderId={orderId} />
</Suspense>
```

Also preconnect to external resource origins:
```html
<link rel="preconnect" href="https://fonts.gstatic.com">
<link rel="preconnect" href="https://images.cdn">
```

---

### INP — Interaction to Next Paint (target: < 200ms)

Replaced FID in 2024. Measures the worst-case delay between user interaction and the next visual update.

**Common culprits and fixes:**

| Culprit | Fix |
|---|---|
| Heavy JS on click/keypress | Break work with `scheduler.yield()` or `setTimeout(0)` |
| Long tasks blocking main thread | Code-split, defer non-critical work |
| Re-rendering too many components | `React.memo`, `useMemo`, `useCallback` |
| Synchronous state updates on fast input | Debounce, or use `useTransition` for non-urgent updates |

## What `scheduler.yield()` Does Internally

### `scheduler.yield()`

1. Your async function hits:

   ```js
   await scheduler.yield();
   ```

2. The current task ends, freeing the main thread.

3. The browser checks whether any high-priority work is pending:

   - User input events
   - Rendering/paint work
   - Other urgent browser tasks

   **If yes:** handle them first.

   **If no:** immediately resume the continuation of your function.

4. Execution resumes exactly at the line following the `await`.

---

### How This Differs from `setTimeout(..., 0)`

#### `setTimeout`

1. Your function executes:

   ```js
   setTimeout(fn, 0);
   ```

2. `fn` is added to the back of the task queue.

3. The browser processes all previously queued tasks:

   - Other timers
   - Analytics callbacks
   - Third-party scripts
   - Any pending macrotasks

4. Eventually `fn` runs, which could be:
   - ~10ms later
   - ~200ms later
   - Or longer under heavy load

---

### Browser Support & Polyfill

`scheduler.yield()` is supported in Chrome and Firefox (since August 2025). Safari has not implemented it yet.

Always perform feature detection and provide a fallback:

```js
async function yieldToMain() {
  if ('scheduler' in globalThis && 'yield' in scheduler) {
    await scheduler.yield();
  } else {
    // Fallback to setTimeout.
    // This still yields to the browser,
    // but loses the priority scheduling benefits.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
```

### Usage Example

```js
async function heavyWork() {
  for (const item of largeList) {
    process(item);

    // Give the browser a chance to handle
    // user input, rendering, and other work.
    await yieldToMain();
  }
}
```

### Why Use It?

- Keeps the UI responsive during CPU-intensive work.
- Allows user interactions to be processed sooner.
- Avoids long-running tasks blocking rendering.
- More efficient than repeatedly using `setTimeout(..., 0)` because the browser can prioritize urgent work before resuming execution.

**Real fix from our project — debounced search with `useTransition`:**

The log search bar was triggering re-renders on every keystroke, filtering thousands of log entries synchronously. We debounced the input and wrapped the heavy filter in `useTransition`:

```jsx
const [inputValue, setInputValue] = useState('');
const [isPending, startTransition] = useTransition();

const debouncedSearch = useMemo(
  () => debounce((value) => {
    startTransition(() => {
      setFilteredLogs(filterLogs(allLogs, value)); // non-urgent — yields to browser
    });
  }, 300),
  [allLogs]
);

function handleSearch(value) {
  setInputValue(value);   // urgent — input updates immediately
  debouncedSearch(value); // non-urgent — filter runs after 300ms + transition
}
```

---

### CLS — Cumulative Layout Shift (target: < 0.1)

Measures visual stability — how much content jumps around during load.

**Common culprits and fixes:**

| Culprit | Fix |
|---|---|
| Images without dimensions | Always set `width` and `height` on `<img>` |
| Ads/embeds without reserved space | Use `min-height` placeholder before content loads |
| Dynamic content injected above fold | Append, don't prepend; or reserve space |
| Web fonts causing FOUT | Use `font-display: optional` or preload fonts |
| Skeleton screens wrong size | Match skeleton dimensions exactly to real content |

**Real fix — skeleton screens for log rows:**
```jsx
// Wrong — generic skeleton, causes shift when real content is different height
<div className="skeleton" style={{ height: '40px' }} />

// Right — skeleton matches the exact row height of the log table
<div className="skeleton" style={{ height: '56px', borderRadius: '4px' }} />
```

For screenshots in the log timeline — reserving fixed aspect ratio space before the image loads:
```css
.screenshot-wrapper {
  aspect-ratio: 16 / 9;
  background: #1e1e2e; /* dark placeholder matching dashboard theme */
}
```

---

### Follow-up Questions

**Q: How do you measure these in a CI/CD pipeline?**
> We run Lighthouse CI in our GitLab pipeline as a stage after deployment to staging. It fails the pipeline if LCP > 2.5s or CLS > 0.1. For real-user data, the `web-vitals` library sends INP and CLS metrics to our internal Sentry dashboard.
```yaml
# .gitlab-ci.yml
lighthouse:
  stage: audit
  script:
    - npx lhci autorun --config=lighthouserc.js
  rules:
    - if: '$CI_MERGE_REQUEST_ID'
```
```js
import { onLCP, onINP, onCLS } from 'web-vitals';
onINP(metric => sendToSentry('inp', metric.value));
```

**Q: What's the difference between lab data and field data?**
> Lab data (Lighthouse, WebPageTest) is synthetic — consistent but doesn't reflect real-user network/device variation. Field data (web-vitals library, RUM) is what actual users experience — noisier but what matters. For the triaging platform, our internal users are on corporate laptops on a fast network, so lab and field were close. For consumer-facing apps I always optimize for field data at the p75 percentile.

**Q: LCP is good in dev but bad in prod — why?**
> Usually CDN misconfiguration, missing preload headers in the deployed HTML, or the build pipeline stripping preload hints. I use `curl -I https://prod-url` to check response headers and verify assets are served with proper cache headers and preloads. In our Jenkins build we had an issue where CRACO's Webpack config was not generating preload hints in production — fixed by explicitly configuring `HtmlWebpackPlugin` preload options.

---

---

## 3. When to Use Redux, Context API, or React Query?

### Answer

This is about choosing the **right tool for the right kind of state**. I classify state into three buckets:

```
┌─────────────────────────────────────────────────┐
│              State Types                        │
│                                                 │
│  Server State    UI/App State    Local State    │
│  (React Query)   (Redux)         (useState)     │
│                  (Zustand)       (Context API)  │
└─────────────────────────────────────────────────┘
```

In the Auto Triaging Platform, we use all three — each for the right job.

### Context API

**Use when:**
- Avoiding prop-drilling for **rarely-changing global data**
- Theme, locale, auth user object, feature flags

**In our project:** Auth context holds the logged-in user object and role decoded from the JWT. It barely changes — only on login/logout — so Context is the right fit.

```jsx
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}
```

**Avoid it for:** High-frequency updates — every context value change re-renders all consumers. We learned this the hard way when we tried to put filter state in context and the entire dashboard re-rendered on every keystroke.

---

### Redux (Redux Toolkit)

**Use when:**
- Complex **shared client state** with many actors updating it
- Cross-cutting UI state that multiple components read and write

**In our project:** Redux manages filters (date range, log level, service name), UI modes (selected node in the order flow graph), and the currently selected Order/Session ID. These are client-side concerns that don't come from the server.

```js
// filtersSlice.ts
const filtersSlice = createSlice({
  name: 'filters',
  initialState: { dateRange: null, logLevel: 'all', serviceId: null },
  reducers: {
    setDateRange: (state, action) => { state.dateRange = action.payload; },
    setLogLevel: (state, action) => { state.logLevel = action.payload; },
    resetFilters: () => initialState,
  }
});

// userSlice.ts — selected order context
const userSlice = createSlice({
  name: 'user',
  initialState: { selectedOrderId: null, selectedSessionId: null },
  reducers: {
    setSelectedOrder: (state, action) => { state.selectedOrderId = action.payload; }
  }
});
```

**Avoid it for:** API data. We initially stored log data in Redux and manually managed loading/error/stale states. When we switched to React Query for server data, we removed 40% of our Redux boilerplate.

---

### React Query (TanStack Query)

**Use when:**
- Any **server state** — logs, order data, metrics from the API

**In our project:** React Query handles all API calls — log fetching, order flow data, AI summary results, customer data. The features we rely on most:

```jsx
// Parallel API calls using useQueries — fetch logs, screenshots, and metrics simultaneously
const results = useQueries({
  queries: [
    { queryKey: ['logs', sessionId], queryFn: () => api.get(`/logs/${sessionId}`) },
    { queryKey: ['screenshots', sessionId], queryFn: () => api.get(`/screenshots/${sessionId}`) },
    { queryKey: ['metrics', orderId], queryFn: () => api.get(`/metrics/${orderId}`) },
  ]
});

// With staleTime and refetchInterval for the 15-min data freshness requirement
const { data: logs } = useQuery({
  queryKey: ['logs', sessionId],
  queryFn: ({ signal }) => api.get(`/logs/${sessionId}`, { signal }), // cancellable
  staleTime: 60_000,
  refetchInterval: 15 * 60 * 1000, // refetch every 15 mins for data freshness
});
```

**Why it beats Redux for server state in our case:**
- Automatic request deduplication — multiple components requesting same session logs = 1 API call
- Built-in race condition handling via `signal` — critical for our tab-switching issue (explained in Issues section)
- Background refetch keeps data fresh for the 15-min freshness requirement without manual polling logic

---

### Decision Matrix

| State Type | Tool Used in Project |
|---|---|
| Auth user, JWT role | Context API |
| Filters, selected node, UI modes | Redux Toolkit |
| Logs, orders, metrics from API | React Query |
| Component-local form state | useState |

---

### Follow-up Questions

**Q: Can React Query replace Redux entirely?**
> For most apps yes. In our project we kept Redux only for client-side UI state (filters, selections). All server state moved to React Query. If we were starting fresh today I'd use Zustand instead of Redux for the remaining client state — less boilerplate, no Provider needed.

**Q: Zustand vs Redux?**
> Zustand is lighter, doesn't need Provider wrapping, and uses hooks natively. Redux Toolkit has better DevTools and enforces patterns useful for large teams. We chose Redux because the team was already familiar with it and the DevTools time-travel helped debug filter state bugs during development.

**Q: How does React Query handle race conditions?**
> It passes an `AbortSignal` to the query function. When a new query fires for the same key, the previous request is cancelled. In our triaging platform this was critical — when a support agent quickly switched between customer sessions, we had stale data from the previous session appearing briefly. Using `signal` in the query function fixed it completely.

```jsx
// Fix for race condition — old session data no longer appears
queryFn: ({ signal }) => api.get(`/logs/${sessionId}`, { signal })
```

---

---

## 4. What is Module Federation?

### Answer

Module Federation is a **Webpack 5 feature** (also available in Vite/Rspack) that allows multiple independently deployed frontend applications to **share code at runtime** — not at build time. It's the technical foundation for **Micro-Frontend architecture**.

Think of it as npm packages, but served live over the network instead of bundled in.

### The Core Concept

```
┌──────────────────────┐     Runtime sharing     ┌────────────────────┐
│   Shell App (Host)   │◄─────────────────────── │  Remote App MFE    │
│                      │                         │                    │
│  Loads & mounts:     │   exposes at runtime:   │  exposes:          │
│  - Header (from MFE) │   /remoteEntry.js        │  - Header component│
│  - Cart (from MFE)   │                         │  - Cart component  │
│  - Checkout (local)  │                         │  - Shared utils    │
└──────────────────────┘                         └────────────────────┘
         ▲
         │  Also shares: react, react-dom (singleton — one copy in memory)
```

### Webpack Config Example

**Remote (exposes components):**
```js
new ModuleFederationPlugin({
  name: 'cartApp',
  filename: 'remoteEntry.js',
  exposes: {
    './Cart': './src/components/Cart',
    './useCartHook': './src/hooks/useCart',
  },
  shared: {
    react: { singleton: true, requiredVersion: '^18.0.0' },
    'react-dom': { singleton: true },
  },
})
```

**Host (consumes components):**
```js
new ModuleFederationPlugin({
  name: 'shell',
  remotes: {
    cartApp: 'cartApp@https://cart.myapp.com/remoteEntry.js',
  },
  shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
})
```

**Usage in Host:**
```jsx
const Cart = React.lazy(() => import('cartApp/Cart'));

function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Cart />
    </Suspense>
  );
}
```

### Real-World Use Case

At a large retail platform: Checkout, Product Listing, and Account teams each owned their MFE. The Shell app loaded them independently. When the Cart team deployed a hotfix, **only their `remoteEntry.js` updated** — no redeployment of the shell or other teams needed. Each team had their own GitLab CI pipeline deploying to their own CDN path.

### Benefits vs. Drawbacks

| Benefits | Drawbacks |
|---|---|
| Independent deployments per team | Runtime errors if remote is down |
| Shared dependencies (one React copy) | Version mismatch can break things |
| Incremental migration (legacy → new) | Debugging across boundaries is harder |
| True team ownership | Initial load has extra network round-trip |

---

### Follow-up Questions

**Q: How do you handle a remote being unavailable?**
> Wrap lazy imports in an ErrorBoundary. For critical components, serve a fallback stub from the shell. We also set up health check endpoints for each remote and alert via PagerDuty before a full outage occurs.

**Q: Module Federation vs iframes for MFEs?**
> iframes give true isolation but hurt UX — separate scroll, can't share auth tokens easily, can't share a design system. Module Federation shares the same DOM and JS context — better UX and performance, but you need discipline on shared dependencies and versioning. iframes are only appropriate for truly isolated third-party widgets.

**Q: What's the `singleton` flag in shared config?**
> It ensures only one copy of a library runs in memory. React specifically requires this — two running React instances cause "hooks can only be called inside a function component" errors. `singleton: true` + `strictVersion: false` means it'll warn on version mismatch but use whichever version is already loaded.

**Q: How do you manage deployments across multiple MFEs?**
> Each team has their own GitLab CI pipeline. The shell app references remote URLs with versioned paths (e.g., `v1.4.2/remoteEntry.js`). We use environment-specific configs so the shell in staging points to staging remotes and production points to production remotes. A centralized `manifest.json` maps MFE names to their current deployed URLs, fetched at shell startup.

---

---

## 5. Global Error Handling for 300 Components

### Answer

With 300+ components, you need a **layered error handling strategy** — not try-catch everywhere. I use four layers: React Error Boundaries, global async/promise catching, HTTP interceptors, and React Query's global error handler.

### Layer 1 — Error Boundaries (React rendering errors)

```jsx
// ErrorBoundary.jsx
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Send to Sentry with component stack
    reportError(error, {
      componentStack: info.componentStack,
      context: this.props.context,
    });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <DefaultErrorUI error={this.state.error} />;
    }
    return this.props.children;
  }
}

export function withErrorBoundary(Component, fallback, context) {
  return (props) => (
    <ErrorBoundary fallback={fallback} context={context}>
      <Component {...props} />
    </ErrorBoundary>
  );
}
```

**Strategic placement — don't wrap all 300 individually. In our triaging platform:**

```jsx
// 1. Top-level catch-all
<ErrorBoundary fallback={<AppCrashPage />}>
  <App />
</ErrorBoundary>

// 2. Route-level — isolate page crashes
<ErrorBoundary fallback={<PageErrorUI />} context="TriagingPage">
  <TriagingPage />
</ErrorBoundary>

// 3. Widget-level — AI summary and graph visualizer can fail independently
<ErrorBoundary fallback={<AISummaryFallback />} context="AISummary">
  <AISummary sessionId={sessionId} />
</ErrorBoundary>

<ErrorBoundary fallback={<GraphFallback />} context="DependencyMatrix">
  <DependencyMatrix orderId={orderId} />
</ErrorBoundary>
```

### Layer 2 — Global Async / Promise Errors

```js
// main.tsx — catch unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  reportError(event.reason, { type: 'unhandledRejection' });
  event.preventDefault();
});

window.addEventListener('error', (event) => {
  reportError(event.error, { type: 'windowError', filename: event.filename });
});
```

### Layer 3 — Axios Interceptor (API errors)

In our project, a single axios instance is created and shared across all React Query calls:

```js
// api.ts — single axios instance used in all useQuery calls
export const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = getAccessToken(); // from Redux store
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  async (error) => {
    if (error.response?.status === 401) {
      // Silent token refresh
      const newToken = await refreshAccessToken();
      error.config.headers.Authorization = `Bearer ${newToken}`;
      return api(error.config); // retry original request
    }
    if (error.response?.status >= 500) {
      reportError(error, { type: 'apiError', url: error.config.url });
    }
    return Promise.reject(error);
  }
);

// Usage in React Query — consistent pattern across all 300 components
const { data } = useQuery(['logs', sessionId], () =>
  api.get(`/logs/${sessionId}`).then(res => res.data)
);
```

### Layer 4 — React Query Global Error Handler

```jsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (error.response?.status === 401) return false; // don't retry auth failures
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000) + Math.random() * 500,
      onError: (error) => reportError(error, { type: 'queryError' }),
    },
  },
});
```

### Real Production Error Flow in Our Platform

```
Support agent triggers action
    │
    ▼
Component renders ──error──► ErrorBoundary ──► Sentry + Fallback UI
    │
    ▼
API Call ──────────error──► Axios Interceptor ──► silent retry or toast
    │                       (401 → token refresh, 500 → error report)
    ▼
Async logic ───────error──► unhandledrejection ──► Sentry log
```

---

### Follow-up Questions

**Q: Error Boundaries don't catch errors in event handlers — how do you handle those?**
> Wrap them in try-catch. In our triaging platform, filter reset, export, and "copy log to clipboard" handlers all have try-catch with a `showToast('Something went wrong')` fallback and a `reportError` call. For critical handlers I also call `setState` with an error flag which triggers the nearest ErrorBoundary.

**Q: You mentioned React Query retry conflicts with Axios refresh token retry. How did you solve that?**
> This was a real bug we hit. React Query was retrying a 401 response at the same time the Axios interceptor was doing a silent refresh — causing duplicate refresh calls and occasionally a logout loop. The fix was to disable React Query retry for 401s specifically, and let the Axios interceptor own the refresh flow entirely. React Query retries only for network errors and 5xx responses.

**Q: How do you use error monitoring in production?**
> We use Sentry. `componentDidCatch` calls `Sentry.captureException(error, { extra: { context } })`. We attach the user's role, the current Order ID, and the active feature flags to every error context — so we can filter errors by "only occurred for ops team users on order flows with more than 50 log entries."

---

---

## 6. What is RSC Payload? Server Components & RSC Payload Explained

### Answer

**React Server Components (RSC)** is a paradigm where components run **on the server**, and the output is streamed to the client — not as HTML, but as a special serialized format called the **RSC Payload**.

### What is RSC Payload?

The RSC Payload is a **binary/JSON-like serialized tree** that describes what the server rendered. It's not HTML. It contains:

- The virtual DOM tree for server components
- Placeholders (holes) where client components should be mounted
- Props passed to client components
- References to client component module IDs (chunks)
- Suspense boundaries and streaming slots

```
Client receives:

Traditional SSR:              RSC:
<html>                        RSC Payload (binary protocol):
  <div>                         J0:["$","div",null,{
    <h1>Hello</h1>                "children": [
    <p>World</p>                    ["$","h1",null,{"children":"Hello"}],
  </div>                           "$L1"  ← hole for client component
</html>                         }]
(full HTML)                     M1:{"id":"./ClientCart.js", ...}
                                (reference to client bundle chunk)
```

### Why This Matters

```
┌─────────────────────────────────────────────────┐
│                 Request/Response                │
│                                                 │
│  Server                    Client               │
│  ──────                    ──────               │
│  ServerComponent           Hydrates client      │
│  runs here:                components only      │
│  - DB queries              - No server code     │
│  - File system             - No DB secrets      │
│  - Secrets safe            - Smaller JS bundle  │
│                                                 │
│  Serializes as RSC Payload ──────────────────►  │
│                            React reconciles     │
│                            with existing DOM    │
└─────────────────────────────────────────────────┘
```

### Server vs Client Components

```jsx
// ProductPage.server.jsx — runs on server only
// Can do: direct DB access, file reads, use secrets
// Cannot do: useState, useEffect, browser APIs, event handlers

async function OrderSummary({ orderId }) {
  const order = await db.orders.findById(orderId); // direct DB — no API round trip
  return (
    <div>
      <h1>{order.id}</h1>
      <p>{order.status}</p>
      <LogTimeline orderId={orderId} /> {/* ← client component */}
    </div>
  );
}
```

```jsx
// LogTimeline.client.jsx — runs on client
'use client';

function LogTimeline({ orderId }) {
  const { data: logs } = useQuery(['logs', orderId], fetchLogs);
  return <VirtualizedLogList logs={logs} />;
}
```

### RSC Payload in Next.js App Router

In Next.js App Router, when you navigate client-side, the browser fetches the RSC Payload (not full HTML) from `/_next/data/...` — React reconciles it with the existing DOM without a full page reload.

```
Initial Load:  Server → HTML + RSC Payload → Hydrate
Navigation:    Server → RSC Payload only → Reconcile (no full reload)
```

This is why App Router feels like a SPA but runs components on the server.

### Benefits

- Zero-bundle cost for server components (their code never ships to the client)
- Colocation: data fetching next to the UI that needs it
- Streaming with Suspense — server can flush parts of the page as they're ready

---

### Follow-up Questions

**Q: What can't you do in Server Components?**
> No `useState`, `useEffect`, `useContext`, event handlers (`onClick`), or browser APIs (`window`, `document`). The boundary is the `'use client'` directive. In our triaging platform (CRA-based), we don't use RSC today, but if we migrated to Next.js App Router, the log timeline viewer would be a client component (uses state + IO) while the order summary header could be a server component (pure data display).

**Q: Can server components import client components and vice versa?**
> Server can import client — those become holes in the RSC payload. Client **cannot** import server components — that would send server code to the browser. You can pass server components as `children` to client components though — a common pattern for layout wrappers.

**Q: How is RSC different from SSR?**
> SSR renders to HTML once on initial load for SEO/fast paint. RSC renders on every navigation/request, returns a serialized component tree (not HTML), and React reconciles it. They work together in Next.js — HTML on initial load + RSC payload for subsequent navigation.

**Q: Why doesn't your current project use RSC?**
> Our triaging platform is built on CRA with CRACO. We chose CRA because the project started two years ago when App Router wasn't stable, and migrating mid-project wasn't worth the risk. CRACO gave us Webpack customization (ES2015 builds, custom chunking, disabled heavy source maps) without ejecting. RSC would be the right choice for a new project.

---

---

## 7. Design Patterns Used in JS Projects

### Answer

These are the patterns I've used in production, including in our triaging platform.

### 1. Module Pattern (Encapsulation)

```js
// Before ES Modules — still relevant for SDKs/utilities
const AnalyticsService = (() => {
  let queue = [];
  let isInitialized = false;

  return {
    init(config) { isInitialized = true; },
    track(event) {
      if (!isInitialized) queue.push(event);
      else sendEvent(event);
    }
  };
})();
```

**Real use in project:** Our `reportError` utility that queues errors before Sentry initializes, then flushes the queue.

### 2. Observer / Pub-Sub Pattern

```js
class EventBus {
  #listeners = new Map();

  on(event, fn) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push(fn);
    return () => this.off(event, fn); // returns unsubscribe
  }

  emit(event, data) {
    this.#listeners.get(event)?.forEach(fn => fn(data));
  }

  off(event, fn) {
    const fns = this.#listeners.get(event) || [];
    this.#listeners.set(event, fns.filter(f => f !== fn));
  }
}

export const eventBus = new EventBus();
```

**Real use in project:** WebSocket ticket updates in our real-time dashboard. When the backend pushes a `ticket_update` event, the EventBus broadcasts it. Instead of updating UI directly from the socket, components listen via the bus and trigger a React Query refetch — keeping UI consistent with server state.

```js
// WebSocket handler
socket.on('ticket_update', (data) => {
  eventBus.emit('ticket:updated', data);
});

// Component listens and refetches
useEffect(() => {
  const unsub = eventBus.on('ticket:updated', () => {
    queryClient.invalidateQueries(['tickets']);
  });
  return unsub;
}, []);
```

### 3. Factory Pattern

```js
function createLogger(type) {
  const loggers = {
    sentry: new SentryLogger(),
    console: new ConsoleLogger(),
    silent: new SilentLogger(),
  };
  return loggers[type] || loggers.console;
}

const logger = createLogger(process.env.REACT_APP_LOG_TARGET);
logger.info('App started');
```

**Real use:** Different log targets for local dev (console), staging (verbose Sentry), and production (errors only).

### 4. Strategy Pattern

```js
// Swap log filtering algorithm at runtime based on user selection
const filterStrategies = {
  error: (logs) => logs.filter(l => l.level === 'ERROR'),
  warning: (logs) => logs.filter(l => ['ERROR', 'WARN'].includes(l.level)),
  all: (logs) => logs,
  service: (logs, serviceId) => logs.filter(l => l.serviceId === serviceId),
};

function filterLogs(logs, strategy, params) {
  return filterStrategies[strategy]?.(logs, params) ?? logs;
}
```

**Real use in project:** The log level filter in the triaging dashboard uses strategy pattern — the filter UI dispatches a Redux action with the strategy name, and `filterLogs` picks the right algorithm.

### 5. Proxy Pattern (with ES6 Proxy)

```js
// Used for Vue 3-style reactivity, form validation, API response normalization
function createNormalizedResponse(target) {
  return new Proxy(target, {
    get(obj, prop) {
      if (prop === 'timestamp') return new Date(obj.ts).toISOString();
      if (prop === 'level') return obj.severity?.toUpperCase() ?? 'INFO';
      return obj[prop];
    }
  });
}
// Normalize inconsistent log field names from different microservices
```

### 6. Decorator Pattern (Higher-Order Functions)

```js
// withRetry — used for API calls that may transiently fail
function withRetry(fn, retries = 3) {
  return async (...args) => {
    for (let i = 0; i < retries; i++) {
      try { return await fn(...args); }
      catch (e) {
        if (i === retries - 1) throw e;
        await delay(1000 * 2 ** i); // exponential backoff
      }
    }
  };
}
```

**Real use:** In our project, React Query handles retries natively with exponential backoff. We use the decorator pattern for non-React-Query async operations like the ETL status polling and ELK direct queries.

---

### Follow-up Questions

**Q: What's the difference between Observer and Pub-Sub?**
> Observer: the subject knows its observers directly (tight coupling). Pub-Sub: publishers and subscribers communicate through a broker/event bus and don't know each other. We use Pub-Sub via our EventBus for WebSocket-to-React-Query communication — the socket handler doesn't know which components are listening.

**Q: Have you used the Command pattern in frontend?**
> Yes — for undo/redo in the order flow graph editor. Each node move or connection change is a Command object with `execute()` and `undo()` methods pushed onto a history stack. The ops team can step backward through their filter/graph changes without refreshing.

**Q: Singleton pattern — where did you use it?**
> The axios instance in our project is a singleton — one configured instance shared across all React Query calls. This ensures interceptors (auth headers, refresh token logic) apply globally without re-registering them per component.

---

---

## 8. Design Principles Used in React Projects

### Answer

### 1. Single Responsibility Principle (SRP)

Every component does one thing. In our triaging platform this means:

```jsx
// ❌ Bad — TriageView does too much
function TriageView({ sessionId }) {
  const [logs, setLogs] = useState([]);
  const [screenshots, setScreenshots] = useState([]);
  const [aiSummary, setAiSummary] = useState(null);
  const [filters, setFilters] = useState({});
  // fetching + filtering + AI + rendering = too many responsibilities
}

// ✅ Good — each piece is a separate layer
function TriageView({ sessionId }) {
  return (
    <>
      <FilterBar />                    {/* Redux — reads/writes filter state */}
      <LogTimeline sessionId={sessionId} />  {/* React Query — fetches logs */}
      <ScreenshotViewer sessionId={sessionId} /> {/* IO + Blob cache */}
      <AISummaryPanel sessionId={sessionId} />   {/* Lazy loaded */}
    </>
  );
}
```

### 2. Open/Closed Principle

Components open for extension, closed for modification.

```jsx
// ❌ Bad — modify LogBadge every time you need a new log level
function LogBadge({ level }) {
  if (level === 'ERROR') return <span className="badge-error">{level}</span>;
  if (level === 'WARN') return <span className="badge-warn">{level}</span>;
}

// ✅ Good — extend via config, no modification needed
const LEVEL_CONFIG = {
  ERROR: { className: 'badge-error', icon: '🔴' },
  WARN:  { className: 'badge-warn',  icon: '🟡' },
  INFO:  { className: 'badge-info',  icon: '🔵' },
};

function LogBadge({ level }) {
  const config = LEVEL_CONFIG[level] ?? LEVEL_CONFIG.INFO;
  return <span className={config.className}>{config.icon} {level}</span>;
}
// New log level from a new microservice? Add one line to LEVEL_CONFIG.
```

### 3. Compound Component Pattern (Interface Segregation)

Don't force consumers to take props they don't need.

```jsx
// Used for our LogTimeline component
<LogTimeline>
  <LogTimeline.Toolbar />
  <LogTimeline.Filters />
  <LogTimeline.List>
    <LogTimeline.Row />
  </LogTimeline.List>
  <LogTimeline.Pagination />
</LogTimeline>
// Teams consuming just LogTimeline.List don't need Toolbar internals
```

### 4. Dependency Inversion (via Props / Injection)

Components depend on abstractions, not concretions.

```jsx
// ❌ Bad — hardcoded to real API
function LogViewer({ sessionId }) {
  const { data } = useQuery(['logs', sessionId], () => api.get(`/logs/${sessionId}`));
}

// ✅ Good — inject the fetcher, testable with mock
function LogViewer({ sessionId, fetchLogs = defaultFetchLogs }) {
  const { data } = useQuery(['logs', sessionId], () => fetchLogs(sessionId));
}
// In tests: <LogViewer sessionId="abc" fetchLogs={mockFetchLogs} />
// In MSW integration tests: the network boundary is mocked, not the hook
```

### 5. Composition over Inheritance

```jsx
// Used in our layout — compose layouts instead of inheriting base classes
function TriagingLayout({ children }) {
  return (
    <AppShell>
      <Sidebar />
      <main className="triage-content">{children}</main>
    </AppShell>
  );
}
```

### 6. DRY — Custom Hooks

```jsx
// Used across 15+ components in the triaging platform
function useSessionData(sessionId) {
  const logs = useQuery(['logs', sessionId], ({ signal }) =>
    api.get(`/logs/${sessionId}`, { signal }).then(r => r.data)
  );
  const screenshots = useQuery(['screenshots', sessionId], ({ signal }) =>
    api.get(`/screenshots/${sessionId}`, { signal }).then(r => r.data)
  );
  return { logs, screenshots, isLoading: logs.isLoading || screenshots.isLoading };
}
```

---

### Follow-up Questions

**Q: How do you enforce these in a team?**
> ESLint rules (`max-lines-per-function`, `max-depth`), PR review checklists, and Architecture Decision Records (ADRs) committed to the repo. We also use Storybook — if a component can't be rendered in isolation in Storybook, it's violating SRP. In our GitLab pipeline, the lint stage fails the MR if any file exceeds 300 lines.

**Q: When is it OK to break SRP in React?**
> When two concerns always change together. A log row that shows the level badge, timestamp, service name, and message — those are all tied to the log entry data model. Splitting them into 4 files would be over-engineering. SRP is about reasons to change, not just count of responsibilities.

**Q: How do you handle the balance between composability and performance?**
> Compound components can cause over-rendering if the shared state lives in a context at the top level. We use `useReducer` + context at the compound root, and `React.memo` on the leaf components. This way the tree is composable but renders are targeted.

---

---

## 9. Which UI Model Does React Follow?

### Answer

React follows the **Unidirectional Data Flow** model (one-way data binding), combined with a **declarative, component-based Virtual DOM** model.

### The Model in Detail

```
┌──────────────────────────────────────────────────┐
│           React's UI Model                       │
│                                                  │
│   State / Props                                  │
│       │                                          │
│       ▼                                          │
│   render() → Virtual DOM (JS object tree)        │
│       │                                          │
│       ▼                                          │
│   Reconciliation (Diffing algorithm / Fiber)     │
│       │                                          │
│       ▼                                          │
│   Commit Phase → Real DOM updates (minimal)      │
│                                                  │
│   User Interaction                               │
│       │                                          │
│       ▼                                          │
│   setState / dispatch → New State → Re-render    │
│   (cycle repeats — always top-down)              │
└──────────────────────────────────────────────────┘
```

### Declarative vs Imperative

```js
// Imperative (jQuery/DOM):
const btn = document.getElementById('btn');
btn.addEventListener('click', () => {
  const count = parseInt(btn.textContent) + 1;
  btn.textContent = count; // YOU manage DOM
});

// Declarative (React):
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
  // YOU describe what to show — React manages DOM
}
```

### The Virtual DOM

The VDOM is a plain JS object representation of the DOM tree. React's **Fiber reconciler** diffs the old and new VDOM trees and computes the minimal set of real DOM operations.

**Why VDOM?** Direct DOM manipulation is slow. Batch and minimize it. In our triaging platform, when filters change, multiple components update simultaneously — React batches all state updates from a single event and applies one DOM patch.

### React Fiber — Concurrent Model

From React 18 onwards, the model evolved with **Fiber** to support **concurrent rendering**:

- Work is split into units (fibers) that can be paused and resumed
- High-priority updates (user input) interrupt low-priority work (background renders)

```
React 17 (Sync):           React 18 (Concurrent Fiber):
─────────────────          ──────────────────────────────
Render → Block → Commit    Render(low) → interrupt → Render(high) → Commit → Resume(low)
```

This is how `useTransition` works in our log search — the input update is high-priority (Fiber handles it immediately), while the heavy log filtering is low-priority (deferred, can be interrupted).

### Contrast With Other Models

| Framework | Model |
|---|---|
| React | Unidirectional + Virtual DOM + Fiber |
| Angular | Two-way binding + Zone.js change detection |
| Vue | Two-way binding (`v-model`) + Proxy-based reactivity |
| Svelte | Compiler-based, no VDOM, direct DOM |

---

### Follow-up Questions

**Q: Is Virtual DOM always faster than direct DOM manipulation?**
> No — for simple updates, direct DOM can be faster. VDOM adds overhead of diffing. Svelte proves this by compiling to direct DOM operations with no VDOM. React's value is the **developer ergonomics and predictability at scale**, not raw speed. For our triaging platform with 300 components and complex state, React's model makes the codebase maintainable.

**Q: What is React's reconciliation algorithm?**
> Two heuristics: (1) different element types produce entirely different trees — no deep diffing attempted; (2) `key` props tell React which list items are the same across renders. In our log table, missing keys caused React to re-create every row on filter change. Adding stable log entry IDs as keys made filter updates 10x faster.

**Q: What changed with React 18's concurrent features?**
> `createRoot` enables concurrent mode. `useTransition` marks updates as non-urgent. `useDeferredValue` delays expensive derived values. We use `useTransition` for the log filter and `useDeferredValue` for the search highlight rendering — prevents jank on a 10,000-entry log list.

---

---

## 10. Production Error "e is not defined" — How to Debug Locally

### Answer

This is a classic problem: **production builds are minified/mangled**, so variable `e` was originally something like `error`, `event`, or `element` — the minifier renamed it. Since local dev runs unminified, you can't reproduce it directly.

### Why It Happens

```js
// Your source code:
function handleClick(event) {
  event.preventDefault();
  submitForm();
}

// After Terser minification:
function handleClick(e) {  // 'event' → 'e'
  e.preventDefault();      // fine if e exists
  submitForm();
}

// But if there's a scope issue in the original:
const handler = () => submitForm(event); // 'event' captured wrong scope
// Minifier renames something → 'e' and now 'e' is not defined
```

### Step-by-Step Debug Strategy

**Step 1 — Get the source map and decode the real location**

Source maps are uploaded to Sentry by our Jenkins pipeline. The mapped stack trace shows the original file and line.

If you have the source map manually:
```bash
npm install -g source-map
npx source-map resolve dist/main.js.map 1 3420
# → src/components/Triaging/LogRow.jsx:87:12
```

**Step 2 — Build locally with production config but readable names**

In our CRACO setup:
```js
// craco.config.js
module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      if (process.env.BUILD_ANALYZE === 'true') {
        // Keep variable names readable, keep dead code removal
        webpackConfig.optimization.minimizer[0].options.terserOptions = {
          mangle: false,
          compress: true,
        };
        webpackConfig.devtool = 'source-map';
      }
      return webpackConfig;
    }
  }
};
```
```bash
BUILD_ANALYZE=true npm run build
# Now serve dist/ locally — same production config, readable names
```

**Step 3 — Add verbose logging in Error Boundary**

```jsx
componentDidCatch(error, info) {
  console.log('Error:', error);
  console.log('Component stack:', info.componentStack);
}
```

**Step 4 — Check common causes**

```js
// Culprit 1: Global 'event' in strict mode
document.addEventListener('click', function() {
  console.log(event); // works in loose mode, undefined in strict mode after minification
});
// Fix: explicit parameter
document.addEventListener('click', function(event) { console.log(event); });

// Culprit 2: Typo in catch clause
try {
  doSomething();
} catch (error) {
  reportError(e); // typo — should be 'error'; minifier renames 'error' to 'e' elsewhere
}

// Culprit 3: Wrong scope capture
const handleSubmit = () => {
  api.post('/submit', event.target.value); // 'event' not in scope here
};
```

**Step 5 — Use Sentry session replay**

In our project we use Sentry with session replay. When a production error fires, the replay shows the exact user actions, network calls, and component state at the time of the error — without needing to reproduce it locally.

### Prevention

```js
// .eslintrc
{
  "rules": {
    "no-undef": "error",
    "no-unused-vars": "error"
  }
}
```

TypeScript would catch this at compile time — we use TypeScript in the triaging platform and `strict: true` in `tsconfig.json`. This class of error is essentially impossible in a strictly typed codebase.

---

### Follow-up Questions

**Q: How do you set up source maps in production without exposing them publicly?**
> In our Jenkins pipeline, after the build step, source maps are uploaded to Sentry using `@sentry/cli` and then deleted from the build output before deployment to the CDN. Source maps never reach the public server.
```sh
# Jenkinsfile
sh 'npm run build'
sh 'sentry-cli releases files $RELEASE upload-sourcemaps ./build --url-prefix "~/"'
sh 'find ./build -name "*.map" -delete'  # remove before deploy
sh 'aws s3 sync ./build s3://triage-frontend/'
```

**Q: The error only happens on specific user machines — how do you debug?**
> Sentry tags errors by browser, OS, and user role. We filter the error event by browser — often it's a Safari version issue or an older Chromium on corporate laptops. For race conditions, the breadcrumb timeline in Sentry shows the sequence of API calls and user actions leading to the error.

**Q: Why don't we always keep source maps public?**
> Source maps expose your entire original source code — business logic, internal API endpoints, algorithm implementations, sometimes env variable names. For an internal enterprise tool like our triaging platform, source maps in the public bundle would expose Verizon's internal microservice structure to anyone with DevTools. Always upload privately to your error monitoring tool.

---

---

## 11. How to Organize Components for Testability

### Answer

Untestable components collapse concerns — they fetch, transform, and render all at once. The principle is to separate logic from rendering so each layer can be tested independently.

> **Rule of thumb:** If a component is hard to test, it has too many responsibilities. Extract until each piece is trivially testable.

### The Three-Layer Model

```
Layer 1: Pure Logic (Custom Hooks / Plain Functions)
  → No JSX, no side effects. Test with renderHook or plain JS tests.

Layer 2: Container (Smart Component)
  → Orchestrates data + state. Test by mocking the hook/API layer.

Layer 3: Presentational (Dumb Component)
  → Receives props, returns JSX. Easiest to test — just pass props.
```

**In our triaging platform:**

```jsx
// Layer 3 — Presentational (pure)
function LogRow({ level, timestamp, message, serviceName }) {
  return (
    <tr>
      <td><LogBadge level={level} /></td>
      <td>{formatTimestamp(timestamp)}</td>
      <td>{serviceName}</td>
      <td>{message}</td>
    </tr>
  );
}

// Layer 2 — Container (smart)
function LogTimeline({ sessionId }) {
  const { data: logs, isLoading } = useQuery(
    ['logs', sessionId],
    ({ signal }) => api.get(`/logs/${sessionId}`, { signal }).then(r => r.data)
  );
  if (isLoading) return <LogSkeleton />;
  return <LogTable logs={logs} />;
}

// Layer 1 — Custom hook (pure logic)
function useLogFilters(logs) {
  const filters = useSelector(selectFilters);
  return useMemo(() => filterLogs(logs, filters), [logs, filters]);
}
```

### Testing Strategies by Layer

**Unit Tests — Custom Hooks & Utilities**
```js
import { renderHook, act } from '@testing-library/react';

it('filters logs by ERROR level', () => {
  const logs = [
    { level: 'ERROR', message: 'Payment failed' },
    { level: 'INFO', message: 'Session started' },
  ];
  const { result } = renderHook(() => useLogFilters(logs));
  // assert filtered output
  expect(result.current).toHaveLength(1);
  expect(result.current[0].level).toBe('ERROR');
});
```

**Integration Tests — Component + MSW**

We mock at the network boundary using MSW — not inside the component. This tests the full stack from hook to render, but without hitting real APIs.

```js
// mocks/handlers.js (MSW)
rest.get('/api/logs/:sessionId', (req, res, ctx) => {
  return res(ctx.json([
    { level: 'ERROR', message: 'Payment failed', serviceName: 'checkout-svc' }
  ]));
});

// LogTimeline.test.jsx
it('shows log entry after fetch', async () => {
  render(<LogTimeline sessionId="session-123" />);
  expect(await screen.findByText('Payment failed')).toBeVisible();
  expect(screen.getByText('checkout-svc')).toBeInTheDocument();
});
```

**E2E Tests — Playwright**

Reserved for critical user journeys: entering an Order ID → viewing log timeline → checking AI summary → exporting logs. Slow — we keep the count small (15 critical flows) but each test covers the full journey.

**Contract Testing — Cross-team**

Our triaging platform consumes APIs from 4 backend teams. We use **Pact** for API-level contract testing. The frontend defines its expectations of the API response shape; the backend CI verifies their actual responses match. This catches breaking API changes before they hit staging.

---

### Follow-up Questions

**Q: Testing Trophy vs Testing Pyramid — what do you follow?**
> Testing Trophy (Kent C. Dodds) — heavy on integration tests because they give the highest confidence-to-cost ratio. A unit test on a utility function is cheap and fast. An integration test that mocks at the network boundary and renders the real component tree is a bit slower but catches real bugs. E2E tests for the most critical paths only.

**Q: How do you test components that use Redux?**
> Wrap the test render with a real Redux store configured with `configureStore` from Redux Toolkit, but with test-specific initial state. Avoid mocking the store — testing with the real store catches bugs in reducers and selectors that mock stores would hide.
```js
function renderWithStore(ui, { preloadedState } = {}) {
  const store = configureStore({ reducer: rootReducer, preloadedState });
  return render(<Provider store={store}>{ui}</Provider>);
}
```

**Q: How do you test React Query components?**
> Wrap with a fresh `QueryClientProvider` per test (no shared cache between tests), and mock the API layer with MSW. React Query's retry behavior can slow tests — set `retry: false` in the test QueryClient.
```js
const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } }
});
render(
  <QueryClientProvider client={testQueryClient}>
    <LogTimeline sessionId="test-123" />
  </QueryClientProvider>
);
```

---

---

## 12. How to Measure Performance Time of a Component

### Answer

I separate **lab measurements** (DevTools Profiler, `performance.mark`, Lighthouse) from **field measurements** (web-vitals RUM, Sentry). Lab tells me what's slow in a controlled environment; field tells me what users actually experience.

### React DevTools Profiler — First Stop

- Records every render, shows which components rendered, how long each took, and **why** (prop/state/context change)
- Flame graph + Ranked chart views
- **Look for:** components rendering with unexpected frequency, context causing full subtree re-renders

In our triaging platform, the Profiler revealed that `LogRow` was re-rendering on every filter change — even rows that were unaffected. The cause was an inline object passed as a prop that created a new reference on every render. Fixed with `useMemo`.

### Performance API — Precise Wall-Clock Measurement

```js
// Measure AI summary panel render time
performance.mark('ai-summary:render:start');

useEffect(() => {
  performance.mark('ai-summary:render:end');
  performance.measure('ai-summary:render', 'ai-summary:render:start', 'ai-summary:render:end');
  const [entry] = performance.getEntriesByName('ai-summary:render');
  console.log(`AI Summary rendered in ${entry.duration}ms`);
}, []);
```

### React Profiler API — Programmatic Render Timing

```jsx
import { Profiler } from 'react';

function onRenderCallback(id, phase, actualDuration, baseDuration) {
  // actualDuration: time to render this commit
  // baseDuration:   estimated time WITHOUT memoization
  // Gap between them = memoization savings
  Sentry.addBreadcrumb({ message: `${id}.${phase}`, data: { duration: actualDuration } });
}

<Profiler id="LogTimeline" onRender={onRenderCallback}>
  <LogTimeline sessionId={sessionId} />
</Profiler>
```

> **Key insight:** `baseDuration` vs `actualDuration` gap shows how much memoization is saving. No gap = memoization is being bypassed (prop identity changing every render).

### Web Vitals & Production Monitoring

```js
import { onINP, onCLS, onLCP } from 'web-vitals';
onINP(({ value }) => Sentry.addMeasurement('inp', value, 'millisecond'));
onLCP(({ value }) => Sentry.addMeasurement('lcp', value, 'millisecond'));
```

**Long Tasks API** — observe tasks blocking main thread > 50ms:
```js
const obs = new PerformanceObserver(list => {
  list.getEntries().forEach(entry => {
    Sentry.captureMessage(`Long task: ${entry.duration}ms`, 'warning');
  });
});
obs.observe({ type: 'longtask', buffered: true });
```

---

### Follow-up Questions

**Q: What was the biggest performance issue you found using these tools?**
> In the triaging platform, the Profiler showed that `DependencyMatrix` (our D3 graph visualizer) was re-rendering on every Redux state change — including filter changes it didn't consume. The fix was `React.memo` with a custom equality check on the graph-specific props, plus moving it to read only from a dedicated Redux slice. The render time dropped from 340ms to 12ms.

**Q: How do you track performance in production, not just in dev?**
> `<Profiler>` wraps the three heaviest components in production with sampling (1 in 20 renders sends timing to Sentry). The web-vitals library reports LCP, INP, and CLS from real users. Long Tasks API catches main-thread blockages. Sentry dashboards show p50/p75/p95 render times segmented by component, user role, and order size.

**Q: How do you decide when a component is "slow enough" to optimize?**
> I use 100ms as the perception threshold for interactions (human perception of instant). For renders that happen in response to user actions, anything over 50ms gets investigated. For background renders, 200ms is acceptable. I always profile before optimizing — premature memoization adds complexity and can introduce bugs.

---

---

## 13. How to Calculate / Track Re-renders

### Answer

### Detection Tooling

**React DevTools — Highlight Updates**

`Settings → General → Highlight updates when components render`
- Blue flash = render, Red flash = frequent re-render
- Fastest way to spot unexpected renders during manual testing

**why-did-you-render — Automated Detection**

```js
// setupTests.js (development only)
import React from 'react';
if (process.env.NODE_ENV === 'development') {
  const whyDidYouRender = require('@welldone-software/why-did-you-render');
  whyDidYouRender(React, { trackAllPureComponents: true });
}

// Opt a component in:
LogRow.whyDidYouRender = true;
```

This caught a critical bug in our triaging platform: `LogRow` was re-rendering because the parent was creating a new `onSelect` callback function on every render. WDYR output: "Re-rendered because `onSelect` changed (same value, different reference)."

### Manual Render Counter Hook

```js
function useRenderCount(label = '') {
  const count = useRef(0);
  count.current++;
  if (process.env.NODE_ENV === 'development') {
    console.log(`[${label}] render #${count.current}`);
  }
}

function LogRow({ log }) {
  useRenderCount('LogRow');
  // ...
}
```

### Root Causes & Fixes

**Cause 1 — New Object/Array Identity on Every Render**
```jsx
// ❌ New object every render — breaks React.memo
<LogRow config={{ showTimestamp: true, showService: true }} />

// ✅ Stable reference — define outside component or useMemo
const LOG_ROW_CONFIG = { showTimestamp: true, showService: true };
<LogRow config={LOG_ROW_CONFIG} />
```

**Cause 2 — Inline Callbacks Without useCallback**
```jsx
// ❌ New function every render — LogRow re-renders even with React.memo
{logs.map(log => (
  <LogRow key={log.id} log={log} onSelect={() => handleSelect(log.id)} />
))}

// ✅ Stable callback
const handleSelectLog = useCallback((id) => dispatch(setSelectedLog(id)), [dispatch]);
{logs.map(log => (
  <LogRow key={log.id} log={log} onSelect={handleSelectLog} />
))}
```

**Cause 3 — Context Re-rendering Entire Subtree** *(most commonly missed)*

In our project we initially put filters AND auth user in the same context. Every time filters changed (on every keystroke), the entire app re-rendered because everything consumed the same context.

```js
// ❌ One context — entire tree re-renders when filters change
const AppContext = createContext({ user, filters, selectedOrderId });

// ✅ Split by update frequency
const AuthContext = createContext(user);         // rarely changes
// Filters moved to Redux — subscription-based, not context propagation
```

**Cause 4 — Parent Re-renders Pulling Children Along**
```jsx
const LogRow = React.memo(function LogRow({ log, onSelect }) {
  return <tr onClick={() => onSelect(log.id)}>...</tr>;
}, (prevProps, nextProps) => {
  // Custom comparison — skip re-render if log ID and level haven't changed
  return prevProps.log.id === nextProps.log.id &&
         prevProps.log.level === nextProps.log.level;
});
```

---

### Follow-up Questions

**Q: When should you NOT use React.memo?**
> When the component is cheap to render (simple JSX, no heavy computation). `React.memo` itself has overhead — the comparison function runs on every parent render. For a `<span>` that just renders a string, memo costs more than it saves. Apply it to components that are (1) re-rendering unnecessarily and (2) expensive to render (heavy computation, large lists, complex DOM).

**Q: Context re-renders vs Zustand/Jotai — when to switch?**
> When more than 3-4 components are consuming a context that updates frequently, I move that state to Zustand or Jotai. They use subscription-based updates — only components subscribed to the specific piece of state re-render, not the whole context subtree. We use Redux for the same reason — `useSelector` ensures a component only re-renders when the specific slice it selects changes.

**Q: How do you track re-renders in production?**
> The React Profiler API in production with sampling — log `actualDuration` for the top 10 heaviest components to Sentry. When a new deploy spikes re-render times, the Sentry dashboard shows it immediately. We also use the Long Tasks API to catch main-thread blockages caused by excessive re-rendering.

---

---

## 14. AI Integration in the Auto Triaging Platform

### Answer

We built two AI-powered features: an RAG-based policy Q&A system and an AI-powered root cause analyzer for log-based debugging.

### 1. RAG System — Policy Document Q&A

The ops and support teams frequently need to look up Verizon internal policy documents (SOPs, escalation guides). Instead of searching through PDFs, they can ask natural language questions.

```
Architecture:
Policy PDFs → S3 → LangChain chunking (≈500 tokens/chunk)
            → HuggingFace/Instructor XL embeddings
            → FAISS vector store (persisted back to S3, versioned)

Query flow:
User question → embed → FAISS similarity search → top-k chunks
             → LLM context window → grounded answer (no hallucination)
```

**Frontend rendering of LLM output:**

Since LLM responses can contain markdown and potentially unsafe HTML, we sanitize before rendering:
```jsx
import DOMPurify from 'dompurify';
import { marked } from 'marked';

function AISummaryPanel({ sessionId }) {
  const { data } = useQuery(['ai-summary', sessionId], fetchAISummary);

  const safeHtml = useMemo(() => {
    if (!data?.summary) return '';
    const rawHtml = marked(data.summary); // markdown → HTML
    return DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS: ['p', 'ul', 'li', 'strong', 'em', 'code', 'pre', 'h3', 'h4']
    });
  }, [data?.summary]);

  return (
    <div className="ai-summary">
      <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
      <ConfidenceScore value={data?.confidence} />
    </div>
  );
}
```

### 2. AI Root Cause Analyzer

User enters a Session ID → LangChain parses it → generates Kibana DSL query → backend executes against ELK → logs returned → LLM extracts root cause, failed microservice, recommended action.

```
Input: Session ID
  ↓
LangChain: Natural language → Kibana DSL
  ↓
Backend: Execute DSL on ELK → retrieve relevant logs
  ↓
LLM: Summarize → root cause → confidence score → next action
  ↓
Frontend: summary + timeline + root cause card
```

**Frontend for AI results:**

```jsx
function RootCauseCard({ analysis }) {
  return (
    <div className={`rca-card rca-card--${analysis.confidence}`}>
      <h3>Root Cause</h3>
      <p>{analysis.rootCause}</p>
      <p><strong>Failed Service:</strong> {analysis.failedService}</p>
      <p><strong>Recommended Action:</strong> {analysis.recommendation}</p>
      <ConfidenceBadge score={analysis.confidence} />
    </div>
  );
}
```

### LLM Security on the Frontend

- **DOMPurify** sanitizes all LLM-generated markdown/HTML before `dangerouslySetInnerHTML`
- Only specific tags allowed (no `<script>`, `<iframe>`, `<object>`)
- Confidence score displayed so users know when to trust vs verify the AI output
- Server-side: API rate limiting on the AI endpoints, secrets never exposed to client

---

### Follow-up Questions

**Q: What if the LLM hallucinates a root cause?**
> The RAG system grounds answers in retrieved document chunks — it can only cite information that exists in the vector store. For the log analyzer, we display the underlying log entries alongside the AI summary so the ops team can verify. We also show a confidence score (derived from the LLM's own uncertainty signals) and always recommend human verification for P1 incidents.

**Q: How does the frontend handle streaming LLM responses?**
> The AI summary endpoint streams the response using Server-Sent Events. The frontend uses `EventSource` to receive tokens as they stream in, appending to a local state string. This means the user sees the summary appearing progressively rather than waiting for the full response.
```js
const source = new EventSource(`/api/ai-summary/${sessionId}`);
source.onmessage = (e) => setSummary(prev => prev + e.data);
source.onerror = () => source.close();
```

**Q: How do you ensure PII isn't sent to the LLM?**
> The backend ETL normalizes and masks PII before storing in MongoDB — phone numbers, SSNs, and customer names are redacted at ingestion. The frontend never sends raw log data to the AI endpoint — only the session ID. The backend fetches the pre-masked log data before constructing the LLM prompt.

---

---

## 15. Developer Productivity — AI-Assisted Bug Fix & MR Automation

### Answer

We implemented two independent AI agents to reduce the time from bug report to merge request: a **Fix Agent** and a **Reviewer Agent**.

### Fix Agent — Automated RCA + MR Creation

The Fix Agent integrates Jira and GitLab via MCP (Model Context Protocol). When a Jira ticket is assigned, the agent:

1. Fetches defect context from Jira (description, stack trace, affected component)
2. If the ticket has a `correlation_id`, uses Kibana MCP to pull the exact server logs — this gives runtime state (what the user was doing, what the API returned)
3. Maps the error to the exact code file using the file paths in the stack trace
4. Performs RCA: "The Kibana logs show the API returned a 404, but the code doesn't check if data exists before mapping — causing `Cannot read property 'map' of undefined`"
5. Generates the fix, validates it (lint + unit tests via Husky)
6. Creates a GitLab MR with a structured description via GitLab MCP

```
Jira Ticket → Fix Agent
  ↓ Jira MCP: fetch ticket details + stack trace
  ↓ Kibana MCP: fetch logs by correlation_id
  ↓ IDE: open relevant files, map error to line
  ↓ LLM: generate fix
  ↓ Husky: ESLint + unit tests
  ↓ GitLab MCP: create MR with description
```

### Reviewer Agent — Structured MR Review

Runs independently after the MR is created. Uses a `Reviewer.md` skill file that defines the review criteria:

```
Reviewer Agent:
  → GitLab MCP: fetch MR diff
  → Analyze: code correctness, edge cases, security, perf implications
  → Add inline comments on the MR
  → Approve/request-changes (requires human confirmation — no auto-merge)
```

GitLab rule enforced: **author cannot approve their own MR** — even if the Fix Agent creates the MR, a human or the Reviewer Agent (different identity/PAT) must approve.

### Security Architecture

```
Fix Agent (LLM)
  ↓
PreToolUse Hook (validate intent, block dangerous tools)
  ↓
Security Proxy MCP (sanitize PII, strip secrets)
  ↓
MCP Tool (Jira / GitLab / Kibana)
  ↓
Security Proxy MCP (sanitize response)
  ↓
Fix Agent (LLM reasoning on clean data)
  ↓
Post-validation (Husky tests + human approval)
```

### Cost Optimization — Model Routing

```
Log parsing (cheap):    GPT-4o-mini
Code fix generation:    Claude 3.5 Sonnet (reasoning model)
Review comments:        GPT-4o-mini
```

---

### Follow-up Questions

**Q: How do you ensure the AI fix is correct?**
> Three gates: (1) Pre-commit Husky hook runs ESLint and Prettier; (2) Pre-push Husky hook runs unit tests and axe-core accessibility checks; (3) Reviewer Agent does a second-pass analysis. No code reaches staging without passing all three.

**Q: How do you prevent the agent from leaking proprietary code to a public LLM?**
> We use GitHub Copilot Enterprise — code and prompts are not used for model training. The Security Proxy MCP intercepts every tool call, runs a regex-based PII scrubber, and strips secrets before forwarding to Jira/GitLab/Kibana. A `PreToolUse` hook blocks tool calls that would send more than the minimal required context.

**Q: What if the AI fix introduces a subtle logic bug?**
> This is the most important risk. Our mitigation: Husky runs the full test suite on push. The Reviewer Agent is specifically prompted to check for edge cases and logic correctness, not just style. Critical paths (payment, auth) have higher test coverage thresholds enforced in the GitLab pipeline — a fix to checkout code must maintain >90% test coverage or the pipeline fails.

**Q: How do you scale this from one developer to a team of 50?**
> Move the MCP tools from local IDE setup to a service-side MCP or a GitLab CI/CD bot. The Fix Agent becomes a triggered CI stage rather than a local tool. Each developer triggers it via a Jira automation or a GitLab pipeline trigger. The Reviewer Agent already runs as a CI stage in our pipeline — it's not developer-local.

**Q: How do you measure the ROI of this?**
> Three metrics: (1) % of bugs auto-resolved (agent created an accepted MR) — currently around 35% for frontend component bugs; (2) time saved per ticket — average dropped from 4 hours to 45 minutes for tickets with a `correlation_id`; (3) MR acceptance rate — 78% of agent-created MRs merged with minor or no changes.

---

---

## Key Differentiators for Architect-Level Answers

| Topic | Mid-level Answer | Architect-level Answer |
|---|---|---|
| Intersection Observer | "IO fires when element enters viewport" | Passive/read-only model, scrollHeight delta fix, scroll-anchoring, practical chat/log timeline example |
| Core Web Vitals | "Use Lighthouse to check scores" | Lab vs field data, Jenkins/GitLab CI integration with Lighthouse CI, Sentry for real users |
| State Management | "Use Redux for global state" | Three buckets (server/client/local), React Query for server state, Redux for UI state, race condition handling |
| Module Federation | "It's for micro-frontends" | Runtime vs build-time sharing, singleton flag, GitLab per-team pipelines, health checks for remotes |
| Error Handling | "Use Error Boundaries" | 4-layer strategy, Axios interceptor owning auth refresh, React Query retry conflicts |
| Performance | "Use React DevTools Profiler" | Lab vs field distinction, Profiler API in production with sampling, Long Tasks API, Sentry correlation |
| Re-renders | "Use React.memo and useCallback" | Context architecture by update frequency, WDYR for detection, profile before memoizing |
| Testability | "Use React Testing Library" | Testing Trophy model, MSW at network boundary, Pact for contract testing across teams |
| AI Integration | "We use an LLM for summaries" | RAG grounding, DOMPurify for LLM output, streaming SSE, PII masking at ETL layer, confidence scores |
| Developer Productivity | "We use Copilot" | MCP-based Fix + Reviewer agents, PreToolUse hooks, Security Proxy MCP, model routing, GitLab pipeline integration |

---