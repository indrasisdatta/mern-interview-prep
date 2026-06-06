# CSS Layout — Deep Dive for Lead/Architect Interviews

> Cross-link: [Performance optimization](../performance-security/performance-optimization.txt) · [Web architecture](WebArchitecture.md) · [Browser rendering pipeline](browser-rendering-pipeline.md)

Modern CSS has *layered* layout systems — Block, Inline, Flexbox, Grid, Multicol — plus positioning, stacking, and containment. Interviewers test the "non-obvious mechanics" because they reveal who has actually shipped UI vs. who copied StackOverflow.

---

## 1. The CSS box model and containing blocks

Every element generates a **principal box** with content / padding / border / margin.

```
+--------------------------------+
|         margin                 |
|   +------------------------+   |
|   |       border           |   |
|   |  +------------------+  |   |
|   |  |     padding      |  |   |
|   |  |  +------------+  |  |   |
|   |  |  |  content   |  |  |   |
|   |  |  +------------+  |  |   |
|   |  +------------------+  |   |
|   +------------------------+   |
+--------------------------------+
```

`box-sizing` controls whether `width/height` includes padding+border:

```css
*, *::before, *::after { box-sizing: border-box; }
```

**Best practice:** set `border-box` globally. Without it, `width: 100%` + `padding: 16px` overflows the parent — a perennial bug.

### 1.1 Containing block — the most-asked-about-yet-misunderstood concept

The "containing block" determines where percentage-based dimensions resolve against and where `position: absolute` anchors.

| Element type | Containing block |
|--------------|------------------|
| Static / relative / sticky | Nearest **block** ancestor's content area |
| `position: fixed` | Viewport (default) OR nearest ancestor with `transform`, `filter`, `perspective`, `contain: paint`, `will-change: transform` (CB escape) |
| `position: absolute` | Nearest **positioned** ancestor (`relative`/`absolute`/`fixed`/`sticky`) |

**Gotcha:** `transform: translateZ(0)` on an ancestor breaks `position: fixed` — it becomes "fixed to the transformed ancestor" instead of viewport. Common cause of "my modal isn't centered on the screen after enabling GPU acceleration".

---

## 2. Flexbox — the practical model

`display: flex` creates a flex formatting context. One-dimensional layout (row OR column).

```
flex-direction: row →  [item1][item2][item3]
                       ----main axis---->
                       ↑
                       cross axis
```

### 2.1 Container properties

```css
.container {
  display: flex;
  flex-direction: row | row-reverse | column | column-reverse;
  flex-wrap: nowrap | wrap | wrap-reverse;
  justify-content: flex-start | center | space-between | space-around | space-evenly;
  align-items: stretch | flex-start | center | flex-end | baseline;
  align-content: /* for multi-line: space between rows */;
  gap: 16px;            /* preferred over margins for spacing */
}
```

### 2.2 Item properties — the `flex` shorthand

```css
.item { flex: <grow> <shrink> <basis>; }
```

| Shorthand | Expands to | Behavior |
|-----------|------------|----------|
| `flex: 1` | `1 1 0` | Grow to fill, can shrink, basis 0 (size purely by grow ratio) |
| `flex: auto` | `1 1 auto` | Grow + shrink based on content size |
| `flex: none` | `0 0 auto` | Fixed at content size — no grow/shrink |
| `flex: 0 0 200px` | — | Locked 200px width, no grow/shrink |

### 2.3 The "flex-basis: 0 vs auto" pitfall

```css
/* Want 3 equal-width columns regardless of content */
.col { flex: 1; }            // each col gets 1/3 of space, content-agnostic

/* Want 3 cols sized by content, then expand */
.col { flex: 1 1 auto; }     // longer text → wider col
```

### 2.4 `min-width: auto` — the silent breaker

Flex items default to `min-width: auto` (≈ "size to content"). This means a flex item with overflowing text *refuses to shrink below its content width*, breaking layouts:

```css
/* Fix: explicit min-width: 0 */
.col { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

This is THE answer to "my table column won't truncate text in a flex row".

### 2.5 Verizon billing summary example

```css
/* Billing card row: label on left, value on right, value never wraps */
.card-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 8px 0;
}
.card-row .label { color: #666; min-width: 0; flex: 1; overflow: hidden;
                   text-overflow: ellipsis; white-space: nowrap; }
.card-row .value { font-weight: 600; flex: none; }   /* never shrink */
```

---

## 3. CSS Grid — two-dimensional layout

`display: grid` defines rows AND columns simultaneously.

### 3.1 Defining tracks

```css
.grid {
  display: grid;
  grid-template-columns: 200px 1fr 1fr;        /* 3 cols */
  grid-template-rows: 60px auto 80px;          /* 3 rows */
  gap: 16px;
}
```

`1fr` = "one fraction of the remaining free space" (after fixed tracks are sized).

### 3.2 Named template areas — most readable for app shells

```css
.app {
  display: grid;
  grid-template-columns: 240px 1fr;
  grid-template-rows: 60px 1fr 40px;
  grid-template-areas:
    "header header"
    "sidebar main"
    "footer footer";
  height: 100vh;
}
.app > header { grid-area: header; }
.app > nav    { grid-area: sidebar; }
.app > main   { grid-area: main; overflow: auto; }
.app > footer { grid-area: footer; }
```

### 3.3 Responsive grid without media queries — the classic recipe

```css
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}
```

- `auto-fit`: empty columns *collapse*, remaining items stretch to fill
- `auto-fill`: empty columns *stay reserved*, items don't stretch
- `minmax(280px, 1fr)`: never narrower than 280px, otherwise share evenly

**Use `auto-fit` when you want content to feel full**, `auto-fill` when you want a stable grid (e.g., dashboard widgets).

### 3.4 Subgrid (Chrome 117+, Safari 16+, Firefox 71+)

Allows nested grids to align with their parent's tracks — fixes the historical "card grid where labels in different cards align" problem.

```css
.parent {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
}
.parent > .card {
  display: grid;
  grid-template-rows: subgrid;   /* inherit row tracks from parent */
  grid-row: span 3;
}
```

### 3.5 Grid vs Flexbox — when to use which

| Use Flexbox | Use Grid |
|-------------|----------|
| One-dimensional content flow (nav bar, toolbar) | Two-dimensional layout (page shell, card grid) |
| Content size drives layout | Layout drives content placement |
| Unknown/variable item count | Known structure with named regions |
| Order matters (flow direction) | Items placed by explicit coordinates |

You'll often nest them: outer Grid for page shell, inner Flex for a toolbar inside the header area.

---

## 4. Positioning — when and why

| Value | Behavior |
|-------|----------|
| `static` (default) | Normal flow, ignores top/left/etc. |
| `relative` | In flow, offsets shift element but reserve original space |
| `absolute` | Removed from flow, anchored to nearest positioned ancestor |
| `fixed` | Removed from flow, anchored to viewport (subject to ancestor `transform` gotcha) |
| `sticky` | Hybrid — in flow until scroll threshold, then fixed |

### 4.1 `position: sticky` — common pitfalls

```css
thead th { position: sticky; top: 0; background: white; z-index: 1; }
```

Sticky requires:
1. A scrollable ancestor (any with `overflow: auto/scroll/hidden`)
2. The element must be *taller than its scroll container's overflow*
3. Background color (else content scrolls visibly underneath)
4. `top`/`bottom` specified

**`overflow: hidden` on an ancestor breaks sticky** — common gotcha when adding `overflow: hidden` to round card corners.

### 4.2 Modal/dialog positioning — modern approach

Use the native `<dialog>` element + the **top layer**:

```html
<dialog id="myDialog">...</dialog>
<script>
  document.getElementById("myDialog").showModal();
</script>
```

`showModal()` places dialog in the browser's top layer — escapes all `z-index` and `transform` containing-block issues. Built-in focus trap and backdrop. Use this in new code.

For React, libraries like Radix UI's Dialog component handle the FocusTrap + ARIA semantics.

---

## 5. Stacking contexts and z-index

The single most-asked CSS architecture question: **"Why doesn't `z-index: 9999` work?"**

A stacking context is a self-contained "layer" where child z-indexes only compete with siblings inside that context — never escape it.

### 5.1 What creates a stacking context

- Root (`<html>`)
- `position: relative/absolute` + `z-index: <number>` (not `auto`)
- `position: fixed/sticky` (any z-index)
- `opacity < 1`
- `transform`, `filter`, `perspective`, `clip-path`, `mask`, `will-change` (any non-initial)
- `isolation: isolate` (the **explicit, intentional** way)
- Flex/grid item with `z-index`
- `contain: layout/paint/strict`

### 5.2 The fix: `isolation: isolate`

Suppose a sidebar card has `opacity: 0.95` → creates stacking context → its child modals can't appear over a sibling header with `z-index: 100`. Fix:

```css
.sidebar { isolation: isolate; }  /* documents the intent */
```

The cardinal rule: **stop adding higher z-indexes; find the stacking context creator instead.**

### 5.3 A team-friendly z-index scale

```css
:root {
  --z-base: 1;
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-overlay: 300;
  --z-modal: 400;
  --z-toast: 500;
  --z-tooltip: 600;
}
```

Never hard-code numbers in components. Always use tokens.

---

## 6. Container queries — game changer (2023+ stable)

Components that adapt to their *container size*, not viewport.

```css
.card-container {
  container-type: inline-size;   /* enables queries on width */
  container-name: card;          /* optional naming */
}

@container card (min-width: 400px) {
  .card { flex-direction: row; }
}
@container card (max-width: 399px) {
  .card { flex-direction: column; }
}
```

**Why this matters:** A `<Card>` component placed in a sidebar (narrow) vs main content (wide) can adapt without props. Before container queries, you had to thread `compact={true}` props or rely on viewport breakpoints (incorrect when sidebar size varies).

---

## 7. Logical properties (i18n-ready)

For Verizon / Citi global deployments — RTL languages (Arabic, Hebrew) need mirrored layouts.

| Physical | Logical |
|----------|---------|
| `margin-left` | `margin-inline-start` |
| `padding-right` | `padding-inline-end` |
| `top` / `bottom` | `inset-block-start` / `inset-block-end` |
| `width` | `inline-size` |
| `height` | `block-size` |
| `text-align: left` | `text-align: start` |

```css
.card {
  padding-inline: 16px;       /* both inline (left+right in LTR) */
  padding-block: 12px;        /* both block (top+bottom) */
  margin-inline-start: 8px;   /* "start" — switches with direction */
  border-inline-start: 4px solid var(--accent);
}

html[dir="rtl"] .card { /* nothing needed — logical props auto-mirror */ }
```

---

## 8. Modern viewport units

| Unit | Meaning |
|------|---------|
| `vw` / `vh` | Viewport width/height — includes mobile browser chrome (legacy) |
| `svw` / `svh` | **Small** viewport (browser chrome visible) |
| `lvw` / `lvh` | **Large** viewport (browser chrome hidden) |
| `dvw` / `dvh` | **Dynamic** viewport — updates as chrome shows/hides |

```css
/* Full-screen modal that works on mobile */
.modal { height: 100dvh; }
```

**Old `100vh` causes the classic iOS Safari problem** where bottom content gets cut off by the browser address bar.

---

## 9. Performance: layout-aware CSS

Some properties trigger layout (reflow), some only paint, some only composite. Animate the cheap ones.

| Action | Cost |
|--------|------|
| Change `width`, `height`, `top`, `left`, `padding`, `margin` | **Layout** (most expensive — reflows children) |
| Change `color`, `background-color`, `box-shadow` | **Paint** (medium) |
| Change `transform`, `opacity` | **Composite only** (cheapest — GPU) |

```css
/* Bad — animates 'left', triggers layout every frame */
.sidebar { transition: left 300ms; }
.sidebar.open { left: 0; }

/* Good — animates transform, composite-only */
.sidebar { transform: translateX(-100%); transition: transform 300ms; }
.sidebar.open { transform: translateX(0); }
```

### 9.1 `will-change` and `contain`

```css
.chart { will-change: transform; }  /* hint browser to promote to layer */

.virtual-list-row { contain: layout style paint; }
/* "Anything inside this row affects nothing outside" — browser can skip relayout
   of ancestors when row content changes. Huge win for 10k-row virtualized lists. */
```

**Don't overuse `will-change`** — promoting too many layers uses memory and can slow paint. Use only on actively animating elements.

---

## 10. CSS architecture for large apps

### 10.1 Methodologies

| Method | One-line summary |
|--------|------------------|
| BEM | `.block__element--modifier` — explicit naming |
| Utility-first (Tailwind) | `class="flex p-4 bg-white"` — atomic classes |
| CSS Modules | `import s from './x.module.css'; s.button` — scoped |
| CSS-in-JS (styled-components, Emotion) | Runtime CSS via JS — colocation but runtime cost |
| Zero-runtime CSS-in-JS (vanilla-extract, Linaria, Panda) | Type-safe styles compiled at build time |

**Architect take:** Tailwind has won for *new apps with strong design systems*. CSS Modules + design tokens is a safer choice for *team-owned design libraries* where consumers must not break invariants. CSS-in-JS runtime cost is a real concern at scale (re-renders cause style re-evaluation).

### 10.2 Design tokens with CSS custom properties

```css
:root {
  /* Spacing */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px;

  /* Color tokens (semantic, not raw) */
  --color-text: #1a1a1a;
  --color-text-muted: #666;
  --color-bg-canvas: #fff;
  --color-bg-surface: #f7f7f7;
  --color-accent: #0066cc;
  --color-danger: #c41e3a;
}

[data-theme="dark"] {
  --color-text: #e0e0e0;
  --color-bg-canvas: #0d0d0d;
  --color-bg-surface: #1a1a1a;
}
```

Tokens make dark mode + theming trivial — flip a data attribute on `<html>`, all custom properties cascade.

---

## 11. Common interview problems

### 11.1 "Center a div"

```css
/* Method 1: Flex */
.parent { display: flex; justify-content: center; align-items: center; }

/* Method 2: Grid (1 line) */
.parent { display: grid; place-items: center; }

/* Method 3: Absolute + transform */
.child { position: absolute; top: 50%; left: 50%;
         transform: translate(-50%, -50%); }
```

Use grid for vertical+horizontal centering — shortest, no flex pitfalls.

### 11.2 "Sticky footer" (footer at bottom even if content is short)

```css
body { min-height: 100dvh; display: flex; flex-direction: column; }
main { flex: 1; }   /* takes remaining space */
footer { /* sits at bottom */ }
```

### 11.3 "Holy grail layout"

App shell with header, footer, sidebar(s), main content:

```css
.app {
  display: grid;
  grid-template: "header header header" 60px
                 "left main right"      1fr
                 "footer footer footer" 40px / 200px 1fr 200px;
  min-height: 100dvh;
}
```

### 11.4 "Responsive card grid"

```css
.grid { display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr));
        gap: 16px; }
```

`min(280px, 100%)` prevents the "card wider than viewport" overflow on narrow screens.

### 11.5 "Make an image cover its container without distortion"

```css
img { width: 100%; height: 100%; object-fit: cover; object-position: center; }
```

`object-fit: cover` is to images what `background-size: cover` is to backgrounds.

---

## 12. Print and accessibility-adjacent considerations

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}

@media (prefers-color-scheme: dark) { /* dark mode */ }
@media (prefers-contrast: more)     { /* high contrast */ }
@media print                        { /* print styles */ }
```

See [accessibility.md](accessibility.md) for full a11y coverage including focus-visible, color contrast, and reduced motion.

---

## 13. Interview talking points

**Q: "I have `position: fixed; top: 0` and it's not at the top of the viewport — why?"**
A: An ancestor has `transform`, `filter`, or `will-change: transform`, which establishes a containing block for fixed-positioned descendants. Find that ancestor and remove the transform OR move the fixed element out of that subtree.

**Q: "`z-index: 9999` isn't working."**
A: Stacking context. Add `isolation: isolate` to the parent that should contain the layering, OR find the ancestor creating a stacking context (opacity < 1, transform, filter, etc.) that's trapping your high z-index.

**Q: "Why use Grid over Flexbox for an app shell?"**
A: Grid is 2D — header/sidebar/main/footer placement happens once with `grid-template-areas`. Flexbox would need nested containers (vertical flex with horizontal flex inside). Grid also supports `subgrid` for aligning nested elements with the parent's tracks.

**Q: "How do you optimize CSS for performance?"**
A: Three levers — (1) animate `transform`/`opacity` only, (2) use `contain` on virtualized list rows to scope reflows, (3) bundle critical CSS inline and lazy-load route-specific CSS. Plus the usual: minify, dedupe, drop unused selectors, use design tokens to eliminate duplicate declarations.

**Q: "Tailwind vs CSS-in-JS — which would you pick for a new project?"**
A: Tailwind for new product code with a fast-moving team and shared design language — better LCP, no runtime overhead, autocomplete-driven. CSS-in-JS for component libraries where consumers need theming via props. Zero-runtime alternatives (vanilla-extract) are the modern middle ground.

---

## 14. Appendix — useful snippets

### 14.1 Aspect-ratio box (no more padding-hack)

```css
.video-thumb { aspect-ratio: 16 / 9; width: 100%; background: #000; }
```

### 14.2 Truncate to N lines

```css
.clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

### 14.3 Scroll-snap carousel

```css
.scroller { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; }
.scroller > * { scroll-snap-align: start; flex: 0 0 100%; }
```

### 14.4 Smooth scroll respecting reduced-motion

```css
html { scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
```
