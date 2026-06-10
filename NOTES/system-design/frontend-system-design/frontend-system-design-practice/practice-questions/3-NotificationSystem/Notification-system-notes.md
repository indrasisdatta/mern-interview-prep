# Notification System — HLD

## Table of Contents

1. [Functional Requirements](#1-functional-requirements)
2. [Non-Functional Requirements](#2-non-functional-requirements)
3. [Component Design](#3-component-design)
4. [API Design](#4-api-design)
5. [Real-Time Notification Workflow](#5-real-time-notification-workflow)
6. [Performance Optimizations](#6-performance-optimizations)
7. [Error Handling & Reliability](#7-error-handling--reliability)
8. [Security](#8-security)
9. [Monitoring & Observability](#9-monitoring--observability)
10. [Deep Dive: SharedWorker](#10-deep-dive-sharedworker)
11. [Q&A — Clarifying Questions with Answers](#11-qa--clarifying-questions-with-answers)
12. [Additional Interview Questions](#12-additional-interview-questions)

---

## 1. Functional Requirements

| # | Requirement |
|---|-------------|
| 1 | Bell icon displays unread notification count badge |
| 2 | Clicking a notification: redirects to target URL, marks it as read, decrements badge count |
| 3 | Real-time updates: new notification prepended to list; badge incremented without page refresh |

---

## 2. Non-Functional Requirements

| Requirement | Target / Notes |
|-------------|----------------|
| **Responsive** | Works across mobile, tablet, desktop viewports |
| **Accessibility** | ARIA roles, keyboard navigation, screen-reader support |
| **Cross-tab sync** | All open browser tabs reflect same read/unread state |
| **Security** | Auth on WebSocket handshake, sanitized notification content |
| **Scalability** | Handles 10k+ concurrent WebSocket connections per server node |
| **Reliability** | Exponential back-off reconnect; polling fallback on WS failure |

---

## 3. Component Design

### Component Tree

```
<Notification />                        ← orchestrator: WS + data + sync
  ├── <NotificationBadge />             ← bell icon + count
  └── <NotificationList />              ← dropdown list of items
        └── <NotificationItem /> × N    ← individual row
```

### Component Interfaces

```tsx
// Orchestrator — owns all side-effects
const Notification = () => { ... }

// Purely presentational
interface NotificationBadgeProps {
  count: number;
  onClick: () => void;
  // Accessibility: aria-label="4 unread notifications"
}

interface NotificationListProps {
  notifications: Notification[];
  isLoading: boolean;
  hasNext: boolean;
  onItemClick: (id: string, url: string) => void;
  onLoadMore: () => void;
}

// Core domain model
interface Notification {
  id: string;        // ULID recommended — lexicographically sortable
  text: string;      // sanitised on server before storage
  avatar: string;    // CDN URL, webp/avif format
  url: string;       // internal relative path the click routes to
  isRead: boolean;
  createdAt: string; // ISO 8601
}

// WebSocket event envelope
interface WSNotificationEvent {
  type: 'NEW_NOTIFICATION' | 'MARK_READ' | 'MARK_ALL_READ';
  payload: Notification | { notificationId: string } | null;
}
```

### Accessibility Checklist

```tsx
// Bell button
<button
  aria-label={`${count} unread notifications`}
  aria-haspopup="listbox"
  aria-expanded={isOpen}
>
  <BellIcon />
  {count > 0 && <span aria-hidden="true">{count}</span>}
</button>

// List
<ul role="listbox" aria-label="Notifications">
  {notifications.map(n => (
    <li key={n.id} role="option" aria-selected={!n.isRead}>
      ...
    </li>
  ))}
</ul>
```

---

## 4. API Design

### GET /notifications

Fetches paginated notifications for the authenticated user.

```
GET /notifications?cursor=01HX3K...&limit=10
Authorization: Bearer <token>
```

**Response:**

```json
{
  "unreadCount": 12,
  "cursor": "01HX3K9MZQR4N5P7",
  "hasNext": true,
  "notifications": [
    {
      "id": "01HX3K9MZQR4N5P7",
      "text": "Alice commented on your post",
      "avatar": "https://cdn.example.com/avatars/alice.webp",
      "url": "/posts/42#comment-7",
      "isRead": false,
      "createdAt": "2025-06-09T08:00:00Z"
    }
  ]
}
```

> **Note:** `unreadCount` is returned on every paginated response so the FE badge
> stays consistent even after partial loads. The FE should not derive count by
> counting `isRead: false` in local state — the server is the source of truth.

---

### POST /notifications/read

Marks one or more notifications as read (batch support avoids chatty calls).

**Request:**

```json
{
  "notificationIds": ["01HX3K9MZQR4N5P7"],
  "isRead": true
}
```

**Response `200`:**

```json
{
  "notificationIds": ["01HX3K9MZQR4N5P7"],
  "unreadCount": 11
}
```

> FE applies an optimistic update immediately; rolls back if the response is non-2xx.
> The authoritative `unreadCount` in the response is used to correct any drift.

---

### POST /notifications/read-all

```json
{}
```

**Response `200`:**

```json
{ "unreadCount": 0 }
```

---

## 5. Real-Time Notification Workflow

### Architecture Diagram

```
Browser Tab 1          SharedWorker           Backend
    │                      │                     │
    │──── port.connect ────▶│                     │
    │                      │──── WSS handshake ──▶│
    │                      │◀─── JWT validated ───│
    │                      │                     │
    │  [New event fires]   │                     │
    │                      │◀── WS frame ─────────│ ← Kafka consumer pushes
    │◀── port.postMessage ─│                     │
    │  prepend + increment │                     │
    │  BroadcastChannel ──────────────────────────────▶ Tab 2, Tab 3
    │                      │                     │
    │  [User clicks item]  │                     │
    │──── optimistic UI    │                     │
    │──── POST /read ──────────────────────────────────▶ REST API
    │                      │                     │
    │  BroadcastChannel ──────────────────────────────▶ Tab 2, Tab 3
```

### Step-by-Step Flow

1. **Page load** — `<Notification />` instantiates a `SharedWorker`. The worker creates one WebSocket connection (shared across all same-origin tabs).
2. **Initial fetch** — REST call `GET /notifications?limit=10` populates the list and seeds `unreadCount`.
3. **Server-side push** — When an event triggers a new notification, the BE service publishes a message to Kafka. The WebSocket Gateway (a Node.js cluster or dedicated service) consumes from Kafka and pushes to connected clients via their open WS sessions.
4. **FE receives WS frame:**
   - Deduplicates via `seenIds` Set
   - Prepends to notification list
   - Increments `unreadCount`
   - Posts to `BroadcastChannel` to sync other tabs
5. **Mark as read (click):**
   - Optimistic UI update in current tab
   - `POST /notifications/read`
   - Broadcast `{ type: 'MARK_READ', notificationId }` via `BroadcastChannel`
   - Other tabs update their local state on receiving the broadcast

---

## 6. Performance Optimizations

### 6.1 React Query — Caching & Sync

```tsx
// hooks/useNotifications.ts
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const NOTIF_KEY = ['notifications'] as const;

// Paginated fetch with infinite scroll
export function useNotifications() {
  return useInfiniteQuery({
    queryKey: NOTIF_KEY,
    queryFn: ({ pageParam }) =>
      fetch(`/notifications?cursor=${pageParam ?? ''}&limit=10`).then(r => r.json()),
    getNextPageParam: page => (page.hasNext ? page.cursor : undefined),
    initialPageParam: undefined,
    staleTime: 30_000,           // treat cached data fresh for 30s
    refetchOnWindowFocus: true,  // background sync when user returns to tab
  });
}

// Optimistic mark-as-read mutation
export function useMarkAsRead() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) =>
      fetch('/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationIds: ids, isRead: true }),
      }).then(r => r.json()),

    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: NOTIF_KEY });
      const snapshot = qc.getQueryData(NOTIF_KEY);         // save for rollback

      qc.setQueryData(NOTIF_KEY, (old: any) => ({
        ...old,
        pages: old.pages.map((page: any) => ({
          ...page,
          notifications: page.notifications.map((n: Notification) =>
            ids.includes(n.id) ? { ...n, isRead: true } : n
          ),
        })),
      }));

      return { snapshot };
    },

    onError: (_err, _ids, ctx) => {
      // Roll back to snapshot
      qc.setQueryData(NOTIF_KEY, ctx?.snapshot);
    },

    onSuccess: (data) => {
      // Sync authoritative unread count from server
      qc.setQueryData(NOTIF_KEY, (old: any) => ({
        ...old,
        pages: [{ ...old.pages[0], unreadCount: data.unreadCount }, ...old.pages.slice(1)],
      }));
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: NOTIF_KEY });
    },
  });
}
```

---

### 6.2 Throttle Rapid WS Updates

```ts
// utils/throttle.ts
import { throttle } from 'lodash-es';

// Prevents hundreds of rapid WS events thrashing React state
export const throttledPrepend = throttle(
  (notification: Notification, dispatch: React.Dispatch<Action>) => {
    dispatch({ type: 'PREPEND', payload: notification });
  },
  300  // max one prepend per 300 ms; trailing call fires for the last burst item
);
```

---

### 6.3 Avatar Image Optimization

```tsx
<img
  src={notification.avatar}
  srcSet={`${notification.avatar}?w=40&fmt=webp 1x, ${notification.avatar}?w=80&fmt=webp 2x`}
  loading="lazy"
  decoding="async"
  width={40}
  height={40}
  alt=""              // decorative — screen reader reads notification text
/>
```

---

## 7. Error Handling & Reliability

### 7.1 Exponential Back-off WebSocket Reconnect

```ts
// workers/notification.worker.ts  (runs inside SharedWorker)

const BASE_DELAY = 1_000;   // 1 s
const MAX_DELAY  = 32_000;  // 32 s cap
const MAX_RETRIES = 12;

let ws: WebSocket | null = null;
let retryCount = 0;
let pollingTimer: ReturnType<typeof setInterval> | null = null;

function connect(url: string) {
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[WS] connected');
    retryCount = 0;
    if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    broadcast(data);   // forward to all ports
  };

  ws.onclose = (event) => {
    if (event.wasClean) return;  // intentional close, no retry
    scheduleReconnect(url);
  };

  ws.onerror = () => {
    // onclose fires after onerror; reconnect happens there
  };
}

function scheduleReconnect(url: string) {
  if (retryCount >= MAX_RETRIES) {
    console.warn('[WS] max retries reached — falling back to polling');
    startPollingFallback();
    return;
  }

  // Full jitter: random value in [0, min(cap, base * 2^attempt)]
  const ceiling = Math.min(MAX_DELAY, BASE_DELAY * Math.pow(2, retryCount));
  const delay   = Math.random() * ceiling;
  retryCount++;

  console.log(`[WS] reconnecting in ${Math.round(delay)}ms (attempt ${retryCount})`);
  setTimeout(() => connect(url), delay);
}

function startPollingFallback() {
  if (pollingTimer) return;
  pollingTimer = setInterval(async () => {
    try {
      const res = await fetch('/notifications?cursor=&limit=10');
      const data = await res.json();
      broadcast({ type: 'POLL_REFRESH', payload: data });
    } catch {
      // network still down; keep polling
    }
  }, 15_000);  // poll every 15 s as fallback
}
```

> **Jitter matters:** Without jitter, all clients that disconnected simultaneously
> (e.g. after a server deploy) retry at exactly the same exponential intervals,
> creating a thundering-herd of reconnections. Full jitter spreads them randomly.

---

### 7.2 Mark-as-Read Retry Queue

```ts
// If the POST /read call fails, queue it and retry on next interaction
// or when the WS connection comes back up.

interface RetryItem {
  notificationIds: string[];
  attempts: number;
}

const retryQueue: RetryItem[] = [];
const MAX_ATTEMPTS = 3;

async function markReadWithRetry(notificationIds: string[]) {
  try {
    await postMarkRead(notificationIds);
  } catch {
    retryQueue.push({ notificationIds, attempts: 0 });
  }
}

// Drain queue e.g. on WS reconnect or next user action
async function drainRetryQueue() {
  for (const item of [...retryQueue]) {
    if (item.attempts >= MAX_ATTEMPTS) {
      retryQueue.splice(retryQueue.indexOf(item), 1);
      showErrorToast('Some notifications could not be marked as read.');
      continue;
    }
    try {
      await postMarkRead(item.notificationIds);
      retryQueue.splice(retryQueue.indexOf(item), 1);
    } catch {
      item.attempts++;
    }
  }
}
```

---

## 8. Security

### 8.1 Authenticated WebSocket Handshake

Never pass tokens in the URL query string — they appear in server logs and browser history.

```ts
// Preferred: pass token via Sec-WebSocket-Protocol header trick
// (the only custom header allowed during the HTTP→WS upgrade)
const ws = new WebSocket('wss://api.example.com/notifications', [
  'v1.notifications',
  `access_token.${getAccessToken()}`,  // server strips this sub-protocol value as the token
]);

// On the server (Node.js / ws library):
wss.on('upgrade', (req, socket, head) => {
  const protocols = req.headers['sec-websocket-protocol']?.split(', ') ?? [];
  const tokenEntry = protocols.find(p => p.startsWith('access_token.'));
  const token = tokenEntry?.replace('access_token.', '');
  if (!verifyJWT(token)) { socket.destroy(); return; }
  // proceed with upgrade
});
```

### 8.2 Content Sanitisation

Notification `text` must be sanitised server-side before storage. Never trust client-supplied content rendered with `dangerouslySetInnerHTML`.

```ts
// server-side (Node.js)
import DOMPurify from 'isomorphic-dompurify';
const safeText = DOMPurify.sanitize(rawText, { ALLOWED_TAGS: [] }); // strip all HTML
```

### 8.3 URL Validation

Only allow internal relative paths in `notification.url` to prevent open-redirect attacks.

```ts
function isSafeUrl(url: string): boolean {
  // Allow only relative paths — reject anything with a protocol or authority
  return /^\/[^/]/.test(url);
}

// On click
if (isSafeUrl(notification.url)) {
  router.push(notification.url);
}
```

---

## 9. Monitoring & Observability

| Signal | Tool | What to Track |
|--------|------|---------------|
| WS errors | Sentry | `onclose` codes, `onerror` events; tag with `retryCount` |
| WS latency | Datadog | Time from server publish → client receipt (add `serverTs` to WS frame) |
| Polling fallback activations | Datadog custom metric | `notification.ws.fallback_activated` counter |
| Mark-read API errors | Sentry | Failed POST `/read` calls + retry exhaustion |
| Unread count drift | Custom assertion | Alert if `localCount` differs from server `unreadCount` by > 0 after sync |

```ts
// Measure end-to-end WS delivery latency
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  const latencyMs = Date.now() - new Date(data.serverTs).getTime();
  datadogRum.addTiming('notification_delivery_latency', latencyMs);
};
```

---

## 10. Deep Dive: SharedWorker

A `SharedWorker` is a browser primitive that runs in a background thread shared across all tabs/windows of the same origin. Unlike a `ServiceWorker` (which intercepts fetches and has its own lifecycle), a `SharedWorker` lives only while at least one tab is connected.

### Why SharedWorker over one WS per tab?

| | Per-tab WebSocket | SharedWorker + 1 WS |
|---|---|---|
| Connections to server | N per user | 1 per user |
| Duplicate events | Yes (each tab gets its own copy) | No |
| Cross-tab consistency | Manual BroadcastChannel needed | Built-in via port messaging |
| Backend socket pressure | High (10 tabs = 10 connections) | Low (10 tabs = 1 connection) |

### Complete Implementation

```ts
// public/notification.worker.ts  — runs in SharedWorker context

interface Port extends MessagePort {}

const ports = new Set<Port>();
let ws: WebSocket | null = null;
let wsUrl = '';

function connectWS() {
  ws = new WebSocket(wsUrl);

  ws.onopen = () => broadcast({ type: 'WS_STATUS', status: 'connected' });

  ws.onmessage = (e) => broadcast(JSON.parse(e.data));

  ws.onclose = () => {
    broadcast({ type: 'WS_STATUS', status: 'disconnected' });
    scheduleReconnect(wsUrl);
  };
}

function broadcast(data: unknown) {
  ports.forEach(port => port.postMessage(data));
}

// Entry point for each new tab
self.onconnect = (connectEvent: MessageEvent) => {
  const port: Port = connectEvent.ports[0];
  ports.add(port);

  port.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data;

    if (type === 'INIT') {
      wsUrl = payload.wsUrl;
      if (!ws || ws.readyState === WebSocket.CLOSED) connectWS();
      return;
    }

    if (type === 'MARK_READ') {
      // Relay "mark read" from one tab to all others
      ports.forEach(p => { if (p !== port) p.postMessage(e.data); });
    }
  };

  port.addEventListener('close', () => {
    ports.delete(port);
    // Tear down WS when no tabs remain
    if (ports.size === 0 && ws) { ws.close(); ws = null; }
  });

  port.start();
};
```

```tsx
// hooks/useSharedWorker.ts  — runs in the main thread

export function useSharedWorker(wsUrl: string) {
  const workerRef = useRef<SharedWorker | null>(null);

  useEffect(() => {
    const worker = new SharedWorker('/notification.worker.js');
    workerRef.current = worker;

    // Announce this tab to the worker
    worker.port.postMessage({ type: 'INIT', payload: { wsUrl } });

    worker.port.onmessage = (e: MessageEvent<WSNotificationEvent>) => {
      handleIncomingEvent(e.data);   // dispatch to React state / React Query cache
    };

    worker.port.start();

    return () => worker.port.close();  // tab unmounts → port removed in worker
  }, [wsUrl]);

  return workerRef;
}
```

### SharedWorker Lifecycle — Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| User opens a second tab | `self.onconnect` fires; new port added; WS already running |
| User closes the last tab | `port close` fires; `ports.size === 0`; WS closed gracefully |
| Tab crashes | Port is removed; other tabs continue unaffected |
| Browser navigates (same origin) | Worker stays alive; port reconnects on new page load |
| Cross-origin iframe | SharedWorker is scoped to origin — iframes on different origins cannot connect |

---

## 11. Q&A — Clarifying Questions with Answers

---

### Q1. How do you implement exponential back-off in a WebSocket connection?

**Algorithm: Full Jitter**

```
delay = random(0, min(MAX_DELAY, BASE * 2^attempt))
```

Full jitter is preferred over pure exponential because it avoids the thundering-herd problem — all disconnected clients reconnecting at the exact same moment after a server restart.

```ts
// See Section 7.1 for the complete implementation.
// Key points:
// 1. Reset retryCount to 0 on successful ws.onopen
// 2. Skip retry if event.wasClean === true (deliberate logout/close)
// 3. After MAX_RETRIES, activate polling fallback
// 4. Drain retry queue and attempt WS reconnect on next user interaction (visibilitychange)
```

**Real-world scenario:** A deploy restarts your WS server. 5,000 clients disconnect simultaneously. Without jitter, all 5,000 retry in 1 s, 2 s, 4 s… in lockstep, spiking your server. With full jitter, reconnections are spread uniformly across the window — your server sees a smooth ramp-up.

---

### Q2. How do you avoid duplicate notifications?

**Three layers of deduplication:**

```ts
// Layer 1: In-memory Set in the SharedWorker (fast, per-session)
const seenIds = new Set<string>();

ws.onmessage = (e) => {
  const notification: Notification = JSON.parse(e.data).payload;
  if (seenIds.has(notification.id)) return; // drop duplicate
  seenIds.add(notification.id);
  broadcast({ type: 'NEW_NOTIFICATION', payload: notification });
};

// Layer 2: React state guard (defensive, for BroadcastChannel path)
dispatch({ type: 'PREPEND', payload: notification });
// In reducer:
case 'PREPEND':
  if (state.ids.has(action.payload.id)) return state; // already present
  return {
    ids: new Set([...state.ids, action.payload.id]),
    items: [action.payload, ...state.items],
  };

// Layer 3: Server-side idempotency key on Kafka messages
// Each notification event has a unique eventId; Kafka consumer deduplicates
// within its processing window using a Redis SET with TTL.
```

**Real-world scenario:** A user has 3 tabs open. Tab 1 receives the WS event and broadcasts via `BroadcastChannel`. If Tab 2 also directly receives the WS event (because SharedWorker wasn't used, or during failover), the `seenIds` Set in Layer 2 prevents a second prepend.

---

### Q3. How do you avoid stale data when caching notifications?

**Strategy: Invalidate on WS event, not on a timer.**

```ts
// In the WS message handler
worker.port.onmessage = (e: MessageEvent<WSNotificationEvent>) => {
  if (e.data.type === 'NEW_NOTIFICATION') {
    // Option A (preferred): update cache directly, no network round-trip
    queryClient.setQueryData(NOTIF_KEY, (old) => ({
      ...old,
      pages: [
        {
          ...old.pages[0],
          notifications: [e.data.payload, ...old.pages[0].notifications],
          unreadCount: old.pages[0].unreadCount + 1,
        },
        ...old.pages.slice(1),
      ],
    }));

    // Option B: invalidate and let React Query refetch in background
    queryClient.invalidateQueries({ queryKey: NOTIF_KEY });
  }
};

// Always refetch on window focus to catch events missed while the tab was hidden
useQuery({ ..., refetchOnWindowFocus: true });
```

**`staleTime` guidance:**

| Data | Recommended staleTime |
|------|----------------------|
| Notification list | 30 s (WS keeps it fresh in real-time) |
| Unread count | 0 (always refetch; counts are critical to be accurate) |
| User profile in avatar | 5 min |

---

### Q4. Why use cursor-based pagination instead of offset?

**The offset problem:**

```sql
-- Offset: vulnerable to "index shift" when new rows are inserted
SELECT * FROM notifications
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT 10 OFFSET 20;

-- If 3 new notifications arrive while the user is on page 1,
-- the next "page 2" query skips 3 items the user never saw.
```

**Cursor solution:**

```sql
-- Cursor: anchored to last-seen item — inserts above don't shift results
SELECT * FROM notifications
WHERE user_id = $1
  AND created_at < $cursor_ts  -- or id < $cursor_id if using ULIDs
ORDER BY created_at DESC
LIMIT 10;
```

```ts
// React Query infinite scroll
const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
  queryKey: NOTIF_KEY,
  queryFn: ({ pageParam }) =>
    fetch(`/notifications?cursor=${pageParam ?? ''}&limit=10`).then(r => r.json()),
  getNextPageParam: page => page.hasNext ? page.cursor : undefined,
  initialPageParam: undefined,
});

// "Load More" trigger
<button
  onClick={() => fetchNextPage()}
  disabled={!hasNextPage || isFetchingNextPage}
>
  {isFetchingNextPage ? 'Loading…' : 'Load More'}
</button>
```

**Why ULID over UUID as cursor?**

ULIDs (`01HX3K9MZQR4N5P7`) are 128-bit, lexicographically sortable, and monotonically increasing within the same millisecond. Using the ULID as both the `id` and the cursor value means:

- No separate `created_at` index needed for cursor comparison
- No tie-breaking logic for same-millisecond records
- Consistent ordering even across distributed nodes

---

### Q5. What if the mark-as-read API fails?

**Three-layer resilience:**

```ts
// 1. Optimistic update (UX feels instant)
onMutate: async (ids) => {
  const snapshot = queryClient.getQueryData(NOTIF_KEY);
  applyOptimisticRead(ids);         // update cache immediately
  return { snapshot };
},

// 2. Rollback on error (correct the UI)
onError: (_err, _ids, ctx) => {
  queryClient.setQueryData(NOTIF_KEY, ctx.snapshot);
  toast.error('Failed to mark as read — will retry');
},

// 3. Persistent retry queue (survive page refreshes via sessionStorage)
onError: (_err, ids) => {
  const queue = JSON.parse(sessionStorage.getItem('readRetryQueue') || '[]');
  sessionStorage.setItem('readRetryQueue', JSON.stringify([...queue, { ids, attempts: 0 }]));
},
```

**Drain on page visibility change:**

```ts
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') drainRetryQueue();
});
```

**Real-world scenario:** User is on a flaky mobile connection. They mark 5 notifications as read while briefly offline. The queue persists in `sessionStorage`. When connectivity resumes (tab becomes visible), the queue drains silently. The user sees no badge inconsistency.

---

### Q6. How do you ensure correct ordering of notifications?

**Problem:** Real-time WS events arrive out-of-order, especially under load or across microservices.

**Solution stack:**

```ts
// 1. Use ULID IDs: naturally ordered by creation time
// 2. Server-side: ORDER BY id DESC (ULID sorts chronologically)
// 3. FE: trust server order for initial load; prepend WS events at top

// 4. For concurrent events arriving out of order on the FE:
function insertSorted(notifications: Notification[], incoming: Notification): Notification[] {
  const idx = notifications.findIndex(n => n.createdAt < incoming.createdAt);
  if (idx === -1) return [...notifications, incoming];  // oldest: append
  return [
    ...notifications.slice(0, idx),
    incoming,
    ...notifications.slice(idx),
  ];
}
```

**Advanced: vector clocks for distributed ordering**

In a multi-region setup, two notification services may emit events with the same millisecond timestamp. The WS Gateway should attach a Kafka partition offset or a logical sequence number so the FE can order definitively:

```json
{
  "type": "NEW_NOTIFICATION",
  "seq": 1042,
  "payload": { ... }
}
```

The FE maintains `lastSeq` and discards any event with `seq <= lastSeq` (duplicate or out-of-order).

---

### Q7. How do you test WebSocket UI?

**Unit test — Mock WebSocket:**

```ts
// test/mocks/MockWebSocket.ts
export class MockWebSocket {
  static instances: MockWebSocket[] = [];
  readyState = 1; // OPEN
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {}
  close() { this.onclose?.(); }

  // Test helper — simulate server push
  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

global.WebSocket = MockWebSocket as unknown as typeof WebSocket;
```

```tsx
// __tests__/Notification.test.tsx
it('increments badge when a new notification arrives via WS', async () => {
  render(<Notification />);
  const ws = MockWebSocket.instances[0];

  act(() => {
    ws.simulateMessage({
      type: 'NEW_NOTIFICATION',
      payload: { id: 'abc', text: 'Alice liked your post', isRead: false, ... },
    });
  });

  expect(await screen.findByLabelText(/1 unread/i)).toBeInTheDocument();
});

it('falls back to polling after WS disconnects', async () => {
  jest.useFakeTimers();
  render(<Notification />);
  const ws = MockWebSocket.instances[0];

  act(() => ws.close());

  // Simulate MAX_RETRIES exhaustion
  jest.advanceTimersByTime(60_000);

  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/notifications'));
});
```

**E2E test — Playwright with WS interception:**

```ts
// e2e/notification.spec.ts
test('real-time notification appears without page refresh', async ({ page, context }) => {
  // Intercept and mock WS
  await page.routeWebSocket('wss://**/notifications', ws => {
    ws.onopen(() => {
      // Simulate server pushing a notification after 1s
      setTimeout(() => ws.send(JSON.stringify({
        type: 'NEW_NOTIFICATION',
        payload: { id: '1', text: 'Test notification', isRead: false },
      })), 1000);
    });
  });

  await page.goto('/dashboard');
  await expect(page.getByLabel('1 unread notification')).toBeVisible();
});
```

---

### Q8. How do you handle rate limiting?

**Two layers: FE throttle + BE rate limiter.**

```ts
// FE: Throttle UI updates for burst events (e.g., 50 events/s during load test)
import { throttle } from 'lodash-es';

const handleWsEvent = throttle((event: WSNotificationEvent) => {
  dispatch({ type: 'PREPEND', payload: event.payload });
}, 200, { leading: true, trailing: true });
// leading: apply first event immediately
// trailing: apply last event in the throttle window (no events dropped, just batched)
```

```ts
// BE: Token bucket on the WebSocket Gateway (per user)
// Express-rate-limit equivalent for WS frames:

const userBuckets = new Map<string, { tokens: number; lastRefill: number }>();

function consumeToken(userId: string): boolean {
  const RATE = 10;       // 10 events/s allowed
  const BURST = 20;      // burst up to 20
  const now = Date.now();
  const bucket = userBuckets.get(userId) ?? { tokens: BURST, lastRefill: now };

  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(BURST, bucket.tokens + elapsed * RATE);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) return false; // rate limited
  bucket.tokens -= 1;
  userBuckets.set(userId, bucket);
  return true;
}
```

**Real-world scenario:** A spam bot triggers 500 notification events per second for a user. The token bucket drops excess events server-side. The FE throttle absorbs any burst that slips through, preventing React from re-rendering 500 times per second.

### Q9. How does SharedWorker handle the case when all tabs close simultaneously and a new tab opens later?

When the last port disconnects, the SharedWorker closes the WebSocket. When a new tab opens, `self.onconnect` fires again, the port sends `INIT`, and `connectWS()` is called fresh — a clean restart with no residual state.

**The subtle issue:** `seenIds` Set is lost when the worker terminates. This is acceptable because on reconnect, the FE re-fetches the full notification list via REST; WS events from that point are new and legitimately unseen.

---

### Q10. How would you implement "Mark All as Read"?

```ts
// FE: single POST, then update entire cache
const markAllRead = async () => {
  // Optimistic update
  queryClient.setQueryData(NOTIF_KEY, (old) => ({
    ...old,
    pages: old.pages.map(page => ({
      ...page,
      unreadCount: 0,
      notifications: page.notifications.map(n => ({ ...n, isRead: true })),
    })),
  }));

  try {
    await fetch('/notifications/read-all', { method: 'POST' });
    // Broadcast to other tabs
    channel.postMessage({ type: 'MARK_ALL_READ' });
  } catch {
    queryClient.invalidateQueries({ queryKey: NOTIF_KEY }); // revert via refetch
  }
};

// BE: single UPDATE query — do NOT update row-by-row (N+1 problem)
// UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false;
```

---

### Q11. What happens to notifications when the user is offline (PWA / Service Worker)?

```ts
// service-worker.ts: cache the last known notification state in IndexedDB
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/notifications')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Clone and cache
          const clone = res.clone();
          caches.open('notifications-v1').then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request)) // serve stale on offline
    );
  }
});

// On reconnect (navigator.onLine event), invalidate React Query cache
window.addEventListener('online', () => {
  queryClient.invalidateQueries({ queryKey: NOTIF_KEY });
});
```

---

### Q12. How do you scale WebSocket servers horizontally?

**The problem:** WS connections are stateful and sticky to a server instance. If you have 3 WS server nodes and user A is on Node 1, a notification generated on Node 2 won't reach user A.

**Solution: Redis Pub/Sub as a cross-node broadcast bus.**

```
Notification Service → Kafka → WS Gateway Node 1 ┐
                                WS Gateway Node 2 ┤ → each subscribes to Redis channel `user:{userId}`
                                WS Gateway Node 3 ┘

When a notification arrives for user A:
1. Any node that processes the Kafka event publishes to Redis channel `user:A`
2. All WS Gateway nodes subscribed to `user:A` receive it
3. Only the node that has user A's WS connection pushes to that socket
```

```ts
// WS Gateway (simplified)
import { createClient } from 'redis';

const sub = createClient(); await sub.connect();
const pub = createClient(); await pub.connect();

// On new WS connection for userId
await sub.subscribe(`user:${userId}`, (message) => {
  const notification = JSON.parse(message);
  userSocket.send(JSON.stringify(notification)); // push to this user's WS
});

// On notification event from Kafka
await pub.publish(`user:${userId}`, JSON.stringify(notification));
```

---

### Q13. How would you implement notification preferences (Do Not Disturb, category filters)?

```ts
// Preferences model
interface NotificationPreferences {
  userId: string;
  dnd: { enabled: boolean; from: string; until: string }; // "22:00" - "08:00"
  mutedCategories: ('comments' | 'likes' | 'mentions' | 'system')[];
  deliveryChannels: { inApp: boolean; email: boolean; push: boolean };
}

// Server-side: filter before publishing to Kafka
async function shouldDeliver(userId: string, notification: RawNotification): Promise<boolean> {
  const prefs = await getPreferences(userId);
  if (prefs.mutedCategories.includes(notification.category)) return false;
  if (prefs.dnd.enabled && isInDndWindow(prefs.dnd)) return false;
  return true;
}
```

---

### Q14. How do you prevent a malicious actor from reading another user's notifications via the WebSocket connection?

```
1. JWT validation on WS handshake upgrade (see Section 8.1)
2. userId extracted from JWT on the server — never trusted from the client
3. Redis Pub/Sub channels keyed by userId (server-assigned, not client-declared)
4. Message payload never includes other users' data
5. Audit log: log all WS connections with userId, IP, timestamp to detect anomalies
6. Rate-limit connection attempts per IP to prevent credential-stuffing on the WS endpoint
```

---

### Q15. How would you handle notification ordering across multiple Kafka partitions?

**Problem:** Kafka guarantees ordering only within a partition. If user A's notifications are spread across partitions 0, 1, 2, events may arrive out of order.

**Solution:** Partition by `userId` — all notifications for the same user always land in the same partition, preserving order.

```ts
// Kafka producer
producer.send({
  topic: 'notifications',
  messages: [{
    key: userId,           // ← partition key: userId → same partition
    value: JSON.stringify(notification),
  }],
});
```

The FE still attaches a monotonic `seq` number (Kafka offset) to each event as a second-order guard against network reordering between the Kafka consumer and the WS push.

# SharedWorker vs BroadcastChannel — Deep Dive
> Notification System | Staff / Principal Interview Prep

---

## TL;DR

| Sync Scope | Mechanism |
|---|---|
| Multiple tabs / windows — **same browser** | SharedWorker (ports) |
| Multiple tabs — **SharedWorker unavailable** | BroadcastChannel (fallback) |
| Different browsers on same device | WebSocket |
| Different devices | WebSocket |

**Your instinct is correct:** SharedWorker's port system already broadcasts to all tabs.
BroadcastChannel is **not required** when SharedWorker is running — but it becomes the
fallback when SharedWorker is unavailable or crashes.

---

## 1. SharedWorker — Pros & Cons

### How It Works (Recap)

```
Tab 1 ──port──┐
Tab 2 ──port──┤  SharedWorker  ──── single WebSocket ──── Server
Tab 3 ──port──┘
```

The worker holds **one** WebSocket. Every connected tab communicates via its
own `MessagePort`. The worker relays events to all ports — effectively
broadcasting without BroadcastChannel.

---

### Pros

**1. One WebSocket connection per browser, regardless of tab count.**

Without SharedWorker, 10 open tabs = 10 WebSocket connections for the same user.
At scale (1M users, avg 3 tabs) that's 3M connections vs 1M. SharedWorker
reduces backend socket pressure by the average number of tabs per user.

```
Without SharedWorker:
  User A: Tab 1 → WS conn 1
          Tab 2 → WS conn 2
          Tab 3 → WS conn 3   ← 3 connections, 3× Redis Pub/Sub fan-out

With SharedWorker:
  User A: SharedWorker → WS conn 1  ← 1 connection, 1× Redis fan-out
          Ports to Tab 1, 2, 3 are free in-process message channels
```

**2. Zero duplicate events.**

Each WS event is received once by the worker and forwarded to all ports.
With per-tab WebSockets, each tab receives its own copy — requiring deduplication
logic everywhere.

**3. Centralised reconnect logic.**

Exponential back-off, polling fallback, and retry queue live in one place.
Tabs are pure consumers of the worker's state — they cannot individually
create conflicting reconnect races.

**4. Shared in-memory state.**

The worker can maintain a `seenIds` Set across all tabs. No tab can process
a duplicate even if BroadcastChannel or port messaging overlaps.

```ts
// worker — single source of truth for deduplication
const seenIds = new Set<string>();

ws.onmessage = (e) => {
  const { id } = JSON.parse(e.data).payload;
  if (seenIds.has(id)) return;   // tab 2 can never accidentally re-process this
  seenIds.add(id);
  broadcast(JSON.parse(e.data));
};
```

**5. Tabs get caught up on connect.**

A tab opened after a WS event fires can request the latest snapshot from
the worker directly — no need for a fresh REST call.

```ts
// New tab connects → ask worker for current state
port.postMessage({ type: 'GET_SNAPSHOT' });

// Worker responds with buffered notifications
port.onmessage = ({ data }) => {
  if (data.type === 'SNAPSHOT') hydrateUI(data.payload);
};
```

---

### Cons

**1. Browser support gap — especially Safari.**

SharedWorker was absent from Safari until **Safari 16 (Sept 2022)**. Any user on
Safari 15 or older gets nothing. You must detect support and fall back.

```ts
function createNotificationConnection(wsUrl: string) {
  if (typeof SharedWorker !== 'undefined') {
    return new SharedWorker('/notification.worker.js');
  }
  // Fallback: dedicated worker + BroadcastChannel
  return new Worker('/notification.dedicated.worker.js');
}
```

**2. Unavailable in certain execution contexts.**

SharedWorker cannot be instantiated inside:
- A Service Worker
- A `<iframe>` with `sandbox` attribute
- Some browser extensions

**3. Single point of failure.**

If the SharedWorker crashes (unhandled exception, OOM), all tabs
simultaneously lose their WebSocket connection. A per-tab WS would be more
resilient — one tab crashing doesn't affect others.

```ts
// Mitigation: health-check from each tab; re-spawn if unresponsive
const HEARTBEAT_INTERVAL = 5000;

setInterval(() => {
  const timeout = setTimeout(() => {
    console.warn('SharedWorker unresponsive — respawning');
    respawnWorker();
  }, 2000);

  worker.port.postMessage({ type: 'PING' });
  worker.port.onmessage = ({ data }) => {
    if (data.type === 'PONG') clearTimeout(timeout);
  };
}, HEARTBEAT_INTERVAL);
```

**4. Harder to debug.**

SharedWorker has its own DevTools context (chrome://inspect/#workers). You
cannot inspect it from the regular tab's DevTools. This adds friction during
development and production incident triage.

**5. No DOM access / no localStorage.**

The worker cannot read cookies, localStorage, or access the DOM. Auth tokens
must be passed explicitly from the main thread on every `INIT` message.

```ts
// Tab must pass auth token explicitly — worker cannot read it
worker.port.postMessage({
  type: 'INIT',
  payload: {
    wsUrl: 'wss://api.example.com/notifications',
    token: getAccessToken(),   // worker cannot fetch this itself
  },
});
```

**6. Worker lifetime is tied to tab count — not the page lifecycle.**

SharedWorker terminates when the last port disconnects. If a user closes all
tabs and reopens one, the worker cold-starts — there is no background
persistence like a Service Worker provides.

---

## 2. Do We Still Need BroadcastChannel?

### The Overlap

```
SharedWorker port system:
  Tab 1 ──postMessage──▶ Worker ──postMessage──▶ Tab 2 ✅

BroadcastChannel:
  Tab 1 ──postMessage──▶ [channel] ──postMessage──▶ Tab 2 ✅
```

Both achieve the same result. When SharedWorker is running, **you do not
need BroadcastChannel** for cross-tab sync. The worker's port relay is the
broadcast mechanism.

---

### When BroadcastChannel is Still Valuable

#### As a Fallback for Unsupported Browsers

```ts
// Progressive enhancement pattern
class NotificationSync {
  private worker: SharedWorker | null = null;
  private channel: BroadcastChannel | null = null;

  init(wsUrl: string) {
    if (typeof SharedWorker !== 'undefined') {
      this.worker = new SharedWorker('/notification.worker.js');
      this.worker.port.postMessage({ type: 'INIT', payload: { wsUrl } });
      this.worker.port.onmessage = (e) => this.handleEvent(e.data);
      this.worker.port.start();
    } else {
      // Fallback: each tab manages its own WS + BroadcastChannel for sync
      this.initDirectWebSocket(wsUrl);
      this.channel = new BroadcastChannel('notifications');
      this.channel.onmessage = (e) => this.handleEvent(e.data);
    }
  }

  broadcast(event: WSNotificationEvent) {
    // Only used in fallback path — SharedWorker handles this otherwise
    this.channel?.postMessage(event);
  }
}
```

#### For Tab-Originated Events (Mark as Read)

This is the subtle case. When the user clicks a notification in **Tab 1**:

```
Tab 1 marks as read
  → optimistic UI update in Tab 1 ✅
  → POST /notifications/read ✅
  → Other tabs need to update too
```

With SharedWorker, Tab 1 sends a `MARK_READ` message to the worker, which
relays it to all other ports. This works fine.

But if you're in the **fallback path** (no SharedWorker), each tab has its
own WS. Tab 1's mark-read action is purely a REST call — the server doesn't
push a WS event back to other tabs for this (it would if you explicitly
implemented it, but it's extra backend work). In this scenario,
BroadcastChannel is what keeps the other tabs in sync locally.

```ts
// Fallback path: Tab 1 broadcasts mark-read via BroadcastChannel
async function markAsRead(notificationId: string) {
  applyOptimisticUpdate(notificationId);   // update Tab 1 UI
  await postMarkRead(notificationId);      // REST call

  // BroadcastChannel tells other tabs (no SharedWorker available)
  channel.postMessage({ type: 'MARK_READ', notificationId });
}

// Other tabs
channel.onmessage = ({ data }) => {
  if (data.type === 'MARK_READ') applyOptimisticUpdate(data.notificationId);
};
```

---

### Decision Matrix

```
SharedWorker available?
├── YES
│    └── Worker ports handle all tab-to-tab sync
│        BroadcastChannel: NOT needed
│
└── NO (Safari ≤ 15, sandboxed iframe, etc.)
     └── Each tab creates its own WebSocket
         BroadcastChannel: REQUIRED for cross-tab sync
```

---

## 3. The Complete Sync Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│                    Same Browser Instance                 │
│                                                         │
│   Tab 1 ──┐                                             │
│   Tab 2 ──┤── SharedWorker ──── WebSocket ──── Server  │
│   Tab 3 ──┘    (1 connection)                           │
│                                                         │
│   If SharedWorker unavailable:                          │
│   Tab 1 ──WS──┐                                         │
│   Tab 2 ──WS──┤── BroadcastChannel (tab sync)           │
│   Tab 3 ──WS──┘                                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   Cross-Device / Cross-Browser           │
│                                                         │
│   Chrome (Device A) ──WS──┐                             │
│   Firefox (Device A) ──WS─┤── Server (Redis + Kafka)    │
│   Safari (Device B) ──WS──┘                             │
│                                                         │
│   Each browser instance has its own SharedWorker.       │
│   Cross-instance sync only possible via WebSocket.      │
└─────────────────────────────────────────────────────────┘
```

> **Key insight for interviews:** SharedWorker is scoped to a browser **instance**,
> not a device. Two browsers on the same machine (Chrome + Firefox) each have
> their own SharedWorker and must sync via WebSocket, exactly like two separate
> devices would.

---

## 4. SharedWorker vs BroadcastChannel — Side-by-Side

| Dimension | SharedWorker | BroadcastChannel |
|---|---|---|
| **Primary role** | Manage shared WS connection | Sync state across tabs |
| **Scope** | Same origin, same browser instance | Same origin, same browser instance |
| **Browser support** | Chrome ✅ Firefox ✅ Safari 16+ ✅ | Chrome ✅ Firefox ✅ Safari 15.4+ ✅ |
| **Holds WebSocket** | ✅ Yes — that's the point | ❌ No — messaging only |
| **Persistence** | Lives while ≥ 1 port connected | Stateless — no memory |
| **Deduplication** | ✅ Centralised `seenIds` in worker | ❌ Each tab must deduplicate |
| **Debugging** | Hard (separate DevTools context) | Easy (inspectable in tab) |
| **Fallback path** | Fall back to BroadcastChannel | No further fallback needed |
| **Single point of failure** | Yes — worker crash kills all tabs | No — tabs are independent |

---

## 5. Interview-Ready Summary

**"Do you still need BroadcastChannel if you use SharedWorker?"**

> No — not for the primary path. SharedWorker's port relay replaces
> BroadcastChannel entirely for cross-tab sync. You include BroadcastChannel
> purely as a fallback for browsers that don't support SharedWorker, and to handle
> tab-originated events (like mark-as-read) in that fallback path. In production,
> I'd feature-detect SharedWorker on init and only wire up BroadcastChannel if
> SharedWorker is unavailable — progressive enhancement, not belt-and-suspenders.

**"What about different windows vs different tabs?"**

> SharedWorker covers both — same-origin windows and tabs within the same
> browser instance share the worker. The WebSocket boundary is the browser
> instance, not the tab. Two different browsers on the same machine, or any
> two separate devices, can only sync via the server-side WebSocket.

**"What's the biggest risk of SharedWorker?"**

> Single point of failure. One unhandled exception crashes the worker and
> silently severs all tab connections simultaneously. The mitigation is a
> per-tab heartbeat that detects an unresponsive worker and respawns it, plus
> a clean fallback path that activates automatically.

# WebSocket at Scale — Multi-Pod K8s + Broker Comparison
> Staff / Principal Interview Prep | Distributed Systems

---

## Table of Contents

1. [The Core Problem](#1-the-core-problem)
2. [Why Sticky Sessions Fall Short](#2-why-sticky-sessions-fall-short)
3. [The Correct Pattern — Centralised Routing](#3-the-correct-pattern--centralised-routing)
4. [Redis Pub/Sub vs Kafka vs AWS SNS/SQS](#4-redis-pubsub-vs-kafka-vs-aws-snssqs)
5. [Complete Architecture](#5-complete-architecture)
6. [Interview-Ready Summary](#6-interview-ready-summary)

---

## 1. The Core Problem

WebSocket connections are **stateful and in-process**. Each pod holds its own
connection registry — a plain `Map<userId, WebSocket>` in memory. There is no
shared memory between pods.

```
Pod A memory:  { "user-alice": <socket>, "user-bob": <socket> }
Pod B memory:  { "user-carol": <socket>, "user-dave": <socket> }
Pod C memory:  { "user-eve": <socket> }
```

Now a `Notification Service` wants to send a notification to **user-carol**.

```
Notification Service
        │
        ▼
  WS Gateway Pod A   ← Processes the event
        │
        └── connectedSockets.get("user-carol")  →  undefined ❌
```

Pod A received the event but user-carol is on Pod B. The notification is
silently dropped. **This is the core problem.**

---

## 2. Why Sticky Sessions Fall Short

### What Sticky Sessions Do

A load balancer with session affinity (sticky sessions) routes all requests
from the same client to the same pod, based on a cookie or client IP.

```
Load Balancer (Nginx / AWS ALB)
  │
  ├── user-alice (cookie: pod=A) ──────▶  Pod A
  ├── user-carol (cookie: pod=B) ──────▶  Pod B
  └── user-eve   (cookie: pod=C) ──────▶  Pod C
```

### Where They Help

Sticky sessions solve the problem when the **same user generates their own
events** — e.g., a chat where user-alice's messages should bounce back to
user-alice. All of alice's traffic routes to Pod A, which always has her
socket.

### Where They Break — 4 Failure Modes

**Failure Mode 1: Cross-user delivery (your exact scenario)**

```
user-alice (Pod A) sends a message → user-carol (Pod B)
Pod A: connectedSockets.get("user-carol") → undefined ❌
```

Sticky sessions guarantee the *sender* stays on one pod. They say nothing
about where the *recipient* is. In a notification system, the sender is a
backend microservice — it has no sticky session at all.

**Failure Mode 2: Pod failure breaks all connections on that pod**

```
Pod B crashes
  → user-carol, user-dave lose their WebSocket connections
  → Must reconnect — land on Pod A or C randomly
  → Cookie still points to Pod B (now dead)
  → Load balancer must detect failure and re-route
  → Gap in connectivity during detection window (~30s in K8s)
```

With a central routing layer (Redis), pod failure is transparent — the
notification waits in the broker and is delivered when the client reconnects
to any pod.

**Failure Mode 3: K8s rolling deployments break affinity**

```
Deploy v2:
  Pod B (v1) gracefully terminates
  Pod B-new (v2) starts with a NEW pod IP
  Load balancer cookie still references the old Pod B IP → broken
  All of Pod B's users get a 502 until they reconnect
```

**Failure Mode 4: Uneven load distribution**

Sticky sessions by IP are skewed by NAT. An office of 500 employees behind
one corporate NAT IP means all 500 land on the same pod. That pod is
overloaded; others are idle. Standard round-robin would distribute them.

### Verdict on Sticky Sessions

> Use sticky sessions only as a **short-term band-aid** on a monolith that
> you cannot yet refactor. For any system designed at scale, they push the
> problem around rather than solve it. The correct solution is a central
> routing layer.

---

## 3. The Correct Pattern — Centralised Routing

### Core Idea

Every pod subscribes to a shared message channel. When a notification for
`user-carol` is published, **all pods receive it**, but only the pod that
actually holds `user-carol`'s socket delivers it. All others discard.

```
Notification Service
        │
        ▼
   [ Kafka ]                         ← durable, ordered event log
        │
        ▼
  All WS Gateway Pods (fan-out)
  ┌──────────────────────────────────────────────────────┐
  │  Pod A                                               │
  │  receives event: "notify user-carol"                 │
  │  connectedSockets.get("user-carol") → undefined      │
  │  → discard                                           │
  └──────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────┐
  │  Pod B  ✅                                           │
  │  receives event: "notify user-carol"                 │
  │  connectedSockets.get("user-carol") → <socket>       │
  │  → socket.send(notification)                         │
  └──────────────────────────────────────────────────────┘
  ┌──────────────────────────────────────────────────────┐
  │  Pod C                                               │
  │  receives event: "notify user-carol"                 │
  │  connectedSockets.get("user-carol") → undefined      │
  │  → discard                                           │
  └──────────────────────────────────────────────────────┘
```

### Two Implementation Variants

---

#### Variant A — Broadcast-and-Discard (simpler)

Each pod has its own Kafka consumer group ID. All pods consume all messages.
Each pod delivers only if the user is local.

```ts
// Pod startup — unique consumer group per pod instance
const podId = process.env.POD_NAME ?? `pod-${crypto.randomUUID()}`;

await consumer.connect();
await consumer.subscribe({ topic: 'notifications', fromBeginning: false });

// In-process registry: userId → WebSocket
const localSockets = new Map<string, WebSocket>();

await consumer.run({
  eachMessage: async ({ message }) => {
    const { userId, notification } = JSON.parse(message.value!.toString());
    const socket = localSockets.get(userId);

    if (!socket) return; // user not on this pod — discard

    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(notification));
    }
  },
});
```

**Tradeoff:** Every pod processes every message. At 1M notifications/min
across 20 pods, each pod processes 1M messages but delivers only ~1/20th.
Wasteful at extreme scale — but operationally dead-simple.

---

#### Variant B — Connection Registry + Targeted Routing (efficient)

Store `userId → podId` in Redis. Route notification directly to the correct
pod's dedicated channel. Only that pod processes the message.

```ts
// On WebSocket connect — register user's location
wss.on('connection', (socket, req) => {
  const userId = getUserIdFromToken(req);
  localSockets.set(userId, socket);

  // Announce to the cluster: "user-carol is on pod-B"
  redis.hset('ws:registry', userId, podId);
  redis.expire(`ws:registry`, 3600); // TTL — auto-cleans stale entries

  socket.on('close', () => {
    localSockets.delete(userId);
    redis.hdel('ws:registry', userId);
  });
});

// Notification router — runs in Notification Service or a dedicated router
async function routeNotification(userId: string, notification: object) {
  const targetPodId = await redis.hget('ws:registry', userId);

  if (!targetPodId) {
    // User offline — store for later delivery
    await storeOfflineNotification(userId, notification);
    return;
  }

  // Publish only to the pod that holds the user's socket
  await redis.publish(`pod:${targetPodId}`, JSON.stringify({ userId, notification }));
}

// Each pod subscribes only to its own channel
await redisSubscriber.subscribe(`pod:${podId}`, (message) => {
  const { userId, notification } = JSON.parse(message);
  const socket = localSockets.get(userId);
  socket?.send(JSON.stringify(notification));
});
```

**Tradeoff:** More complex — registry must stay consistent. If a pod crashes
before calling `hdel`, the registry has a stale entry. Mitigate with a TTL
heartbeat:

```ts
// Heartbeat — re-register every 30s to prove pod is alive
setInterval(async () => {
  for (const userId of localSockets.keys()) {
    await redis.hset('ws:registry', userId, podId);
    await redis.expire(`ws:registry:${userId}`, 90); // 3× heartbeat interval
  }
}, 30_000);
```

---

#### Which Variant to Use?

| | Variant A (Broadcast-and-Discard) | Variant B (Registry + Targeted) |
|---|---|---|
| Complexity | Low | High |
| Message processing waste | High (all pods process all messages) | Low (only target pod processes) |
| Redis dependency | Optional | Required |
| Stale registry risk | None | Yes — needs TTL heartbeat |
| Best for | ≤ 20 pods, moderate traffic | Large clusters, high notification volume |

---

## 4. Redis Pub/Sub vs Kafka vs AWS SNS/SQS

Your architecture has **two distinct routing problems** — use the right tool
for each.

```
Problem 1: Notification Service → WS Gateway   (durable, cross-service)
Problem 2: WS Gateway cross-pod fan-out        (ephemeral, ultra-low latency)
```

---

### Redis Pub/Sub

**What it is:** In-memory, fire-and-forget channel. Publisher sends a message;
all active subscribers receive it immediately. No persistence, no queuing.

```ts
// Publisher (any service)
await redis.publish('user:carol', JSON.stringify(notification));

// Subscriber (WS Gateway pod)
await redis.subscribe('user:carol', (message) => {
  const socket = localSockets.get('carol');
  socket?.send(message);
});
```

**Pros:**
- Sub-millisecond latency — purely in-memory, no disk I/O
- Zero configuration — no topics, partitions, or offsets to manage
- Perfect for ephemeral signaling where Kafka already guarantees durability upstream
- Scales well for fan-out to a bounded number of pods

**Cons:**
- **No persistence** — if no subscriber is listening when a message is published,
  it is gone forever. A restarting pod misses events published during its downtime.
- No consumer groups — cannot have independent consumers tracking their own offset
- Memory pressure — all routing is in-memory; large fan-out to many channels is expensive
- No replay — cannot reprocess events after a bug fix or new consumer is added

**Best for:** Cross-pod WS routing (Problem 2) — the event is already durable in
Kafka upstream; Redis is just the last-mile delivery signal.

---

### Kafka

**What it is:** Distributed, persistent, ordered event log. Events are written
to disk and retained. Multiple independent consumer groups can each consume
the full stream at their own pace.

```ts
// Producer — Notification Service
await producer.send({
  topic: 'notifications',
  messages: [{
    key: userId,                          // partition key → same user, same partition → ordered
    value: JSON.stringify(notification),
    headers: { eventId: uuidv4() },       // idempotency key
  }],
});

// Consumer — WS Gateway (unique group per pod for fan-out)
const consumer = kafka.consumer({ groupId: `ws-gateway-${podId}` });
await consumer.subscribe({ topic: 'notifications' });

await consumer.run({
  eachMessage: async ({ message }) => {
    const { userId, notification } = JSON.parse(message.value!.toString());
    localSockets.get(userId)?.send(JSON.stringify(notification));
  },
});
```

**Pros:**
- **Durable** — events survive pod restarts, deploys, network partitions. A pod
  that was down for 5 minutes catches up by replaying from its last offset.
- **Multiple independent consumers** — WS Gateway, Email Service, Push Notification
  Service, and Analytics all consume the same topic independently.
- **Ordered within partition** — partition by `userId` guarantees all notifications
  for a user arrive in creation order.
- **Replay** — re-run consumers after a bug fix, no data loss.
- **Backpressure** — slow consumers lag without losing data; Kafka buffers for them.

**Cons:**
- Higher latency than Redis (~5–20ms vs sub-ms) — not suitable for gaming/presence
  but fine for notifications.
- Operationally heavy — Kafka cluster, Zookeeper (or KRaft), topic management,
  partition rebalancing.
- Overkill if you have one service and low volume.
- Fan-out to N pods requires N consumer groups — each pod having a unique group ID.
  At 50 pods, you have 50 consumer groups, each reading the full topic.

**Best for:** Service-to-gateway durable delivery (Problem 1) and any pipeline
where you need multi-consumer, replay, or backpressure guarantees.

---

### AWS SNS + SQS

**What they are:**

- **SNS (Simple Notification Service):** Fan-out pub/sub. One publisher, many
  subscribers. Each subscriber gets a copy. Think of it like Kafka topics but
  managed and serverless.
- **SQS (Simple Queue Service):** Point-to-point queue. One message is consumed
  by exactly one worker. Think of it like a Kafka consumer group.
- **SNS → SQS fan-out pattern:** SNS topic fans out to multiple SQS queues.
  Each queue is consumed independently — equivalent to Kafka's consumer groups.

```
                           ┌──▶ SQS Queue (ws-gateway)    ──▶ WS Gateway pods
SNS Topic (notifications)  ├──▶ SQS Queue (email-service) ──▶ Email Service
                           └──▶ SQS Queue (push-service)  ──▶ Push Notification Service
```

```ts
// Publish from Notification Service (AWS SDK v3)
const sns = new SNSClient({ region: 'us-east-1' });
await sns.send(new PublishCommand({
  TopicArn: 'arn:aws:sns:us-east-1:123456:notifications',
  Message: JSON.stringify({ userId, notification }),
  MessageAttributes: {
    userId: { DataType: 'String', StringValue: userId },
  },
}));

// WS Gateway polls its dedicated SQS queue
const sqs = new SQSClient({ region: 'us-east-1' });
const { Messages } = await sqs.send(new ReceiveMessageCommand({
  QueueUrl: WS_GATEWAY_QUEUE_URL,
  MaxNumberOfMessages: 10,
  WaitTimeSeconds: 20,    // long polling — reduces empty receives
}));

for (const msg of Messages ?? []) {
  const { userId, notification } = JSON.parse(msg.Body!);
  localSockets.get(userId)?.send(JSON.stringify(notification));
  await sqs.send(new DeleteMessageCommand({
    QueueUrl: WS_GATEWAY_QUEUE_URL,
    ReceiptHandle: msg.ReceiptHandle!,
  }));
}
```

**Pros:**
- **Fully managed** — no brokers to operate, auto-scales, 99.99% SLA.
- **SNS fan-out** — trivially delivers the same event to WS, Email, Push, and
  Analytics pipelines.
- **SQS durability** — messages persist up to 14 days; retries and dead-letter
  queues built in.
- **FIFO queues** — SNS FIFO + SQS FIFO gives ordering and exactly-once delivery
  within a message group (userId as group key).
- **Native AWS integration** — Lambda triggers, CloudWatch metrics, IAM auth —
  zero glue code on AWS infrastructure.

**Cons:**
- **High latency for real-time WS delivery** — SQS long-polling adds ~100–500ms
  per message. Completely unacceptable for a notification badge that should
  update in under 100ms.
- **Polling model** — SQS is pull-based. Your WS Gateway must continuously poll.
  At 1,000 pods, that's 1,000 polling loops — costs add up.
- **Not designed for WebSocket fan-out** — SNS/SQS excels at async background
  processing, not synchronous real-time delivery.
- **Vendor lock-in** — migrating off AWS requires replacing the entire event bus.
- **Cost at scale** — SNS charges per publish, SQS per request. High-volume
  notification systems can generate significant bills.

**Best for:** Async delivery channels — email digests, mobile push, webhooks,
analytics ingestion. Not for real-time WS delivery.

---

### Head-to-Head Comparison

| Dimension | Redis Pub/Sub | Kafka | AWS SNS/SQS |
|---|---|---|---|
| **Latency** | < 1ms | 5–20ms | 100–500ms |
| **Persistence** | ❌ None | ✅ Disk, configurable | ✅ Up to 14 days |
| **Consumer groups** | ❌ | ✅ | ✅ (separate SQS queues) |
| **Replay** | ❌ | ✅ | ❌ (once consumed, gone) |
| **Fan-out** | ✅ | ✅ (per group) | ✅ (SNS → N SQS) |
| **Ordering** | ❌ | ✅ (per partition) | ✅ (FIFO queues only) |
| **Ops overhead** | Low (if Redis already running) | High | None (managed) |
| **Backpressure** | ❌ | ✅ | ✅ (SQS buffers) |
| **Best layer** | Cross-pod WS routing | Service → gateway | Async channels |
| **Worst for** | Durable event pipelines | Simple single-service | Real-time WS |

---

## 5. Complete Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Event Origin                                  │
│  User Action / System Event → Notification Service                  │
└────────────────────────────┬────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Layer 1 — Durable Event Log                       │
│                                                                      │
│   [ Kafka ]  (partition key = userId)                                │
│                                                                      │
│   Consumer Group: ws-gateway-pod-A  (unique per pod)                │
│   Consumer Group: ws-gateway-pod-B                                   │
│   Consumer Group: email-service                                      │
│   Consumer Group: push-service                                       │
└──────────────────────────┬──────────────────────────────────────────┘
                           │  each pod consumes independently
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  Layer 2 — WS Gateway Cluster (K8s)                  │
│                                                                      │
│   Pod A  ──────────────────────────────────────────────────────┐    │
│   localSockets: { alice: <ws>, bob: <ws> }                     │    │
│   receives Kafka event for "carol" → not local → discard       │    │
│                                                                 │    │
│   Pod B  ──────────────────────────────────────────────────┐   │    │
│   localSockets: { carol: <ws>, dave: <ws> }                │   │    │
│   receives Kafka event for "carol" → local → deliver ✅     │   │    │
│                                                             │   │    │
│   Pod C  ───────────────────────────────────────────────┐  │   │    │
│   localSockets: { eve: <ws> }                           │  │   │    │
│   receives Kafka event for "carol" → not local → discard│  │   │    │
└────────────────────────────────────────────────────────────────┘    │
                           │
                           │  Optional: Variant B adds Redis registry
                           │  for targeted routing (skip discard waste)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Layer 3 — Cross-Pod Signal (optional, Variant B)        │
│                                                                      │
│   [ Redis Pub/Sub ]                                                  │
│   channel: pod:B  →  only Pod B receives and delivers                │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                Layer 4 — Async Delivery Channels                     │
│                                                                      │
│   [ AWS SNS → SQS ]                                                  │
│   email-service queue  →  Email digest                               │
│   push-service queue   →  FCM / APNs mobile push                    │
│   analytics queue      →  Kinesis / BigQuery                         │
└─────────────────────────────────────────────────────────────────────┘
```

### K8s Configuration

```yaml
# Horizontal Pod Autoscaler — scale WS Gateway on connection count
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  scaleTargetRef:
    name: ws-gateway
  minReplicas: 3
  maxReplicas: 50
  metrics:
    - type: Pods
      pods:
        metric:
          name: websocket_connections_per_pod   # custom Prometheus metric
        target:
          type: AverageValue
          averageValue: "1000"   # scale out when avg > 1000 connections per pod
```

```yaml
# Service — do NOT use sessionAffinity: ClientIP
# We handle routing at the application layer, not the load balancer
apiVersion: v1
kind: Service
spec:
  sessionAffinity: None   # ← intentionally stateless at LB level
  ports:
    - port: 443
      targetPort: 8080
```

---

## 6. Interview-Ready Summary

**"How do you manage WebSocket connections across K8s pods?"**

> WebSocket connections are stateful and in-process — each pod holds a local
> `Map<userId, socket>`. The solution is a fan-out layer where every pod
> receives every notification event and delivers it only if the target user is
> connected locally. Kafka gives each pod its own consumer group so all pods
> see all events. For large clusters where broadcast-and-discard is wasteful,
> you add a Redis connection registry — each pod registers its connected users
> on connect and removes them on disconnect. The routing layer looks up which
> pod holds the target socket and publishes only to that pod's Redis channel.

**"What about sticky sessions?"**

> Sticky sessions solve the wrong problem. They guarantee the same *user* stays
> on the same pod — but in a notification system, the sender is a backend
> service with no affinity. They also create uneven load distribution, break on
> pod restarts, and cause connection storms during rolling K8s deployments. They
> are an anti-pattern for horizontally scaled WebSocket systems.

**"Redis Pub/Sub vs Kafka vs SNS/SQS — which one?"**

> Different layers, different tools. Kafka for the durable service-to-gateway
> pipeline — it survives pod restarts, supports replay, and fans out to multiple
> independent consumers like email and push. Redis Pub/Sub for the cross-pod
> last-mile routing — sub-millisecond, ephemeral, no ops; it works because
> Kafka already holds the durable copy. SNS/SQS for async delivery channels
> like email digests and mobile push — fully managed, built-in dead-letter
> queues, but the 100–500ms polling latency makes it wrong for real-time
> WebSocket delivery.
