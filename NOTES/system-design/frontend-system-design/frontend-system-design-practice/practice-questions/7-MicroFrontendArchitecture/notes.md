# FE System Design — Micro-Frontend Architecture (Citibank CWO)

> Resume project: **Citibank Clarity Workflow Oversight (CWO)** — global banking portals with micro-frontend architecture, multi-step transaction workflows, role-based access.
>
> Cross-link: [Module Federation](../../../micro-frontends/module-federation.md) · [Single-SPA](../../../micro-frontends/single-spa.txt) · [FE design patterns](../../../react/design-patterns-frontend.md) · [Vite vs Webpack](../../vite-vs-webpack.md)

---

## 1. Problem statement

Design the frontend architecture for an enterprise banking portal where:

- **Multiple teams** (Funds, Trading, Operations, Compliance, Reporting) own different domains
- Each team **deploys independently** at their own cadence
- Users see a **unified portal** with shared shell (header, nav, footer), single sign-on
- Different sub-apps may use **different framework versions** during gradual migration
- **Role-based access** — what modules a user sees depends on roles (RBAC)
- **Strict compliance** — every release auditable, fast rollback critical

Real-world constraints:
- 6+ teams, ~50 engineers
- 15+ functional modules
- Tier-1 bank — uptime, audit, security are non-negotiable
- Existing legacy apps (jQuery, Angular 1.x, React 16) need gradual incorporation

---

## 2. Why micro-frontends

The pattern's purpose isn't tech novelty — it's **team autonomy at scale**. If you have ≤10 engineers and one product, you don't need this. You need it when:

- Multiple teams hit each other in the monolith (merge conflicts, release coupling)
- Different parts of the product evolve at different speeds
- You need to incrementally migrate legacy stacks
- Independent deployment matters for risk isolation

**Anti-cases:** small teams, single-purpose app, performance-critical (MF adds overhead), strong design consistency requirement (harder to enforce across MFEs).

---

## 3. Integration approaches — landscape

| Approach | How it works | When |
|----------|--------------|------|
| **Build-time integration** | NPM packages, mono-built into one bundle | Same team or tight contract; gives up independent deploy |
| **Iframe** | Embed app via `<iframe>` | Legacy, hard-coupling-needed; weak UX (scroll, modals across frames) |
| **Server-side composition** | Edge Side Includes (ESI), Tailor, Mosaic | Need server infrastructure; great for SEO/SSR |
| **Client-side composition — runtime** | Module Federation, Single-SPA, import maps | Most flexible; this is what CWO uses |
| **Web Components** | Each MFE exposes a custom element | Framework-agnostic but loses typed contracts |

For CWO, **runtime client-side composition** is the right choice — independent deploy, single SSO, shared shell.

---

## 4. Module Federation (Webpack 5) — deep dive

The reference implementation of runtime MFE composition.

### 4.1 Concepts

- **Host:** the shell app that *consumes* remote modules
- **Remote:** a child app that *exposes* modules
- **Container:** the remote's runtime entry point (`remoteEntry.js`)
- **Shared modules:** dependencies (React, Redux) deduped at runtime

### 4.2 Host config

```js
// webpack.config.js (shell)
const { ModuleFederationPlugin } = require("webpack").container;

module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: "shell",
      remotes: {
        funds:    "funds@https://cdn.bank.com/funds/remoteEntry.js",
        trading:  "trading@https://cdn.bank.com/trading/remoteEntry.js",
        ops:      "ops@https://cdn.bank.com/ops/remoteEntry.js",
      },
      shared: {
        react:     { singleton: true, requiredVersion: "^18.0.0", eager: false },
        "react-dom": { singleton: true, requiredVersion: "^18.0.0" },
        "react-router-dom": { singleton: true, requiredVersion: "^6.0.0" },
        "@bank/design-system": { singleton: true, requiredVersion: "^4.0.0" },
      },
    }),
  ],
};
```

### 4.3 Remote config

```js
// webpack.config.js (funds module)
module.exports = {
  plugins: [
    new ModuleFederationPlugin({
      name: "funds",
      filename: "remoteEntry.js",
      exposes: {
        "./FundsApp":  "./src/FundsApp",
        "./NAVPanel":  "./src/components/NAVPanel",
      },
      shared: { react: { singleton: true }, "react-dom": { singleton: true } },
    }),
  ],
};
```

### 4.4 Using remote in host

```jsx
// React.lazy + dynamic import — lazily fetches remoteEntry.js
const FundsApp = lazy(() => import("funds/FundsApp"));

function App() {
  return (
    <Routes>
      <Route path="/funds/*" element={
        <Suspense fallback={<Spinner />}><FundsApp /></Suspense>
      } />
      <Route path="/trading/*" element={
        <Suspense fallback={<Spinner />}><TradingApp /></Suspense>
      } />
    </Routes>
  );
}
```

### 4.5 Vite alternative

`@originjs/vite-plugin-federation` provides similar API for Vite hosts/remotes. Less battle-tested for complex shared-dep scenarios, but improving fast.

```js
// vite.config.ts (remote)
federation({
  name: "funds",
  filename: "remoteEntry.js",
  exposes: { "./FundsApp": "./src/FundsApp" },
  shared: ["react", "react-dom"],
});
```

---

## 5. Single-SPA — the predecessor / alternative

Older approach (predates Module Federation) but still widely used.

### 5.1 Concept

A "root config" (shell) registers multiple MFE apps. Each app implements three lifecycles:

```js
export const bootstrap = () => Promise.resolve();
export const mount     = (props) => ReactDOM.render(<App {...props} />, document.getElementById("funds-root"));
export const unmount   = (props) => ReactDOM.unmountComponentAtNode(document.getElementById("funds-root"));
```

Shell handles routing — when URL changes, unmount old apps, mount new ones.

### 5.2 Module Federation vs Single-SPA

| Aspect | Module Federation | Single-SPA |
|--------|-------------------|------------|
| Sharing components | First-class (expose any module) | App-level boundary only |
| Build tool dependency | Webpack/Vite | Framework-agnostic, any bundler |
| Routing | Host owns + remote may have its own router | Single-SPA itself routes between apps |
| Multiple instances | Tricky (singleton enforced) | Easy (different apps on same page) |
| Setup complexity | Medium | Higher initial setup |
| Maturity | Newer, growing | Battle-tested, slower evolution |

**For new projects in 2026: Module Federation.** Single-SPA still wins when you need framework-mixing on one page (a React app embedded next to an Angular app), or you have legacy SPAs to absorb.

---

## 6. Sharing dependencies — the hardest problem

Naive setup ships React 3 times if 3 MFEs import it. The whole point of `shared` configs is deduplication.

### 6.1 `singleton: true`

Forces a single instance of the package across the app. Required for:
- React (multiple Reacts = broken hooks across boundary)
- React Router (shared history)
- Redux store (if shared)
- React Query (shared QueryClient)
- Design system (shared CSS context)

### 6.2 Version negotiation

Host declares `requiredVersion: "^18.0.0"`. Remote also declares its version. If versions are compatible, the higher one wins; otherwise both load (memory penalty).

**Production rule:** publish a "platform contract" lockfile that all MFEs sync from monthly. Otherwise version drift = duplicated bundles + subtle bugs.

### 6.3 Eager vs lazy

- `eager: true` — load immediately with the entry chunk (no async load delay, but bloats initial bundle)
- `eager: false` (default) — load when first imported (smaller initial, but adds latency on first MFE use)

Use eager for React/critical shared libs in host; lazy for everything else.

### 6.4 The "two Reacts" disaster

If `singleton: true` fails (e.g., version mismatch), each MFE loads its own React. Symptoms: hooks throw, context doesn't propagate, refs lose identity. Always lock React versions across MFEs at the same minor.

---

## 7. Routing across MFEs

### 7.1 Shell-owned routing

The host owns `react-router-dom`. Each MFE is mounted under a route prefix; the MFE may internally route within its prefix.

```jsx
// Shell
<Routes>
  <Route path="/funds/*" element={<FundsApp />} />   {/* /* delegates the rest */}
</Routes>

// Funds MFE
<Routes>
  <Route path="/" element={<FundsList />} />
  <Route path=":fundId" element={<FundDetail />} />
  <Route path=":fundId/nav" element={<NAVApproval />} />
</Routes>
```

This works because `react-router-dom` is a singleton — both apps share the same router context.

### 7.2 Deep linking & SSO

Users hit `/funds/F1/nav` directly. The shell:
1. Authenticates via SSO (Cognizant/Citi OAuth/SAML)
2. Loads user's roles
3. Determines if `/funds/...` is permitted
4. Lazily loads funds remote
5. Renders, funds MFE picks up its sub-route

---

## 8. State sharing

### 8.1 Don't share runtime state by default

Anti-pattern: a global Redux store the shell owns and all MFEs subscribe to. Pulls every MFE into a single mental model — opposite of independence.

### 8.2 Patterns for cross-MFE communication

| Need | Mechanism |
|------|-----------|
| Auth token, user identity | Shared context provided by shell — singleton |
| Cross-MFE event ("order approved by ops") | Pub/sub via shared event bus (lightweight EventEmitter) |
| Navigation requests | `useNavigate` from singleton router |
| Persisted preferences | localStorage + storage event listener |
| Feature flags | Shared context / provider in shell |

### 8.3 Event bus example

```ts
// @bank/event-bus (shared package, singleton)
type Listener<T> = (event: T) => void;

class EventBus {
  private channels = new Map<string, Set<Listener<any>>>();
  on<T>(channel: string, listener: Listener<T>) {
    if (!this.channels.has(channel)) this.channels.set(channel, new Set());
    this.channels.get(channel)!.add(listener);
    return () => this.channels.get(channel)!.delete(listener);
  }
  emit<T>(channel: string, event: T) {
    this.channels.get(channel)?.forEach((l) => l(event));
  }
}
export const eventBus = new EventBus();

// Funds MFE
eventBus.emit("nav.approved", { fundId, by: user.id });

// Reporting MFE
useEffect(() => eventBus.on("nav.approved", (e) => refetchAuditLog()), []);
```

Keep channels typed via TypeScript discriminated unions in the shared package.

---

## 9. Design system & visual consistency

Sharing UI primitives is harder than sharing logic. Each MFE rendering its own Button means visual drift.

### 9.1 Strategy

- **Shared design system** as a separate NPM package (`@bank/design-system`)
- Published via internal registry (Verdaccio, GitHub Packages, Nexus)
- All MFEs depend on it; declared as `shared` in MF config (singleton)
- CSS variables / design tokens at the shell layer (`<html data-theme="light">`)
- Component primitives styled via tokens — work in any MFE

### 9.2 Token propagation

```css
/* shell.css — loaded once by host */
:root {
  --color-primary: #002d72;       /* Citi blue */
  --color-bg-canvas: #fff;
  --space-1: 4px; --space-2: 8px;
  --font-body: "Open Sans", system-ui, sans-serif;
}
```

Each MFE's CSS uses `var(--color-primary)` — no per-MFE colors hard-coded. Token changes propagate everywhere via single source.

### 9.3 Scoping conflicts

Two MFEs may use the same class name. Mitigations:
- **CSS Modules** (recommended) — auto-scoped class names
- **Scoped naming convention** — `.funds-Btn`, `.trading-Btn`
- **Shadow DOM** (heavy — fewer use cases need it)
- **CSS-in-JS** with library-level scoping

---

## 10. Build & deploy

### 10.1 Independent CI per MFE

Each MFE:
1. Builds to `dist/` containing `remoteEntry.js` + chunks
2. Uploads to CDN under versioned path: `/funds/v23/...`
3. Updates a manifest the host reads to discover current version

### 10.2 Manifest pattern

```json
// manifest.json (served from CDN or shell API)
{
  "funds":   { "version": "1.42.0", "url": "https://cdn.bank.com/funds/v1.42.0/remoteEntry.js" },
  "trading": { "version": "2.7.1",  "url": "https://cdn.bank.com/trading/v2.7.1/remoteEntry.js" },
  "ops":     { "version": "0.9.3",  "url": "https://cdn.bank.com/ops/v0.9.3/remoteEntry.js" }
}
```

Shell reads manifest on load, configures remote URLs at runtime — supports rollback by reverting manifest.

### 10.3 Dynamic remotes (Module Federation runtime API)

Instead of compile-time `remotes` config:

```js
// shell — load remote URL at runtime
const loadRemote = (url, scope, module) => {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = async () => {
      await __webpack_init_sharing__("default");
      const container = window[scope];
      await container.init(__webpack_share_scopes__.default);
      const factory = await container.get(module);
      resolve(factory());
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
};
```

Lets the shell honor the manifest live without rebuilds.

### 10.4 Rollback strategy

- **Bad release on funds MFE:** revert manifest to `funds@1.41.x` URL. Live within seconds. No host redeploy.
- **Bad release on shared design system:** roll the major across all MFEs in concert (tighter coupling for shared libs)

---

## 11. Performance considerations

| Concern | Impact | Mitigation |
|---------|--------|-----------|
| `remoteEntry.js` fetch per remote | +100-300ms first load per MFE | Preload critical remotes via `<link rel="preload">`; defer non-critical |
| Duplicated shared deps | Bundle bloat | Verify `singleton: true` works; audit network panel |
| Multiple framework versions | Memory + bugs | Lock versions, monthly platform sync |
| Cross-MFE re-renders | Performance | Don't share runtime stores; use isolated event bus |
| LCP on initial load | Shell-only render is slow if waiting for first MFE | SSR the shell + skeleton MFE placeholders, hydrate progressively |

### 11.1 Preloading critical MFE

```html
<link rel="preload" href="https://cdn.bank.com/funds/v1.42.0/remoteEntry.js"
      as="script" crossorigin>
```

For user-likely paths (e.g., user's last-visited MFE), preload that remote's entry before the user navigates.

### 11.2 Bundle analyzer per MFE

Each team owns their MFE's bundle size. Set budgets in their CI:
- Funds MFE: < 200KB gzipped
- Trading MFE: < 250KB
- Ops MFE: < 180KB

Block PR on budget breach.

---

## 12. Security & compliance

Banking-grade requirements drive much of the architecture.

### 12.1 CSP (Content Security Policy)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://cdn.bank.com;
  style-src 'self' 'unsafe-inline' https://cdn.bank.com;
  connect-src 'self' https://api.bank.com wss://api.bank.com;
  frame-ancestors 'none';
```

CDN origin must be allowlisted; sub-resources must be over HTTPS. Use SRI (Subresource Integrity) hashes on `remoteEntry.js` for tamper detection.

### 12.2 Auth & RBAC

Single SSO at shell layer; MFEs receive `{ user, roles, token }` via shared context. Each MFE enforces feature-level RBAC:

```jsx
function ApproveNAVButton() {
  const { hasRole } = useAuth();
  if (!hasRole("nav:approve")) return null;
  return <Button onClick={approve}>Approve</Button>;
}
```

Server-side enforcement remains the source of truth — UI checks are UX-only.

### 12.3 Audit logging

Every shell event (MFE loaded, route navigated, action invoked) emits an audit event to a backend log. Compliance audits trace user actions across MFE boundaries.

### 12.4 Dependency scanning

Each MFE's `package.json` scanned via Snyk/Dependabot. Bank's policy: no critical/high CVEs in prod for >24h.

---

## 13. Failure modes

| Failure | Impact | UX |
|---------|--------|----|
| Remote `remoteEntry.js` 404 | MFE doesn't load | Show "This feature is temporarily unavailable" + link to legacy fallback |
| Remote times out (>10s) | MFE doesn't load | Same — don't block the whole shell |
| Remote throws on mount | Subtree crashes | Error boundary in shell wraps each MFE; show fallback UI |
| Shared dep version mismatch | Hooks throw / context broken | Console warn during dev; CI lint enforces alignment |
| CDN down | All MFEs fail | Shell shows degraded view + status banner; cached pages still work via SW |
| Auth token expires mid-session | API calls 401 | Shared interceptor refreshes; all MFEs see new token via context |

### 13.1 Error boundary wrapping each remote

```jsx
function RemoteWrapper({ name, children }) {
  return (
    <ErrorBoundary
      fallback={<RemoteUnavailable name={name} />}
      onError={(err, info) => sentry.captureException(err, { tags: { mfe: name } })}
    >
      <Suspense fallback={<MFESkeleton name={name} />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

<RemoteWrapper name="funds"><FundsApp /></RemoteWrapper>
```

One MFE crashing must NOT take down others.

---

## 14. Testing strategy

### 14.1 Per-MFE tests (responsibility of owning team)

- Unit + integration tests run on the MFE in isolation
- Contract tests verify the exposed API matches what shell expects
- Visual regression on the MFE's components

### 14.2 Shell tests

- Routes to each MFE successfully (mock remoteEntry.js)
- Auth context propagates
- Error boundary catches MFE crashes
- Event bus messages route correctly

### 14.3 Integration / E2E

- Playwright suite that exercises a full journey crossing MFEs:
  - Login → Funds MFE → approve NAV → audit log in Reporting MFE shows it
- Run nightly across all `*main*` builds of each MFE
- Smoke tests on prod after each MFE deployment

### 14.4 Contract testing with Pact (advanced)

Provider (MFE) publishes the API it exposes; consumer (shell or other MFEs) publishes what they expect. Pact broker verifies compatibility before deploy.

---

## 15. Verizon-style alternative: server-driven UI

CWO uses Module Federation. An alternative for new projects: **server-driven UI** where the backend returns a JSON description of the UI; client renders it from a fixed set of components.

```json
{
  "type": "page",
  "children": [
    { "type": "header", "title": "NAV Approval" },
    { "type": "table", "dataSource": "/api/funds/F1/nav-history" },
    { "type": "approveButton", "fundId": "F1" }
  ]
}
```

Pros: backend rolls out new screens without client deploy.
Cons: limited to the components the client supports; harder UX iteration; harder a11y/accessibility nuances.

Used by: Airbnb (Ghost Platform), Lyft, some banking apps. Not in scope for CWO but worth knowing.

---

## 16. Trade-off matrix

| Decision | Option A | Option B | Choice + Why |
|----------|----------|----------|--------------|
| Composition | Build-time (NPM) | Runtime (MF) | **Runtime** — independent deploy required |
| Framework | Module Federation | Single-SPA | **Module Federation** — modern, fine-grained sharing |
| Bundler | Webpack | Vite | **Webpack for host (MF maturity)**, Vite for remotes that don't expose internals |
| State | Shared Redux | Isolated stores + event bus | **Isolated + event bus** — preserves team independence |
| Design system | Per-MFE | Shared package | **Shared package** — visual consistency |
| Routing | Per-MFE | Shell-owned singleton | **Shell-owned** — single source of truth, deep linking |
| Deploy | Monorepo single | Independent repos | **Independent repos** — team velocity |
| Manifest | Static (build-time) | Dynamic | **Dynamic** — rollback without host redeploy |

---

## 17. Anti-patterns

1. **Monolithic shared store** — defeats independence
2. **Cross-MFE imports** — funds MFE importing from trading MFE creates hidden coupling
3. **Mixed React versions in singletons** — broken hooks across boundary
4. **No error boundaries** — one MFE crash takes down shell
5. **CSS without scoping** — `.button` from funds collides with trading's `.button`
6. **Build-time URL hard-coding** of remotes — no dynamic rollback
7. **Each MFE bundles React** — bloated downloads
8. **Tightly coupled events** — `eventBus.emit("specific-trading-state-mutation")` — leaks internals

---

## 18. Interview talking points

**Q: "When would you NOT recommend a micro-frontend?"**
A: Small team (<10), single-domain product, performance-critical (where overhead matters), strong centralized design discipline (where shared design system already enables fast iteration in a monolith). MF is a team-scaling pattern, not a tech-stack pattern.

**Q: "Module Federation vs Single-SPA?"**
A: For new projects, Module Federation. It allows sharing not just apps but any module across boundaries, with first-class dependency dedup. Single-SPA wins for framework-mixing on one page or when you can't use Webpack (rare in 2026).

**Q: "How do you handle shared React?"**
A: `singleton: true` + `requiredVersion: "^18.x"` in `shared` config. Lock major.minor across all MFE manifests. CI lint enforces alignment. If singleton fails, each MFE ships its own React — broken hooks across boundary.

**Q: "How do you share state between MFEs without tight coupling?"**
A: Event bus for cross-MFE notifications. Shared context (from shell singleton) only for app-wide invariants — auth, theme, feature flags. NOT a shared Redux store — that pulls every team into one mental model.

**Q: "What's your strategy for design consistency?"**
A: Shared design system package with `singleton: true` config. Tokens (CSS variables) at the shell layer. Component primitives styled via tokens — so changing the theme propagates everywhere. Strict semver on the design system; coordinated major upgrades.

**Q: "How do you rollback a bad MFE deploy?"**
A: Dynamic manifest — shell reads remote URLs from a JSON file at runtime. Bad release on funds? Revert the manifest URL to the previous version's CDN path. Live within seconds, no host redeploy. Audit log captures who and when.

**Q: "Performance penalty of micro-frontends?"**
A: Roughly 100-300ms per remote first-load (network fetch + parse `remoteEntry.js`). Mitigations: preload critical remotes, defer non-critical, lazy-load below-the-fold MFEs. Net cost ~5-15% on LCP typically. Worth it for team-velocity gains in large orgs.

**Q: "How do you migrate a legacy Angular 8 module into a React Module Federation portal?"**
A: Wrap the legacy app as a Module Federation remote that exports a single React component which mounts the Angular app inside via `ReactDOM` boundary + bootstrap manually. Or use Single-SPA's framework-agnostic approach for that one app. Plan for sunset, not eternal coexistence — mixed frameworks add long-term cost.

**Q: "Security concerns?"**
A: CSP must allowlist the CDN. SRI hashes on `remoteEntry.js` for tamper detection. Auth token never in URL params or localStorage — use `httpOnly` cookies or memory-only. Each MFE goes through bank's security review. Dependency scanning per MFE.

---

## 19. Diagram

```
                  Browser
            ┌──────────────────────────────────────────┐
            │  Shell host                               │
            │  ┌────────────────────────────────────┐   │
            │  │ Shared shell UI                     │   │
            │  │ (header, nav, footer, auth context) │   │
            │  └────────────────────────────────────┘   │
            │  ┌────────────────────────────────────┐   │
            │  │  Router (singleton react-router)    │   │
            │  └────────────────────────────────────┘   │
            │  ┌────────────────────────────────────┐   │
            │  │  Module Federation runtime          │   │
            │  │  + shared deps (React, RR, Redux,   │   │
            │  │    design-system)                   │   │
            │  └────────────────────────────────────┘   │
            │                                            │
            │  /funds/* ↓     /trading/* ↓   /ops/* ↓    │
            │  ┌────────┐    ┌──────────┐  ┌─────────┐   │
            │  │ Funds  │    │ Trading  │  │   Ops   │   │
            │  │  MFE   │    │   MFE    │  │   MFE   │   │
            │  └────────┘    └──────────┘  └─────────┘   │
            │                                            │
            │  Event Bus (cross-MFE pub/sub)             │
            └──────────────────────────────────────────┘
                 ↓ load remoteEntry.js per route
            ┌──────────────────────────────────────────┐
            │           CDN (versioned paths)           │
            │  /funds/v1.42/   /trading/v2.7/  /ops/v0.9│
            └──────────────────────────────────────────┘
                              ↑
            ┌──────────────────────────────────────────┐
            │     Manifest (dynamic URL config)         │
            └──────────────────────────────────────────┘
```

---

## 20. Cross-links

- [Module Federation notes](../../../micro-frontends/module-federation.md)
- [Single-SPA notes](../../../micro-frontends/single-spa.txt)
- [Vite vs Webpack](../../vite-vs-webpack.md)
- [FE design patterns](../../../react/design-patterns-frontend.md)
- [React Advanced topics](../../../react/advanced-topics.md)
- [Performance optimization](../../../performance-security/performance-optimization.txt)
- [Web Security](../../../performance-security/WebSecurity.md)
