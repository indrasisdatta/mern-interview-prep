# Frontend Design Patterns (React-focused)

> Cross-link: [React advanced topics](advanced-topics.md) · [Redux](redux.md) · [TanStack Query](tanstack-query.txt) · [CODE/design-patterns/](../../../CODE/design-patterns/)
>
> Classic GoF patterns adapted for React + hooks era. Plus React-specific patterns that emerged from real-world component library design (Radix, Headless UI, Reach, Reach UI).

---

## 1. Why this matters at architect level

When you build a component library (Verizon UI library, Citi micro-frontend shared components), you're designing for *consumers* — other developers. The wrong pattern produces:

- Inflexible APIs (every change requires a new prop)
- Awkward composition (cannot insert custom elements between fixed structure)
- Implementation leakage (consumers depend on internal state shape)

Good patterns let consumers extend, customize, and replace pieces without forking your library.

---

## 2. Compound Components

A parent component coordinates state for child components that work together. Children look semantically meaningful in markup.

### 2.1 Example: Tabs

```jsx
<Tabs defaultValue="summary">
  <Tabs.List>
    <Tabs.Trigger value="summary">Summary</Tabs.Trigger>
    <Tabs.Trigger value="items">Items</Tabs.Trigger>
    <Tabs.Trigger value="audit">Audit Log</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Panel value="summary">...</Tabs.Panel>
  <Tabs.Panel value="items">...</Tabs.Panel>
  <Tabs.Panel value="audit">...</Tabs.Panel>
</Tabs>
```

Consumer controls structure (which children, in what order, with what wrapping). Component coordinates state (which tab is active).

### 2.2 Implementation (with Context)

```jsx
import { createContext, useContext, useState } from "react";

const TabsContext = createContext(null);

export function Tabs({ defaultValue, value, onValueChange, children }) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const current = value ?? internalValue;
  const setValue = (v) => { setInternalValue(v); onValueChange?.(v); };
  return (
    <TabsContext.Provider value={{ value: current, setValue }}>
      <div className="tabs">{children}</div>
    </TabsContext.Provider>
  );
}

Tabs.List = function List({ children }) {
  return <div role="tablist" className="tabs-list">{children}</div>;
};

Tabs.Trigger = function Trigger({ value, children }) {
  const ctx = useContext(TabsContext);
  const selected = ctx.value === value;
  return (
    <button role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1}
            onClick={() => ctx.setValue(value)}>
      {children}
    </button>
  );
};

Tabs.Panel = function Panel({ value, children }) {
  const ctx = useContext(TabsContext);
  if (ctx.value !== value) return null;
  return <div role="tabpanel">{children}</div>;
};
```

### 2.3 Trade-offs

| Pro | Con |
|-----|-----|
| Flexible — consumer arranges children freely | Context re-renders all children on state change |
| Self-documenting in JSX | Children must be direct or use shared context |
| Encourages a11y semantics (role="tablist" etc) | More files / more API surface |

### 2.4 Where it shines

- Tabs, Accordion, RadioGroup, Menu, Dialog (Trigger + Content)
- Citi CWO uses this pattern for the role-based workflow stepper component

---

## 3. Render Props

A component takes a function as a prop and calls it with state/handlers. Consumer decides how to render.

```jsx
function MouseTracker({ children }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  return (
    <div onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}>
      {children(pos)}
    </div>
  );
}

// Usage
<MouseTracker>
  {({ x, y }) => <p>Mouse at ({x}, {y})</p>}
</MouseTracker>
```

**Status:** largely superseded by custom hooks in modern React. Use hooks unless you specifically need render-prop semantics (e.g., for non-hook consumers or class components).

### 3.1 When render props still make sense

- You need to render the same logic into multiple "slots"
- The consumer wants the JSX positioned in a specific DOM structure controlled by your component
- For libraries supporting both class and function components (rare in 2026)

---

## 4. Higher-Order Components (HOCs)

A function that takes a component and returns a new component with added behavior.

```jsx
function withAuth(Component) {
  return function WithAuth(props) {
    const user = useUser();
    if (!user) return <Navigate to="/login" />;
    return <Component {...props} user={user} />;
  };
}

const ProtectedDashboard = withAuth(Dashboard);
```

### 4.1 Status & trade-offs

**Largely replaced by hooks** in modern React. Use HOCs when:
- Wrapping for cross-cutting concerns the consumer shouldn't have to opt into (error boundaries, providers)
- Integrating with class components
- Libraries with class-based public API (e.g., older react-redux `connect`)

### 4.2 HOC pitfalls

```jsx
// BAD: HOC inside render — creates a new component each render, loses state
function Parent() {
  const Enhanced = withAuth(Child);   // ← new component every render!
  return <Enhanced />;
}

// GOOD: define HOC at module level
const Enhanced = withAuth(Child);
function Parent() { return <Enhanced />; }
```

Other gotchas:
- Static method hoisting (`hoist-non-react-statics`)
- Refs not forwarded (need `forwardRef`)
- Props collision risk

**Modern preference:** custom hooks > HOCs for behavior; render props or compound components for visual composition.

---

## 5. Custom Hooks — composition over inheritance

The React-native unit of reuse. A function that calls other hooks.

### 5.1 Patterns

```jsx
// Pattern: state + behavior
function useToggle(initial = false) {
  const [v, setV] = useState(initial);
  const toggle = useCallback(() => setV((x) => !x), []);
  const setTrue = useCallback(() => setV(true), []);
  const setFalse = useCallback(() => setV(false), []);
  return [v, { toggle, setTrue, setFalse }];
}

// Pattern: data fetching
function useFundNAV(fundId) {
  return useQuery({
    queryKey: ["nav", fundId],
    queryFn: () => fetchNAV(fundId),
    staleTime: 60_000,
  });
}

// Pattern: subscription / effect
function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on);
                   window.removeEventListener("offline", off); };
  }, []);
  return online;
}
```

### 5.2 Rules

1. Name starts with `use`
2. Only call hooks at top level (no loops, conditions, nested functions)
3. Return the minimal API the consumer needs

### 5.3 Composition example (Verizon dashboard order detail)

```jsx
function useOrderDetail(orderId) {
  const orderQ = useOrder(orderId);
  const itemsQ = useOrderItems(orderId);
  const historyQ = useOrderHistory(orderId);

  return {
    order: orderQ.data,
    items: itemsQ.data ?? [],
    history: historyQ.data ?? [],
    isLoading: orderQ.isLoading || itemsQ.isLoading || historyQ.isLoading,
    error: orderQ.error || itemsQ.error || historyQ.error,
    refetch: () => Promise.all([orderQ.refetch(), itemsQ.refetch(), historyQ.refetch()]),
  };
}
```

Encapsulates three queries into one cohesive hook. Component code:

```jsx
function OrderDetail({ orderId }) {
  const { order, items, history, isLoading, error } = useOrderDetail(orderId);
  if (isLoading) return <Spinner />;
  if (error) return <Error err={error} />;
  return <OrderView order={order} items={items} history={history} />;
}
```

---

## 6. Controlled vs Uncontrolled Components

**Controlled:** parent owns state via `value` + `onChange`.
**Uncontrolled:** component owns its state internally (DOM-backed via `defaultValue` + ref).

```jsx
// Controlled
<input value={name} onChange={(e) => setName(e.target.value)} />

// Uncontrolled
<input defaultValue="initial" ref={inputRef} />
// read: inputRef.current.value
```

### 6.1 Hybrid pattern — support both

Library-quality components support both modes:

```jsx
function Switch({ checked, defaultChecked, onCheckedChange, ...props }) {
  const [internal, setInternal] = useState(defaultChecked ?? false);
  const isControlled = checked !== undefined;
  const value = isControlled ? checked : internal;

  const set = (next) => {
    if (!isControlled) setInternal(next);
    onCheckedChange?.(next);
  };

  return (
    <button role="switch" aria-checked={value} onClick={() => set(!value)} {...props}>
      <span className={`thumb ${value ? "on" : "off"}`} />
    </button>
  );
}

// Consumer can use either
<Switch defaultChecked onCheckedChange={fn} />        // uncontrolled
<Switch checked={pinned} onCheckedChange={setPinned}/> // controlled
```

### 6.2 When to choose

- **Uncontrolled:** simple inputs where parent doesn't need real-time value (forms with `onSubmit`-only reads)
- **Controlled:** parent needs to react to changes (validation, filtering, derived state)

---

## 7. Provider Pattern

Wrap subtree with context to inject shared dependencies — theme, auth, query client, feature flags.

```jsx
const ThemeContext = createContext("light");

export function ThemeProvider({ initial = "light", children }) {
  const [theme, setTheme] = useState(initial);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
```

### 7.1 Composing providers cleanly

Combat "provider hell":

```jsx
// BAD
<QueryClientProvider client={client}>
  <ThemeProvider>
    <I18nProvider>
      <AuthProvider>
        <ToastProvider>
          <FeatureFlagProvider>
            <App />
          </FeatureFlagProvider>
        </ToastProvider>
      </AuthProvider>
    </I18nProvider>
  </ThemeProvider>
</QueryClientProvider>

// BETTER: composeProviders helper
function composeProviders(...providers) {
  return ({ children }) =>
    providers.reduceRight((acc, P) => <P>{acc}</P>, children);
}

const AppProviders = composeProviders(
  ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  ThemeProvider, I18nProvider, AuthProvider, ToastProvider, FeatureFlagProvider,
);

<AppProviders><App /></AppProviders>
```

### 7.2 Context performance pitfalls

Context updates re-render **every consumer**. Splits help:

```jsx
// BAD: single context — every state change re-renders everyone
<AppContext.Provider value={{ user, theme, locale, notifications, ... }}>

// GOOD: split by update frequency / consumer set
<UserContext.Provider value={user}>
  <ThemeContext.Provider value={theme}>
    <NotificationsContext.Provider value={notifications}>
      ...
```

For Redux-like global state without Redux, look at Zustand or Jotai — they avoid context's "re-render everyone" problem.

---

## 8. Slot Pattern (children as slots)

Pass named "slots" via props or compound children.

```jsx
// Variant A: named props
<Layout
  header={<Header />}
  sidebar={<Sidebar />}
  main={<Main />}
  footer={<Footer />}
/>

// Variant B: Compound children with role-based discovery
<Layout>
  <Layout.Header><MyHeader /></Layout.Header>
  <Layout.Sidebar><Nav /></Layout.Sidebar>
  <Layout.Main><Page /></Layout.Main>
  <Layout.Footer><MyFooter /></Layout.Footer>
</Layout>
```

The named-prop variant is great for layouts; the compound variant for sectioned widgets.

### 8.1 Render Helper Children (advanced)

```jsx
<Dialog>
  <Dialog.Title>Confirm</Dialog.Title>
  <Dialog.Description>Are you sure?</Dialog.Description>
  <Dialog.Actions>
    <Button onClick={cancel}>Cancel</Button>
    <Button onClick={confirm}>OK</Button>
  </Dialog.Actions>
</Dialog>
```

`Dialog.Title` automatically wires `aria-labelledby`; `Dialog.Description` wires `aria-describedby`. Hidden ARIA wiring is one of the biggest wins of compound components.

---

## 9. Headless Components (logic without UI)

Library provides hooks/logic; consumer renders the UI. Examples: Radix UI, Headless UI, React Aria, downshift.

### 9.1 Pattern

```jsx
// Library exports a hook returning state + props to spread
function useCombobox({ items, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const inputProps = {
    value: query,
    onChange: (e) => { setQuery(e.target.value); setOpen(true); },
    role: "combobox",
    "aria-expanded": open,
    "aria-controls": "listbox-id",
    onKeyDown: (e) => {
      if (e.key === "ArrowDown") setActiveIndex((i) => Math.min(i + 1, items.length - 1));
      if (e.key === "Enter") { onSelect(items[activeIndex]); setOpen(false); }
    },
  };

  const listboxProps = { id: "listbox-id", role: "listbox" };

  const getItemProps = (index) => ({
    role: "option",
    "aria-selected": index === activeIndex,
    onClick: () => { onSelect(items[index]); setOpen(false); },
  });

  return { open, query, activeIndex, inputProps, listboxProps, getItemProps };
}
```

Consumer uses it with whatever JSX/styling they want.

### 9.2 When to choose headless

- Building a design system that must enforce a11y but allow visual customization
- Need full control over styling/animation
- Library wants to be tree-shakeable (no unused styling code)

### 9.3 Trade-offs

- Headless: max flexibility, more code per consumer
- Pre-styled: faster to adopt, less flexible

Modern approach: **Radix UI primitives** (headless, accessible) + **your own styling layer** = best of both.

---

## 10. State Reducer Pattern

Consumer can intercept and modify state transitions.

```jsx
function useSwitch(options) {
  const [state, dispatch] = useReducer((state, action) => {
    let next;
    switch (action.type) {
      case "toggle": next = { on: !state.on }; break;
      default: next = state;
    }
    return options?.reducer ? options.reducer(state, action, next) : next;
  }, { on: false });
  return [state.on, () => dispatch({ type: "toggle" })];
}

// Consumer can prevent toggle if business rule says so
const [on, toggle] = useSwitch({
  reducer: (prev, action, next) => {
    if (action.type === "toggle" && lockedByBackend) return prev;
    return next;
  }
});
```

Useful for component libraries where consumers occasionally need to intercept "should this state transition happen?".

---

## 11. Factory Hooks (composing related hooks)

Create a family of related hooks bound to shared config:

```js
function createApi({ baseUrl, headers }) {
  function useGet(path) {
    return useQuery({
      queryKey: [path],
      queryFn: () => fetch(`${baseUrl}${path}`, { headers }).then(r => r.json()),
    });
  }
  function useMutate(path) {
    return useMutation({
      mutationFn: (body) => fetch(`${baseUrl}${path}`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r => r.json()),
    });
  }
  return { useGet, useMutate };
}

const { useGet, useMutate } = createApi({ baseUrl: "/api", headers: { Auth: token } });

// In a component
const { data } = useGet("/funds");
```

---

## 12. Classic GoF patterns in React

### 12.1 Observer

React's state model IS the Observer pattern under the hood — components subscribe to state updates via `useState`/`useContext`/store subscriptions.

```jsx
// External store as Observable
function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,
    setState: (next) => { state = next; listeners.forEach(l => l()); },
    subscribe: (l) => { listeners.add(l); return () => listeners.delete(l); },
  };
}

// Use it in React via useSyncExternalStore (React 18+)
function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.getState);
}
```

### 12.2 Singleton

```js
// Single QueryClient for entire app
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

// In root
<QueryClientProvider client={queryClient}>
```

### 12.3 Factory

```js
function createLogger(scope) {
  return {
    info: (...a) => console.info(`[${scope}]`, ...a),
    error: (...a) => console.error(`[${scope}]`, ...a),
  };
}

const navLogger = createLogger("nav");
navLogger.info("Loading fund", fundId);
```

### 12.4 Strategy

```jsx
const sortStrategies = {
  byName: (a, b) => a.name.localeCompare(b.name),
  byNAV: (a, b) => a.nav - b.nav,
  byPctChange: (a, b) => a.changePct - b.changePct,
};

function useSorted(items, strategy) {
  return useMemo(() => [...items].sort(sortStrategies[strategy]), [items, strategy]);
}
```

### 12.5 Adapter

```jsx
// Old API: returns array. New API: returns object with metadata.
function adaptLegacyFundsResponse(legacy) {
  return { items: legacy, total: legacy.length, hasMore: false };
}

const { data: raw } = useQuery({ queryKey: ["funds"], queryFn: fetchLegacyFunds });
const adapted = useMemo(() => raw && adaptLegacyFundsResponse(raw), [raw]);
```

### 12.6 Facade

```jsx
// Internal: complex state machine, multiple stores
// External: simple hook
export function useOrderActions(orderId) {
  const reduxDispatch = useDispatch();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  return {
    cancel: async () => {
      try {
        await cancelOrder(orderId);
        queryClient.invalidateQueries(["order", orderId]);
        reduxDispatch(orderCancelled(orderId));
        toast.success("Order cancelled");
        navigate("/orders");
      } catch (e) { toast.error(e.message); }
    },
    approve: async () => { /* similar */ },
  };
}
```

Hides multi-store choreography behind a single `useOrderActions(id)` for consumers.

### 12.7 Decorator (HOC variant)

```jsx
const withLogging = (Component) => (props) => {
  useEffect(() => { logger.info(`${Component.name} mounted`); }, []);
  return <Component {...props} />;
};
```

---

## 13. Container / Presentational (legacy)

Originally proposed by Dan Abramov (2015): separate "smart" container (data + handlers) from "dumb" presentational (just renders).

```jsx
function FundListContainer() {
  const { data, isLoading } = useFunds();
  if (isLoading) return <Spinner />;
  return <FundList items={data} onApprove={approveFund} />;
}

function FundList({ items, onApprove }) {
  return <ul>{items.map(f => <FundListItem key={f.id} {...f} onApprove={onApprove} />)}</ul>;
}
```

### 13.1 Status

**Largely obsoleted** by hooks (the container's job becomes a custom hook). Dan himself walked it back. But the *idea* — separating data orchestration from rendering — survives via custom hooks:

```jsx
function FundList() {
  const { data, isLoading } = useFunds();   // hook = "container logic"
  if (isLoading) return <Spinner />;
  return <ul>{data.map(f => <FundListItem key={f.id} {...f} />)}</ul>;
}
```

---

## 14. State machines (for complex flows)

Many "this depends on that depends on the other" bugs are state machines waiting to be born.

### 14.1 useReducer for inline machines

```jsx
function uploadReducer(state, action) {
  switch (state.status) {
    case "idle":
      if (action.type === "select_file") return { status: "selected", file: action.file };
      return state;
    case "selected":
      if (action.type === "start") return { status: "uploading", file: state.file, progress: 0 };
      return state;
    case "uploading":
      if (action.type === "progress") return { ...state, progress: action.value };
      if (action.type === "success") return { status: "done", file: state.file };
      if (action.type === "error")   return { status: "error", file: state.file, error: action.error };
      return state;
    case "error":
    case "done":
      if (action.type === "reset")  return { status: "idle" };
      return state;
  }
}
```

The reducer rejects illegal transitions — `error → progress` does nothing. Vastly fewer "impossible UI states" bugs than `useState` for each piece.

### 14.2 XState for big machines

For multi-screen flows (KYC, checkout, multi-step approval like Citi CWO NAV submission), use XState:

```js
import { setup } from "xstate";

const navMachine = setup({}).createMachine({
  id: "navSubmission",
  initial: "loading",
  states: {
    loading: { on: { LOADED: "review" } },
    review:  { on: { APPROVE: "submitting", REJECT: "rejected" } },
    submitting: { on: { SUCCESS: "submitted", FAIL: "review" } },
    submitted: { type: "final" },
    rejected:  { type: "final" },
  },
});
```

Visual editor, exhaustive testing, scaling for complex flows.

---

## 15. Anti-patterns to recognize and avoid

### 15.1 Prop drilling without bounds

```jsx
<Page user={user}>
  <Section user={user}>
    <Card user={user}>
      <Avatar user={user} />
```

Fix: Context (or Zustand) for cross-cutting data.

### 15.2 "God component" with 50 props

```jsx
<DataTable
  rows={...} columns={...} sortable filterable resizable
  selectedRows={...} onSelectionChange={...}
  expandable expandedRows={...} onExpandChange={...}
  onRowClick onRowDoubleClick onRowContextMenu
  loading error
  toolbar={...}
  pagination={...} totalCount onPageChange onSizeChange
  onExport onPrint
  density="compact"
  ... 40 more props
/>
```

Fix: compound components — let consumer compose pieces.

### 15.3 Boolean prop explosion

```jsx
<Button primary large outlined rounded loading disabled />
```

Fix: variant props.

```jsx
<Button variant="primary" size="lg" shape="outlined" loading disabled />
```

### 15.4 Implicit dependencies

```jsx
function PriceWidget() {
  const price = window.__GLOBAL_PRICE__;  // implicit dep
  return <span>${price}</span>;
}
```

Fix: explicit prop or context — `<PriceWidget price={x} />`.

### 15.5 Mutating props

```jsx
function Sort({ items }) {
  items.sort(...);   // mutates caller's array!
  return ...;
}
```

Fix: always copy: `items.slice().sort(...)` or `[...items].sort(...)`.

### 15.6 Effect that does what render should

```jsx
function PriceFormatted({ price }) {
  const [formatted, setFormatted] = useState("");
  useEffect(() => { setFormatted(`$${price.toFixed(2)}`); }, [price]); // unnecessary
  return <span>{formatted}</span>;
}

// Fix: just compute during render
function PriceFormatted({ price }) {
  return <span>${price.toFixed(2)}</span>;
}
```

---

## 16. Verizon billing dashboard: pattern application

Combining patterns for the chart family of components:

```jsx
// 1. Compound components for chart structure
<Chart data={billingData} kind="bar">
  <Chart.XAxis dataKey="month" />
  <Chart.YAxis label="USD" />
  <Chart.Bar dataKey="revenue" fill="var(--color-accent)" />
  <Chart.Tooltip />
  <Chart.Legend position="bottom" />
</Chart>

// 2. Custom hook for chart-specific state
function useChartZoom() {
  const [range, setRange] = useState(null);
  const onSelect = useCallback((start, end) => setRange({ start, end }), []);
  const reset = useCallback(() => setRange(null), []);
  return { range, onSelect, reset };
}

// 3. Headless chart toolbar (consumer styles)
function ChartToolbar({ chart, render }) {
  const props = {
    onZoomIn: chart.zoomIn, onZoomOut: chart.zoomOut, onReset: chart.reset,
  };
  return render(props);
}

// 4. State reducer for advanced consumers
<Chart reducer={(state, action, next) => {
  if (action.type === "zoom" && billingPeriodLocked) return state;
  return next;
}} />
```

---

## 17. Interview talking points

**Q: "When would you choose compound components over a single component with many props?"**
A: When consumers need to *arrange* sub-pieces (different orders, intermix with custom content), or when each sub-piece has its own a11y semantics (e.g., Tabs.List = `role="tablist"`, Tabs.Trigger = `role="tab"`). Single-component-with-many-props ends up with prop explosion; compound components push composition responsibility to the consumer.

**Q: "Hooks vs HOCs — when do you still use HOCs?"**
A: Almost never in new code. Hooks cover all the use cases more cleanly. I'd use HOCs only for: (1) integrating with legacy class components, (2) wrapping for cross-cutting concerns like `withErrorBoundary` where the consumer shouldn't have to call a hook, (3) library compat layers.

**Q: "What's your approach to building a design system for a micro-frontend setup like Citi CWO?"**
A: Headless primitives (Radix-style) + thin styling layer. Reason: each MFE may have its own styling needs (different banks have different brand requirements), but the a11y + keyboard semantics must be consistent across the whole portal. Headless + tokens = consistent behavior, flexible visual.

**Q: "How do you handle a component that needs to support both controlled and uncontrolled usage?"**
A: Internal `useState` driven by `defaultValue`, but if the consumer passes `value`, treat that as the source of truth and fire `onValueChange` for updates. See the Switch example in section 6.1. Library-quality components must support both — otherwise consumers will fork.

**Q: "When does Context cause performance problems?"**
A: Context updates re-render every consumer subscribed via `useContext`. For frequently-changing values, this re-renders large subtrees. Mitigations: (1) split contexts by update frequency, (2) memoize the value object, (3) use a subscribe-based store (Zustand, Jotai) for high-frequency state — they let consumers subscribe to *slices*. React 19's `use()` hook helps slightly but doesn't fix the fundamental issue.

**Q: "Show me a real state machine you've built."**
A: For Citi CWO NAV submission — states: `loading → review → editing → submitting → submitted | rejected | error`. Each state has only valid transitions (e.g., can't `submit` while `editing` if validation fails). Implemented as `useReducer` initially, migrated to XState when the workflow team added approval levels (junior → senior → CFO). XState's visualizer made the workflow legible for non-engineers.

---

## 18. References

- [Patterns.dev](https://www.patterns.dev/) — comprehensive modern patterns
- [Kent C. Dodds — Advanced React Patterns](https://kentcdodds.com/blog/?q=patterns)
- [Radix UI source](https://github.com/radix-ui/primitives) — compound component + headless reference
- [Headless UI](https://headlessui.com/)
- [downshift](https://github.com/downshift-js/downshift) — state-reducer pattern reference
- [XState docs](https://stately.ai/docs/) — state machines
- [React Aria](https://react-spectrum.adobe.com/react-aria/) — Adobe's headless hooks for a11y primitives
