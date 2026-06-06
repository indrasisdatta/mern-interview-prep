# Vite vs Webpack — Build Tooling Deep Dive

> Cross-link: [Webpack notes](webpack.txt) · [Frontend advanced](frontend-advanced.txt) · [Performance optimization](../performance-security/performance-optimization.txt)
>
> Webpack ruled 2015-2022. Vite has taken the lead for new projects since 2023. Architects must understand both — you'll be asked when to choose, how to migrate, and how each handles HMR / code splitting / SSR.

---

## 1. The fundamental difference

| Aspect | Webpack | Vite |
|--------|---------|------|
| Dev mode | **Bundles everything upfront**, then serves bundle | **Serves native ESM**, browser requests modules on demand |
| Prod build | Webpack itself | **Rollup** (via Vite) |
| Transform | Babel / SWC / loaders | **esbuild** (Go, ~10-100× faster) for transform; Rollup for bundle |
| Cold start | Slow (3-30s for medium apps) | Near-instant (~300ms) |
| HMR | Module-level, bundle rebuild on change | Module-level, sub-100ms |
| Plugin ecosystem | Massive, mature | Growing fast, Rollup plugins largely compatible |

**The insight:** Vite skips bundling in dev because modern browsers (since 2018) support native ESM. Webpack bundles everything because it was designed before native ESM was viable.

---

## 2. Vite — how it actually works

### 2.1 Dev server (the magic)

```
Browser:  GET /src/App.tsx
   |
Vite:     Read App.tsx → transform JSX/TS via esbuild → return ESM
   |
Browser:  GET /src/Header.tsx   (followed by, because App.tsx imports it)
Vite:     Transform → return
   |
Browser:  GET /node_modules/.vite/react.js   (pre-bundled deps)
Vite:     Return pre-bundled CJS-as-ESM dep
```

**Two-tier approach:**

1. **Source code** (`src/`): served raw via native ESM, transformed on demand
2. **Dependencies** (`node_modules/`): pre-bundled once with **esbuild** into a single ESM file per package (avoids browser making 100s of requests for `lodash-es` sub-modules)

This is why Vite is fast: only what the browser requests gets transformed.

### 2.2 HMR (Hot Module Replacement)

When you save `Header.tsx`:
1. Vite detects file change
2. Vite invalidates `Header.tsx` + its importers in its module graph
3. Sends WS message to client: `"update": ["/src/Header.tsx"]`
4. Client re-fetches `/src/Header.tsx` (cache-busted), React Fast Refresh patches the component tree

Total time: **<100ms**. Webpack with HMR is typically 500ms–5s depending on app size.

### 2.3 Production build (Rollup)

For production, Vite uses **Rollup**, not Webpack. Reason: Rollup produces smaller, cleaner bundles for application code (better tree-shaking, fewer wrappers). esbuild is used for *transform* (JSX, TS) but Rollup handles *bundling + tree-shaking + minify*.

```bash
vite build
# 1. esbuild transforms all source files
# 2. Rollup builds the bundle, applies tree shaking
# 3. Output to /dist with content-hashed filenames
```

Output: code-split by dynamic imports + an entry chunk + vendor chunk.

---

## 3. Webpack — how it actually works

### 3.1 Compilation phases

```
Entry point → Module resolution → Loader pipeline → Plugin hooks → Chunk → Asset emission
```

For every source file:
1. Resolve module path (`./Header` → `./Header.tsx`)
2. Run through configured loaders (e.g., `babel-loader`, `ts-loader`, `css-loader`)
3. Add to dependency graph
4. Split into chunks based on config + dynamic imports
5. Emit bundle files

### 3.2 Why Webpack is slow in dev

- **Bundles all modules into one file** before serving — even if you only changed one
- HMR rebuilds the affected chunk(s), then sends a delta to the browser
- TS + Babel transforms are slow (single-threaded, JS-based)

Modern Webpack (5.x) + SWC loader narrows the gap but doesn't close it.

### 3.3 Where Webpack still wins

- **Mature plugin ecosystem** — chrome-extension builds, Module Federation, complex monorepo setups
- **Module Federation** — Vite has plugins but Webpack's `ModuleFederationPlugin` is more battle-tested for runtime micro-frontend composition
- **Battle-tested at scale** — Facebook, Airbnb, banks have ridden it for years
- **Complex chunking** strategies — Webpack's `optimization.splitChunks` is more configurable

---

## 4. Side-by-side configs

### 4.1 Minimal Vite (React + TS)

```js
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});
```

That's it. ~15 lines for production-ready React + TS.

### 4.2 Equivalent Webpack (React + TS)

```js
// webpack.config.js
const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = (env, argv) => {
  const isProd = argv.mode === "production";
  return {
    entry: "./src/index.tsx",
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: isProd ? "[name].[contenthash].js" : "[name].js",
      clean: true,
      publicPath: "/",
    },
    resolve: { extensions: [".tsx", ".ts", ".js"] },
    module: {
      rules: [
        { test: /\.tsx?$/, use: "swc-loader", exclude: /node_modules/ },
        { test: /\.css$/,
          use: [isProd ? MiniCssExtractPlugin.loader : "style-loader",
                "css-loader"] },
        { test: /\.(png|jpe?g|svg|gif)$/, type: "asset/resource" },
      ],
    },
    devServer: { port: 3000, historyApiFallback: true, hot: true },
    plugins: [
      new HtmlWebpackPlugin({ template: "./public/index.html" }),
      new CleanWebpackPlugin(),
      ...(isProd ? [new MiniCssExtractPlugin()] : []),
    ],
    optimization: {
      splitChunks: {
        chunks: "all",
        cacheGroups: {
          react: { test: /[\\/]node_modules[\\/]react/, name: "react" },
          vendor: { test: /[\\/]node_modules[\\/]/, name: "vendor" },
        },
      },
    },
    devtool: isProd ? "source-map" : "eval-cheap-module-source-map",
  };
};
```

~60 lines for a similar setup. Webpack rewards explicit configuration; Vite rewards convention.

---

## 5. Code splitting

Both support dynamic imports the same way:

```js
const LazyChart = lazy(() => import("./Chart"));
// → Webpack/Vite emit Chart-[hash].js as a separate chunk
```

### 5.1 Vendor chunk splitting

**Vite (manual chunks):**
```js
build: {
  rollupOptions: {
    output: {
      manualChunks(id) {
        if (id.includes("node_modules/react"))     return "react";
        if (id.includes("node_modules/recharts"))  return "chart";
        if (id.includes("node_modules"))           return "vendor";
      }
    }
  }
}
```

**Webpack (splitChunks):**
```js
optimization: {
  splitChunks: {
    chunks: "all",
    cacheGroups: {
      react: { test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/, name: "react", priority: 20 },
      chart: { test: /[\\/]node_modules[\\/]recharts[\\/]/, name: "chart", priority: 15 },
      vendor: { test: /[\\/]node_modules[\\/]/, name: "vendor", priority: 10 },
    }
  }
}
```

Webpack's API is more granular (per-cacheGroup priorities, min size, etc.) but typically over-engineered for app code. Vite's `manualChunks` covers 95% of cases simply.

---

## 6. HMR comparison

### 6.1 Vite HMR API

```ts
// In any module
if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    // re-bind anything depending on the changed module
  });
  import.meta.hot.dispose(() => {
    // cleanup before replacement
  });
}
```

React Fast Refresh is automatic via `@vitejs/plugin-react`.

### 6.2 Webpack HMR API

```js
// In any module
if (module.hot) {
  module.hot.accept("./App", () => { /* re-render */ });
  module.hot.dispose(() => { /* cleanup */ });
}
```

Functionally equivalent. The difference is that Vite invalidates and re-fetches single modules; Webpack rebuilds the chunk those modules belong to.

---

## 7. Environment variables

### 7.1 Vite

```bash
# .env, .env.local, .env.production
VITE_API_URL=https://api.verizon.example.com
```

Only variables prefixed `VITE_` are exposed to client code:

```ts
const url = import.meta.env.VITE_API_URL;   // string
const mode = import.meta.env.MODE;          // "development" | "production"
const isDev = import.meta.env.DEV;          // boolean
```

### 7.2 Webpack

```bash
REACT_APP_API_URL=https://api.example.com
```

Requires `DefinePlugin` or `dotenv-webpack` plugin:

```js
new webpack.DefinePlugin({
  "process.env.REACT_APP_API_URL": JSON.stringify(process.env.REACT_APP_API_URL),
});
```

CRA's "REACT_APP_" convention is exactly this with auto-config.

**Security note:** any env var exposed to client code is **public**. Never put secrets (API keys, DB credentials) in client env vars — they ship in your JS bundle.

---

## 8. SSR / SSG

| Framework | Bundler | SSR/SSG model |
|-----------|---------|---------------|
| Next.js (legacy) | Webpack/Turbopack | Page-based, SSR/SSG/ISR |
| Next.js 13+ App Router | Turbopack (Webpack-compatible) | Server Components |
| Remix | Vite (since v2) | Loader/Action model |
| Nuxt 3 | Vite | SSR/hybrid by default |
| Astro | Vite | Islands architecture |
| SvelteKit | Vite | SSR/SSG |
| SolidStart | Vite | SSR/SSG |

The ecosystem has moved to Vite for SSR-capable meta-frameworks. Next.js is the outlier (still Webpack-based, transitioning to Turbopack — Vercel's Rust rewrite).

### 8.1 Vite SSR primer

```ts
// server.ts (Node)
import { createServer as createViteServer } from "vite";

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
});

app.use(vite.middlewares);
app.use("*", async (req, res) => {
  const template = await vite.transformIndexHtml(req.originalUrl, baseHtml);
  const { render } = await vite.ssrLoadModule("/src/entry-server.tsx");
  const appHtml = await render(req.originalUrl);
  res.send(template.replace("<!--app-html-->", appHtml));
});
```

Used by Remix, SolidStart, Nuxt under the hood.

---

## 9. Plugin patterns

Vite plugins are essentially **Rollup plugins** + Vite-specific hooks (`configureServer`, `transformIndexHtml`):

```ts
// vite-plugin-build-info.ts
export function buildInfoPlugin() {
  return {
    name: "vite-plugin-build-info",
    transformIndexHtml(html: string) {
      return html.replace("</head>",
        `<meta name="build-time" content="${new Date().toISOString()}"></head>`);
    },
  };
}

// vite.config.ts
export default defineConfig({
  plugins: [react(), buildInfoPlugin()],
});
```

Webpack plugins are heavier — they tap into the compiler's lifecycle and often need to manipulate assets via the compilation API.

---

## 10. Migration: CRA/Webpack → Vite

CRA (Create React App) was deprecated by Meta in 2023. Most teams are migrating to Vite. Steps:

### 10.1 Pre-flight

- Audit `webpack.config.js` / CRA overrides for non-standard config (CSS modules conventions, asset loaders)
- List dependencies that import Node built-ins in client code (`crypto`, `path`, `fs`) — Vite is stricter; you may need polyfills via `vite-plugin-node-polyfills`

### 10.2 Steps

1. **Install Vite**
   ```bash
   npm i -D vite @vitejs/plugin-react
   ```
2. **Move `public/index.html` to project root**, change CRA's `%PUBLIC_URL%` to `/`, and add the script tag:
   ```html
   <script type="module" src="/src/index.tsx"></script>
   ```
3. **Rename env vars** — `REACT_APP_X` → `VITE_X` and update references (`process.env.REACT_APP_X` → `import.meta.env.VITE_X`)
4. **Replace CRA scripts in `package.json`:**
   ```json
   {
     "scripts": {
       "dev": "vite",
       "build": "tsc -b && vite build",
       "preview": "vite preview"
     }
   }
   ```
5. **Move TS config** — Vite needs `tsconfig.app.json` (browser) + `tsconfig.node.json` (build) split (template provided by `npm create vite@latest`)
6. **Add `vite.config.ts`** (see Section 4.1)
7. **Fix import paths** that relied on Webpack's loose resolution (e.g., importing JSON without extension may now fail under strict ESM resolution)
8. **Replace `@svgr/webpack` with `vite-plugin-svgr`** if using SVG-as-React-component imports
9. **Run + smoke test.** Most apps work first try.

### 10.3 Citi CWO migration example (hypothetical)

Was: CRA + manual `craco` overrides for CSS Modules + SVG.

After Vite migration:
- Cold dev start: 22s → 0.4s
- HMR: 1.8s → 80ms
- Prod build: 3min → 50s (mostly TS compile time, Rollup itself is ~12s)
- Bundle size: similar (Rollup tree-shakes slightly better in some cases)
- One issue: `process.env.NODE_ENV` in some legacy code → had to use `import.meta.env.MODE`

---

## 11. When to NOT pick Vite

- **Heavy Module Federation usage** (Citi CWO micro-frontend style). Webpack's `ModuleFederationPlugin` is the reference impl. Vite Module Federation plugins exist (`@originjs/vite-plugin-federation`) but are less battle-tested. Some teams keep host on Webpack and remotes on Vite.
- **Chrome extension** with manifest v3 — Webpack tooling (CRX plugin) is more mature
- **Strict CommonJS dependencies** that can't be ESM-converted — Vite handles many cases but some edge cases break
- **You depend on a Webpack-only loader/plugin** with no Vite/Rollup equivalent
- **Tooling lock-in** — your CI/CD pipeline assumes Webpack stats output for bundle analysis

For everything else in 2026, default to **Vite**.

---

## 12. Bundle analysis

### 12.1 Vite — `rollup-plugin-visualizer`

```ts
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  plugins: [react(), visualizer({ open: true, gzipSize: true })],
});
```

After `vite build`, opens an interactive treemap of bundle composition.

### 12.2 Webpack — `webpack-bundle-analyzer`

```js
const { BundleAnalyzerPlugin } = require("webpack-bundle-analyzer");
plugins: [new BundleAnalyzerPlugin()];
```

Both give similar treemaps. Use them every major release to catch dependency creep.

---

## 13. Other modern bundlers worth knowing

| Tool | Status | Pitch |
|------|--------|-------|
| **Turbopack** | Beta (Next.js) | Vercel's Rust rewrite of Webpack — 700x faster claim |
| **Rspack** | Stable (ByteDance) | Rust Webpack-compatible bundler, drop-in replacement |
| **Bun (build)** | Beta | All-in-one runtime + bundler |
| **Rolldown** | Alpha | Vite team's Rust rewrite of Rollup — Vite future |
| **esbuild** | Stable | Lightning-fast but limited features — fine for libs, raw esbuild rarely used for apps |
| **Parcel** | Stable | Zero-config bundler; niche today |

**The 5-year arc:** all bundlers are moving to Rust/Go for speed. The API/conventions are converging (Vite-style). Expect a "Rolldown-powered Vite" + "Turbopack-powered Next" world by 2027.

---

## 14. Performance tips (apply to both)

| Tip | Impact |
|-----|--------|
| Code-split by route (`React.lazy` + dynamic import) | Smaller initial JS |
| `manualChunks` for vendor splitting | Better caching across deploys |
| Use SWC over Babel (Webpack) | 5-10× faster transforms |
| Modern target (`esnext`/`es2022`) for chrome ≥ 110 builds | Smaller bundles, no polyfills |
| Tree-shake aggressively (avoid CJS deps, mark `sideEffects: false`) | Smaller bundle |
| Preload critical chunks via `<link rel="modulepreload">` | Faster FCP |
| Compress with **brotli** at edge (Vite/Webpack don't gzip themselves) | 15-30% size reduction |
| Avoid global polyfills — use `@vitejs/plugin-legacy` only if you must support older browsers | Smaller bundle for modern users |
| Strip `console.log` / debugger in prod | Minor size win, big PII win |

```ts
// Vite — strip console in prod
build: {
  minify: "esbuild",
  esbuild: { drop: ["console", "debugger"] },
}
```

---

## 15. Interview talking points

**Q: "Why is Vite faster than Webpack in dev?"**
A: Vite serves native ESM — the browser requests modules on demand, only those modules get transformed (by esbuild, written in Go, ~10-100× faster than Babel). Webpack bundles everything upfront before serving even one byte. The fundamental shift is bundle-then-serve → serve-and-transform-lazily.

**Q: "Vite uses esbuild — why use Rollup for production?"**
A: esbuild is fast but produces larger, less-optimized bundles. Rollup has superior tree-shaking, smaller scope hoisting wrappers, and better chunk splitting for application code. Vite uses each tool for what it's best at: esbuild for transform (fast, no DCE needed since Rollup does it), Rollup for bundle (small output, mature optimizations).

**Q: "How would you migrate a CRA app to Vite?"**
A: See Section 10. Key gotchas: env var prefix change, `process.env` references in client code, SVG-as-component imports, CommonJS deps that need a polyfill plugin. Most apps migrate cleanly in a day; the dev experience improvement justifies the effort immediately.

**Q: "When would you stick with Webpack?"**
A: Heavy Module Federation usage where Webpack's `ModuleFederationPlugin` is the reference implementation. Citi CWO had a host + 6 remotes — I'd evaluate `@originjs/vite-plugin-federation` carefully before migrating, and probably keep the host on Webpack for stability while migrating remotes one at a time.

**Q: "How do you optimize bundle size?"**
A: Visualize first (rollup-plugin-visualizer / webpack-bundle-analyzer). Then: (1) code-split by route, (2) lazy-load heavy components (charts, code editors), (3) replace heavy deps (moment.js → date-fns, lodash → lodash-es with named imports), (4) tree-shake via ESM-only deps, (5) modern target to skip polyfills, (6) drop console in prod, (7) brotli compression at CDN.

**Q: "What's the future of build tooling?"**
A: Convergence on Rust-based bundlers — Turbopack (Next), Rspack (Webpack-compat in Rust), Rolldown (future Vite). Vite-style conventions (esbuild for transform + bundler for prod, native ESM dev) are becoming the universal interface. The differentiation has shifted from "config flexibility" (Webpack era) to "speed + simplicity" (Vite era).

---

## 16. Cheat sheet

| Task | Vite | Webpack |
|------|------|---------|
| Dev server | `vite` | `webpack serve` |
| Build | `vite build` | `webpack --mode=production` |
| Preview prod build | `vite preview` | n/a (need static server) |
| Dynamic import | `import("./X")` | `import("./X")` |
| Env vars | `import.meta.env.VITE_X` | `process.env.X` (via DefinePlugin) |
| Asset import | `import url from "./img.png?url"` | `import url from "./img.png"` |
| SVG as React component | `vite-plugin-svgr` | `@svgr/webpack` |
| HMR API | `import.meta.hot` | `module.hot` |
| Bundle analyzer | `rollup-plugin-visualizer` | `webpack-bundle-analyzer` |
