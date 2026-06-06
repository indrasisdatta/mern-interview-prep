# Browser Rendering Pipeline & V8 Internals

> Cross-link: [Performance optimization](../performance-security/performance-optimization.txt) · [CSS Layout Deep](css-layout-deep.md) · [JS concepts](../javascript-concepts.txt)
>
> Understanding the rendering pipeline lets you reason about *why* a UI is slow rather than guessing. This note covers the pixel pipeline, JS execution model, and the practical performance levers a lead is expected to wield.

---

## 1. The critical rendering path (CRP)

```
Network → HTML Parse → DOM
                        |
              CSS Parse → CSSOM
                        |
                   Render Tree
                        |
                     Layout
                        |
                      Paint
                        |
                    Composite → Pixels on screen
```

Each step is gated by inputs from previous steps. The browser performs these on the **main thread** (single-threaded for layout/paint), with compositing handed off to the compositor thread (and ultimately GPU).

### 1.1 HTML parsing → DOM

The HTML parser streams in bytes, tokenizes, builds the DOM tree. Blocked by:

| Resource | Blocks parser? | Blocks render? |
|----------|----------------|----------------|
| External CSS (`<link>`) | No | **Yes** (render-blocking) |
| Inline `<script>` (no `async`/`defer`) | **Yes** | Yes |
| External `<script>` (no `async`/`defer`) | **Yes** | Yes |
| `<script async>` | No (downloads parallel, executes ASAP) | Briefly when executing |
| `<script defer>` | No (executes after DOM complete, in order) | No |
| `<script type="module">` | Defer by default | No |
| Image | No | No (paints when loaded) |

### 1.2 CSS parsing → CSSOM

CSS is render-blocking. The browser won't paint a single pixel until it has the complete CSSOM (so it doesn't have to repaint when styles arrive).

**Implication:** large stylesheets delay first paint. Strategies:
- Critical CSS inlined in `<head>` (above-fold styles)
- Non-critical CSS lazy-loaded: `<link rel="preload" as="style" onload="this.rel='stylesheet'">`
- Use media queries on `<link>`: `<link rel="stylesheet" href="print.css" media="print">` → non-blocking

### 1.3 Render tree

Merge of DOM + CSSOM. Includes only **visible** elements (excludes `<head>`, `display: none`, comments).

Note: `visibility: hidden` IS in the render tree (takes layout space), `display: none` is not.

### 1.4 Layout (reflow)

Compute geometry — position and size of every visible element. Cascades top-down. Forced by:
- Initial render
- DOM changes (add/remove element, change text)
- CSS changes affecting box (`width`, `height`, `padding`, `margin`, `top`, etc.)
- Window resize
- Reading certain JS properties that force flush: `offsetHeight`, `getBoundingClientRect()`, `clientWidth`, `scrollTop`

### 1.5 Paint

Fill in pixels — text, colors, borders, shadows, images. Each "paint layer" rasterized separately. Triggered by:
- Layout changes
- Visual property changes (`color`, `background`, `border-radius`, `box-shadow`, `outline`)

### 1.6 Composite

Layers combined on the compositor thread (often using GPU). Cheap operations that only require composite:
- `transform`
- `opacity`
- `filter: blur()` on a composited layer

This is **why animating `transform` is fast and animating `top`/`left` is slow** — `transform` skips layout AND paint.

---

## 2. Pixel pipeline summary — what each property triggers

```
Layout  →  Paint  →  Composite
  ↑          ↑          ↑
width      color    transform
height     bg-color opacity
margin     visibility (visible/hidden)
padding    shadow
top/left   border
font-size  outline
text-align border-radius
```

**Performance heuristic:** if you can't animate `transform`/`opacity`, you're paying layout + paint each frame. Animations that drop frames usually trigger layout per frame on a deep subtree.

### 2.1 `will-change` and layer promotion

```css
.chart {
  will-change: transform;   /* hint: promote to its own layer */
}
```

Promotes the element to a composited layer (GPU-backed). Browser pre-allocates memory and skips re-rasterizing the layer for transform/opacity changes.

**Overuse penalties:**
- Memory pressure (each layer ~Width × Height × 4 bytes)
- Extra texture uploads
- Diminishing returns past 50-100 layers

Best practice: add `will-change` *before* animation, remove after via JS.

### 2.2 Force composite layers (legacy hack)

```css
.chart { transform: translateZ(0); }  /* same effect as will-change: transform */
```

Older code uses this; `will-change` is the modern, explicit version.

---

## 3. The JS event loop and rendering

```
┌──────────────────────────────────────────────────────────┐
│                  Event Loop (per task)                    │
│                                                           │
│  1. Pick task from queue (macrotask)                      │
│  2. Run task to completion (synchronous)                  │
│  3. Drain microtasks (Promise.then, queueMicrotask)       │
│  4. Render? (browser decides — usually every 16.67ms)     │
│     ├─ requestAnimationFrame callbacks                    │
│     ├─ style/layout/paint/composite                       │
│  5. requestIdleCallback (if time left)                    │
│  6. → next task                                           │
└──────────────────────────────────────────────────────────┘
```

### 3.1 Macrotasks vs microtasks

| Macrotasks | Microtasks |
|------------|------------|
| `setTimeout`, `setInterval` | `Promise.then/catch/finally` |
| User events (click, scroll) | `queueMicrotask()` |
| `MessageChannel`, `postMessage` | `MutationObserver` |
| `requestAnimationFrame` callbacks | `await` continuations |
| Network responses | |

Microtasks drain **completely** before the next macrotask. Long microtask chains starve rendering.

**Bad pattern:**
```js
async function flood() {
  for (let i = 0; i < 1_000_000; i++) {
    await Promise.resolve(); // microtask chain — UI freezes
  }
}
```

### 3.2 `requestAnimationFrame` vs `setTimeout(0)`

```js
// Janky: not aligned with rendering
setTimeout(() => { element.style.transform = `translateX(${x}px)`; }, 0);

// Smooth: runs just before next paint
requestAnimationFrame(() => {
  element.style.transform = `translateX(${x}px)`;
});
```

rAF callbacks are batched into the next render cycle (60 FPS = every ~16ms). Multiple rAF calls in the same frame coalesce.

### 3.3 `requestIdleCallback` — opportunistic work

```js
requestIdleCallback((deadline) => {
  while (deadline.timeRemaining() > 0 && tasks.length) {
    runTask(tasks.shift());
  }
});
```

Runs during idle periods between frames. Use for non-urgent work: analytics, logging, cache prewarming. **Not supported in Safari** — polyfill or use `setTimeout(fn, 1)` fallback.

---

## 4. Layout thrashing — the #1 performance killer

```js
// BAD — alternating read/write forces layout each iteration
for (const el of items) {
  el.style.left = el.offsetLeft + 10 + "px";   // read offsetLeft → write left
  // Each iteration: layout flush
}
```

The browser must flush pending style+layout work before returning a value from `offsetLeft` (or `getBoundingClientRect`, `clientWidth`, etc.). Repeated read-write cycles trigger N layouts.

**Fix: read first, then write:**
```js
// Read phase
const positions = items.map((el) => el.offsetLeft);
// Write phase
items.forEach((el, i) => { el.style.left = positions[i] + 10 + "px"; });
```

**Verizon dashboard example:** scrolling a 500-row table with sticky positioning where each row reads its own `getBoundingClientRect` to update a label → 30fps. Fix: batch reads via `requestAnimationFrame`, store in array, then apply all writes.

---

## 5. V8 internals (the JS engine)

```
Source → Parser → AST → Ignition (bytecode interpreter)
                            ↓ (hot code)
                       TurboFan (optimizing compiler)
                            ↓
                     Optimized machine code
                            ↓ (deopt on type change)
                       Back to Ignition
```

### 5.1 Hidden classes (object shape)

V8 internally represents objects with hidden classes ("Shapes" in SpiderMonkey, "Maps" in V8 terminology — confusingly named).

```js
function Point(x, y) {
  this.x = x;    // Shape S1 — has property x
  this.y = y;    // Shape S2 — has properties x, y
}

const p1 = new Point(1, 2);  // Shape S2
const p2 = new Point(3, 4);  // Shape S2 — same hidden class
```

Both objects share Shape S2 → property access is fast (inline cache hits).

**Performance killer:** changing property order across instances:

```js
function MakeP1() { const o = {}; o.x = 1; o.y = 2; return o; }
function MakeP2() { const o = {}; o.y = 1; o.x = 2; return o; }
// MakeP1's objects: shape {x, y}
// MakeP2's objects: shape {y, x}
// → Different shapes, inline caches go polymorphic, slower
```

### 5.2 Inline caches (ICs)

When V8 sees `point.x`, it compiles a lookup specialized for the shape it saw at that call site:

- **Monomorphic** (1 shape seen) — fastest
- **Polymorphic** (2-4 shapes) — slower, still optimized
- **Megamorphic** (>4 shapes) — generic lookup, slow

This is why type-stability matters in hot paths. **TS doesn't help at runtime** — only the actual shapes do.

### 5.3 Deoptimization

```js
function add(a, b) { return a + b; }
add(1, 2);            // V8 specializes for numbers → optimized machine code
add("a", "b");        // Different types → deopt → back to interpreter
```

Avoid mixing types in hot functions. Stable types = stable optimization.

### 5.4 Garbage collection

V8 uses generational GC:
- **Young generation** (new space): small, frequent collections (~1-10ms)
- **Old generation** (old space): large, infrequent (~50-200ms) — uses incremental marking + concurrent sweeping

**Tips to be GC-friendly:**
- Reuse objects instead of allocating per call (object pools for hot loops)
- Avoid huge allocation bursts (split large workloads)
- Minimize closures capturing large objects
- Use `--max-old-space-size` flag in Node.js for memory limits

### 5.5 Why this matters for React

React's reconciliation creates many short-lived objects (VNodes). With React 19 fiber + automatic batching, GC patterns improved. But:

- Avoid creating inline objects/functions in render that are GC'd every frame (use `useMemo`/`useCallback` *when measurements warrant it*)
- Avoid huge prop changes that trigger deep reconciliation
- Use `memo`/`useMemo` strategically — not as default

---

## 6. JS execution model in browsers

### 6.1 Single-threaded main thread

All JS runs on the main thread (which also handles DOM, style, layout, paint).

**Implications:**
- Long-running JS blocks all of the above
- 16ms budget per frame (60 FPS) for everything: JS + layout + paint + composite
- 50ms+ tasks are "long tasks" (TBT contributor in Lighthouse)

### 6.2 Web Workers

```js
// main.ts
const worker = new Worker("/worker.js");
worker.postMessage({ type: "process", data: largeArray });
worker.onmessage = (e) => { console.log("done", e.data); };

// worker.js — runs on separate thread
self.onmessage = (e) => {
  const result = heavyComputation(e.data);
  self.postMessage(result);
};
```

Workers don't have DOM access. They communicate via `postMessage` (structured clone — large payloads are expensive). Use for: CSV parsing, image processing, crypto, complex sorts.

### 6.3 Transferable objects

```js
const buffer = new ArrayBuffer(1024 * 1024 * 10);  // 10MB
worker.postMessage(buffer, [buffer]);  // transfer (zero-copy)
// after: main thread can't read buffer (transferred)
```

Use for large binary data — avoid structured clone overhead.

### 6.4 OffscreenCanvas

Render charts/visualizations on a worker thread:

```js
const offscreen = canvas.transferControlToOffscreen();
worker.postMessage({ canvas: offscreen }, [offscreen]);

// worker.js
self.onmessage = (e) => {
  const ctx = e.data.canvas.getContext("2d");
  // draw without blocking main thread
};
```

Great for Verizon billing dashboards with multiple charts updating in real-time — keeps the main thread free for interactions.

### 6.5 SharedArrayBuffer + Atomics

Shared memory between main thread and workers. Requires cross-origin isolation headers (`COOP`, `COEP`). Use cases: high-throughput simulations, audio processing. Most apps don't need this.

---

## 7. Core Web Vitals — what each measures

| Metric | What it measures | Threshold (Good) | Affected by |
|--------|------------------|------------------|-------------|
| **LCP** (Largest Contentful Paint) | Time to render largest visible content | ≤ 2.5s | Server, image opt, render-blocking resources |
| **INP** (Interaction to Next Paint) | Worst input → next paint delay | ≤ 200ms | JS execution time, layout thrashing |
| **CLS** (Cumulative Layout Shift) | Visual stability — unexpected shifts | ≤ 0.1 | Images without dimensions, late-loading fonts, ads |
| **FCP** (First Contentful Paint) | First text/image painted | ≤ 1.8s | Network, render-blocking |
| **TTFB** (Time to First Byte) | Server response latency | ≤ 800ms | Backend, CDN |
| **TBT** (Total Blocking Time, lab only) | Sum of long-task blocking time | ≤ 200ms | Long JS tasks |

**INP replaced FID in March 2024** — FID measured first interaction only; INP measures the worst over the page lifetime.

### 7.1 LCP optimization checklist

1. **Server fast** (TTFB < 600ms) — CDN, edge caching
2. **No render-blocking** in `<head>` — async/defer scripts, inline critical CSS
3. **Preload LCP image:** `<link rel="preload" as="image" fetchpriority="high" href="hero.jpg">`
4. **`<img loading="eager" fetchpriority="high">`** on the LCP image
5. **No `loading="lazy"` on above-the-fold images**
6. **Preconnect to required origins** (`<link rel="preconnect" href="https://cdn.x">`)

### 7.2 INP optimization checklist

1. **Break up long tasks** — `await` between chunks of work, `scheduler.yield()` (Chrome 129+)
2. **Use `requestIdleCallback`** for non-urgent work
3. **Move work to Web Workers**
4. **Debounce/throttle** input handlers
5. **Avoid synchronous layout reads** in event handlers (no `offsetHeight` in onClick)
6. **React 18+ concurrent features** — `useDeferredValue`, `useTransition`

### 7.3 CLS optimization checklist

1. **Always set `width`/`height`** on `<img>`, `<video>`, `<iframe>` (or aspect-ratio CSS)
2. **Reserve space for ads/embeds** with `min-height`
3. **`font-display: optional`** to avoid font swap shifts (or use `size-adjust` descriptors)
4. **Inject toasts/banners with `transform`**, not by inserting into DOM at top

---

## 8. Tools

| Tool | Use |
|------|-----|
| Chrome DevTools → Performance | Record + analyze, see flame chart, layout/paint flashing |
| Chrome DevTools → Rendering | "Paint flashing", "Layout shift regions", "Frame rendering stats" |
| Lighthouse | Audit + Core Web Vitals scoring |
| WebPageTest | Free, detailed waterfall, multiple locations |
| `performance.now()` | High-res timer in JS |
| `PerformanceObserver` | Tap into LCP/INP/CLS in production |
| Chrome User Experience Report (CrUX) | Real-user metrics from Chrome — public dataset |

### 8.1 Measuring INP in production

```js
import { onINP } from "web-vitals";

onINP((metric) => {
  analytics.track("inp", { value: metric.value, id: metric.id });
});
```

Use the `web-vitals` library for all CWV metrics in production. Sample to avoid analytics flood.

### 8.2 Reading a Performance flame chart

In Chrome DevTools Performance panel:
- **Frames row** — vertical bars: green = composite-only frame (cheap), yellow = paint, red = jank (>16ms)
- **Main row** — JS execution + layout/paint
- **Hover over "Layout" entries** — see "Forced reflow" warnings (the layout thrashing markers)
- **Bottom-Up panel** — sort by self-time to find heaviest functions

---

## 9. Verizon dashboard scenario (real-world example)

**Symptom:** chart panel re-renders every WS message at 60 FPS → CPU pegged, INP > 1000ms.

**Diagnosis (Performance recording):**
1. Each WS message → setState → React re-renders chart → recharts diffs → SVG paths re-emitted → layout + paint
2. Forced reflow warnings in JSX where `getBoundingClientRect()` reads occur in render

**Fix:**
1. Throttle WS updates — collect ticks, flush at 30Hz via rAF
2. Use `useDeferredValue` to defer chart re-render priority
3. Move chart to `OffscreenCanvas` + worker for high-frequency series
4. Add `contain: layout style paint` to chart container
5. Replace SVG (DOM-heavy) with Canvas where >10k data points

**Result:** INP 1000ms → 80ms, CPU 95% → 35%.

---

## 10. Architecting for performance — heuristics

### 10.1 The "ship less" rule

The fastest code is no code. Audit each frame:
- Lazy-load components below the fold
- Tree-shake heavy libraries (lodash → lodash-es with named imports)
- Use `dynamic import` for rarely-used features (chart libs, code editors)
- Split route bundles

### 10.2 The "do less per frame" rule

For 60 FPS, you have 16.67ms per frame, of which the browser needs ~5ms for layout/paint/composite. JS budget: ~10ms per frame.

- Cap work per frame with `scheduler.yield()` or `await`
- Process collections in batches (process 100 items, yield, process next 100)
- Use `IntersectionObserver` to skip work on off-screen content

### 10.3 The "GPU-accelerate the right things" rule

- Animate `transform`/`opacity`
- Promote actively-animating layers with `will-change`
- Use `contain` on virtualized rows
- Don't promote everything — memory matters

### 10.4 The "measure before optimizing" rule

Anecdote: a team added `useMemo` on every function. Result: zero measurable improvement (overhead of comparison ≈ overhead of recompute on cheap values), increased code complexity. Always measure with the Performance panel.

---

## 11. Browser architecture (Chrome / multi-process)

```
┌─────────────────────────────────────────────┐
│  Browser process (UI, network, storage)      │
└──────┬──────────┬──────────┬─────────────────┘
       │          │          │
   ┌───▼──┐   ┌──▼───┐   ┌───▼──┐
   │ Tab 1 │   │ Tab 2 │   │ Tab N │  (Renderer processes)
   │       │   │       │   │       │
   │ Main  │   │ Main  │   │ Main  │  thread (HTML/CSS/JS, V8)
   │ Comp  │   │ Comp  │   │ Comp  │  Compositor thread
   │ Worker│   │       │   │       │  Web Worker threads
   └───────┘   └───────┘   └───────┘
       │          │          │
   ┌───▼──────────▼──────────▼───┐
   │      GPU process              │
   └───────────────────────────────┘
```

**Why multi-process:** site isolation (security), tab crash containment, parallel rendering. Each tab has its own renderer; same-origin iframes may share renderer.

**Implication for perf:** the *site* doesn't compete with other tabs for the main thread. But within a single page, all your JS, layout, and paint compete for one main thread.

---

## 12. Interview talking points

**Q: "Why does animating `transform` perform better than animating `left`?"**
A: `transform` only triggers the composite step — the GPU shifts an already-rasterized layer's coordinates. `left` triggers layout (reflow of subsequent siblings), paint (rasterize new positions), and composite. Layout is the most expensive of the three; eliminating it per frame is the key.

**Q: "What's the difference between `requestAnimationFrame` and `setTimeout(fn, 0)`?"**
A: `rAF` callbacks run just before the next paint, batched into the rendering cycle. `setTimeout(fn, 0)` runs as a separate macrotask, potentially mid-frame, causing janky redraws. Multiple `rAF` calls in the same frame coalesce; multiple `setTimeout(0)` calls do not.

**Q: "How would you debug a janky scroll?"**
A: Chrome DevTools → Performance → record while scrolling. Look for: (1) red frames >16ms; (2) "Recalculate Style" or "Layout" entries in the main row — they indicate forced reflow; (3) huge "Composite Layers" — too many promoted layers; (4) scroll event handlers running synchronous heavy work. Fixes: passive event listeners, throttle, IntersectionObserver, `contain` on scrolled containers.

**Q: "What is layout thrashing and how do you avoid it?"**
A: Alternating reads (offsetHeight, getBoundingClientRect) and writes (style changes) within a JS frame forces the browser to flush pending layout each time. Avoid by batching: read all values first, then write all values. Or use libraries that batch — FastDOM, scheduler.postTask in Chrome.

**Q: "Explain Core Web Vitals to a non-technical PM."**
A: Three metrics Google uses to rank pages — and that real users feel. (1) LCP = how fast does the page LOOK loaded; (2) INP = how snappy is the page when users click; (3) CLS = does the page jump around as it loads. Target: green on all three for top-tier UX and SEO.

**Q: "How does V8 optimize JavaScript?"**
A: Two-tier — Ignition interpreter compiles to bytecode and runs cold paths; TurboFan optimizing compiler kicks in for hot paths, generating type-specialized machine code based on inline cache observations. If a function suddenly sees different argument types, V8 deopts back to bytecode. To stay optimized: keep argument types and object shapes stable across calls.

**Q: "When would you use a Web Worker?"**
A: CPU-bound work that's not DOM-related — CSV parsing, image filtering, complex sorts/diff, encryption, ML inference. For Verizon dashboards, we'd worker-ize: parsing huge JSON payloads from the backend, computing OLAP-style aggregations, and rendering Canvas-based charts via `OffscreenCanvas` so the main thread stays responsive to user interactions.

---

## 13. References

- [web.dev — Performance fundamentals](https://web.dev/learn/performance/)
- [HTML5 Rocks — Rendering Performance](https://www.html5rocks.com/en/tutorials/speed/rendering/)
- [V8 blog](https://v8.dev/blog) — engineering deep dives
- [Inside look at modern web browser (Chrome team)](https://developer.chrome.com/blog/inside-browser-part1/) — 4-part series
- [CSS Triggers](https://csstriggers.com/) — table of which properties trigger layout/paint/composite
- [web-vitals.js](https://github.com/GoogleChrome/web-vitals) — production CWV measurement library
