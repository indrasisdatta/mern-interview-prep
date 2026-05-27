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

### React Effect Hooks — Execution Timeline

```
1. Render Phase
       ↓
2. Real DOM Update
       ↓
3. useInsertionEffect
       ↓
4. useLayoutEffect
       ↓
5. Browser Paint
       ↓
6. useEffect
```

---

### Steps Explained

#### 1. Render Phase
React calculates the Virtual DOM. No browser changes yet.

#### 2. Real DOM Update
React updates the actual browser elements.

#### 3. `useInsertionEffect`
- **When:** Synchronously after DOM mutations, before layout is measured
- **Purpose:** Injecting dynamic CSS (CSS-in-JS libraries) so styles are in place before anything measures the DOM

#### 4. `useLayoutEffect`
- **When:** Synchronously after DOM mutations and styles are injected, before the browser paints
- **Purpose:** Measuring layout (width/height) or making adjustments that must happen before the user sees anything, to avoid flickering

#### 5. Browser Paint
The user sees the updated pixels on screen.

#### 6. `useEffect`
- **When:** Asynchronously after the browser paints
- **Purpose:** Most side effects — API calls, subscriptions, event listeners. Doesn't block the UI

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

Each node in these trees is a **Fiber node** — a plain JavaScript object that holds information about a component: its type, props, state, effects, and pointers to its parent, child, and sibling (a linked list, not a call stack).

#### Phase 1: Render Phase *(can be paused, resumed, or cancelled)*

React traverses the WIP tree using **depth-first search (DFS)** via a linked list — not recursion. This is what makes it interruptible (a recursive call stack can't be paused mid-way; a linked list traversal can).

As it walks the tree, it runs two internal functions on each node:

1. **`beginWork()`** — called going *down* the tree. Determines whether this component needs to re-render. If yes, it calculates the new output and tags the node with what kind of change is needed (insert, update, delete).

2. **`completeWork()`** — called coming *back up* the tree. For host components (like `<div>`, `<button>`), it prepares the actual DOM node properties (but does **not** insert them into the real DOM yet). It also builds the **Effect List**.

**Effect List** — a flat linked list of only the Fiber nodes that have changes. Instead of walking the entire WIP tree again during the commit phase, React just follows this list. This makes the commit phase fast.

> **Analogy:** The render phase is like a contractor doing a walkthrough of an entire building and writing a snag list — noting exactly which rooms need work (Effect List) — without touching anything yet. The commit phase is the actual repair crew that only visits the rooms on the snag list.

#### Phase 2: Commit Phase *(cannot be paused — must run to completion)*

Once the WIP tree is fully calculated and the Effect List is ready, React enters the commit phase. This is irreversible — like the moment you sign the contract.

Three sub-phases happen in order:

| Sub-phase | Hook fired | What happens |
|---|---|---|
| **Before mutation** | `getSnapshotBeforeUpdate` | Read current DOM state before any changes |
| **Mutation** | `useInsertionEffect` | React makes actual DOM insertions, updates, deletions |
| **Layout** | `useLayoutEffect` | DOM is updated; browser hasn't painted yet — safe to measure layout |

After the commit phase, the browser paints the screen. Then `useEffect` fires asynchronously.

**Tree swap** — at the end of the commit phase, React flips the root pointer: the WIP tree becomes the new current tree, and the old current tree is kept around as a candidate to become the next WIP tree (double buffering). This is why there's no flickering — the switch is atomic.

> **Analogy:** A theatre stage with two sides. Stagehands set up the next scene on one side while the current scene plays on the other. The curtain drops for just a moment while the stage rotates — then it's back up with the fresh scene already in place.

---

### Full Execution Timeline

| Step | What happens | Hook fired |
|---|---|---|
| 1 | **Render phase**: React walks the WIP tree, runs `beginWork` and `completeWork` on each node, builds the Effect List. Can be paused. | — |
| 2 | **Commit — Before mutation**: React reads current DOM state before making any changes. | `getSnapshotBeforeUpdate` |
| 3 | **Commit — Mutation**: React flushes the Effect List — inserts, updates, deletes DOM nodes. Dynamic CSS injected here so the browser doesn't recalculate styles multiple times. | `useInsertionEffect` |
| 4 | **Commit — Layout**: DOM is updated but the browser hasn't painted yet. Use this to measure layout (e.g. element width/height) or make adjustments to avoid visible flickering. | `useLayoutEffect` |
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
Legacy rendering is a "blocking" process that can't be stopped once it starts; Concurrent rendering is "interruptible," allowing React to pause a long render to handle a user click.

**2. How the Fiber scheduler pauses, resumes, and abandons partial work.**
The Fiber scheduler checks the remaining time in the current frame; it pauses if it runs out of time, resumes in the next frame, or abandons the work if a higher-priority update makes the current WIP tree stale.

**3. What are lanes and how do they control priority of UI updates?**
Lanes are 32-bit integers representing different "urgency" levels (like Sync, Input, or Transition); they allow React to sort and filter updates so the most critical UI changes (typing) happen first.

**4. Why interruptible rendering is core to UX smoothness.**
It prevents "Main Thread jank" by ensuring the browser stays responsive to user inputs even while React is calculating a heavy, complex UI update in the background.

**5. Why React runs `useEffect` twice in Strict Mode (dev only).**
It intentionally mounts components twice to help developers find "impure" side effects that would break Concurrent features like "discard and restart."

**6. When to use `useTransition` to stop UI blockage.**
Use it when updating state that causes a heavy UI change (like switching a tab with a big chart) and you want to keep the current UI interactive while the new one loads.

**7. `useTransition` vs `startTransition` with priority distinction.**
Both mark work as low-priority, but `useTransition` provides an `isPending` boolean to show a loading spinner, whereas `startTransition` is for when you don't need that pending state.

**8. How `useDeferredValue` avoids list & search lag.**
It keeps the input field fast by letting the search result list lag slightly behind the typing state, allowing the list to render at a lower priority than the keystrokes.

**9. What changed with Suspense in React 18 streaming pipeline.**
In React 18/19, Suspense allows the server to send HTML in "chunks" (streaming), so the user sees the shell of the page immediately while slow data-heavy sections load in later.

**10. Why hydration mismatch happens even if server HTML = client render.**
Occurs when using non-deterministic data like `new Date()`, `Math.random()`, or browser-only globals (like `window`).

---

### Set 2 — React 19 Hydration Model, Streams & Modern UI Delivery

[Reference](https://github.com/reactwg/react-18/discussions/37)

**1. How Progressive Hydration differs from full hydration in React 19.**
Full Hydration blocks the entire page from being interactive until the entire JavaScript bundle is downloaded and the entire tree is hydrated. Progressive Hydration splits the page using Suspense boundaries and hydrates them incrementally in top-down / natural order.

**2. What is Selective Hydration and why it hydrates only interaction-touched UI.**
When a component is wrapped in `<Suspense>`, React treats that section as a separate boundary. Instead of waiting for every boundary to be ready, React starts hydrating whichever parts have their code and data available first. If a user interacts with a not-yet-hydrated component, React pauses, jumps to that component, hydrates it, and replays the captured event.

**3. Explain React Flight (server → client payload streaming).**
Using React Flight, the server sends a serialized description of the React component tree instead of entire HTML. The browser deserializes and renders it. No hydration is needed for server components — only client components.

**4.** What causes client waterfalls with mixed RSC & client components.

**5.** What is lazy hydration and how it boosts INP/LCP.

**6.** React 19's partial serialization strategy in hydration.

**7.** Full vs Progressive vs Selective hydration — when to choose each.

**8.** Why streaming helps UI render the shell first, details later.

**9.** How Suspense boundaries isolate slow UI to avoid blocking.

**10.** Role of Offscreen Rendering in React 19 for background updates.

---

### Set 3 — State, Rendering Boundaries & Re-Render Control

**1.** When state colocation beats lifting state (render scope control).

**2.** Why heavy Context leads to re-render storms & how to isolate with selectors.

**3.** Automatic Batching across events, promises & fetches in React 18.

**4.** Controlled vs Uncontrolled components from a render cost perspective.

**5.** Why referential stability (`useRef`, `memo`) matters for lists & grids.

**6.** Signals vs stores vs context — why subscriptions reduce re-render floods.

**7.** How RSC boundaries eliminate client JS cost.

**8.** Why props look the same but still cause re-render (identity vs equality).

**9.** When to avoid lifting and rely on server-cached state instead.

**10.** React 19 preparing ground for partial UI compilation & offscreen hydration.

---

## Debugging

- [Debug React Memory Leaks](https://oneuptime.com/blog/post/2026-01-15-debug-memory-leaks-react-applications/view)