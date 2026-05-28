# Frontend System Design - Interview Notes

---

## Table of Contents

1. [Loading Time Metrics](#1-loading-time-metrics)
2. [TTFB — Time to First Byte](#2-ttfb--time-to-first-byte)
3. [FCP — First Contentful Paint](#3-fcp--first-contentful-paint)
4. [LCP — Largest Contentful Paint](#4-lcp--largest-contentful-paint)
5. [TTI — Time to Interactive](#5-tti--time-to-interactive)
6. [CLS — Cumulative Layout Shift](#6-cls--cumulative-layout-shift)
7. [Backend Communication](#7-backend-communication)
8. [Smooth Animation](#8-smooth-animation)
9. [Rendering Strategies](#9-rendering-strategies)
10. [Resource Hints](#10-resource-hints)
11. [Compression](#11-compression)
12. [List Virtualization](#12-list-virtualization)
13. [Asset Optimization Techniques](#13-asset-optimization-techniques)
14. [Adaptive Bitrate Streaming](#14-adaptive-bitrate-streaming)
15. [Netflix Architecture Case Study](#15-netflix-architecture-case-study)
16. [Atomic Design](#16-atomic-design)
17. [API Design](#17-api-design)
18. [Accessibility](#18-accessibility)
19. [PR Process & CI/CD](#19-pr-process--cicd)
20. [Code Quality & PR Review](#20-code-quality--pr-review)
21. [Virtualization vs Infinite Scroll](#21-virtualization-vs-infinite-scroll)

---

## 1. Loading Time Metrics

| Metric | Full Name | What it measures |
| :--- | :--- | :--- |
| TTFB | Time to First Byte | Time from request to first byte received from server |
| FCP | First Contentful Paint | Time for first text or image to render |
| LCP | Largest Contentful Paint | Time for the largest visible element to render |
| TTI | Time to Interactive | Time until the page is fully interactive |
| CLS | Cumulative Layout Shift | Visual stability — how much content shifts during load |

---

## 2. TTFB — Time to First Byte

**Goal:** Process the server request fast and deliver to the client fast.

- Use CDN to serve static files
- Optimize server-side processing (e.g. DB queries)
- Optimize DNS lookup times with DNS prefetching
- Enable compression (Gzip, Brotli) to reduce response size
- Use Redis to cache heavy responses
- Use HTTP/2 or HTTP/3 for multiplexing and lower latency
- Reduce HTTP overhead by minimizing headers and cookies

---

## 3. FCP — First Contentful Paint

Time taken for the first text or image to render on a webpage.

**Goal:** Pre-load or cache above-the-fold content (content before the scrollbar). Lazy load the rest.

### PRPL Pattern

> Reference: https://web.dev/articles/apply-instant-loading-with-prpl

- **P — Preload** late-discovered resources
  ```html
  <link rel="preload" as="image" href="image.jpg">
  ```
- **R — Render** the initial route as soon as possible
  - Inline critical JS and set others as `async`
  - Inline critical CSS used above the fold
  - Server-side rendering (note: can harm TTI)
- **P — Pre-cache** remaining assets using service workers
- **L — Lazy load** other routes and non-critical assets (split your bundle)

---

## 4. LCP — Largest Contentful Paint

Time taken for the largest image, text, or video block in the viewport to become visible.

- Optimize images using modern formats (`avif`, `webp`), compression, and lazy loading
- **Do not lazy load above-the-fold images** — this delays LCP
- JS optimizations:
  - Reduce bundle size (tree shaking, code splitting)
  - Delay or async-load non-critical JS

---

## 5. TTI — Time to Interactive

- Break down long-running JS tasks:
  - Use **Web Workers** for heavy computation
  - Split tasks using `setTimeout`, `requestIdleCallback`
- Prioritize loading essential scripts first
- Minimize third-party scripts that may be blocking interactivity
- Server-side rendering strategies: Streaming SSR, Selective Hydration, Static Rendering
- Code splitting and dynamic imports
- Preload resources based on user behaviour

---

## 6. CLS — Cumulative Layout Shift

- Always set `width` and `height` for images and iframes
- Reserve space for ads and dynamic content
- Avoid layout shifts caused by late-loading fonts — use `font-display`

---

## 7. Backend Communication

Three strategies for real-time or near-real-time data:

- **Long polling** — client holds request open until server has data
- **Server-Sent Events (SSE)** — server pushes updates over a single HTTP connection
- **WebSockets** — full-duplex, persistent TCP tunnel

---

## 8. Smooth Animation

- Use **GPU acceleration** — prefer CSS properties `transform` and `opacity`
- Prefer CSS animations over JS-driven animations
- Use the **composition thread** / explicit layer creation

> GPU animations don't trigger re-layouts or re-paints since they are handled at the composition layer.

---

## 9. Rendering Strategies

### SSR, CSR, SSG, Pre-rendering

**Case Study: Social Network**

Requirements: Public-facing, millions of DAU, SEO needed, must start quickly, work on low-powered devices, smooth and fast UI, dynamically rendered content.

**Solution: SSR with Hydration**

**The Uncanny Valley problem:** The page looks rendered and normal but is not yet interactive.

**Hydration types:**

| Type | Description |
| :--- | :--- |
| Full hydration | Request the full JS bundle once and hydrate the entire application |
| Partial / Selective hydration | Hydrate only the interactive parts of the application |
| Progressive hydration | Individually hydrate nodes over time |

**Island Architecture** — similar to partial hydration. Divide the page into independent interactive static components that can be rendered and updated separately.

> Reference: https://www.patterns.dev/vanilla/islands-architecture/

---

### Import on Interaction

> Reference: https://www.patterns.dev/vanilla/import-on-interaction

Different ways to load resources:

| Strategy | When it loads |
| :--- | :--- |
| Lazy (route-based) | When user navigates to a route |
| Lazy (on interaction) | When user clicks a UI element (e.g. YouTube video) |
| Lazy (in viewport) | When user scrolls toward the component |
| Prefetch | Prior to when it's needed, but after critical resources are loaded |
| Preload | Eagerly, with high urgency |

### Import on Visibility

Lazy load images not directly visible in the viewport — loaded only when the user scrolls down.

Use the `IntersectionObserver` API, or libraries like `react-lazyload` or `react-loadable-visibility`.

---

## 10. Resource Hints

> Reference: https://web.dev/learn/performance/resource-hints

| Hint | Purpose | Example use case |
| :--- | :--- | :--- |
| `preload` | Load resource right now — needed immediately | Fonts, main JS |
| `prefetch` | Load resource in background for future use | Next page, other route assets |
| `preconnect` | DNS resolution + TCP + TLS handshake | CDN, Google Fonts |
| `dns-prefetch` | DNS resolution only | Third-party domains |
| `pre-render` | Load and render an entire page in a hidden tab | Anticipating the user's next page |
| `module-preload` | Preload ES modules and dependencies before execution | Critical ES modules |

### Scenarios

1. Homepage loads a hero image from a CDN (`cdn.images.com`) that is the LCP element → **`preload`**
2. App will likely navigate to `/dashboard` next, which has a heavy JS chunk → **`prefetch`**
3. Site uses Google Fonts from `fonts.gstatic.com`, needed on first paint → **`preconnect`**
4. Site sometimes loads a third-party chat widget after user interaction → **`dns-prefetch`**
5. Main JS bundle blocks rendering and is required for the page to work → **`preload`**

### `dns-prefetch` vs `preconnect`

When a browser first contacts a new domain (e.g. `google.com`), it does three steps:

1. **DNS resolution** — look up the domain's IP address
2. **Open TCP connection**
3. **Negotiate TLS** (HTTPS handshake)

- `dns-prefetch` does **step 1 only** while the page is still loading
- `preconnect` does **steps 1, 2, and 3** — reduces TTFB for subsequent requests

```html
<link rel="dns-prefetch" href="https://www.google.com">
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
```

### `content-visibility` — Skip off-screen rendering

Normally, the browser calculates layout and paint for everything on the page, even elements far below the fold.

```css
.card {
  content-visibility: auto;       /* Doesn't render until needed */
  contain-intrinsic-size: 300px;  /* Reserve space to prevent layout shift */
}
```

### Prefetch via Webpack

```js
const EmojiPicker = import(/* webpackPrefetch: true */ "./EmojiPicker");
```

### Font preload + `font-display: swap`

Prevent layout shifting and flashes of unstyled text by preloading optional fonts:

```html
<link rel="preload" href="pacifico.woff2" as="font" crossorigin="anonymous">
```

```css
@font-face {
  font-family: 'Pacifico';
  font-style: normal;
  font-weight: 400;
  src: local('Pacifico Regular'), local('Pacifico-Regular'),
       url(pacifico.woff2) format('woff2');
  font-display: swap;
}
```

---

## 11. Compression

- **Brotli** — better compression ratio, modern standard
- **Gzip** — widely supported fallback
- Done server-side: Node.js, Nginx

---

## 12. List Virtualization

- **`react-virtualized`** — full-featured virtualization library
- **`react-window`** — smaller, faster rewrite of `react-virtualized`

> CRACO — Create React App Configuration Override (without ejecting)

---

## 13. Asset Optimization Techniques

### 1. Images

> Reference: https://medium.com/@arulvalananto/9-image-optimization-tricks-for-a-seamless-web-experience-b41867e87e54

- Use modern formats: `WebP`, `AVIF`
  ```html
  <img srcset="image.webp image.jpg" src="image.jpg" />
  ```
- **Responsive images** — provide multiple sizes; browser chooses the best match
- **Adaptive images** — served based on connection speed
- **Blur-up placeholder** — show a tiny blurred placeholder image first
- CSS image sprites
- Lazy loading
- CDN image compression (Cloudflare, Akamai, Cloudinary)

**Responsive image example:**
```html
<img
  src="image.jpg"
  srcset="
    image-small.jpg 480w,
    image-medium.jpg 800w,
    image-large.jpg 1200w
  "
  sizes="(max-width: 600px) 480px, 800px"
/>
```

---

### 2. Video

- Progressive enhancement (use `webM`)
- Replace GIFs with videos
- Responsive poster image
- Streaming — HLS/DASH delivery: large videos split into chunks, downloaded only as the user watches
- Videos with no audio track
- Preload

---

### 3. Fonts

> Reference: https://blog.pixelfreestudio.com/how-to-optimize-web-fonts-for-faster-loading-times/

- `font-display: swap` — no invisible text; loads system font first, switches to custom font after
- Preload critical fonts:
  ```html
  <link rel="preload" href="main.woff2" as="font" type="font/woff2" crossorigin>
  ```
- Progressive enhancement — use `woff2` first, `woff` as fallback
- Use only needed font variants (e.g. `400`, `600` instead of `100–900`)
- **FontFaceObserver** — JS library that detects when fonts finish loading:
  ```js
  const font = new FontFaceObserver("MyFont");
  font.load().then(() => {
    document.body.classList.add("font-loaded");
  });
  ```
- Self-host fonts instead of using Google Fonts

---

### 4. CSS

- Critical CSS rendering (above-the-fold CSS)
- Lazy loading CSS — browser downloads CSS early but doesn't block rendering:
  ```html
  <link rel="preload" href="style.css" as="style" onload="this.rel='stylesheet'" />
  <noscript>
    <link rel="stylesheet" href="style.css" />
  </noscript>
  ```

---

### 5. JavaScript

- `defer` vs `async`
- Web Workers
- Lazy loading

---

## 14. Adaptive Bitrate Streaming

**Adaptive Bitrate Streaming (ABS):** Video is split into small chunks at multiple quality levels. The player adjusts quality dynamically based on network speed.

- Uses **HLS** and **DASH** protocols
- No buffering, smooth playback
- Quality levels: 144p, 480p, 1080p, etc.

**Progressive Video Download:** Video is downloaded from start to end and begins playing once enough data is buffered (e.g. an MP4 file — not chunked).

---

## 15. Netflix Architecture Case Study

**Requirements:** SEO-driven, dynamic, media-heavy → **Next.js is the best choice**

- **SSR / ISR** for content rendering
- **Image optimization** — automatic compression, resize, lazy load, serves `webp`/`avif` from Vercel's Edge CDN cache
- **Edge middleware** — small serverless function running on Vercel's edge nodes, close to the user, before the request hits the route. Used for: auth checks, geo-based personalization, device-based redirects (e.g. `m.example.com`)
- **Routing** — file-based routing
- **Performance primitives** — tree shaking, code splitting, prefetch links on hover/viewport, SSG

### Self-Hosted (Docker on EC2 instead of Vercel)

**Image optimization:**

- **Approach 1:** Install `sharp` so Next.js can do `webp`/`avif` conversion (image uploaded to this server)
- **Approach 2:** Use an external image CDN (e.g. Cloudflare Images) by updating `next.config.js` image loader and path options

**Edge middleware:**

Use **CloudFront + Lambda@Edge**

> Note: Next.js edge middleware runs on the edge runtime, available on Vercel's edge network or Cloudflare Workers. EC2 cannot run edge functions.

---

## 16. Atomic Design

> Reference: https://www.linkedin.com/pulse/atomic-design-react-components-building-scalable-uis-wijerathna--kwzkc

| Level | Description |
| :--- | :--- |
| Atoms | Smallest UI elements (buttons, inputs, labels) |
| Molecules | Groups of atoms working together (search bar = input + button) |
| Organisms | Complex UI sections made of molecules (header, card grid) |
| Templates | Page-level layouts without real content |
| Pages | Templates with real content instances |

---

## 17. API Design

- **REST** — resource-based, stateless, widely adopted
- **GraphQL** — query exactly what you need, reduces over-fetching and under-fetching

**When to use which:** Use REST for simple CRUD-heavy APIs. Use GraphQL when clients need flexible queries or when aggregating data from multiple sources.

---

## 18. Accessibility

- Semantic HTML
- Images with `alt` tags
- Keyboard navigation support
- Mobile AA — design for thumb reach

---

## 19. PR Process & CI/CD

### Branch Strategy

```
dev branches  →  staging (QA)  →  master (prod)
```

Or use **feature flags** to ship code without branching complexity.

### CI/CD Tools

- Jenkins
- GitHub Actions

### Testing

| Tool | Purpose |
| :--- | :--- |
| ESLint | Linting and formatting |
| Jest + RTL | Unit and component testing |
| Lighthouse | Performance auditing |
| Cypress | End-to-end testing |

### Deployment & Infrastructure

| Option | Use case |
| :--- | :--- |
| S3 deploy | Static sites |
| Serverless | Event-driven, auto-scaling functions |
| Docker on EC2 | Full control, self-hosted |

### Monitoring & Logging

- **Sentry** — error tracking and performance monitoring

### Styling

- SASS
- Design system (reusable components)
- Tailwind / Bootstrap

---

## 20. Code Quality & PR Review

### Automated Checks

- ESLint and Prettier rules enforced using **Husky** and **lint-staged** (pre-commit hooks)
- Unit testing with **Jest** and **RTL** — enforce minimum code coverage threshold
- CI/CD pipeline stages: linting → testing → code coverage

### Code Review Checklist

- **Functionality** — edge cases, error scenarios, proper error handling, avoid overuse of `useState` (prefer `useReducer` for complex state)
- **Code style** — adhere to ESLint/Prettier rules and team coding standards
- **Performance** — efficient DOM updates, minimum re-renders (use React Profiler)
- **Accessibility** — adhere to WCAG guidelines (use tools like `axe-core`)
- **Security** — XSS prevention, sanitize user inputs

### Code Review Examples

**1. Inline arrow function vs direct reference**

```jsx
// ❌ Creates a new function on every re-render
<input onClick={() => handleClick()} />

// ✅ Reference stays stable across re-renders
<input onClick={handleClick} />
```

**2. State updates with stale closures**

```js
// ❌ State updates are asynchronous — can produce incorrect results on rapid updates
setCount(count + 1);

// ✅ Use functional form to always get the latest state
setCount((prevCount) => prevCount + 1);
```

**3. Missing key in list render**

```jsx
// ❌ Missing key prop
items.map((item) => <div>{item}</div>);

// ✅ Always provide a stable, unique key
items.map((item) => <div key={item.id}>{item}</div>);
```

---

## 21. Virtualization vs Infinite Scroll

These solve different problems and are often confused.

| | Infinite Scroll | Virtualization |
| :--- | :--- | :--- |
| **What it is** | A pagination strategy | A DOM optimization strategy |
| **When it triggers** | User scrolls to the end of the list | Browser tries to render 1000+ complex rows |
| **Memory behaviour** | Grows over time as more items are added to the DOM | Fixed — reuses a small set of DOM nodes |
| **Use case** | Social feeds, search results pagination | Data tables, long lists, dashboards |
| **Libraries** | — | `react-window`, `react-virtualized` |

### How `react-window` works

- Keeps only a small, fixed set of row components mounted in the DOM at any time.
- On scroll, it **reuses those DOM nodes** by updating their index and `style` (`top` / `transform`) — no mounting or unmounting thousands of items.
- Uses `translate` / absolute positioning → updates are **GPU-friendly** and extremely fast.

### The Context Trap

> Because elements are being unmounted during virtualization, **you cannot rely on local component state to persist**. When a row scrolls out of view it unmounts, and its state is lost.
>
> **Fix:** Lift that state to a global store (Zustand, TanStack Query) so when the row re-enters the viewport, it re-renders correctly with the right data.
