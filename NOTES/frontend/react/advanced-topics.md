# React Notes

## Resources
- [React 19.2 Latest Features](https://dev.to/elvissautet/react-192-just-dropped-what-actually-matters-my-3-week-production-test-5387)
- [React 19 Latest Features](https://react.dev/blog/2024/12/05/react-19)
- [React Hooks Cheatsheet](https://www.tapascript.io/books/react-hooks-cheatsheet)

---

## React 19 New Features

### 1. Async Functions in Transitions

Support for async functions in transitions to handle pending states, errors, forms and optimistic updates (introduced in React 18).

```js
const [isPending, startTransition] = useTransition();

// Handles pending state
startTransition(async () => {
  const response = await getData();
  return response.data;
});
```

### 2. `useActionState()`

Simplifies form submission by automatically managing pending, success, error states.

```js
const submitDataAction = async (prevState, formData) => {
  formData.get('email'); // Get email input
  try {
    await axios.post(formData);
    return { success: true };
  } catch (e) {
    return { error: e.message };
  }
};

const [state, formAction, isPending] = useActionState(submitDataAction, {
  success: false,
  error: null,
});
```

```jsx
<form action={formAction}>
  <input name="email" />
  <button disabled={isPending}>Submit</button>
</form>
```

### 3. `useFormStatus()`

Reads the status of the parent form. Useful when the submit button is a separate child component — no need to pass any props.

```js
const { pending, data, method, action } = useFormStatus();
```

```jsx
<button disabled={pending}>Submit</button>
```

### 4. `useOptimistic()`

Immediately renders `optimisticName` while the async request is in progress. When the update finishes or errors, React automatically switches back to the `currentName` value.

```js
const [optimisticName, setOptimisticName] = useOptimistic(currentName);
```

### 5. `use()` API

Read a promise or context with `use()` and React will suspend until the promise resolves. Preferred over `useContext` as it can be called within an `if` statement.

```js
use(Promise);
use(Context);
```

### 6. Other Improvements

- `ref` as a prop instead of `forwardRef`
- Cleanup function from ref callbacks
- Support for document metadata
- Support for stylesheet precedence, preloading, prefetch assets, async script tags

---

## React Advanced Hooks

### a) `useDeferredValue`
[Docs](https://react.dev/reference/react/useDeferredValue) — Suited for optimizing rendering (show old content while fresh content is loading).

### b) `useTransition`
[Docs](https://blog.webdevsimplified.com/2022-04/use-transition) — Gives lower priority to state updates written within `startTransition` to prevent blocking, so the UI doesn't freeze. Without `useTransition`, React treats every update as urgent, resulting in a blocking UI.

**`useDeferredValue` vs `useTransition`:**
- `useTransition` (State Control): Use when you have access to the state-setting function (like `setResult`). Tells React: "when I call this function, don't rush the UI update."
- `useDeferredValue` (Value Control): Use when you only have the value (usually passed down as a prop) and don't have control over the original `setState` call.

Both control UI rendering priority (interruptible by React — can pause, resume, discard renders). E.g. typing feels instant while UI updates are deferred.

### c) `useId`
Assigns a unique id to elements when a component is called multiple times.

### d) `useImperativeHandle`
Exposes only a few methods / custom methods from a child component's `forwardRef`.

### e) `useInsertionEffect`
Fired synchronously before DOM mutations. E.g. runtime injection of a style tag.

### f) `useLayoutEffect`
Fired synchronously after DOM mutation.

### g) `useEffect`
Runs asynchronously once the browser paints DOM changes to screen.

### h) `useSyncExternalStore`

Used when React components need to subscribe to external state sources like Redux stores, WebSocket states, or browser APIs (e.g. `navigator.onLine` or `localStorage`). React-Redux v8 uses it.

In React 18+ concurrent rendering, **tearing** can happen:

```
React starts rendering → Pause → External store change → Resume
```

Components may read 2 different values in one render. If an external store is updated during that pause, components rendered before the pause use the old value while components rendered after use the new value — resulting in visual "tearing" (e.g. different prices for the same item in a list).

### Other Hooks

- **`useState` vs `useReducer`**: `useReducer` is a better choice when multiple variables need to be managed together, e.g. `{ loading: false, data: [], error: null }` instead of 3 separate `useState` calls.
- **`useContext`**: Used as a consumer to read the value of a Context.
- **`useRef` vs `useState`**: `useRef` doesn't re-render the component.

---

## React Execution Timeline

The full order of execution from `setState` → user seeing pixels:

| Step | Phase | Hook fired | What happens |
|------|-------|------|-------|
| 1 | **Render** (interruptible) | — | React walks the WIP fiber tree, runs `beginWork` / `completeWork` on each node, builds the Effect List. No DOM changes yet. Can be paused, resumed, or thrown away. |
| 2 | **Commit — Before mutation** | `useInsertionEffect`<br>(+ `getSnapshotBeforeUpdate` for class components) | Fires **synchronously *before*** any DOM mutations. CSS-in-JS libraries inject `<style>` tags here so the browser doesn't have to recompute styles multiple times during the upcoming DOM changes. |
| 3 | **Commit — Mutation** | — *(no public hook)* | React applies the Effect List to the real DOM: inserts, updates, deletes nodes. The DOM physically changes here. |
| 4 | **Commit — Layout** | `useLayoutEffect`<br>(`componentDidMount` / `componentDidUpdate` for classes) | Fires **synchronously *after*** DOM mutations but **before** paint. Use this to measure layout (e.g. `getBoundingClientRect`) or make adjustments without a visible flicker. Blocks paint — keep it fast. |
| 5 | **Tree swap** | — | WIP tree becomes the new current tree (double buffering — atomic flip, no flicker). |
| 6 | **Browser paint** | — | The user finally sees the updated pixels on screen. |
| 7 | **After paint** | `useEffect` | Runs **asynchronously** after the browser has painted. Use for API calls, subscriptions, event listeners — anything that shouldn't block the UI. |

### Memorize this order

> **`useInsertionEffect` → DOM changes → `useLayoutEffect` → paint → `useEffect`**

### Concrete example showing all three

```jsx
function Demo() {
  useInsertionEffect(() => {
    // 1️⃣ Fires FIRST — before React touches the DOM
    // Use case: inject a <style> tag for CSS-in-JS
    const style = document.createElement('style');
    style.textContent = `.box { color: red; }`;
    document.head.appendChild(style);
  });

  useLayoutEffect(() => {
    // 3️⃣ Fires AFTER DOM is updated, BEFORE paint
    // Use case: measure the box's width and adjust before user sees anything
    const width = boxRef.current.getBoundingClientRect().width;
    if (width > 500) boxRef.current.style.fontSize = '12px';
  });

  useEffect(() => {
    // 4️⃣ Fires LAST — after the user has seen the paint
    // Use case: fetch data, log analytics
    fetch('/api/log');
  });

  return <div ref={boxRef} className="box">Hello</div>;
  // 2️⃣ Between insertion and layout: React applies the DOM change
}
```

### When to use which

| Hook | Use case | Real example |
|---|---|---|
| `useInsertionEffect` | Inject styles before DOM mutations | `styled-components`, `emotion` library internals — **not** for app code |
| `useLayoutEffect` | Read/measure DOM, set position before paint | Tooltip positioning, autosizing a textarea, custom scroll indicators |
| `useEffect` | Everything else — side effects that don't block UI | Data fetching, subscriptions, analytics, `setTimeout` |

**Rule of thumb:** Default to `useEffect`. Only reach for `useLayoutEffect` when you'd see a visual flicker otherwise. `useInsertionEffect` is for library authors, not app code.

---

## `forwardRef` with `useImperativeHandle`

Create a ref in the parent and send it to the child component (access the child's ref from the parent).

[CodeSandbox Example](https://codesandbox.io/p/sandbox/forwardref-rmzmz6)

---

## `React.memo`

Re-renders the child component only if props have changed.

```js
memo(Component, arePropsEqual);
```

Internally uses `Object.is` to compare old and new props (shallow equality for objects).

```js
// For comparing object props, create a custom equality function
const arePropsEqual = (prevProps, nextProps) => {
  return JSON.stringify(prevProps) === JSON.stringify(nextProps);
};

memo(Component, arePropsEqual);
```

[Example 1](https://codesandbox.io/p/sandbox/memo-eg-qmchpg) | [Example 2](https://codesandbox.io/p/sandbox/react-memo-object-props-iimgcg)

---

## `useMemo` & `useCallback`

- **`useMemo`**: Caches the function result for given dependencies. The function is called only when a dependency value changes.
- **`useCallback`**: Caches the function itself when passed as a prop to a child.

> In the example below, `useMemo` and `useCallback` solve the same purpose:

```js
const clickHandlerChildMemo = useMemo(() => {
  return clickHandlerChild();
}, [childName]);

const clickHandlerChildCallback = useCallback(
  () => clickHandlerChild,
  [childName],
);
```

[CodeSandbox Example](https://codesandbox.io/p/sandbox/react-memo-hooks-m8p9hr)

---

## React Fiber

[Article 1](https://sunnychopper.medium.com/what-is-react-fiber-and-how-it-helps-you-build-a-high-performing-react-applications-57bceb706ff3) | [Architecture](https://github.com/acdlite/react-fiber-architecture) | [Article 2](https://flexiple.com/react/react-fiber)

### The Core Problem Fiber Solves

**Real-life analogy:** Imagine a chef who has been given a recipe with 500 steps and must follow it from start to finish without stopping — even if the restaurant catches fire. That was React ≤ v15. Fiber is like giving that chef a checklist where they can pause after any step, go deal with an emergency, and come back exactly where they left off.

Before Fiber (≤ v15), React used a **Stack Reconciler** — a recursive, synchronous process. Once a UI update started, it ran to completion, blocking the browser's main thread. On a complex page, this could freeze the UI for hundreds of milliseconds, causing dropped frames and a janky experience.

**Reconciliation** — the process React uses to figure out what changed in the UI and what needs to be updated in the real DOM.

> *Work* — any computation React must perform, usually the result of a state update (e.g. `setState`).

---

### Old vs New: Stack Reconciler vs Fiber

| | Stack Reconciler (≤ v15) | Fiber Reconciler (v16+) |
|---|---|---|
| Work style | Recursive (like a call stack) | Incremental (linked list of units) |
| Interruptible? | ❌ No — runs to completion | ✅ Yes — can pause and resume |
| Prioritization? | ❌ No — all updates equal | ✅ Yes — urgent work goes first |
| Concurrent rendering? | ❌ No | ✅ Yes (fully unlocked in v18) |

**Important distinction:**
- **v16** — Fiber architecture was introduced, but React still rendered synchronously (for backward compatibility). The engine was upgraded but the "concurrent" gear wasn't enabled yet.
- **v17** — Mostly groundwork; still synchronous by default.
- **v18** — Concurrent rendering fully unlocked. Features like `useTransition`, `useDeferredValue`, automatic batching, and Suspense streaming all depend on this.

---

### Key Concepts

**Incremental rendering** — Instead of rendering the entire UI in one big recursive call, Fiber breaks the work into small units called **Fiber nodes** (one per component). React processes one unit, then checks: *"Do I still have time in this frame?"* If yes, continue. If no, yield control back to the browser (so it can handle a scroll or a keypress), then resume on the next frame.

> **Analogy:** Moving house by carrying one box at a time and checking the clock between trips, rather than trying to move everything in a single uninterrupted rush.

**Concurrent rendering** — React can work on a new version of the UI in the background (in a "Work-in-Progress" tree) while the current UI remains fully interactive. If a higher-priority update comes in mid-way (e.g. the user types something), React can abandon the background work, handle the urgent update, and restart the background work fresh.

> **Analogy:** A video editor exporting a video in the background while you keep editing on the same timeline. If you make a change, the export restarts with the latest version — the editing never blocks.

**Prioritizing updates (Lanes)** — React assigns every update to a "lane," which is essentially a priority level. The scheduler always works on the highest-priority lane first.

```js
onChange = () => setState('123'); // SyncLane      — highest priority (user typing)
setTimeout(...)                   // DefaultLane   — normal priority
startTransition(...)              // TransitionLane — lowest priority (non-urgent UI)
```

> **Analogy:** An ER triage system. A patient with a heart attack (SyncLane) gets seen immediately. A patient with a minor sprain (TransitionLane) waits. The doctor doesn't finish a check-up on the sprain patient before responding to the heart attack.

---

### How Fiber Works Internally

Fiber maintains **two trees** at all times:

- **Current tree** — the tree currently rendered on screen.
- **Work-in-Progress (WIP) tree** — a copy of the tree where React calculates the next UI state. Built node by node, can be paused or thrown away.

Each node in these trees is a **Fiber node** — a plain JavaScript object that holds information about a component: its type, props, state, effect flags, and pointers to its parent, child, and sibling (a linked list, not a call stack).

#### Phase 1: Render Phase *(can be paused, resumed, or cancelled)*

React traverses the WIP tree using **depth-first search (DFS)** via a linked list — not recursion. This is what makes it interruptible (a recursive call stack can't be paused mid-way; a linked list traversal can).

As it walks the tree, it runs two internal functions on each node:

1. **`beginWork()`** — called going *down* the tree. Calls the component function (this is where `console.log` inside your component runs), reconciles children, marks the fiber as "dirty" if state or props changed, and tags it with the type of change needed.

2. **`completeWork()`** — called coming *back up* the tree (after all children of a node have completed). For host components (like `<div>`, `<button>`), it **constructs the actual DOM node instance** — but does **not** insert it into the live DOM yet. It also builds the **Effect List**.

> Each node only moves to `completeWork()` once all its children and siblings have completed. The "going down" (begin) and "coming back up" (complete) traversal happens fiber by fiber, like exploring a maze depth-first.

**Effect List** — a flat linked list of only the Fiber nodes that have changes. Instead of walking the entire WIP tree again during the commit phase, React just follows this list. This makes the commit phase fast.

> **Analogy:** The render phase is like a contractor doing a walkthrough of an entire building, writing a snag list of which rooms need work (Effect List) — without touching anything yet. The commit phase is the actual repair crew that only visits the rooms on the snag list.

#### Phase 2: Commit Phase *(synchronous — cannot be paused)*

Once the WIP tree is fully calculated and the Effect List is ready, React enters the commit phase. This is irreversible — like the moment you sign a contract.

Three sub-phases happen in order:

| Sub-phase | Hook fired | What happens |
|---|---|---|
| **Before mutation** | `useInsertionEffect`<br>`getSnapshotBeforeUpdate` (class) | Fires *before* any DOM changes. CSS-in-JS libraries inject `<style>` tags here, so the browser doesn't have to recompute styles multiple times during the upcoming DOM changes. |
| **Mutation** | — *(no public hook)* | React walks the Effect List and applies actual DOM changes: insert, update, delete nodes. The DOM physically changes here. |
| **Layout** | `useLayoutEffect` | DOM is updated but browser hasn't painted yet. Safe to read final layout, attach refs, or sync-mutate without flicker. |

After the commit phase, the browser paints the screen. Then `useEffect` fires asynchronously.

**Tree swap** — at the end of the commit phase, React flips the root pointer: the WIP tree becomes the new current tree, and the old current tree is kept around as a candidate to become the next WIP tree (double buffering). This is why there's no flickering — the switch is atomic.

> **Analogy:** A theatre with two rotating stages. Stagehands set up the next scene on one side while the current scene plays on the other. The curtain drops for just a moment while the stage rotates — then it's back up with the fresh scene already in place.

---

### Full Execution Timeline

| Step | What happens | Hook fired |
|---|---|---|
| 1 | **Render phase**: React walks the WIP tree, runs `beginWork` and `completeWork` on each node, builds the Effect List. Can be paused. | — |
| 2 | **Commit — Before mutation**: Fires *before* any DOM changes. CSS-in-JS libraries inject `<style>` tags here. | `useInsertionEffect` |
| 3 | **Commit — Mutation**: React flushes the Effect List — inserts, updates, deletes DOM nodes. The DOM physically changes. | — |
| 4 | **Commit — Layout**: DOM is updated but the browser hasn't painted yet. Safe to measure layout or make adjustments to avoid visible flickering. | `useLayoutEffect` |
| 5 | **Tree swap**: WIP tree becomes the new current tree. | — |
| 6 | **Browser paint**: The user sees the updated pixels on screen. | — |
| 7 | **After paint**: Side effects run asynchronously — API calls, subscriptions, event listeners. Doesn't block the UI. | `useEffect` |

---

### Summary: Why Fiber Matters (Interview-ready answer)

> "Before Fiber, React used a recursive Stack Reconciler that, once started, couldn't be stopped — like a long phone call you can't put on hold. This blocked the browser and caused janky UIs on complex pages.
>
> Fiber rewrote the reconciliation engine to use an iterative, linked-list-based approach. This means React can now break rendering into small units of work, pause between them, check if anything more urgent has come in (like a user typing), and resume or restart as needed.
>
> The Fiber architecture was introduced in React 16, but concurrent rendering — the full benefit of all this — was only enabled by default in React 18, with APIs like `useTransition` and `useDeferredValue` giving developers direct control over update priority."

---

## React Authentication & Authorization

[Reference](https://dev.to/miracool/how-to-manage-user-authentication-with-react-js-3ic5)

```jsx
// Protected nested routes
<Route element={<ProtectedRoute />}>
  <Route path="/dashboard" element={<Dashboard />} />
  <Route path="/profile" element={<Profile />} />
</Route>

// ProtectedRoute component — redirect to /login if token not found
export const ProtectedRoute = () => {
  const { token } = useAuth();
  if (token) return <Navigate to="/login" />;
  return <Outlet />;
};
```

**Token Strategy:**
- **Access token**: short-lived, stored in memory (not accessible after refresh)
- **Refresh token**: stored in `HttpOnly` cookie, auto-sent with requests
- Refresh API issues new access + refresh tokens; backend invalidates old refresh token

Use `BroadcastChannel` so that when one tab refreshes the token, all other tabs refresh it instantly.

---

## FAQs

### Why does `useEffect` not support a direct async callback function?

`useEffect` expects its callback to return either a cleanup function or nothing at all. If declared as `async`, it implicitly returns a Promise, which React doesn't recognize as a cleanup function.

### Disadvantage of using state in Context?

If there are multiple nested components within a parent `Context.Provider`, a state update causes a re-render in all consuming components. It's good practice to wrap the Context close to the component you want to re-render. Only components that call `useContext` re-render when the context's state changes.

**Solution:** Use multiple Contexts and keep state close to its dependent components.

### Why does React use `Object.is()` to compare state?

`Object.is()` handles two edge cases that `===` misses:

```js
NaN === NaN      // false  ❌
Object.is(NaN, NaN) // true ✅

+0 === -0        // true   ❌
Object.is(+0, -0)   // false ✅
```

```js
const [user, setUser] = useState({ name: 'Alex' });

// WON'T trigger a re-render:
user.name = 'Blake';
setUser(user); // Object.is(user, user) is true

// WILL trigger a re-render:
setUser({ ...user, name: 'Blake' }); // New object reference
```

---

## React 19.2 New Features

### 1. `<Activity>` Component

Two modes: `visible` and `hidden`.

- **`hidden`**: hides the children and unmounts effects
- **`visible`**: shows the children and mounts effects

**Use case:** preserves component state, scroll position etc. (`useState`, `useRef`). The component stays mounted but React pauses its effects and deprioritizes updates — saving performance while preserving state.

```jsx
<Activity mode={tabName === 'profile' ? 'visible' : 'hidden'}>
  <Profile />
</Activity>
<Activity mode={tabName === 'dashboard' ? 'visible' : 'hidden'}>
  <Dashboard />
</Activity>
```

### 2. `useEffectEvent`

Use the latest state/props inside an effect without re-running the effect every time.

```js
// Before — effect re-runs when either userId OR sortBy changes
useEffect(() => {
  const fetchData = async () => {
    const res = await api.getData(userId, sortBy);
    setData(res);
  };
  fetchData();
}, [userId, sortBy]);

// After — always uses the latest sortBy, but effect runs only when userId changes
const fetchData = useEffectEvent(async () => {
  const res = await api.getData(userId, sortBy);
  setData(res);
});

useEffect(() => {
  fetchData();
}, [userId]);
```

### 3. Partial Pre-Rendering

Combines the benefits of SSG (Static Site Generation) and SSR (Server-Side Rendering).

- Static contents generated at build time are loaded immediately
- Dynamic parts (personalized data or API results) are loaded on demand and streamed in once ready

### 4. Batching Suspense Boundaries for SSR

Reveals more content together instead of one by one. Previously, server-rendered Suspense loaded one by one but client-rendered Suspense loaded in batch — felt janky.

---

## React Compiler (React 19)

Checks the code during build time and adds memoization wherever necessary to avoid re-renders. Eliminates the need to manually use `useMemo`, `useCallback`, and `React.memo` in most cases.

**Edge case** — external/3rd-party dependencies (e.g. a Maps library) still require manual memoization:

```js
const markerClickHandler = useCallback((markerId) => {
  // Logic
}, []);

return <Map onMarkerClick={markerClickHandler} />;
```

---

## Re-rendering Logic for Context

- When Provider re-renders → All children re-render (unless wrapped in `React.memo`)
- When Provider's `value` changes → All `useContext()` consumers re-render (`React.memo` **cannot** prevent this)

---

## `flushSync`

[Reference](https://www.dhiwise.com/post/understanding-react-flushsync-a-deep-dive-into-synchronous-rendering)

Forces a synchronous update to the DOM. State is updated and the component is re-rendered immediately, without waiting for other pending updates.

---

## SSR & Hydration

### Classic SSR with Hydration (React < 18)

React components are executed twice — once on the server to generate HTML and once on the client to recreate the Virtual DOM and hydrate the existing HTML by attaching event handlers.

**Issue:** Heavy components still cost CPU on the client; large hydration cost (uncanny valley problem).

### React 19 — React Flight Protocol

[Discussion](https://github.com/reactwg/react-18/discussions/37)

Instead of sending entire HTML, the server sends a serialized React tree (a Flight payload). The client stitches it together with client components. No hydration needed for server components — only client components.

**React Server Components sends 2 formats:**
1. HTML — for immediate UI display
2. Flight Payload — a map of the whole UI, used by the React client for hydration

**Hydration Process:**
1. The server runs components and fetches data.
2. Sends a fast HTML preview so the user sees the page immediately.
3. Also sends a Flight Payload — a map of the whole UI.
4. This map marks which parts are "static" and which need "interactivity."
5. The browser shows the HTML, but buttons and inputs don't work yet.
6. Static Server Components stay as they are — they never need JavaScript on the client.
7. The browser downloads small JavaScript bundles only for Client Components.
8. React 18 uses Selective Hydration to prioritize the parts the user clicks on first.
9. React hydrates these parts by attaching event listeners like `onClick` to the HTML.
10. The page becomes fully interactive without re-rendering the entire tree.

### Progressive vs Selective Hydration

**Full Hydration** — blocks the entire page until the entire JS bundle is downloaded and the entire tree is hydrated.

**Progressive Hydration:**
- Page is split using Suspense boundaries
- React hydrates boundaries incrementally
- Hydration order is usually top-down / natural order

**Selective Hydration:**
- React treats each `<Suspense>`-wrapped component as a separate boundary
- Hydrates whichever parts have their code and data available first
- **Event Replay**: if a user clicks a not-yet-hydrated component, React pauses background hydration, jumps to that component, hydrates it immediately, and replays the captured click event

### What Causes Hydration Mismatch?

Occurs when the initial HTML from the server doesn't match the first render on the client. Common causes: `new Date()`, `Math.random()`, or browser-only globals like `window`.

### Modern SSR Flow

```
Server:  request → create QueryClient → prefetch queries → dehydrate → render
Client:  hydrate → reuse cache → no refetch → UI stable
```

### `server-only` Package

Prevents server code from accidentally being imported into a client component.

---

## Global Providers Pattern

```jsx
export const GlobalProviders = ({ children }: { children: React.ReactNode }) => (
  <Provider store={store}>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          {children}
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </Provider>
);

// main.tsx
createRoot(document.getElementById("root")).render(
  <GlobalProviders>
    <App />
  </GlobalProviders>
);
```

---

## Interview Questions

### Set 1 — React 18/19 Concurrency & Scheduling Internals

**1. Difference between legacy sync rendering vs concurrent rendering in React 18/19.**

Legacy (≤ v17): once a render started, it ran to completion — like a blocking phone call. A slow render froze the UI.

Concurrent (v18+): renders are interruptible. React can pause mid-render to handle a user click or keystroke, then resume.

> **Real use case:** A dashboard with a 10,000-row data grid. In legacy mode, sorting the grid blocked typing in the search box. In concurrent mode (wrap the sort in `startTransition`), typing stays smooth while the sort happens in the background.

```js
// Legacy — typing freezes while the heavy list re-renders
setQuery(input);

// Concurrent — typing stays smooth, list updates when ready
startTransition(() => setQuery(input));
```

---

**2. How the Fiber scheduler pauses, resumes, and abandons partial work.**

After processing each fiber node, the scheduler checks the remaining time in the current frame (using `MessageChannel` / `requestIdleCallback`-style time-slicing, ~5ms budget). If time is up, it yields to the browser and resumes on the next frame. If a higher-priority update arrives (e.g. user clicks), it **abandons the in-progress WIP tree** and restarts.

> **Real use case:** A user is typing in a search bar that filters a large product list. While React is mid-way through re-rendering the filtered list for `"iphon"`, the user types another letter making it `"iphone"`. React abandons the half-done render and starts fresh with the new query — no wasted paint.

---

**3. What are lanes and how do they control priority of UI updates?**

Lanes are 31-bit bitmasks where each bit represents an urgency level. React batches updates within the same lane and processes lanes in priority order.

| Lane | Priority | Triggered by |
|---|---|---|
| `SyncLane` | Highest | `onClick`, `onChange`, `flushSync` |
| `InputContinuousLane` | High | `onScroll`, `onMouseMove` |
| `DefaultLane` | Normal | `setTimeout`, network responses |
| `TransitionLane` | Low | `startTransition`, `useTransition` |
| `IdleLane` | Lowest | Offscreen / background work |

> **Real use case:** A chat app. Typing in the message box (`SyncLane`) must feel instant. Loading the next page of message history when scrolling near the top (`TransitionLane`) can wait. Lanes ensure typing never gets delayed by history loading.

---

**4. Why interruptible rendering is core to UX smoothness.**

The browser must complete each frame in ~16ms to hit 60fps. If a JS task runs longer, the browser drops frames (jank). Interruptible rendering lets React yield to the browser every few ms so scroll, animation, and input handling stay responsive.

> **Real use case:** A live stock-trading dashboard with charts updating every second. Without interruptible rendering, a chart recalculation could block a user's "SELL" button click. With Fiber, the click is handled instantly, and the chart finishes rendering after.

---

**5. Why React runs `useEffect` twice in Strict Mode (dev only).**

React deliberately mounts → unmounts → remounts each component in development to expose impure effects. In concurrent mode, React reserves the right to "discard and restart" a render. If your effect doesn't clean up properly, this re-execution will surface the bug.

> **Real use case:** A developer subscribes to a WebSocket in `useEffect` but forgets to return a cleanup. In dev, they get two open WebSockets immediately — the bug is loud, not silent. In production, this would have caused a slow memory leak that grew with every navigation.

```js
useEffect(() => {
  const socket = openWebSocket();
  return () => socket.close(); // ← Strict Mode forces you to remember this
}, []);
```

---

**6. When to use `useTransition` to stop UI blockage.**

Use when a state update triggers an expensive re-render, and you want the existing UI to stay interactive during it.

> **Real use case:** Switching tabs in a tabbed analytics dashboard, where each tab renders a heavy chart. Without `useTransition`, the click freezes the UI until the chart is ready. With it, the old tab stays interactive (and shows a spinner) until the new one is rendered.

```jsx
const [tab, setTab] = useState('overview');
const [isPending, startTransition] = useTransition();

function selectTab(next) {
  startTransition(() => setTab(next));
}

return (
  <>
    <Tabs onChange={selectTab} disabled={isPending} />
    {isPending && <Spinner />}
    <HeavyChart tab={tab} />
  </>
);
```

---

**7. `useTransition` vs `startTransition` — priority distinction.**

Both mark updates as `TransitionLane` (low priority). The difference is purely API:

- `useTransition` returns `[isPending, startTransition]` — gives you a flag to show a spinner.
- `startTransition` (the standalone import) is fire-and-forget — no pending state.

Use `startTransition` outside React components (e.g. in a Redux thunk, an event listener attached imperatively, or a router) where hooks aren't allowed.

> **Real use case:** A router library uses `startTransition` internally when navigating, because it doesn't render a component — it just calls the function. A page using `useTransition` adds a spinner while that navigation happens.

---

**8. How `useDeferredValue` avoids list & search lag.**

It defers updating a value until React has spare time. The input stays bound to the urgent state; the heavy list reads the deferred value.

> **Real use case:** Typing in a fuzzy file-finder (like VS Code's Cmd+P). You want every keystroke to appear instantly in the input box, even if the filtered file list (10,000 items) can't keep up. `useDeferredValue` lets the input update at 60fps while the list catches up when it can.

```jsx
function FileFinder() {
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;

  return (
    <>
      <input value={query} onChange={e => setQuery(e.target.value)} />
      <FileList query={deferredQuery} style={{ opacity: isStale ? 0.5 : 1 }} />
    </>
  );
}
```

`useTransition` vs `useDeferredValue`:
- Use `useTransition` when you **own the setState** call.
- Use `useDeferredValue` when you only have **the value** (e.g. it's a prop from a library).

---

**9. What changed with Suspense in React 18 streaming pipeline.**

Pre-v18 SSR: the server had to render the entire HTML before sending anything. One slow API blocked the whole page.

v18+ SSR with Suspense: the server sends HTML in chunks. Slow parts get a `<Suspense fallback>`; the rest streams immediately. As slow data resolves, the server streams the remaining HTML and React stitches it in.

> **Real use case:** An e-commerce product page. The product image, title, and price (fast DB lookup) stream instantly so LCP is great. The reviews section (slow third-party API) is wrapped in `<Suspense fallback={<ReviewsSkeleton />}>` and streams in 2 seconds later — without blocking the rest of the page.

```jsx
<ProductPage>
  <ProductDetails /> {/* streams immediately */}
  <Suspense fallback={<ReviewsSkeleton />}>
    <Reviews productId={id} /> {/* streams when slow API resolves */}
  </Suspense>
</ProductPage>
```

---

**10. Why hydration mismatch happens even if server HTML = client render.**

Hydration mismatch occurs when the server-rendered HTML doesn't match the first client render. Common causes:

- **Non-deterministic values** — `new Date()`, `Math.random()`, `Date.now()`
- **Browser-only globals** — `window`, `localStorage`, `navigator`
- **User-specific data** — reading `localStorage` for theme on client but defaulting to light on server
- **Browser extensions** — Grammarly/ad-blockers injecting attributes into your HTML

> **Real use case:** A blog shows "Posted 2 hours ago" using `formatDistance(new Date(), post.date)`. The server renders this at 10:00 AM ("2 hours ago"), the user opens it at 10:02 AM, the client renders "2 hours ago" too — but the next second it becomes "2 hours and 1 minute ago" and React panics. Fix: render the absolute date on the server, switch to relative in a `useEffect`.

```jsx
// ❌ Hydration mismatch
<span>{Math.random()}</span>

// ✅ Render server-safe value, then update on client
const [now, setNow] = useState(null);
useEffect(() => setNow(Date.now()), []);
return <span>{now ?? 'Loading...'}</span>;
```

---

### Set 2 — React 19 Hydration Model, Streams & Modern UI Delivery

[Reference](https://github.com/reactwg/react-18/discussions/37)

**1. How Progressive Hydration differs from full hydration in React 19.**

**Full hydration:** the entire React tree must hydrate (attach event listeners) before *anything* is interactive. The whole page is "dead HTML" until the full JS bundle loads.

**Progressive hydration:** the page is split into Suspense boundaries. Each boundary hydrates independently as its JS arrives. Other regions remain non-interactive but visible.

> **Real use case:** A news homepage with header, article list, sidebar, and footer. With full hydration, the header's search bar is unusable until the entire 800KB bundle loads (~3s on 3G). With progressive hydration, the header hydrates in ~500ms while the heavier article list streams in later.

---

**2. What is Selective Hydration and why it hydrates only interaction-touched UI.**

Selective hydration lets React **prioritize hydration based on user interaction**. If you click an unhydrated component, React jumps to that boundary, hydrates it immediately, and replays the captured event — even if other regions were "next in line" to hydrate.

> **Real use case:** A long e-commerce category page is hydrating top-down. The user scrolls to the bottom and clicks "Add to cart" on a product. React detects the click on an unhydrated component, pauses its current work, hydrates that product card first, and replays the click as if it were always interactive.

```jsx
<Page>
  <Header />            {/* hydrates first by default */}
  <Suspense fallback={<Skeleton />}>
    <ProductList />     {/* would hydrate later, BUT */}
  </Suspense>           {/* if user clicks it first, React jumps here */}
  <Footer />
</Page>
```

---

**3. Explain React Flight (server → client payload streaming).**

React Flight is the wire format for streaming server-rendered React trees to the client. Instead of sending HTML alone (which is opaque and requires re-rendering on the client), Flight sends a serialized representation of the React component tree.

The payload includes:
- Static parts of the tree (rendered on server, no JS needed on client)
- "Holes" pointing to Client Components (with their props serialized)
- Promises that resolve as more data streams in

> **Real use case:** A Next.js App Router page. The server runs your async server component (which directly queries the DB), serializes the result as a Flight payload, and streams it. The client receives `{type: 'div', children: [..., {clientRef: 'ProductCard', props: {id: 42}}]}` and renders it. The `ProductCard` JS is the *only* JS shipped to the browser.

---

**4. What causes client waterfalls with mixed RSC & client components.**

A waterfall happens when one fetch can only start after another finishes. Mixing RSC with Client Components can create them when:

- A Server Component fetches data, renders a Client Component, and the Client Component then fetches more data based on props.
- Multiple Server Components fetch sequentially instead of in parallel.

> **Real use case (bad):**
> Server Component fetches `user` → renders `<UserProfile userId={user.id} />` (client) → `UserProfile` calls `useQuery` for orders. The orders fetch waits for both the user fetch AND hydration.
>
> **Fix:** Fetch orders in the server component too and pass them down as props. Or use `Promise.all` at the top to parallelize fetches.

```jsx
// ❌ Waterfall
async function Page() {
  const user = await getUser();
  const orders = await getOrders(user.id); // waits for user
  return <Profile user={user} orders={orders} />;
}

// ✅ Parallel
async function Page() {
  const [user, orders] = await Promise.all([getUser(), getOrders()]);
  return <Profile user={user} orders={orders} />;
}
```

---

**5. What is lazy hydration and how it boosts INP/LCP.**

Lazy hydration **defers hydration of below-the-fold or rarely-used components** until needed (on scroll, interaction, or idle). Less hydration upfront = less main-thread blocking = better INP.

- **LCP** improves because the page is visually complete sooner without competing JS work.
- **INP** improves because hydration is no longer one giant blocking task; the main thread stays free for input handlers.

> **Real use case:** A landing page with a hero, three feature cards, and a 5,000-word FAQ section at the bottom. Wrap the FAQ in lazy hydration — it stays as static HTML (zero JS cost) until the user scrolls to it. [Wix reported a 40% INP improvement using this pattern.](https://www.wix.engineering/post/40-faster-interaction-how-wix-solved-react-s-hydration-problem-with-selective-hydration-and-suspen)

---

**6. React 19's partial serialization strategy in hydration.**

React 19 serializes only the data needed to make Client Components interactive — not the entire tree. Server Components are "baked into HTML" and never need a client-side counterpart. This drastically reduces the hydration payload.

> **Real use case:** A blog article page. The article body (5,000 words) is a Server Component — pure HTML, no JS, no hydration. Only the "Like" button and the comments form are Client Components, each with a small serialized props payload. Total client JS: ~10KB instead of 200KB.

---

**7. Full vs Progressive vs Selective hydration — when to choose each.**

| Type | Use when | Example |
|---|---|---|
| **Full** | Small page, all-interactive (admin dashboards) | Internal tool with login wall |
| **Progressive** | Mixed page with clear above/below-the-fold split | News homepage |
| **Selective** | Heavy page where user interaction is unpredictable | E-commerce category page |

In practice React 18+ does all three automatically when you use `<Suspense>` boundaries. The "strategy" is really *how you place your boundaries*.

---

**8. Why streaming helps UI render the shell first, details later.**

Streaming sends HTML in chunks as it's produced. The browser can paint the page shell (header, navigation, layout) within ~100ms of the first byte, even if the data-heavy content takes 2s. This dramatically improves perceived performance.

> **Real use case:** A search results page. The header and filter sidebar render from cache in ~50ms and stream immediately. The actual results (slow Elasticsearch query) stream in 800ms later. The user sees a complete page shell in <100ms and can start interacting with filters while results load.

---

**9. How Suspense boundaries isolate slow UI to avoid blocking.**

A `<Suspense>` boundary tells React: "if anything inside throws a Promise (suspends), show the fallback and don't block the rest of the tree." This creates an isolation boundary for both server streaming and client-side data loading.

> **Real use case:** A user profile page with fast user data and slow activity history. Without Suspense, the entire page waits for activity. Wrapping activity in `<Suspense fallback={<Spinner />}>` lets the rest of the profile render instantly.

```jsx
<Profile>
  <Header user={user} />             {/* fast */}
  <Bio user={user} />                {/* fast */}
  <Suspense fallback={<Spinner />}>
    <ActivityHistory userId={id} /> {/* slow — isolated */}
  </Suspense>
</Profile>
```

---

**10. Role of Offscreen Rendering (React 19's `<Activity>`) for background updates.**

The `<Activity>` component lets React keep a subtree mounted but **hidden and deprioritized** — preserving state, scroll position, refs — without unmounting. When toggled back to `visible`, it's instantly available.

> **Real use case:** A tabbed app (chat / contacts / settings). With conditional rendering (`tab === 'chat' && <Chat />`), switching tabs unmounts each tab — losing scroll position and forcing re-fetches. With `<Activity>`, every tab stays mounted in the background; switching tabs is instant and preserves state.

```jsx
<Activity mode={tab === 'chat' ? 'visible' : 'hidden'}>
  <Chat /> {/* state preserved when hidden */}
</Activity>
<Activity mode={tab === 'contacts' ? 'visible' : 'hidden'}>
  <Contacts />
</Activity>
```

---

### Set 3 — State, Rendering Boundaries & Re-Render Control

**1. When state colocation beats lifting state (render scope control).**

Lifting state up means *every* descendant of the owner re-renders when the state changes — even ones that don't care. Colocating state inside the component that actually uses it limits re-renders to that subtree.

> **Real use case:** A long form with 30 fields. If you put all field state in the parent `useState({...})`, every keystroke re-renders the entire form. Colocate each field's state inside the field component — only that field re-renders.

```jsx
// ❌ Lifted — every keystroke re-renders all 30 fields
function Form() {
  const [values, setValues] = useState({});
  return Object.keys(fields).map(k =>
    <Field value={values[k]} onChange={v => setValues({...values, [k]: v})} />
  );
}

// ✅ Colocated — only the typed-in field re-renders
function Field({ name }) {
  const [value, setValue] = useState('');
  return <input value={value} onChange={e => setValue(e.target.value)} />;
}
```

**Lift only when:** sibling components need to read the value, or when submitting needs all values.

---

**2. Why heavy Context leads to re-render storms & how to isolate with selectors.**

Any change to a Context's `value` re-renders **every** consumer, even if they only read one unchanged field. With 50 consumers and a single boolean flip in a "global state" context, all 50 re-render.

**Fixes:**
- **Split contexts**: separate `UserContext`, `ThemeContext`, `CartContext` instead of one `AppContext`.
- **Use a selector-aware library**: Zustand, Jotai, Redux with `useSelector` — they let components subscribe only to the slice they read.

> **Real use case:** A chat app had a single `AppContext` with user, theme, online status, and unread count. Every WebSocket message updating unread count re-rendered the entire app. Splitting into 4 contexts dropped re-renders by 90%.

```jsx
// ❌ One mega-context
<AppContext.Provider value={{ user, theme, cart, notifications }}>

// ✅ Split
<UserContext.Provider value={user}>
  <ThemeContext.Provider value={theme}>
    <CartContext.Provider value={cart}>
      <NotificationsContext.Provider value={notifications}>
```

---

**3. Automatic Batching across events, promises & fetches in React 18.**

Pre-v18: React batched updates only inside React event handlers. Updates inside `setTimeout`, Promises, or native event handlers triggered separate renders.

v18+: **all** updates are batched, regardless of origin.

> **Real use case:** A form submit handler:
> ```js
> async function onSubmit() {
>   setLoading(true);
>   const data = await api.post();    // ← inside a promise
>   setLoading(false);                // pre-v18: triggered separate render
>   setData(data);                    // pre-v18: triggered another render
> }
> ```
> Pre-v18 this caused 3 renders. v18+ batches the two post-`await` updates into 1.

If you need to opt out (rare): `flushSync(() => setX(1))`.

---

**4. Controlled vs Uncontrolled components from a render cost perspective.**

- **Controlled** (`<input value={state} onChange={setState}>`): every keystroke triggers a re-render of the parent component.
- **Uncontrolled** (`<input ref={inputRef} defaultValue="">`): the DOM holds the value, React doesn't re-render on each keystroke. Read via ref on submit.

> **Real use case:** A 30-field form. Controlled inputs work fine, but typing fast in one field re-renders the whole form (if state is lifted). For huge forms or perf-sensitive cases, libraries like **React Hook Form** use uncontrolled inputs with refs — yielding ~10x fewer renders.

```jsx
// Controlled — re-renders on every keystroke
<input value={value} onChange={e => setValue(e.target.value)} />

// Uncontrolled — zero re-renders while typing
<input ref={inputRef} defaultValue="" />
// Later: const value = inputRef.current.value;
```

---

**5. Why referential stability (`useRef`, `memo`) matters for lists & grids.**

`React.memo` does a shallow prop comparison. If you pass a new object/function/array on every parent render, the memoized child sees "different props" and re-renders anyway — defeating memoization.

> **Real use case:** A virtualized table with 10,000 rows wrapped in `React.memo`. The parent passes `onRowClick={(id) => doSomething(id)}` — a new function each render. Result: all 10,000 rows re-render. Wrapping the handler in `useCallback` (stable reference) means only changed rows re-render.

```jsx
// ❌ New function reference → all rows re-render
<Row onClick={(id) => handleClick(id)} />

// ✅ Stable reference → memo works correctly
const handleRowClick = useCallback((id) => handleClick(id), []);
<Row onClick={handleRowClick} />
```

(React 19's compiler eliminates most of this manual `useCallback` boilerplate — but it's still vital to understand.)

---

**6. Signals vs stores vs context — why subscriptions reduce re-render floods.**

- **Context**: re-renders *all consumers* on any value change (no granularity).
- **Stores with selectors** (Redux, Zustand): components subscribe to specific slices. Only components whose slice changed re-render.
- **Signals** (SolidJS-style, coming to React via the compiler): updates skip React's render cycle entirely and patch the DOM directly. No re-render at all.

> **Real use case:** A trading dashboard with 200 price tickers. With Context, any single price tick re-renders all 200 tickers. With Zustand using `useStore(s => s.prices[symbol])`, only the changed ticker re-renders. With signals, no React re-render — the DOM text node updates directly.

---

**7. How RSC boundaries eliminate client JS cost.**

A React Server Component runs only on the server. Its output (HTML + Flight payload) is sent to the client. The component's **code is never shipped to the browser**. The "boundary" is the `"use client"` directive — everything above it stays server-only.

> **Real use case:** A blog using `marked` (200KB) to render Markdown. As a Client Component, that 200KB ships to every reader. As a Server Component, the rendering happens server-side and only the resulting HTML is sent — saving 200KB of JS, 100ms of parse time, and 50ms of execution.

```jsx
// ❌ Client Component — ships marked.js to browser
"use client";
import { marked } from "marked";
export function Article({ md }) { return <div dangerouslySetInnerHTML={{ __html: marked(md) }} />; }

// ✅ Server Component — marked.js never reaches client
import { marked } from "marked";
export async function Article({ slug }) {
  const md = await readFile(slug);
  return <div dangerouslySetInnerHTML={{ __html: marked(md) }} />;
}
```

---

**8. Why props look the same but still cause re-render (identity vs equality).**

JavaScript compares objects, arrays, and functions by **reference identity**, not deep equality. `{a: 1} === {a: 1}` is `false`. So passing inline objects/arrays/functions creates a new reference on every render.

> **Real use case:** A chart component wrapped in `React.memo`. Parent renders pass `<Chart options={{theme: 'dark'}} />`. The `options` object is new every render → memo's shallow check fails → chart re-renders constantly.

```jsx
// ❌ New object every render
<Chart options={{ theme: 'dark' }} />

// ✅ Stable reference
const options = useMemo(() => ({ theme: 'dark' }), []);
<Chart options={options} />

// ✅ Or, if truly static, hoist out of component
const options = { theme: 'dark' };
function Parent() { return <Chart options={options} />; }
```

---

**9. When to avoid lifting and rely on server-cached state instead.**

If state is derived from server data (e.g. "is this user's email available?", "current list of products"), don't lift it into React state — let a server cache (React Query, SWR, RSC) own it. Multiple components can read from the same cache without prop drilling, and the cache handles invalidation.

> **Real use case:** A header showing the cart count and a separate cart page. Lifting `cartItems` into a top-level Context means every cart update re-renders both. Using React Query with `useQuery(['cart'])` in both, each gets the data from the same cache — and React Query handles refetching, optimistic updates, and stale-while-revalidate.

```jsx
// ❌ Lifted state needs prop drilling or context
<App cart={cart} setCart={setCart}>

// ✅ Shared cache — both components read from it independently
function Header() { const { data } = useQuery(['cart'], fetchCart); ... }
function CartPage() { const { data } = useQuery(['cart'], fetchCart); ... }
```

---

**10. React 19 preparing ground for partial UI compilation & offscreen hydration.**

React 19 lays the groundwork for two big shifts:

- **React Compiler (formerly "React Forget")**: Compiles components at build time and auto-inserts memoization where it would help. Removes the need for manual `useMemo`/`useCallback`/`React.memo` in 95% of cases.
- **Offscreen hydration + `<Activity>`**: Components can be pre-rendered and pre-hydrated in the background while invisible, then revealed instantly when the user navigates.

> **Real use case:** A multi-step wizard. With React 19, you can pre-render and pre-hydrate the next step in the background (via `<Activity mode="hidden">`) while the user is on the current step. When they click "Next", the transition is instant — no rendering, no hydration, no API call wait. Combined with the compiler, you get this performance with zero manual memoization.

---

## Debugging

- [Debug React Memory Leaks](https://oneuptime.com/blog/post/2026-01-15-debug-memory-leaks-react-applications/view)