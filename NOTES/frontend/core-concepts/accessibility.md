# Accessibility (a11y) — WCAG, ARIA, and Production Patterns

> Cross-link: [CSS Layout Deep](css-layout-deep.md) · [React advanced topics](../react/advanced-topics.md) · [Web architecture](WebArchitecture.md)
>
> For a UI Lead, accessibility is no longer optional. ADA lawsuits, government procurement requirements (EAA in EU, Section 508 in US), and major-bank compliance audits all gate on WCAG 2.1/2.2 conformance. This note covers what gets asked in architect interviews and what teams actually ship.

---

## 1. WCAG — the standard

**WCAG 2.2** (Oct 2023, current) is the working spec. **WCAG 3.0** is in draft — not yet citable in audits.

### 1.1 The four POUR principles

| Principle | What it means | Examples of failure |
|-----------|--------------|---------------------|
| **P**erceivable | Users can perceive the info | Missing `alt`, low color contrast, captions absent |
| **O**perable | Users can operate the UI | Focus trap broken, click-only events, no keyboard nav |
| **U**nderstandable | UI behaves predictably | Surprise context changes, unlabeled inputs |
| **R**obust | Works with assistive tech | Custom widgets without ARIA, brittle DOM |

### 1.2 Conformance levels

- **A** — minimum (must-have)
- **AA** — industry standard target (most legal requirements)
- **AAA** — aspirational (rarely fully achieved)

Citi/Verizon-tier enterprise apps must hit **WCAG 2.2 AA**.

### 1.3 The most-tested 2.2 success criteria

| SC | Requirement | What it looks like in code |
|----|-------------|----------------------------|
| 1.1.1 | Non-text content has text alternative | `<img alt="..."/>`, `aria-label` |
| 1.3.1 | Info & relationships programmatically determinable | Use semantic HTML; `<th scope="col">`, `<label for>` |
| 1.4.3 | Color contrast ≥ 4.5:1 (text), 3:1 (large text/UI) | Test with axe/Lighthouse |
| 1.4.10 | Reflow at 320px without horizontal scroll | Use container queries, avoid fixed widths |
| 1.4.11 | Non-text contrast ≥ 3:1 | Button borders, focus rings, icons |
| 2.1.1 | Keyboard accessible | All interactions reachable via Tab/Enter/Space |
| 2.1.2 | No keyboard trap | Focus can move out of any region |
| 2.4.3 | Focus order is logical | DOM order matches visual order |
| 2.4.7 | Focus visible | Never set `outline: none` without alternative |
| 2.4.11 (2.2) | Focus not obscured (minimum) | Sticky headers must not hide focused element |
| 2.5.7 (2.2) | Drag → also doable without dragging | Provide alt click path for drag-drop |
| 2.5.8 (2.2) | Target size ≥ 24×24 CSS px | Avoid tiny click targets |
| 3.3.7 (2.2) | Accessible authentication | No CAPTCHA-only login; password autofill works |
| 4.1.2 | Name, Role, Value programmatic | Use `role`, `aria-*` for custom widgets |
| 4.1.3 | Status messages via live regions | Toasts, loading announcements |

---

## 2. Semantic HTML — the foundation

**Rule #1: Use the right element.** A correctly-coded `<button>` ships with focus styles, Enter/Space activation, role, name, and disabled state for free. A `<div onClick>` ships with zero of those.

```html
<!-- BAD -->
<div class="btn" onClick={save}>Save</div>

<!-- GOOD -->
<button type="button" onClick={save}>Save</button>
```

### 2.1 Landmark elements

```html
<header>     <!-- top of page -->
<nav>        <!-- primary navigation -->
<main>       <!-- one per page, primary content -->
<aside>      <!-- complementary -->
<footer>     <!-- bottom of page -->
<section>    <!-- thematic grouping (with heading) -->
<article>    <!-- self-contained item -->
```

Screen reader users navigate by landmark — `<main>` lets them skip nav. **Don't wrap everything in `<div>`** then add `role="main"` — use semantic elements.

### 2.2 Heading hierarchy

```html
<h1>Page title (one per page)</h1>
  <h2>Section</h2>
    <h3>Subsection</h3>
  <h2>Another section</h2>
```

Screen readers offer a "headings list" navigation. Skipping levels (`h1` → `h3`) breaks expectations.

### 2.3 Lists

Sets of items should be marked up as `<ul>`/`<ol>`/`<li>`. Screen readers announce "list with 5 items" — critical context lost when using `<div>`s.

### 2.4 Tables

```html
<table>
  <caption>Fund NAVs as of 2026-06-05</caption>
  <thead>
    <tr>
      <th scope="col">Fund</th>
      <th scope="col">NAV</th>
      <th scope="col">Change</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <th scope="row">Citi Growth Fund A</th>
      <td>$102.45</td>
      <td>+0.45</td>
    </tr>
  </tbody>
</table>
```

`<caption>` + `<th scope>` is what makes data tables actually accessible. Layout tables (DON'T) need `role="presentation"` — but use CSS Grid instead.

---

## 3. ARIA — when (and when NOT) to use it

The **first rule of ARIA**: don't use ARIA. Native HTML elements are accessible by default. ARIA exists to bridge gaps when you must build custom widgets.

### 3.1 The three pillars

| Concept | Purpose | Example |
|---------|---------|---------|
| **Role** | What kind of element this is | `role="tab"`, `role="dialog"` |
| **Properties** | Static characteristics | `aria-label`, `aria-describedby` |
| **States** | Dynamic, change over time | `aria-expanded`, `aria-selected`, `aria-busy` |

### 3.2 Naming an element

Priority order browsers/screen readers use:
1. `aria-labelledby="otherId"` (references another element's text)
2. `aria-label="explicit string"`
3. The element's own text content
4. `title` (last resort — only works on mouse hover)

```html
<!-- Icon-only button needs a name -->
<button aria-label="Close dialog"><svg>×</svg></button>

<!-- Field labeled by another element -->
<label id="lblQty">Quantity</label>
<input type="number" aria-labelledby="lblQty"/>

<!-- Use input + label for form fields when possible -->
<label for="qty">Quantity</label>
<input id="qty" type="number"/>
```

### 3.3 Common ARIA patterns by widget

#### Toggle button

```html
<button type="button" aria-pressed="false" onClick={togglePin}>
  📌 Pin
</button>
```

#### Disclosure (collapsible panel)

```html
<button aria-expanded="false" aria-controls="panel1">Details</button>
<div id="panel1" hidden>...</div>
```

#### Tabs

```html
<div role="tablist" aria-label="Order details">
  <button role="tab" id="tab-1" aria-selected="true"  aria-controls="panel-1" tabindex="0">Summary</button>
  <button role="tab" id="tab-2" aria-selected="false" aria-controls="panel-2" tabindex="-1">Items</button>
</div>
<div role="tabpanel" id="panel-1" aria-labelledby="tab-1">...</div>
<div role="tabpanel" id="panel-2" aria-labelledby="tab-2" hidden>...</div>
```

Arrow keys move between tabs (custom JS), Tab moves to first tabpanel.

#### Dialog (modal)

Prefer **native `<dialog>`** with `showModal()` — gets focus trap, ESC handling, ARIA, top-layer placement for free.

```html
<dialog aria-labelledby="dlgTitle">
  <h2 id="dlgTitle">Confirm</h2>
  ...
</dialog>
```

#### Combobox / autocomplete

Pattern is complex — use a library (Radix, Headless UI, Reach) unless you have a *very* good reason. See [Autocomplete FE-SD case study](frontend-system-design-practice/practice-questions/1-Autocomplete/).

### 3.4 Anti-patterns

```html
<!-- BAD: redundant role -->
<button role="button">Save</button>

<!-- BAD: aria-label on element with visible text (conflicts) -->
<button aria-label="Submit form">Save</button>

<!-- BAD: hidden + aria-hidden together -->
<div hidden aria-hidden="true">...</div>     <!-- hidden already hides -->

<!-- BAD: positive tabindex (reorders focus, breaks expectations) -->
<input tabindex="5"/>                         <!-- never positive -->

<!-- OK: -1 to make focusable programmatically but skip Tab order -->
<div tabindex="-1" ref={focusOnError}/>
```

---

## 4. Focus management

### 4.1 Visible focus indicators

```css
/* Don't do this without a replacement */
button:focus { outline: none; }   /* BAD — keyboard users lose focus location */

/* Modern, recommended */
button:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

`:focus-visible` shows the ring **only for keyboard focus**, not mouse clicks — best of both worlds.

### 4.2 Programmatic focus

```jsx
function CommandPalette({ open }) {
  const inputRef = useRef(null);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  return open ? <input ref={inputRef} /> : null;
}
```

### 4.3 Focus restoration after modal close

```jsx
function Modal({ open, onClose, children }) {
  const triggerRef = useRef(null);   // store opening element

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement;   // remember
    } else if (triggerRef.current) {
      triggerRef.current.focus();   // restore on close
    }
  }, [open]);
  ...
}
```

### 4.4 Focus traps

In modals, focus must cycle within the dialog. Library: `focus-trap-react`. Or use native `<dialog showModal()>` which handles trap automatically.

```jsx
import { FocusTrap } from "focus-trap-react";

<FocusTrap active={open}>
  <div role="dialog" aria-modal="true">...</div>
</FocusTrap>
```

### 4.5 Skip links

A keyboard user shouldn't tab through 50 nav items to reach content. Provide:

```html
<a href="#main" class="skip-link">Skip to main content</a>
<main id="main">...</main>
```

```css
.skip-link {
  position: absolute; top: -40px; left: 0;
  background: #000; color: #fff; padding: 8px 16px;
  z-index: 1000;
}
.skip-link:focus { top: 0; }  /* visible only when focused */
```

---

## 5. Keyboard interaction patterns

| Widget | Required keys |
|--------|---------------|
| Button | Enter, Space → activate |
| Link | Enter → activate |
| Checkbox | Space → toggle |
| Radio group | Arrow keys → move + select; Tab moves between groups |
| Tabs | Arrow keys → switch tabs; Tab → into tabpanel |
| Listbox / Combobox | Arrow keys, Home/End, type-ahead |
| Menu | Arrow keys, Esc closes |
| Slider | Arrow keys (small step), Page Up/Down (large step) |
| Modal | Esc closes, Tab cycles inside |
| Tree | Arrow keys (left/right expand/collapse) |

Reference: [WAI-ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/patterns/).

---

## 6. Color and contrast

### 6.1 Contrast ratios (WCAG AA)

- **Body text:** 4.5:1
- **Large text (18pt+ regular or 14pt+ bold):** 3:1
- **UI components (buttons, form borders, icons):** 3:1

Tools: WebAIM Contrast Checker, Chrome DevTools color picker (auto-shows ratio), Lighthouse.

### 6.2 Don't rely on color alone

```html
<!-- BAD: red border only -->
<input class="error" placeholder="Email"/>

<!-- GOOD: red + icon + text -->
<label for="email">Email <span aria-hidden="true">*</span></label>
<input id="email" aria-invalid="true" aria-describedby="emailErr"/>
<span id="emailErr" class="error">
  <Icon name="warn"/> Enter a valid email
</span>
```

### 6.3 Color tokens with accessible defaults

```css
:root {
  --color-text: #1a1a1a;          /* #1a1a1a on #fff = 18.1:1 */
  --color-text-muted: #595959;    /* on #fff = 7:1 */
  --color-link: #0a58ca;          /* on #fff = 5.5:1 */
  --color-danger-fg: #b91c1c;     /* on #fff = 7:1 */
}
```

---

## 7. Forms

### 7.1 Labels — every input needs one

```html
<!-- Explicit label (preferred) -->
<label for="email">Email</label>
<input id="email" type="email" autocomplete="email"/>

<!-- Wrapping label -->
<label>
  Email
  <input type="email" autocomplete="email"/>
</label>

<!-- aria-label when visual label is undesirable -->
<input type="search" aria-label="Search products"/>
```

`autocomplete` is critical for users with motor disabilities or those using password managers.

### 7.2 Error messaging

```html
<label for="qty">Quantity</label>
<input id="qty" type="number"
       aria-invalid="true"
       aria-describedby="qtyHelp qtyErr"/>
<span id="qtyHelp">Whole numbers only.</span>
<span id="qtyErr" role="alert">Must be between 1 and 100.</span>
```

- `aria-invalid="true"` marks the field as in error
- `aria-describedby` points to help + error text
- `role="alert"` makes errors announce when they appear

### 7.3 Required fields

```html
<label for="email">Email <span aria-hidden="true">*</span></label>
<input id="email" type="email" required aria-required="true"/>
```

The `*` is decorative — `required` + `aria-required` does the semantic work.

---

## 8. Live regions — announcing changes

For dynamic content (toasts, status updates, streaming RAG responses) that changes without user action, screen readers won't notice unless you tell them.

```html
<!-- Polite: announce after current speech finishes -->
<div role="status" aria-live="polite">Saved.</div>

<!-- Assertive: interrupt immediately (use sparingly) -->
<div role="alert" aria-live="assertive">Connection lost — retrying.</div>

<!-- Atomic: re-read entire region on any change -->
<div aria-live="polite" aria-atomic="true">
  3 of 10 items uploaded
</div>
```

### 8.1 RAG streaming chat (Verizon use case)

```jsx
function StreamingMessage({ tokens }) {
  return (
    <article aria-label="Assistant response">
      <div aria-live="polite" aria-atomic="false">
        {tokens.join("")}
      </div>
      {/* aria-atomic="false" → only NEW tokens get announced, not the whole message */}
    </article>
  );
}
```

For long streamed responses, debounce announcements (e.g., announce every sentence boundary) — otherwise screen readers fall behind.

---

## 9. Charts and data visualizations (Verizon billing dashboard)

Canvas-based charts (D3, Chart.js, Recharts) are invisible to screen readers by default. Three strategies:

### 9.1 Provide an accessible summary

```html
<figure>
  <canvas aria-labelledby="chartTitle" aria-describedby="chartSummary"></canvas>
  <figcaption id="chartTitle">Monthly Revenue 2026</figcaption>
  <p id="chartSummary" class="sr-only">
    Revenue rose from $1.2M in January to $2.4M in May, with a dip to
    $1.8M in March. May represents a 100% year-over-year increase.
  </p>
</figure>
```

### 9.2 Provide a tabular alternative

```html
<button aria-controls="dataTable" aria-expanded="false">View data table</button>
<table id="dataTable" hidden>...</table>
```

### 9.3 Generate ARIA tree from chart data

Recharts and Chart.js v4+ support `role` and `aria-label` on data points. SVG-based charts can mark each `<path>` with an accessible label.

---

## 10. Testing accessibility

### 10.1 Automated tools (catches ~30% of issues)

| Tool | What it does |
|------|--------------|
| **axe-core** | Industry standard a11y engine — used by Lighthouse, dev tools, jest plugins |
| **jest-axe** | Run axe in unit tests |
| **@axe-core/playwright** | E2E a11y assertions |
| **Lighthouse** | Audit including a11y score |
| **WAVE** | Browser extension overlay |
| **Storybook a11y addon** | Per-component a11y warnings |

```js
// Jest example — Citi CWO fund-NAV table
import { axe, toHaveNoViolations } from "jest-axe";
expect.extend(toHaveNoViolations);

test("NAV table is accessible", async () => {
  const { container } = render(<NavTable funds={mockFunds} />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

### 10.2 Manual testing (catches the other 70%)

- **Keyboard-only:** unplug mouse, tab through the entire app
- **Screen reader:** macOS VoiceOver (Cmd+F5), Windows NVDA (free), JAWS (paid, used in enterprise)
- **200% zoom + reflow** at 320px width
- **Forced colors / High contrast** mode (Windows)
- **Reduced motion** (`prefers-reduced-motion`)

### 10.3 Practical screen reader commands

| Action | NVDA | VoiceOver |
|--------|------|-----------|
| Toggle on | Ctrl+Alt+N | Cmd+F5 |
| Read all | Insert+Down | VO+A |
| Headings list | Insert+F7 → Headings | VO+U |
| Landmarks list | Insert+F7 → Landmarks | VO+U |
| Forms list | Insert+F7 → Form fields | VO+U |
| Next heading | H | VO+Cmd+H |

---

## 11. Common React a11y mistakes & fixes

```jsx
// BAD: div with onClick — not keyboard accessible
<div onClick={save}>Save</div>

// GOOD
<button type="button" onClick={save}>Save</button>


// BAD: Conditional rendering breaks live regions
{loading && <span aria-live="polite">Loading...</span>}

// GOOD: keep the live region in DOM, toggle its content
<span aria-live="polite">{loading ? "Loading..." : ""}</span>


// BAD: tabIndex={0} on non-interactive elements without role
<div tabIndex={0}>Card</div>   // focusable but ambiguous to AT

// GOOD: only if you've added a role + key handlers
<div role="button" tabIndex={0} onClick={handle}
     onKeyDown={(e) => e.key === "Enter" && handle()}>Card</div>


// BAD: autoFocus on every modal field
<input autoFocus />  // jarring, can disorient screen reader users

// GOOD: focus the first error or first field on mount, only on intent
useEffect(() => { firstFieldRef.current?.focus(); }, [open]);
```

---

## 12. The `sr-only` (screen-reader-only) utility class

```css
.sr-only {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

Use to add visually-hidden text screen readers will announce:

```html
<button>
  <Icon name="delete"/>
  <span class="sr-only">Delete order #12345</span>
</button>
```

Don't use `display: none` or `visibility: hidden` — both hide content from screen readers.

---

## 13. Document structure & metadata

```html
<!doctype html>
<html lang="en">       <!-- ALWAYS set lang — controls screen reader voice -->
<head>
  <title>Order #12345 — Verizon Auto Triaging</title>
  <!-- Title is announced on page load -->
</head>
<body>
  <header>...</header>
  <nav aria-label="Primary">...</nav>
  <main id="main">
    <h1>Page title</h1>
    ...
  </main>
  <footer>...</footer>
</body>
</html>
```

For SPAs, update `<title>` and announce route changes:

```jsx
function useRouteAnnouncement(title) {
  useEffect(() => {
    document.title = title;
    // Announce via live region
    announce(`Navigated to ${title}`);
  }, [title]);
}
```

---

## 14. Architect-level concerns

### 14.1 Build accessibility into the design system

- Every primitive (Button, Input, Dialog) ships with correct ARIA + focus styles
- Component API forces accessible naming: `aria-label` or visible label required
- Storybook a11y addon runs on every story
- Visual regression tests use forced-colors / dark mode

### 14.2 a11y in CI

```yaml
# .github/workflows/a11y.yml
- run: npm run build
- run: npx start-server-and-test "npm run preview" 4173 \
        "npx pa11y-ci --sitemap http://localhost:4173/sitemap.xml"
```

### 14.3 Document your conformance

Publish a **VPAT (Voluntary Product Accessibility Template)** describing how your product meets each WCAG criterion. Procurement teams at banks/govs demand it.

### 14.4 Train the team

Per-PR a11y review checklist:
- [ ] Keyboard tab order makes sense
- [ ] All interactive elements have visible focus
- [ ] All images have alt
- [ ] All form fields have labels
- [ ] Color contrast passes
- [ ] Error states use aria-invalid + aria-describedby
- [ ] No new `outline: none` without replacement

---

## 15. Interview talking points

**Q: "What does WCAG 2.2 AA mean for your team's day-to-day work?"**
A: Three things: (1) every new component must pass axe with zero violations in CI; (2) every PR is keyboard-tested by the author; (3) we own a VPAT that gets updated each release. We assume any large enterprise customer's procurement will demand it.

**Q: "A designer wants you to remove the focus outline because it 'looks ugly'. What do you do?"**
A: Push back, but propose a replacement. `:focus-visible` + a custom focus ring that matches the design language. Focus indicators are WCAG 2.4.7 — a non-negotiable A-level criterion. I'd also show them keyboard-only navigation in our app to make the concern concrete.

**Q: "How do you handle accessibility for canvas-based charts?"**
A: Three-layer approach — (1) descriptive `aria-label` + summary text describing the trend; (2) toggleable data table alternative for screen reader users; (3) keyboard nav between data points using arrow keys with `role="application"` and announce values. Recharts and visx have decent built-ins; pure D3 needs hand-rolled labels.

**Q: "How do you make a streaming AI response accessible?"**
A: Use `aria-live="polite"` with `aria-atomic="false"` so only new tokens announce. But debounce — screen readers fall behind on every-token announcements. Announce at sentence boundaries or every ~500ms. On stream complete, fire an "assistant has finished responding" announcement.

**Q: "What's the difference between `aria-hidden` and `hidden`?"**
A: `hidden` (or `display: none`) removes from accessibility tree AND visual tree. `aria-hidden="true"` removes from accessibility tree only — element still rendered visually. Use `aria-hidden` for decorative icons inside buttons that have a visible/aria label. Never put `aria-hidden` on focusable elements — focus + hidden-from-AT is a confusing trap.

---

## 16. References

- [WCAG 2.2 Quick Reference](https://www.w3.org/WAI/WCAG22/quickref/)
- [WAI-ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [Deque University](https://dequeuniversity.com/) — paid but worth it for compliance teams
- [Inclusive Components by Heydon Pickering](https://inclusive-components.design/)
- [a11ymatters.com](https://www.a11ymatters.com/)
