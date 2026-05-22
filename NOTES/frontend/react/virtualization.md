# How Virtualization Works Internally - `react-window`

---

## The Problem First

Imagine you have a list of **10,000 hotel rows**. Without virtualization, React renders all 10,000 `<div>` nodes into the DOM at once.

- Browser has to layout, paint and composite 10,000 nodes
- Memory usage is huge
- Scrolling becomes janky

But here's the key insight: **the user can only see ~10 rows at any given time.**

So why render 10,000?

---

## The Core Idea

`react-window` renders only the rows **currently visible in the viewport** — plus a few extra above and below as a buffer (called **overscan**).

Let's say the viewport fits **10 rows** and overscan is **2**. That means `react-window` keeps only **~14 DOM nodes** alive at any time — regardless of whether the list has 100 or 100,000 items.

```
┌─────────────────────────┐
│  Row 3  (overscan)      │  ← in DOM, just above viewport
├─────────────────────────┤
│  Row 4                  │  ← visible
│  Row 5                  │  ← visible
│  Row 6                  │  ← visible
│  ...                    │
│  Row 13                 │  ← visible
├─────────────────────────┤
│  Row 14  (overscan)     │  ← in DOM, just below viewport
└─────────────────────────┘

Rows 1–2 and 15–10000 → NOT in the DOM at all
```

---

## How It Actually Swaps — Step by Step

### Step 1: The outer container has a fixed height

```jsx
<List
  height={500}        // visible area height in px
  itemCount={10000}
  itemSize={50}       // each row is 50px tall
  width={600}
>
  {Row}
</List>
```

`react-window` creates two nested `<div>`s:

```
┌──────────────────────────────────┐  ← Outer div
│  height: 500px                   │    (fixed, clips content, overflow: auto)
│  overflow: auto                  │
│  ┌────────────────────────────┐  │
│  │  Inner div                 │  │  ← Inner div
│  │  height: 500,000px         │  │    (10,000 rows × 50px = total scroll height)
│  │                            │  │    This is what makes the scrollbar look real
│  │  [only ~14 rows rendered]  │  │
│  │                            │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

The **inner div's height is the full list height** (`10,000 × 50px = 500,000px`). This makes the scrollbar behave as if all rows exist — but the rows themselves are not there.

---

### Step 2: Each row is absolutely positioned

Instead of flowing rows one after another with normal document flow, `react-window` positions each row using:

```css
position: absolute;
top: Npx;   /* N = rowIndex × itemSize */
```

So row 0 sits at `top: 0px`, row 1 at `top: 50px`, row 7 at `top: 350px`, and so on.

This means rows don't depend on each other to know where they are. `react-window` can place any row at exactly the right pixel position, instantly — without rendering the rows before it.

---

### Step 3: On scroll, it recalculates which rows are visible

When you scroll, the outer div fires a `scroll` event. `react-window` reads `scrollTop` (how many pixels you've scrolled) and does simple math:

```
scrollTop = 300px         (you've scrolled 300px down)
itemSize  = 50px          (each row is 50px)

firstVisibleRow = Math.floor(300 / 50) = row 6
lastVisibleRow  = Math.floor((300 + 500) / 50) = row 15

With overscan of 2:
  render rows 4 → 17
```

It now knows exactly which row indices need to be in the DOM.

---

### Step 4: It unmounts old rows and mounts new ones — or updates in place

Here's where the "swapping" actually happens.

**Before scroll:** rows 0–13 are in the DOM.

**After scrolling down 5 rows:** rows 5–18 should be visible.

`react-window` does this:

- Rows 0–4 → **unmounted** (removed from DOM entirely)
- Rows 5–13 → **already in DOM**, their `top` values are still correct, nothing changes
- Rows 14–18 → **newly mounted** with `position: absolute; top: 700px` etc.

React's reconciler handles this efficiently — it diffs the previous render and only touches what changed.

The **total number of DOM nodes stays the same** (~14). Old ones at the top get removed, new ones at the bottom get added. From a DOM perspective, it's a small, fixed-size sliding window moving over a huge virtual list.

---

## Concrete Example

List of 10,000 hotels. `itemSize = 50px`. Viewport = `500px`. Overscan = `2`.

| Scroll position | `scrollTop` | Rows in DOM | Rows visible |
| :--- | :--- | :--- | :--- |
| Top of list | 0px | 0 → 13 | 0 → 9 |
| Scrolled halfway | 250px | 3 → 16 | 5 → 14 |
| Scrolled to row 100 | 5000px | 98 → 111 | 100 → 109 |
| Bottom of list | 499,950px | 9986 → 9999 | 9990 → 9999 |

At every point, only ~14 DOM nodes exist. The other 9,986 rows do not exist in the DOM at all.

---

## Why `transform` / `translate` Instead of `top`

`react-window` uses `top` internally, but the reason it's GPU-friendly is that absolute positioning takes rows **out of normal document flow**. Moving them doesn't trigger a **reflow** (recalculating layout of other elements). It only triggers a **repaint** at most — and often just a **composite** if the browser promotes the layer to the GPU.

Compare that to a normal scrolling list where adding/removing items causes the entire list to reflow.

---

## The Context Trap — Why Local State Breaks

Since rows are **unmounted** when they scroll out of view, any local state inside a row component is destroyed.

```jsx
// ❌ This breaks with virtualization
function HotelRow({ index }) {
  const [isExpanded, setIsExpanded] = useState(false); // lost when row unmounts

  return (
    <div>
      <p>Hotel {index}</p>
      <button onClick={() => setIsExpanded(!isExpanded)}>Expand</button>
      {isExpanded && <p>Details...</p>}
    </div>
  );
}
```

User expands row 5. Scrolls down. Row 5 unmounts → `isExpanded` is lost. Scrolls back up. Row 5 remounts → `isExpanded` is `false` again. The expansion is gone.

```jsx
// ✅ Lift state outside the list
const expandedRows = useHotelStore((s) => s.expandedRows);   // Zustand
const toggleRow = useHotelStore((s) => s.toggleRow);

function HotelRow({ index }) {
  const isExpanded = expandedRows[index] ?? false;

  return (
    <div>
      <p>Hotel {index}</p>
      <button onClick={() => toggleRow(index)}>Expand</button>
      {isExpanded && <p>Details...</p>}
    </div>
  );
}
```

Now `isExpanded` lives in Zustand — outside React's component tree. When row 5 remounts, it reads the correct state from the store and renders expanded correctly.

---

## Summary

| What | How |
| :--- | :--- |
| Total DOM nodes | Fixed — only visible rows + overscan (~14), regardless of list size |
| Scroll illusion | Inner div height = `itemCount × itemSize` — makes scrollbar look real |
| Row positioning | `position: absolute; top: index × itemSize` — no layout dependency between rows |
| On scroll | Recalculate visible range from `scrollTop`, unmount out-of-view rows, mount new ones |
| GPU friendly | Absolute positioning skips reflow — only composite-level updates |
| State persistence | Local state is lost on unmount — always lift state to Zustand or TanStack Query |