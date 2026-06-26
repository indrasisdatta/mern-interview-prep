# Hotel Booking Frontend — High Level Design (HLD)

> Framework: **RADIO** — Requirements → Architecture → Data Design → Interface → Optimization

---

## R — Requirements

### Functional Requirements

#### 1. Hotel Search
Users can search hotels by entering:
- Check-in / Check-out date range
- City / Location
- Number of rooms
- Number of guests

On form submit, the system fires a POST to the search API and renders results.

**Why POST for search?**
Search params can be large (filters, date ranges, location). GET has URL length limits and exposes sensitive filter data in browser history. POST gives a clean payload and is consistent across all filter states.

#### 2. Search Results Page
- Displays a **large result set** using **infinite scroll** (mobile-first) or **pagination** (desktop)
- Each hotel card shows: name, location, thumbnail, starting price, rating
- Results update reactively when filters change (no full page reload)

#### 3. Filters (on-click, non-blocking)
Users can refine results post-search using:
- Price range (slider)
- Ratings (checkbox: 3★, 4★, 5★)
- Amenities (multi-select: Wi-Fi, parking, pool, etc.)

Filters should be applied client-side when the dataset is already loaded, or trigger a new API call when the dataset is too large.

#### 4. Hotel Detail Page
- Triggered on clicking a hotel card
- Displays: photo gallery, room types, pricing, occupancy, cancellation policies
- Route: `/hotel/:id` — deep linkable, shareable URL

#### 5. Booking Flow (3-step funnel)
```
Step 1: Select Room
Step 2: Guest Info (name, email, phone)
Step 3: Payment (card details, confirmation)
```
Each step is a separate route or a wizard-style component. Must support back-navigation without losing state.

#### 6. Auth — Login / Signup / Profile
- JWT or session-based auth
- Protected routes for booking and profile
- Social login (Google/Facebook) as optional enhancement
- Profile page: booking history, saved hotels

#### 7. Internationalization (i18n)
- Multi-language support via `react-i18next` or Next.js built-in i18n
- Currency formatting using `Intl.NumberFormat`
- Date formatting using `Intl.DateTimeFormat` (locale-aware)
- RTL layout support for Arabic/Hebrew markets

---

### Non-Functional Requirements

#### 1. Accessibility (a11y)
- WCAG 2.1 AA compliance
- Semantic HTML (`<main>`, `<nav>`, `<section>`, `<article>`)
- Keyboard navigation for all interactive elements
- ARIA labels on icon buttons, modals, and carousels
- Focus trap in modals during booking flow
- Color contrast ratio ≥ 4.5:1

#### 2. Responsive Design
- Mobile-first CSS using Tailwind breakpoints (`sm`, `md`, `lg`, `xl`)
- Grid layout adapts: 1 column on mobile → 2 → 3 on desktop
- Touch-friendly tap targets (≥ 44px)
- Collapsible filter sidebar on mobile (drawer/bottom sheet)

#### 3. SEO Support
- **SSR / ISR** for hotel detail pages (crawlable by search engines)
- `<title>`, `<meta description>`, OpenGraph tags per page
- Structured data (JSON-LD) for hotel schema markup
- Canonical URLs to avoid duplicate content
- Sitemap.xml for hotel listing pages

#### 4. Testing Coverage
| Layer | Tool |
|---|---|
| Unit | Jest + React Testing Library (RTL) |
| Integration | MSW (Mock Service Worker) |
| E2E | Playwright or Cypress |
| Accessibility | axe-core / jest-axe |
| Visual Regression | Chromatic / Percy |

---

## A — Architecture

### Rendering Strategy

```
┌──────────────────────────────────────────────────────┐
│                   Next.js App                        │
├──────────────────────────────────────────────────────┤
│  /            → SSG  (static landing page)           │
│  /search      → CSR  (dynamic filters, pagination)   │
│  /hotel/:id   → ISR  (revalidate: 60s, SEO critical) │
│  /booking/*   → CSR  (auth-protected, no SEO needed) │
│  /profile     → CSR  (auth-protected)                │
└──────────────────────────────────────────────────────┘
```

- **SSG** — Landing page is fully static. Deployed to CDN edge nodes.
- **ISR (Incremental Static Regeneration)** — Hotel detail pages are pre-rendered and revalidated every 60 seconds. Best balance of SEO + freshness.
- **CSR** — Search results and booking flow are client-rendered. No SEO value, high interactivity needed.

- Use Next.js with ISR for the hotel detail page static shell — name, photos, amenities — served from CDN for fast LCP and SEO. 
- But price and availability are fetched client-side on hydration via react-query, since those change too frequently for any static revalidation window to be reliable.
- This pattern gives you the best of all three: SEO, performance, and price accuracy. 
- Plain React without a framework would mean building SSR, routing, and image optimization from scratch — not worth it when Next.js ships all of that.

### State Management

Two-layer state strategy:

```
┌──────────────────────────────────────────────────────┐
│  Server State         │  Client State                │
│  (react-query)        │  (redux-toolkit)             │
├───────────────────────┼──────────────────────────────┤
│  - Search results     │  - Auth / user session       │
│  - Hotel details      │  - Active booking step       │
│  - Room availability  │  - Guest info form data      │
│  - Cache + refetch    │  - UI state (modals, drawer) │
└───────────────────────┴──────────────────────────────┘
```

**Why both?**
- `react-query` handles async server state with built-in caching, deduplication, and stale-while-revalidate.
- `redux-toolkit` handles synchronous client state that must persist across route navigations (e.g., booking wizard data).

### Styling Architecture

```
Design Tokens (ShadCN / MUI)
       ↓
Tailwind CSS utility classes
       ↓
Component library (Button, Card, Modal, Input)
       ↓
Page-level layout components
```

- **ShadCN/UI** — Unstyled, accessible primitives (Radix UI under the hood). Bring your own styles.
- **Tailwind CSS** — Utility-first, no runtime overhead, purge unused classes at build time.
- **Design Tokens** — Centralized color, spacing, typography variables. Ensures consistency and theme-switching.

### Bundling — Webpack / Next.js

```
Entry Points (per route via Next.js automatic code splitting)
       ↓
Webpack bundles each route chunk separately
       ↓
Tree shaking removes unused exports
       ↓
Dynamic imports: React.lazy() + Suspense for below-fold components
       ↓
Output: Hashed filenames for long-term browser caching
```

Key strategies:
- **Route-level code splitting** — Next.js does this automatically. Each page = separate chunk.
- **Component-level splitting** — Use `React.lazy()` for heavy components (photo gallery, map widget, date picker).
- **Vendor chunk splitting** — Separate `node_modules` from app code. `react`, `redux` etc. are cached longer.

### Image Optimization

```
Hotel Images (uploaded by hotel owners)
       ↓
Stored in S3 / Cloud Storage
       ↓
Processed by image pipeline (sharp / Imgix)
       ↓
Served via CDN (CloudFront / Fastly)
       ↓
Format: WebP (fallback JPG) / AVIF for modern browsers
       ↓
<Image> component (Next.js) → srcset, sizes, lazy loading
```

- `avif` ~50% smaller than WebP. Use with `<picture>` and `<source type="image/avif">` fallback.
- CDN serves images from the nearest edge node. Cache-Control headers: `max-age=31536000, immutable`.
- Use `loading="lazy"` for below-fold hotel card images.
- Use `priority` flag on hero image (LCP critical path).

### Authentication & Authorization

```
┌──────────────────────────────────────┐
│  Auth Flow                           │
├──────────────────────────────────────┤
│  Login → POST /api/auth/login        │
│  → Server returns: accessToken (JWT) │
│    + refreshToken (httpOnly cookie)  │
│                                      │
│  accessToken stored in memory        │
│  (not localStorage — XSS safe)       │
│                                      │
│  Silent refresh via httpOnly cookie  │
│  on token expiry                     │
└──────────────────────────────────────┘
```

- **Route guards** — Next.js middleware checks token presence before serving protected pages.
- **Role-based access** — `USER` can book. `ADMIN` can manage listings.
- **CSRF protection** — SameSite cookie flag + CSRF token for state-changing mutations.

---

## D — Data Design

### Core TypeScript Interfaces

```typescript
/* Search input shape — sent to POST /api/search */
interface SearchParams {
  checkin: string;         /* ISO 8601: "2024-12-01" */
  checkout: string;        /* ISO 8601: "2024-12-05" */
  city: string;
  guests: number;
  rooms: number;
  filters: Filters;
  cursor?: string | null; 
}

/* Applied filters — can be partial */
interface Filters {
  price?: [number, number];    /* [min, max] in user's currency */
  rating?: number[];           /* e.g. [4, 5] for 4★ and 5★ */
  amenities: string[];         /* e.g. ['wifi', 'car-parking'] */
}

/* Hotel summary (used in search results list) */
interface Hotel {
  id: string;
  name: string;
  location: {
    lat: number;
    lng: number;
    address?: string;
  };
  rooms: Room[];
  images: string[];            /* CDN URLs */
  minPrice: number;            /* Lowest room price — used in card */
  rating?: number;
  reviewCount?: number;
}

/* Room detail (used in hotel detail page) */
interface Room {
  id: string;
  roomNo: string;
  price: number;               /* Per night */
  occupancy: string;           /* e.g. "2 adults, 1 child" */
  images: string[];
  amenities?: string[];
  available?: boolean;
}

/* Booking state — persisted in redux during booking flow */
interface BookingState {
  hotelId: string;
  roomId: string;
  checkin: string;
  checkout: string;
  guestInfo: GuestInfo;
  paymentStatus: 'idle' | 'processing' | 'success' | 'failed';
}

interface GuestInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}
```

### Data Flow Diagram

```
User Input (SearchForm)
       ↓
SearchParams object built in component
       ↓
react-query useMutation → POST /api/search
       ↓
Response: Hotel[]
       ↓
Cached in react-query cache (key: ['search', params])
       ↓
SearchResults renders <HotelCard> per hotel
       ↓
On filter change: invalidate cache → re-fetch (or client-side filter if all data loaded)

User clicks HotelCard
       ↓
Navigate to /hotel/:id
       ↓
react-query useQuery → GET /api/hotel/:id
       ↓
Hotel detail page renders
       ↓
User selects room → dispatch to redux (booking slice)
       ↓
Navigate through booking wizard (steps stored in redux)
       ↓
Step 3 (Payment) → POST /api/booking → clear booking slice
```

---

## I — Interface (API Integration)

### Endpoints Used

#### Search Hotels
```http
POST /api/search
Content-Type: application/json

{
  "checkin": "2024-12-01",
  "checkout": "2024-12-05",
  "city": "Mumbai",
  "guests": 2,
  "rooms": 1,
  "filters": {
    "price": [1000, 5000],
    "rating": [4, 5],
    "amenities": ["wifi", "car-parking"]
  }
}
```

**Response:**
```json
{
  "hotels": [...],
  "total": 124,
  "page": 1,
  "pageSize": 20,
  "nextCursor": "eyJpZCI6IjIwIn0="
}
```

Use `nextCursor` for infinite scroll (cursor-based pagination is preferred over offset — avoids duplicate/missing items when new hotels are added mid-scroll).

#### Get Hotel Detail
```http
GET /api/hotel/:id
```

**Response:**
```json
{
  "id": "hotel_abc",
  "name": "The Grand Mumbai",
  "location": { "lat": 19.076, "lng": 72.877 },
  "rooms": [...],
  "images": ["https://cdn.example.com/hotel_abc/hero.avif"],
  "minPrice": 2500,
  "rating": 4.3
}
```

### React Query Integration Pattern

```typescript
/* Search hook — wraps POST as mutation */
const useHotelSearch = () => {
  return useMutation({
    mutationFn: (params: SearchParams) =>
      fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }).then(r => r.json()),
  });
};

/* Hotel detail hook — cached by id */
const useHotelDetail = (id: string) => {
  return useQuery({
    queryKey: ['hotel', id],
    queryFn: () => fetch(`/api/hotel/${id}`).then(r => r.json()),
    staleTime: 60_000,    /* 1 min — ISR revalidation interval */
  });
};

/* Infinite scroll hook — cursor-based */
const useInfiniteSearch = (params: SearchParams) => {
  return useInfiniteQuery({
    queryKey: ['search', params],
    queryFn: ({ pageParam = null }) =>
      fetch('/api/search', {
        method: 'POST',
        body: JSON.stringify({ ...params, cursor: pageParam }),
      }).then(r => r.json()),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
};
```

### Filter Strategy

```
Two modes based on dataset size:

< 200 results (small set)
  → Filter client-side (useMemo on Hotel[])
  → No network call, instant feedback

> 200 results (large set)
  → Debounce filter changes (300ms)
  → Re-fire POST /api/search with updated filters
  → Show skeleton loader during fetch
```

```typescript
/* Client-side filter example */
const filteredHotels = useMemo(() => {
  return hotels.filter(hotel => {
    const inPriceRange = hotel.minPrice >= filters.price[0] &&
                         hotel.minPrice <= filters.price[1];
    const inRating = filters.rating.includes(Math.floor(hotel.rating));
    return inPriceRange && inRating;
  });
}, [hotels, filters]);
```

---

## O — Optimization

### 1. Route-Level Code Splitting

```tsx
/* Lazy load heavy pages — not loaded until navigated to */
const HotelDetailPage = React.lazy(() => import('./pages/HotelDetail'));
const BookingPage = React.lazy(() => import('./pages/Booking'));

<Suspense fallback={<PageSkeleton />}>
  <Routes>
    <Route path="/hotel/:id" element={<HotelDetailPage />} />
    <Route path="/booking/*" element={<BookingPage />} />
  </Routes>
</Suspense>
```

### 2. Tree Shaking

```
Webpack production mode + ES modules
       ↓
Static import analysis → dead code removal
       ↓
Example: import { debounce } from 'lodash-es'
         Only debounce is bundled, not entire lodash
```

Always use named imports from ESM-compatible libraries. Avoid `import _ from 'lodash'` (pulls entire bundle).

### 3. Image Optimization

```tsx
/* Next.js Image component handles everything automatically */
<Image
  src="https://cdn.example.com/hotel.avif"
  alt="Hotel exterior"
  width={400}
  height={300}
  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
  priority={isAboveFold}    /* true only for LCP image */
  loading={isAboveFold ? 'eager' : 'lazy'}
  placeholder="blur"
  blurDataURL={lowQualityBase64}
/>
```

Pipeline:
- Upload → S3 → Imgix pipeline → generates WebP + AVIF variants
- CDN caches by format + width
- Browser picks best format via `Accept: image/avif,image/webp` header

### 4. Debounce / Throttle

```typescript
/* Debounce: fire search only after user stops typing (300ms) */
const debouncedSearch = useMemo(
  () => debounce((params: SearchParams) => searchMutation.mutate(params), 300),
  []
);

/* Throttle: limit scroll event firing (not the fetch — the scroll listener) */
const handleScroll = useCallback(
  throttle(() => {
    if (isNearBottom()) fetchNextPage();
  }, 200),
  [fetchNextPage]
);
```

Use `debounce` for input-triggered API calls. Use `throttle` for continuous events (scroll, resize, mousemove).

### 5. Infinite Scroll + Virtualization

```
Problem: 500 hotel cards in DOM = layout thrash, high memory

Solution:
  react-window (or @tanstack/virtual)
  → Only renders cards visible in viewport + overscan buffer
  → DOM count stays ~10-15 regardless of dataset size
```

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

const rowVirtualizer = useVirtualizer({
  count: hotels.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 200,   /* estimated card height in px */
  overscan: 5,               /* extra items above/below viewport */
});
```

When the user reaches the last virtualized item, trigger `fetchNextPage()` from `useInfiniteQuery`.

### 6. Monitoring & Observability

```
Error Tracking:    Sentry
  → Captures runtime errors with stack trace + user context
  → Custom breadcrumbs for booking funnel drop-offs

Analytics:         Google Analytics / Mixpanel
  → Track search-to-detail conversion
  → Track booking funnel completion rate
  → A/B test filter placement variants

Performance:       Web Vitals API + Sentry
  → Capture LCP, CLS, INP in real user browsers
  → Alert on P75 LCP > 2.5s
```

### 7. Core Web Vitals Targets

| Metric | Target | Strategy |
|---|---|---|
| LCP | < 2.5s | SSR/ISR + CDN images + `priority` flag on hero |
| CLS | < 0.1 | Fixed image dimensions, no layout shift on load |
| INP | < 200ms | Debounce inputs, avoid long tasks on main thread |
| FID/TBT | < 200ms | Code split heavy libs, use `scheduler.yield()` |

```typescript
/* Report Web Vitals to your analytics pipeline */
import { onLCP, onCLS, onINP } from 'web-vitals';

onLCP(metric => sendToAnalytics({ name: metric.name, value: metric.value }));
onCLS(metric => sendToAnalytics({ name: metric.name, value: metric.value }));
onINP(metric => sendToAnalytics({ name: metric.name, value: metric.value }));
```

### 8. Testing Pyramid

```
              /\
             /E2E\         ← Playwright: full booking flow
            /──────\
           / Integr. \     ← MSW: API mocking, full component
          /────────────\
         /  Unit Tests  \  ← Jest + RTL: hooks, utilities
        /────────────────\
```

```typescript
/* MSW handler example — mock search API */
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.post('/api/search', () => {
    return HttpResponse.json({ hotels: mockHotels, total: 5 });
  }),
  http.get('/api/hotel/:id', ({ params }) => {
    return HttpResponse.json(mockHotelDetail(params.id));
  }),
];
```

---

## Concepts to Learn for This HLD

### Rendering & Architecture
- SSR vs CSR vs SSG vs ISR — when to use each, tradeoffs
- Next.js App Router vs Pages Router — layouts, streaming, server components
- React Server Components (RSC) — how they differ from SSR
- Hydration — what it is, hydration mismatch errors

### State Management
- react-query (TanStack Query) — caching, staleTime, gcTime, refetch strategies
- redux-toolkit — createSlice, RTK Query vs react-query
- Zustand as a lightweight alternative to RTK
- Cursor-based vs offset-based pagination — tradeoffs
- `useInfiniteQuery` internals

### Performance
- Core Web Vitals — LCP, CLS, INP definitions and measurement
- `scheduler.yield()` — yielding to browser during long tasks
- Virtual list rendering — why and how `@tanstack/virtual` works
- Image optimization pipeline — WebP, AVIF, srcset, sizes attribute
- Tree shaking — how Webpack/Rollup eliminates dead code
- Code splitting — dynamic import, React.lazy, Suspense

### Accessibility & Standards
- WCAG 2.1 AA — perceivable, operable, understandable, robust
- ARIA roles and attributes — aria-label, aria-live, role="dialog"
- Focus management — focus trap in modals, skip-to-content links
- Keyboard navigation patterns — tab order, arrow key navigation

### Security
- JWT storage — memory vs localStorage vs httpOnly cookie
- CSRF attacks and mitigation
- XSS — how it happens, Content Security Policy headers
- Secure payment flow — PCI-DSS, never store raw card data

### Testing
- MSW (Mock Service Worker) — network-level mocking
- React Testing Library principles — test behavior, not implementation
- axe-core for automated a11y testing
- Playwright for E2E — page object model pattern

### Tooling
- Webpack — entry/output, loaders, plugins, bundle analysis
- Lighthouse CI — automated scores in CI/CD pipeline
- Sentry — source maps, breadcrumbs, performance monitoring
- Chromatic / Storybook — visual testing and component documentation

---

## Interview Questions & Cross-Questions

### Rendering Strategy

**Q: Why did you choose ISR for hotel detail pages instead of full SSR?**
> ISR pre-renders at build time and revalidates in the background after a set interval. Hotel data doesn't change every second — a 60-second stale window is acceptable. SSR re-renders on every request, adding server load and latency. ISR gives you the SEO benefit of pre-rendered HTML with near-fresh data, at a fraction of the compute cost.

**Grilling:** What if hotel price changes between the 60s window? A user sees stale price.
> Answer: Show a "Prices may vary" disclaimer. On the detail page, fire a client-side fetch for real-time availability/price on mount. The static shell loads fast (good LCP), then hydrates with live data. This is the "stale-while-revalidate" pattern.

---

**Q: Why use POST for the search endpoint instead of GET?**
> GET requests put params in the URL. Our filter object (price range, ratings array, amenities array) can become large and complex. URL has ~2KB practical limit across browsers. POST gives us a clean JSON body, no encoding issues, and doesn't expose filter state in browser history or server logs.

**Grilling:** But GET requests are cacheable — you lose CDN caching with POST.
> Answer: Correct. Tradeoff acknowledged. For a hotel search with personalized filters, CDN caching adds little value since each query is unique. We can cache at the react-query layer (in-memory, client-side) with a composite query key. If CDN caching matters for popular searches, we can hash the body and cache by hash as a custom middleware strategy.

---

### State Management

**Q: Why use both react-query AND redux-toolkit? Isn't that overkill?**
> They serve different purposes. react-query manages server state — async data with cache, stale/fresh lifecycle, background refetch. It's not a global store. Redux manages client state that is synchronous and UI-driven — the booking wizard's step progress, guest info entered, auth session. Mixing server and client state in Redux leads to manual cache invalidation pain. Using react-query alone means you lose a predictable, devtools-inspectable global store for UI state.

**Grilling:** RTK Query can replace react-query entirely. Why didn't you use it?
> Answer: RTK Query is great and reduces the dual-library overhead. I default to react-query because its cache model is more ergonomic for non-REST patterns (like our POST search), and its `useInfiniteQuery` is first-class. If the team is already heavy on Redux, RTK Query is a valid consolidation move. Tradeoff: slightly more boilerplate in RTK Query for pagination.

---

### Infinite Scroll & Virtualization

**Q: What's the difference between infinite scroll and pagination? When do you pick which?**
> Infinite scroll is better for mobile and content discovery (social feeds, hotel browsing). It reduces friction — user never clicks "next page". Pagination is better for desktop, task-oriented UIs, and when users need to jump to a specific result. For hotels on mobile, infinite scroll wins. Desktop search results could go either way — many booking sites use both (infinite on mobile, numbered pages on desktop).

**Grilling:** Infinite scroll breaks browser history and back-button behavior. How do you fix that?
> Answer: Store the current scroll position and loaded page count in the URL as query params (e.g., `?page=3`). On back-navigation, restore state from URL. Alternatively, use the History API to update the URL silently as pages load. This is a known UX problem with infinite scroll — proper deep link support requires extra engineering.

---

**Q: Why do you need virtualization if you already have infinite scroll?**
> Infinite scroll limits how much data you *fetch*, but if you don't virtualize, every fetched card is added to the DOM. After 10 pages × 20 hotels = 200 DOM nodes, all with images, event listeners, and styles. This causes layout thrash and high memory usage. Virtualization removes items from the DOM as they scroll out of viewport, keeping the DOM count constant regardless of how many pages have been loaded.

**Grilling:** Virtualization makes scroll restoration harder. How do you handle it?
> Answer: Use `scrollToIndex` from the virtualizer on route restoration. Store the visible index in session storage or URL. `@tanstack/virtual` exposes `scrollToOffset` and `scrollToIndex` APIs for this. It's extra work but necessary for large lists.

---

### Performance & Images

**Q: Walk me through your image optimization strategy.**
> Hotel images are uploaded to S3, processed by an Imgix/sharp pipeline that generates WebP and AVIF variants at multiple resolutions. These are served from a CDN edge. On the frontend, Next.js `<Image>` automatically generates `srcset` and `sizes` attributes so the browser downloads only the resolution it needs. We use `loading="lazy"` for below-fold cards and the `priority` flag on the LCP hero image. AVIF is ~50% smaller than WebP with better quality at low bitrates. Browsers that don't support AVIF fall back to WebP, then JPG.

**Grilling:** What if the CDN isn't available and falls back to origin? How do you prevent a cascade?
> Answer: Set a CDN cache TTL of `max-age=31536000, immutable` for images (they're content-addressed by hash). Origin is only hit on cache miss. Circuit-breaker pattern at the application layer: if image URL fails, show a placeholder. Use `onerror` on `<img>` to swap in a fallback.

---

### Accessibility

**Q: How do you handle accessibility in the booking flow modal?**
> When a modal opens: (1) move focus to the first focusable element inside the modal, (2) trap focus so Tab/Shift+Tab cycles within the modal, (3) close on Escape key, (4) restore focus to the trigger element when modal closes. Use `aria-modal="true"`, `role="dialog"`, `aria-labelledby` pointing to the modal title. For screen readers, use `aria-live="polite"` for success/error messages that appear dynamically.

**Grilling:** aria-modal alone is not enough for all screen readers — some still read background content. What do you do?
> Answer: Use `inert` attribute on the background content when a modal is open (`document.getElementById('root').inert = true`). The `inert` attribute removes all focusability and screen reader access from the subtree, more reliably than `aria-hidden` alone.

---

### Security

**Q: Where do you store the JWT access token and why?**
> In memory (a JavaScript variable or React state). Not in localStorage (vulnerable to XSS — any injected script can read it). Not in a non-httpOnly cookie (also readable by JS). The access token lives in memory — it's gone on page refresh. A httpOnly, Secure, SameSite=Strict refresh token cookie is used to silently obtain a new access token on page load. This is the "BFF (Backend for Frontend)" auth pattern.

**Grilling:** If it's in memory, a page refresh logs the user out. Isn't that bad UX?
> Answer: The httpOnly refresh token cookie handles this. On app load, we fire a silent `POST /api/auth/refresh`. If the refresh token is valid, we get a new access token in the response body and store it in memory. User never sees a logout. The refresh token has a longer TTL (7 days). The access token has a short TTL (15 minutes) — even if somehow stolen, it expires quickly.

---

### Testing

**Q: Why MSW for integration testing instead of mocking `fetch` directly?**
> MSW intercepts requests at the network level (service worker in browser, node interceptor in Jest). It's closer to the real integration point. Mocking `fetch` at the module level couples tests to implementation — if you swap `fetch` for `axios`, tests break. MSW mocks are reusable across Jest, Storybook, and Playwright. Test behavior, not implementation.

**Grilling:** MSW can't test actual network failures (timeouts, 500s). How do you test error states?
> Answer: MSW supports this explicitly. You can return `HttpResponse.error()` for network failures, or `new HttpResponse(null, { status: 500 })` for server errors. You can also use `delay()` to simulate slow networks and test skeleton/loading states.

---

### i18n

**Q: How does your i18n strategy work at the architecture level?**
> We use `react-i18next` with JSON locale files per language (`en.json`, `hi.json`, `ar.json`). The language is set via URL prefix (`/en/search`, `/hi/search`) or `Accept-Language` header. Currency and date formatting use the browser-native `Intl` API — no library needed. For RTL, we add `dir="rtl"` to `<html>` and use Tailwind's `rtl:` variant for mirrored layouts. Locale files are loaded asynchronously (dynamic import) — only the user's language bundle is fetched.

**Grilling:** Locale files can get large as the app grows. How do you keep them manageable?
> Answer: Namespace splitting — separate JSON files per feature (`search.json`, `booking.json`, `common.json`). Load namespaces lazily when the route mounts. Only load `booking.json` when user enters the booking flow. Keeps initial bundle small and locale file maintenance organized.

---

*End of HLD — Hotel Booking Frontend System Design*