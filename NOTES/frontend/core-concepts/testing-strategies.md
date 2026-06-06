# Testing Strategies — Jest, RTL, MSW, E2E

> Cross-link: [React advanced topics](../react/advanced-topics.md) · [TanStack Query notes](../react/tanstack-query.txt) · [Accessibility](accessibility.md)
>
> Your resume cites Jest + RTL + MSW + Husky CI as quality governance lever — interviewers will probe how deep that goes. This note covers the full testing strategy a lead is expected to define.

---

## 1. The test pyramid (and why it still matters)

```
                    /\
                   /E2E\        few, slow, brittle, $$$
                  /------\
                 /Integr. \    some, medium speed
                /----------\
               /   Unit     \  many, fast, cheap
              /--------------\
```

A senior must define the **ratio** for their org. Typical healthy split:
- **Unit:** 70-80% — pure functions, hooks, components in isolation
- **Integration:** 15-25% — multiple components + real data layer (with MSW)
- **E2E:** 3-5% — golden-path user journeys in a real browser

### 1.1 The "Testing Trophy" alternative (Kent C. Dodds)

For component-heavy React apps, Dodds argues integration tests have the best ROI:

```
              /---\
             | E2E |
             /-----\
            |Integr.|    ← biggest slice
           /---------\
          |   Unit    |
         /-------------\
        |    Static    |   ← TS, ESLint
```

**Architect takeaway:** the pyramid is right for backend-heavy systems with complex logic; the trophy is right for UI-heavy React apps where you mostly orchestrate, not compute. Pick consciously.

---

## 2. Jest — the runner and assertion library

### 2.1 Anatomy of a test

```js
import { add } from "./math";

describe("add", () => {
  it("adds positive numbers", () => {
    expect(add(2, 3)).toBe(5);
  });

  it("handles negative", () => {
    expect(add(-1, 1)).toBe(0);
  });

  it.each([
    [1, 1, 2],
    [-1, 1, 0],
    [0, 0, 0],
  ])("add(%i, %i) = %i", (a, b, expected) => {
    expect(add(a, b)).toBe(expected);
  });
});
```

### 2.2 Matchers cheat-sheet

| Matcher | Use |
|---------|-----|
| `toBe(v)` | `===` equality (primitives, ref equality) |
| `toEqual(v)` | Deep equality (objects, arrays) |
| `toStrictEqual(v)` | `toEqual` + checks types, no undefined props |
| `toMatchObject(v)` | Subset match — checks listed keys only |
| `toContain(v)` | Array/string contains |
| `toHaveLength(n)` | `.length` check |
| `toThrow(err?)` | Function throws |
| `toHaveBeenCalled()` / `toHaveBeenCalledWith(...)` | Mock assertions |
| `toMatchSnapshot()` | Snapshot — use sparingly |
| `toBeCloseTo(v, dp)` | Floats with precision |
| `toBeInstanceOf(Cls)` | Constructor check |

### 2.3 Mocking — three flavors

```js
// 1. jest.fn() — manual mock
const cb = jest.fn();
cb.mockReturnValue(42);
cb.mockResolvedValueOnce("ok");
expect(cb).toHaveBeenCalledWith(expect.any(Number));

// 2. jest.spyOn() — wrap existing method
const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
// runs original by default; mockImplementation overrides
spy.mockRestore();

// 3. jest.mock() — module-level mock (hoisted)
jest.mock("./api", () => ({
  fetchNAV: jest.fn().mockResolvedValue({ fundA: 102.5 }),
}));
```

### 2.4 The hoisting gotcha

`jest.mock(...)` is hoisted to the top of the file at compile time. You cannot reference outer variables unless they start with `mock` (Jest's escape hatch):

```js
const mockFetcher = jest.fn();   // must start with "mock"
jest.mock("./api", () => ({ fetchNAV: mockFetcher }));
```

### 2.5 Setup / teardown

```js
beforeAll(() => { /* once, before any test */ });
beforeEach(() => { /* before each */ });
afterEach(() => { jest.clearAllMocks(); });
afterAll(() => { /* once, after all */ });
```

`clearAllMocks` vs `resetAllMocks` vs `restoreAllMocks`:
- **clear:** clears call history only
- **reset:** clear + remove implementations
- **restore:** restore original (for spies)

---

## 3. React Testing Library (RTL) — testing philosophy

> **"The more your tests resemble the way your software is used, the more confidence they can give you."** — Kent C. Dodds

RTL pushes you to query the DOM like a user would — by **role**, **label**, **text** — not by implementation details (class names, test IDs everywhere, internal state).

### 3.1 Query priority order

Use queries in this order; only fall back if higher-priority ones don't work:

1. **Accessible to everyone**
   - `getByRole` (most preferred — combines role + name)
   - `getByLabelText` (form fields)
   - `getByPlaceholderText`
   - `getByText`
   - `getByDisplayValue`
2. **Semantic queries**
   - `getByAltText`
   - `getByTitle`
3. **Last resort**
   - `getByTestId`

```js
// BAD — implementation detail
screen.getByClassName("submit-btn");

// GOOD — what the user sees/interacts with
screen.getByRole("button", { name: /save/i });
```

### 3.2 `get*` vs `query*` vs `find*`

| Variant | Match found | No match | Multiple matches |
|---------|-------------|----------|------------------|
| `getBy*` | element | **throws** | throws |
| `queryBy*` | element | **null** | throws |
| `findBy*` | promise → element | **rejects after timeout** | rejects |
| `getAllBy*` | array | throws | array |
| `findAllBy*` | promise → array | rejects | array |

**Rule of thumb:**
- `getBy*` — element must exist now
- `queryBy*` — element should NOT exist (`expect(...).not.toBeInTheDocument()`)
- `findBy*` — element will appear after async work

### 3.3 Citi CWO fund-NAV component test

```jsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FundNAVPanel } from "./FundNAVPanel";

test("displays NAV when fund selected and approves it", async () => {
  const user = userEvent.setup();
  const onApprove = jest.fn();
  render(<FundNAVPanel onApprove={onApprove} />);

  // Select a fund — combobox role
  await user.click(screen.getByRole("combobox", { name: /fund/i }));
  await user.click(screen.getByRole("option", { name: /citi growth fund a/i }));

  // NAV displays
  expect(await screen.findByRole("status")).toHaveTextContent(/\$102\.45/);

  // Approve
  await user.click(screen.getByRole("button", { name: /approve nav/i }));
  expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({
    fundId: "fund-a",
    nav: 102.45,
  }));
});
```

Why this test is good:
- Queries match how a screen reader / keyboard user perceives the UI
- No mention of CSS classes or internal state
- Asserts user-visible outcome (NAV text + callback fired with correct shape)

### 3.4 `userEvent` vs `fireEvent`

```js
import { fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// fireEvent: low-level, single synthetic event
fireEvent.click(button);

// userEvent: high-fidelity, mimics real user (focus, mousedown, mouseup, click)
const user = userEvent.setup();
await user.click(button);
await user.type(input, "hello");
await user.keyboard("{Tab}");
```

**Always prefer userEvent.** `fireEvent.click` fires only `click` — missing focus events, which means your `onFocus`/`:focus-visible` paths go untested.

### 3.5 Testing hooks (renderHook)

```js
import { renderHook, act, waitFor } from "@testing-library/react";
import { useCounter } from "./useCounter";

test("useCounter increments", async () => {
  const { result } = renderHook(() => useCounter(0));

  expect(result.current.count).toBe(0);

  act(() => { result.current.increment(); });
  expect(result.current.count).toBe(1);
});

// For hooks requiring providers:
const wrapper = ({ children }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);
const { result } = renderHook(() => useNAVQuery("fund-a"), { wrapper });
```

---

## 4. MSW — Mock Service Worker

MSW intercepts network requests at the **Service Worker** layer (or via Node interceptors in tests). Your component code calls real `fetch`/`axios`; MSW responds with mocked data.

### 4.1 Why MSW > inline mocks

| Approach | Problem |
|----------|---------|
| `jest.mock("./api", ...)` | Mocks the *function* — couples test to internal API shape |
| `jest.spyOn(global, "fetch")` | Tests are specific to fetch impl — fragile |
| **MSW** | Mocks the *HTTP request* — code is exercised as in production |

### 4.2 Setup (Jest + Node)

```js
// src/test/handlers.ts
import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/funds/:fundId/nav", ({ params }) => {
    return HttpResponse.json({ fundId: params.fundId, nav: 102.45, asOfDate: "2026-06-05T00:00:00Z" });
  }),
  http.post("/api/funds/:fundId/approve", async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({ id: "approval-1", ...body });
  }),
];
```

```js
// src/test/server.ts
import { setupServer } from "msw/node";
import { handlers } from "./handlers";
export const server = setupServer(...handlers);
```

```js
// jest.setup.ts
import { server } from "./src/test/server";
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### 4.3 Override per test (error paths)

```js
import { server } from "./test/server";
import { http, HttpResponse } from "msw";

test("shows error when NAV API fails", async () => {
  server.use(
    http.get("/api/funds/:fundId/nav", () =>
      new HttpResponse(null, { status: 500 })
    )
  );

  render(<FundNAVPanel />);
  expect(await screen.findByRole("alert"))
    .toHaveTextContent(/failed to load nav/i);
});
```

### 4.4 MSW for streaming responses (RAG chat)

```js
http.get("/api/chat/stream", () => {
  const stream = new ReadableStream({
    start(controller) {
      const tokens = ["Hello", " ", "world"];
      tokens.forEach((t, i) =>
        setTimeout(() => controller.enqueue(new TextEncoder().encode(`data: ${t}\n\n`)), i * 50)
      );
      setTimeout(() => controller.close(), 200);
    },
  });
  return new HttpResponse(stream, { headers: { "Content-Type": "text/event-stream" } });
});
```

Lets you test SSE/streaming UI without standing up a real backend.

---

## 5. Integration tests — multiple components + data layer

These are the "trophy" — high ROI for React apps.

```jsx
// Test the entire NAV submission flow end-to-end (with MSW as backend)
test("user can submit a fund NAV approval", async () => {
  const user = userEvent.setup();
  render(<App />, { wrapper: AllProviders });

  // 1. Navigate
  await user.click(screen.getByRole("link", { name: /fund nav/i }));

  // 2. Fund list loads (MSW returns mock funds)
  expect(await screen.findByRole("row", { name: /citi growth fund a/i }))
    .toBeInTheDocument();

  // 3. Click into one
  await user.click(screen.getByRole("link", { name: /citi growth fund a/i }));

  // 4. NAV value displays
  expect(await screen.findByText(/\$102\.45/)).toBeInTheDocument();

  // 5. Approve
  await user.click(screen.getByRole("button", { name: /approve/i }));
  expect(await screen.findByRole("status"))
    .toHaveTextContent(/approval submitted/i);
});
```

This single test covers: router, list view, detail view, data fetching, mutation, toast notification. Much more confidence per dollar than 5 unit tests.

---

## 6. Snapshot testing — when to use, when NOT

```jsx
const { container } = render(<Button>Save</Button>);
expect(container).toMatchSnapshot();
```

**OK use cases:**
- Pure presentational components with stable markup
- Visual regression (paired with image diff tool — see Chromatic, Percy)

**Bad use cases:**
- Anything dynamic — dates, random IDs, generated keys
- Large component trees — snapshots become unreadable noise
- Anything where the snapshot is "approved" without reading

**Rule:** snapshots break trust the moment a teammate just runs `--updateSnapshot` without reading the diff. Use sparingly, target small components.

---

## 7. E2E testing — Playwright (recommended) vs Cypress

| Aspect | Playwright | Cypress |
|--------|-----------|---------|
| Browsers | Chromium, Firefox, WebKit | Chrome, Edge, Firefox, WebKit (paid for parallel) |
| Speed | Very fast (parallel by default) | Fast but serial in OSS |
| API | `async/await` | Chained, custom |
| Multi-tab/window | ✓ | Limited |
| iframe handling | Native | Custom commands |
| Component testing | ✓ (experimental) | ✓ (stable) |
| Network interception | ✓ | ✓ |
| Mobile emulation | ✓ | ✓ |

**For new projects in 2026, Playwright is the recommended choice** — Microsoft-backed, free, multi-browser by default, less flaky.

### 7.1 Playwright example

```ts
import { test, expect } from "@playwright/test";

test("submit fund NAV approval", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /fund nav/i }).click();

  await page.getByRole("row", { name: /citi growth fund a/i }).click();
  await expect(page.getByText(/\$102\.45/)).toBeVisible();

  await page.getByRole("button", { name: /approve/i }).click();
  await expect(page.getByRole("status")).toContainText(/approval submitted/i);
});
```

### 7.2 Page Object Model

For large E2E suites, encapsulate per-page selectors/actions:

```ts
// nav-page.ts
export class NavPage {
  constructor(private page: Page) {}
  goto() { return this.page.goto("/nav"); }
  selectFund(name: string) { return this.page.getByRole("row", { name }).click(); }
  approve() { return this.page.getByRole("button", { name: /approve/i }).click(); }
}
```

### 7.3 E2E trade-offs

- **Slow** — each test launches a browser (1-3s overhead)
- **Flaky** — race conditions with animations, network
- **Expensive to maintain** — refactor selectors when UI changes
- **High signal** — when one fails, something real is broken

**Strategy:** keep E2E suite small (10-30 golden paths), run in CI on every PR. Rely on integration tests for breadth.

---

## 8. Visual regression testing

Screenshots are diffed against a baseline. Catches CSS regressions integration tests miss.

| Tool | Notes |
|------|-------|
| Chromatic | Hosted, integrates with Storybook |
| Percy | BrowserStack, hosted |
| Playwright `toHaveScreenshot()` | Self-hosted, free |
| Loki | Storybook + Docker-based |

```ts
// Playwright visual regression
await expect(page).toHaveScreenshot("nav-list.png", { maxDiffPixels: 100 });
```

---

## 9. Coverage — useful but misleading

```bash
jest --coverage
```

Generates HTML report (`coverage/lcov-report/index.html`).

**Threshold config:**

```json
{
  "coverageThreshold": {
    "global": {
      "branches": 80,
      "functions": 80,
      "lines": 80,
      "statements": 80
    }
  }
}
```

### 9.1 Coverage is necessary but not sufficient

100% coverage means every line *ran during tests* — not that the behavior is correct. You can have 100% coverage with zero `expect()` calls.

**Better metric: mutation testing** with [Stryker](https://stryker-mutator.io/). It mutates your code (flips operators, deletes lines) and verifies tests detect the mutation. Catches lazy assertions.

---

## 10. Testing async code — common pitfalls

### 10.1 `act()` warnings

```jsx
// BAD — async state update happens after render, no await
test("loads data", () => {
  render(<FundList />);
  expect(screen.getByText("Citi Growth")).toBeInTheDocument(); // FAIL — not yet rendered
});

// GOOD — wait for state update
test("loads data", async () => {
  render(<FundList />);
  expect(await screen.findByText("Citi Growth")).toBeInTheDocument();
});
```

`findBy*` is implicit `waitFor(() => getBy*)`.

### 10.2 Don't `act()` manually unless you must

RTL wraps user-events and most state updates in `act()` already. If you see `act()` warnings, the fix is usually `await findBy*` or `await waitFor(...)`, not adding manual `act()` calls.

### 10.3 Fake timers

```js
test("debounced search fires after 300ms", async () => {
  jest.useFakeTimers();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(<Search />);

  await user.type(screen.getByRole("searchbox"), "abc");
  jest.advanceTimersByTime(299);
  expect(searchSpy).not.toHaveBeenCalled();

  jest.advanceTimersByTime(1);
  expect(searchSpy).toHaveBeenCalledWith("abc");

  jest.useRealTimers();
});
```

`userEvent.setup({ advanceTimers })` is essential — otherwise userEvent's internal timeouts hang.

---

## 11. Testing accessibility in tests

```js
import { axe, toHaveNoViolations } from "jest-axe";
expect.extend(toHaveNoViolations);

test("FundNAVPanel has no a11y violations", async () => {
  const { container } = render(<FundNAVPanel />);
  expect(await axe(container)).toHaveNoViolations();
});
```

Run on every component story / page. Cross-link: [accessibility.md](accessibility.md).

---

## 12. Contract tests — MCP server contracts (Verizon)

When your client talks to a server you don't own (MCP server, third-party API), contract tests verify the *shape* matches.

### 12.1 Schema-based with Zod

```ts
import { z } from "zod";

const MCPToolResponseSchema = z.object({
  tool: z.string(),
  result: z.object({
    status: z.enum(["ok", "error"]),
    data: z.unknown(),
  }),
});

test("MCP server returns valid response shape", async () => {
  const res = await callMCPServer("list-defects");
  expect(() => MCPToolResponseSchema.parse(res)).not.toThrow();
});
```

### 12.2 Pact (consumer-driven contracts)

For multi-team setups: consumer publishes expected contract → broker → producer verifies. Worth it when you have many teams sharing APIs.

---

## 13. Test patterns to know

### 13.1 Builder / factory pattern

```ts
function makeFund(overrides: Partial<Fund> = {}): Fund {
  return {
    id: "fund-a",
    name: "Citi Growth Fund A",
    nav: 100,
    status: "active",
    ...overrides,
  };
}

test("approves only active funds", () => {
  const f = makeFund({ status: "inactive" });
  expect(canApprove(f)).toBe(false);
});
```

Avoids deep `mockFund1`, `mockFund2`, `mockFund3` proliferation.

### 13.2 Render wrappers

```jsx
// test/utils.tsx
function renderWithProviders(ui, { route = "/", queryClient = new QueryClient(), ...opts } = {}) {
  window.history.pushState({}, "", route);
  return render(
    <QueryClientProvider client={queryClient}>
      <Router>{ui}</Router>
    </QueryClientProvider>,
    opts
  );
}
export * from "@testing-library/react";
export { renderWithProviders as render };
```

Import from `test/utils` everywhere — keeps tests focused on behavior, not setup.

### 13.3 Given-When-Then (AAA)

```js
test("approves NAV", async () => {
  // Arrange (Given)
  const fund = makeFund({ nav: 100 });
  render(<FundDetail fund={fund} />);
  const user = userEvent.setup();

  // Act (When)
  await user.click(screen.getByRole("button", { name: /approve/i }));

  // Assert (Then)
  expect(await screen.findByRole("status")).toHaveTextContent(/approved/i);
});
```

Improves readability when tests have multiple setup/action/assert pairs.

---

## 14. CI integration (Husky + Jest)

```json
// package.json
{
  "scripts": {
    "test": "jest",
    "test:ci": "jest --ci --coverage --maxWorkers=2",
    "e2e": "playwright test"
  },
  "husky": {
    "hooks": {
      "pre-commit": "lint-staged",
      "pre-push": "npm run test:ci"
    }
  },
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "jest --bail --findRelatedTests"]
  }
}
```

**Strategy:** quick tests pre-commit on changed files only; full suite pre-push; E2E + coverage in CI.

### 14.1 GitHub Actions example

```yaml
name: Test
on: [pull_request]
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run test:ci
      - uses: codecov/codecov-action@v4

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run build && npm run preview &
      - run: npm run e2e
```

---

## 15. What to test (architect heuristics)

### 15.1 Definitely test

- **Business logic in reducers / selectors / utilities** (high value, easy to test)
- **Custom hooks** (encapsulated logic)
- **Forms** (validation, error states, submit)
- **Conditional rendering** (auth states, role-based UI)
- **Data fetching flows** with MSW (loading → success → error)
- **Critical user journeys** as E2E (login, checkout, NAV submission)

### 15.2 Don't bother testing

- Third-party libraries (React, Redux — they have their own tests)
- Implementation details (component internal state)
- Trivial getters/setters
- Constants files
- Generated code
- CSS unless visual regression

### 15.3 The "delete this test" smell

If changing a refactor (no behavior change) breaks the test, the test is coupled to implementation. Refactor or delete.

---

## 16. Interview talking points

**Q: "How do you decide what to mock?"**
A: Mock at the *boundary*, not internal modules. Mock HTTP via MSW. Mock time via `jest.useFakeTimers`. Mock browser APIs (localStorage, Date.now, crypto). Don't mock React components — render them.

**Q: "How do you balance test coverage with shipping speed?"**
A: Coverage thresholds for new code (80% lines), but no requirement for legacy code unless it's being modified. Pre-commit runs only related tests for speed. Full suite + E2E only in CI on PR. We monitor flaky tests — anything failing >5% gets a Linear ticket immediately.

**Q: "MSW vs jest.mock?"**
A: MSW for anything that crosses HTTP — components stay implementation-agnostic about whether fetch is real or mocked. `jest.mock` for non-network modules (e.g., a logger, a feature flag client). Mixing them is fine.

**Q: "How would you test a streaming AI response UI?"**
A: MSW with a `ReadableStream` returning chunks at controlled intervals + fake timers. Assert that the UI accumulates tokens, that the "stop" button cancels the stream, and that the final message renders markdown correctly. Add an a11y test that the live region announces incremental updates politely.

**Q: "What's the test pyramid for Verizon's real-time dashboard?"**
A: Heavy on **integration** (RTL + MSW) for component flows; **E2E in Playwright** for 5-6 critical user journeys (login, view-order, search, drilldown, export); **unit** tests dominate for: pure data transforms, websocket reconnect logic, throttle/debounce utilities, chart data shapers. Coverage gate at 80%; mutation testing on the pure-logic modules quarterly.

**Q: "Snapshot tests — yes or no?"**
A: Sparingly. They invite "approve and forget". I prefer focused assertions: "this button has label 'Save' and is enabled". Snapshots OK only for tiny pure-presentational primitives where any markup change is intentional.

---

## 17. References

- [Testing Library docs](https://testing-library.com/docs/)
- [MSW docs](https://mswjs.io/)
- [Kent C. Dodds — Common mistakes with RTL](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [Playwright docs](https://playwright.dev/)
- [jest-axe](https://github.com/nickcolley/jest-axe)
- [Stryker mutation testing](https://stryker-mutator.io/)
