# 🧠 MERN Stack Lead/Architect — Interview Prep Notes
### 11+ YOE | Focus: Node.js Internals · Async Governance · AI Bridge · MCP

> **Memory Strategy:** Keywords are in **`code-bold`** format. Use the keyword to anchor the concept, then expand verbally.

---

## 📅 STUDY ROADMAP

| Day | Focus Area | Key Deliverable |
|-----|-----------|----------------|
| Mon–Tue | Event Loop · Clustering · Worker Threads | Whiteboard the call stack + libuv |
| Wed | Streams · Security Middleware · CPU Utilization | Draw pipeline diagrams |
| Thu | Husky · ESLint · SonarQube · Code Quality CI | Explain gate-based deployment |
| Fri | MCP Mechanics · LLM Context Bridge | Whiteboard MCP host architecture |
| Sat–Sun | STAR Script · Verizon/GitLab Project · Mock QA | Verbal fluency + abstraction |

---

# PART 1 — NODE.JS EVENT LOOP & ASYNC GOVERNANCE

## 1.1 The Event Loop — Core Mental Model

### 🔑 Keywords: `Call Stack → Web APIs → Callback Queue → Event Loop → Microtask Queue`

```
┌─────────────────────────────────────────────────┐
│               Node.js Process                   │
│                                                 │
│  ┌──────────┐    ┌──────────────────────────┐   │
│  │Call Stack│    │        libuv             │   │
│  │          │    │  ┌────────────────────┐  │   │
│  │ main()   │    │  │   Thread Pool (4)  │  │   │
│  │ express()│    │  │  fs · crypto · dns │  │   │
│  └──────────┘    │  └────────────────────┘  │   │
│       ↕          └──────────────────────────┘   │
│  ┌──────────────────────────────────────────┐   │
│  │           EVENT LOOP PHASES              │   │
│  │  timers → I/O → idle → poll → check →   │   │
│  │                    close callbacks       │   │
│  └──────────────────────────────────────────┘   │
│                                                 │
│  Microtask Queue (Priority): Promise → queueMicrotask │
└─────────────────────────────────────────────────┘
```

### Event Loop Phases (In Order)

| Phase | What Runs | Example |
|-------|-----------|---------|
| **timers** | `setTimeout`, `setInterval` callbacks | Retry logic |
| **pending I/O** | I/O errors from previous cycle | Network error callbacks |
| **idle/prepare** | Internal Node.js only | — |
| **poll** | Fetch new I/O events, execute callbacks | DB queries, file reads |
| **check** | `setImmediate` callbacks | Post-I/O hooks |
| **close callbacks** | `socket.on('close')` etc. | Cleanup |

> **Microtasks (`Promise.then`, `queueMicrotask`) run BETWEEN every phase — they have highest priority.**

### Practical Example — Execution Order Quiz

```javascript
console.log('1: sync');

setTimeout(() => console.log('2: setTimeout'), 0);
setImmediate(() => console.log('3: setImmediate'));

Promise.resolve().then(() => console.log('4: Promise'));
process.nextTick(() => console.log('5: nextTick'));

console.log('6: sync end');

// OUTPUT ORDER:
// 1: sync
// 6: sync end
// 5: nextTick        ← process.nextTick (highest microtask priority)
// 4: Promise         ← Promise.then
// 2: setTimeout      ← timers phase (0ms, but after microtasks)
// 3: setImmediate    ← check phase
```

> **Real-life use case:** Knowing this order prevents subtle bugs in Express middleware chains where a Promise rejection might be swallowed before an error handler fires.

### ❓ Cross-Questions

- *"What is the difference between `process.nextTick` and `Promise.then`?"*
  > `nextTick` is processed before the microtask queue even starts. It's part of Node's own microtask-like queue, giving it higher priority than Promises.

- *"What happens if `process.nextTick` calls itself recursively?"*
  > **Starvation** — the event loop never moves to I/O phase. Real bug: seen in recursive retry logic without a base case.

- *"Can the poll phase block the event loop?"*
  > Yes. If no I/O is pending and no timers are set, it blocks waiting for I/O. This is intentional for servers waiting for requests.

---

## 1.2 Asynchronous Governance

### 🔑 Keywords: `Callback Hell → Promises → async/await → Error Boundary → Backpressure`

### The Evolution of Async Patterns

```javascript
// ❌ Callback Hell (Anti-pattern)
db.find(userId, (err, user) => {
  if (err) return handle(err);
  db.find(user.orderId, (err, order) => {
    if (err) return handle(err);
    payment.charge(order, (err, receipt) => { /* ... */ });
  });
});

// ✅ Promise Chain
db.findUser(userId)
  .then(user => db.findOrder(user.orderId))
  .then(order => payment.charge(order))
  .catch(handleError);

// ✅✅ async/await with proper error governance
async function processOrder(userId) {
  try {
    const user = await db.findUser(userId);
    const order = await db.findOrder(user.orderId);
    const receipt = await payment.charge(order);
    return receipt;
  } catch (err) {
    logger.error({ userId, err }, 'Order processing failed');
    throw new AppError('ORDER_FAILED', err); // Wrap for upstream
  }
}
```

### Parallel vs Sequential Execution

```javascript
// Sequential (slow — 3 round trips)
const user = await getUser(id);
const orders = await getOrders(id);
const prefs = await getPrefs(id);

// Parallel (fast — 1 round trip effectively)
const [user, orders, prefs] = await Promise.all([
  getUser(id),
  getOrders(id),
  getPrefs(id)
]);

// Partial failure tolerance
const results = await Promise.allSettled([getUser(id), getOrders(id)]);
results.forEach(r => {
  if (r.status === 'fulfilled') use(r.value);
  else log(r.reason);
});
```

### Real-Life Use Case: Throttled API Calls to External Service

```javascript
// Problem: GitLab API rate limit = 300 req/min
// Solution: Async queue with concurrency control (p-limit pattern)

import pLimit from 'p-limit';
const limit = pLimit(10); // max 10 concurrent

const repos = await Promise.all(
  repoList.map(repo => limit(() => gitlab.fetchRepo(repo.id)))
);
// Real-world: Used for bulk Jira ticket syncing without hitting API limits
```

### ❓ Cross-Questions

- *"What is `Promise.race` used for in production?"*
  > Timeout patterns. `Promise.race([fetchData(), timeout(5000)])` — if the fetch takes too long, timeout wins and we fail fast.

- *"How do you handle unhandled promise rejections in Express?"*
  > `process.on('unhandledRejection', ...)` as a last resort, but better: wrap all async route handlers in a `asyncWrapper(fn)` utility that calls `next(err)` on rejection.

- *"What is backpressure and where does it appear in async Node.js?"*
  > When a writable stream can't consume data as fast as a readable produces it. The `readable.pipe(writable)` automatically manages this. In manual scenarios, check `writable.write()` return value — `false` means pause the source.

---

# PART 2 — CPU CORE UTILIZATION, CLUSTERING & WORKER THREADS

## 2.1 The Single-Thread Problem

### 🔑 Keywords: `Single Thread → CPU Bound → Cluster Module → Worker Threads → libuv Thread Pool`

Node.js runs JavaScript on **one thread**. But your server has 8, 16, or 32 cores sitting idle.

```
Without Clustering:
Core 0: [Node.js event loop] ← 100% busy
Core 1: [IDLE]
Core 2: [IDLE]
...
Core 7: [IDLE]   ← 7 cores wasted!

With Clustering (cluster module):
Core 0: [Master process] — forks workers
Core 1: [Worker 1] — handles requests
Core 2: [Worker 2] — handles requests
...
Core 7: [Worker 7] — handles requests
```

---

## 2.2 Cluster Module

### 🔑 Keywords: `cluster.isMaster → fork() → IPC Channel → Round-Robin → Shared Port`

```javascript
import cluster from 'cluster';
import os from 'os';
import express from 'express';

const NUM_CPUS = os.cpus().length;

if (cluster.isPrimary) {
  console.log(`Master PID: ${process.pid} | Forking ${NUM_CPUS} workers`);

  for (let i = 0; i < NUM_CPUS; i++) {
    cluster.fork();
  }

  // Auto-restart crashed workers
  cluster.on('exit', (worker, code, signal) => {
    console.warn(`Worker ${worker.pid} died. Restarting...`);
    cluster.fork(); // Resilience: always maintain worker count
  });

} else {
  // Each worker runs its own Express instance
  const app = express();
  app.get('/health', (req, res) => res.json({ pid: process.pid }));
  app.listen(3000, () => console.log(`Worker ${process.pid} listening`));
}
```

### Real-Life Use Case: Verizon API Gateway

> At Verizon, the GitLab webhook processor used clustering across 8 cores. Each worker independently parsed webhook payloads, wrote to a shared Redis queue, and the master process monitored worker health. This gave ~7x throughput improvement on a c5.2xlarge EC2 instance.

### ❓ Cross-Questions

- *"What's the difference between clustering and load balancing via Nginx?"*
  > Clustering uses the OS-level round-robin on a shared port within one machine. Nginx load balancing distributes across multiple machines. Cluster is intra-node; Nginx is inter-node.

- *"How do workers in a cluster share state?"*
  > They don't share memory. State is shared via **IPC (Inter-Process Communication)** messages, **Redis**, or a **shared DB**. `process.send()` / `worker.on('message')` for IPC.

- *"Can clustering handle WebSocket connections correctly?"*
  > Not out of the box — a WebSocket client must hit the same worker each time. Solution: sticky sessions via `nginx ip_hash` or `socket.io` with Redis adapter.

---

## 2.3 Worker Threads

### 🔑 Keywords: `CPU-Bound → workerData → parentPort → SharedArrayBuffer → MessageChannel`

Cluster = multiple processes. Worker Threads = multiple threads within ONE process. Use for CPU-bound tasks (image processing, JSON parsing of huge payloads, encryption).

```javascript
// main.js
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import path from 'path';

if (isMainThread) {
  function runHeavyTask(data) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('./heavy-task.js', { workerData: data });
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', code => {
        if (code !== 0) reject(new Error(`Worker stopped with code ${code}`));
      });
    });
  }

  // Express route — offload CPU work
  app.post('/analyze', async (req, res) => {
    const result = await runHeavyTask(req.body.payload);
    res.json(result);
  });

} else {
  // heavy-task.js — runs in separate thread
  const { payload } = workerData;
  const result = performHeavyCPUWork(payload); // e.g., regex scanning, ML inference
  parentPort.postMessage(result);
}
```

### Cluster vs Worker Threads — Decision Matrix

| Scenario | Use |
|----------|-----|
| Multiple HTTP request handlers | **Cluster** |
| I/O bound (DB, file, network) | **Cluster** (event loop handles it) |
| CPU-bound (image resize, encryption) | **Worker Threads** |
| Shared memory between computations | **Worker Threads** + `SharedArrayBuffer` |
| Zero-downtime deployment | **Cluster** with rolling restarts |
| ML model inference in Node | **Worker Threads** |

### ❓ Cross-Questions

- *"What is `SharedArrayBuffer` and why is it useful in Worker Threads?"*
  > A chunk of raw memory accessible from multiple threads simultaneously without copying. Useful for large data like video frames or ML tensors. Requires `Atomics` for safe concurrent access.

- *"Why not just use Worker Threads for everything instead of Cluster?"*
  > Worker Threads share memory and process space — one thread crash can affect others. Cluster workers are fully isolated OS processes with independent memory, making them more fault-tolerant.

---

## 2.4 Node.js Streams

### 🔑 Keywords: `Readable → Writable → Transform → Duplex → pipe → backpressure → highWaterMark`

### 4 Stream Types

```
Readable  →  Transform  →  Writable
           (modify data)
Duplex (both readable & writable simultaneously — e.g., TCP socket)
```

### Practical Example: Processing Large GitLab Export (CSV 5GB)

```javascript
import fs from 'fs';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import csvParser from 'csv-parser';

// ❌ Wrong: loads entire 5GB into memory
const data = fs.readFileSync('export.csv'); // Crashes on large files!

// ✅ Right: streams — memory stays ~10MB regardless of file size
const filterAndTransform = new Transform({
  objectMode: true,
  transform(row, encoding, callback) {
    if (row.status === 'MERGED') {
      this.push({ id: row.id, author: row.author, date: row.date });
    }
    callback();
  }
});

await pipeline(
  fs.createReadStream('gitlab-export.csv'),
  csvParser(),
  filterAndTransform,
  new WritableToMongoDB() // Custom writable that batch-inserts
);

console.log('Processed 5GB file — peak memory: ~25MB');
```

### Real-Life Use Case: Log Streaming to AI Context

```javascript
// Stream Jira logs to LLM without loading all into memory
const logStream = jira.createLogStream({ projectId: 'VZ-2024' });

logStream
  .pipe(new ChunkByTokenCount(4000))   // Transform: chunk by token limit
  .pipe(new LLMContextSender(llmClient)) // Writable: sends each chunk to LLM
  .on('finish', () => console.log('All logs analyzed'));
```

### ❓ Cross-Questions

- *"What is backpressure in streams and how does Node handle it?"*
  > Backpressure occurs when a writable can't keep up with a readable. `pipe()` automatically pauses the readable when `writable.write()` returns `false`, resuming on the `drain` event.

- *"When would you use `Transform` stream over a simple function?"*
  > When processing data in a pipeline that must remain streaming (e.g., processing multi-GB files). A function would require loading everything into memory first.

- *"What is `highWaterMark` in streams?"*
  > The buffer threshold. Once buffered data exceeds `highWaterMark` bytes (default: 16KB for bytes, 16 objects for object mode), the stream triggers backpressure. Tuning it controls memory vs throughput trade-off.

---

# PART 3 — SECURITY MIDDLEWARE

## 3.1 Security Layers in Express

### 🔑 Keywords: `Helmet → CORS → Rate Limit → JWT → Input Sanitization → CSRF → SQL Injection`

```javascript
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss-clean';
import hpp from 'hpp';

const app = express();

// Layer 1: Security Headers (Helmet sets 14+ HTTP headers)
app.use(helmet()); 
// Sets: X-XSS-Protection, X-Frame-Options, Strict-Transport-Security, etc.

// Layer 2: CORS — explicit allowlist
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || [],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Layer 3: Rate Limiting — prevent brute force
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // max 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', apiLimiter);

// Layer 4: Body parsing with size limits
app.use(express.json({ limit: '10kb' })); // Prevent payload bombing

// Layer 5: NoSQL Injection prevention
app.use(mongoSanitize()); // Strips $, . from user input

// Layer 6: XSS sanitization
app.use(xss()); // Strips HTML tags from input

// Layer 7: HTTP Parameter Pollution
app.use(hpp()); // Prevents ?sort=price&sort=name attacks
```

### JWT Authentication Middleware

```javascript
import jwt from 'jsonwebtoken';

export const authenticate = async (req, res, next) => {
  try {
    // 1. Extract token
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.split(' ')[1]
      : null;

    if (!token) return res.status(401).json({ error: 'No token provided' });

    // 2. Verify (checks signature + expiry)
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Check token hasn't been invalidated (e.g., user logged out)
    const isBlacklisted = await redisClient.get(`blacklist:${token}`);
    if (isBlacklisted) return res.status(401).json({ error: 'Token revoked' });

    // 4. Attach user context
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};
```

### ❓ Cross-Questions

- *"What headers does Helmet add and why does it matter?"*
  > Key ones: `Content-Security-Policy` (prevents XSS), `X-Frame-Options: DENY` (prevents clickjacking), `Strict-Transport-Security` (forces HTTPS), `X-Content-Type-Options: nosniff` (prevents MIME sniffing).

- *"What is `X-Content-Type-Options: nosniff`?"*
  > Trust the Content-Type header sent by the server. Do not try to guess (sniff) the file type. Without it, browsers may inspect the content and decide that a file is actually HTML or JavaScript even if the server labeled it differently.
  E.g. Attacker uploads sample.txt with JS content `<script>alert('XSS');</script>` 
  With `no-sniff`, the server serves it as `text/plain`. Without it, some browsers might inspect the content, realize it looks like HTML/Js and execute it. This becomes XSS vulnerability.

- *"JWT vs Session — which do you choose and when?"*
  > JWT for stateless microservices (no shared session store needed, scales horizontally). Sessions for monoliths or when you need instant revocation. JWT revocation requires a blacklist (Redis), which adds overhead.

- *"How do you prevent SQL Injection in a Node.js MongoDB app?"*
  > `express-mongo-sanitize` strips `$` and `.` operators. For SQL: always use parameterized queries/prepared statements — never string concatenation.

---

# PART 4 — CODE QUALITY INTEGRATIONS

## 4.1 Husky — Git Hooks Automation

### 🔑 Keywords: `pre-commit → pre-push → lint-staged → commit-msg → hook pipeline`

```bash
# Installation
npm install --save-dev husky lint-staged

# Initialize
npx husky init
```

```json
// package.json
{
  "scripts": {
    "prepare": "husky"
  },
  "lint-staged": {
    "**/*.{js,ts}": ["eslint --fix", "prettier --write"],
    "**/*.{json,md}": ["prettier --write"]
  }
}
```

```bash
# .husky/pre-commit
#!/bin/sh
npx lint-staged           # Run ESLint + Prettier only on staged files

# .husky/commit-msg
#!/bin/sh
npx commitlint --edit $1  # Enforce conventional commits

# .husky/pre-push
#!/bin/sh
npm run test:unit         # Run unit tests before push
npm run build             # Verify build doesn't break
```

### Real-Life Use Case

> On the Verizon project, Husky's `pre-commit` hook ran `lint-staged` (ESLint + Prettier) only on changed files — not the entire codebase. This kept commit time under 3 seconds for a 200k LOC repo. The `pre-push` hook ran critical unit tests, catching regressions before they hit the remote.

---

## 4.2 ESLint — Static Code Analysis

### 🔑 Keywords: `rules → plugins → extends → parser → autofix → custom rules`

```javascript
// eslint.config.js (flat config — ESLint v9+)
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  security.configs.recommended,
  {
    rules: {
      // Security
      'security/detect-object-injection': 'error',
      'security/detect-non-literal-regexp': 'warn',

      // Async safety — catches missing await
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // Code style
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',

      // Node.js specific
      'no-process-exit': 'error', // Use proper shutdown instead
    }
  }
);
```

---

## 4.3 SonarQube — Enterprise Code Quality Gate

### 🔑 Keywords: `Quality Gate → Code Smells → Technical Debt → Coverage → Duplications → SAST`

```
SonarQube Metrics Dashboard:
┌─────────────────────────────────────────┐
│  Quality Gate: ✅ PASSED                 │
├────────────┬────────────────────────────┤
│ Bugs       │ 0 new bugs                 │
│ Vulnerab.  │ 0 new vulnerabilities      │
│ Code Smells│ < 5 new smells             │
│ Coverage   │ > 80% on new code          │
│ Duplications│ < 3% duplication          │
│ Security   │ No hotspots unreviewed     │
└────────────┴────────────────────────────┘
```

```yaml
# GitLab CI/CD Pipeline Integration
sonarqube-scan:
  stage: quality
  image: sonarsource/sonar-scanner-cli
  script:
    - sonar-scanner
        -Dsonar.projectKey=verizon-api
        -Dsonar.sources=src
        -Dsonar.tests=tests
        -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info
        -Dsonar.host.url=$SONAR_HOST_URL
        -Dsonar.login=$SONAR_TOKEN
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
  # Blocks MR merge if Quality Gate fails
```

### The Full CI Quality Pipeline

```
Developer commits code
       ↓
[Husky pre-commit]  → ESLint + Prettier (local, fast)
       ↓
[Husky pre-push]    → Unit tests (local)
       ↓
[GitLab CI Pipeline]
   Stage 1: lint     → ESLint (full project)
   Stage 2: test     → Jest (unit + integration)
   Stage 3: sonar    → SonarQube scan + quality gate
   Stage 4: build    → Docker image
   Stage 5: deploy   → Kubernetes (only if all pass)
```

### ❓ Cross-Questions

- *"What's the difference between ESLint and SonarQube?"*
  > ESLint is developer-side, fast, runs locally or in CI — catches syntax/style issues. SonarQube is enterprise-grade SAST (Static Application Security Testing) with historical tracking, security vulnerability detection, technical debt measurement, and team-wide dashboards.

- *"How do you enforce SonarQube quality gates in a team that resists it?"*
  > Make the gate a merge blocker in the CI pipeline. Start with lenient thresholds on the overall codebase, strict thresholds only on new code. Show the "technical debt" metric in sprint reviews to create ownership.

- *"What is a 'Code Smell' vs a 'Bug' in SonarQube?"*
  > A bug is incorrect behavior. A code smell is maintainability issue — deeply nested conditions, overly long methods, magic numbers. Smells don't break things today but make future bugs more likely.

---

# PART 5 — MODEL CONTEXT PROTOCOL (MCP)

## 5.1 What is MCP?

### 🔑 Keywords: `Protocol → Host → Server → Client → Tool → Resource → Context Window → LLM Bridge`

MCP (Model Context Protocol) is an **open standard** (by Anthropic, 2024) that defines how AI models (LLMs) connect to external data sources and tools in a **standardized, safe, and composable** way.

Think of it as **USB-C for AI integrations** — instead of building custom integrations for every tool, MCP provides a universal connector.

```
WITHOUT MCP (bespoke per integration):
LLM ←→ custom Jira adapter
LLM ←→ custom GitLab adapter  ← each integration is a snowflake
LLM ←→ custom Slack adapter

WITH MCP (standardized):
LLM ←→ MCP Protocol ←→ Jira MCP Server
                    ←→ GitLab MCP Server   ← plug & play
                    ←→ Slack MCP Server
```

---

## 5.2 MCP Architecture — The Three Roles

```
┌──────────────────────────────────────────────────────────────┐
│                        MCP ECOSYSTEM                         │
│                                                              │
│  ┌─────────────────┐       ┌──────────────────────────────┐  │
│  │   MCP HOST      │       │       MCP SERVER             │  │
│  │  (Your Node.js  │◄─────►│  (Jira / GitLab / DB)        │  │
│  │   Express App)  │  MCP  │                              │  │
│  │                 │  JSON │  Exposes:                    │  │
│  │  Contains:      │  RPC  │  • Tools (functions)         │  │
│  │  • MCP Client   │       │  • Resources (data)          │  │
│  │  • LLM Logic    │       │  • Prompts (templates)       │  │
│  │  • Auth/AuthZ   │       │                              │  │
│  └────────┬────────┘       └──────────────────────────────┘  │
│           │                                                   │
│           ▼                                                   │
│  ┌─────────────────┐                                          │
│  │   LLM API       │                                          │
│  │  (Claude/GPT)   │                                          │
│  │                 │                                          │
│  │  Context Window │◄── MCP Host feeds approved data here    │
│  └─────────────────┘                                          │
└──────────────────────────────────────────────────────────────┘
```

### The Three MCP Primitives

| Primitive | Description | Example |
|-----------|-------------|---------|
| **Tools** | Functions the LLM can call (with approval) | `create_jira_ticket`, `get_gitlab_diff` |
| **Resources** | Read-only data the LLM can access | Jira project docs, GitLab repo files |
| **Prompts** | Reusable prompt templates | `summarize_pr_review`, `triage_bug` |

---

## 5.3 Building a Custom Node.js/Express MCP Host

### 🔑 Keywords: `MCP SDK → stdio transport → HTTP/SSE transport → Tool definition → Context injection → Auth boundary`

### Architecture: Bridging GitLab + Jira to LLM

```
Enterprise Infrastructure         MCP Host              LLM
┌─────────────────┐          ┌──────────────────┐   ┌──────────┐
│  GitLab API     │◄────────►│  Node.js/Express │   │          │
│  (MR diffs,     │          │                  │   │  Claude  │
│   pipelines,    │          │  Auth: OAuth2    │◄─►│  GPT-4   │
│   commit logs)  │          │  Rate limiting   │   │          │
├─────────────────┤          │  Data filtering  │   │  Context │
│  Jira API       │◄────────►│  PII scrubbing   │   │  Window  │
│  (tickets,      │          │  Audit logging   │   │  (128k)  │
│   sprint data,  │          │                  │   └──────────┘
│   comments)     │          │  MCP Protocol    │
└─────────────────┘          └──────────────────┘
```

### Minimal MCP Server Implementation (Node.js)

```javascript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Create MCP Server
const server = new McpServer({
  name: 'enterprise-bridge',
  version: '1.0.0'
});

// Define a TOOL: LLM can call this to get GitLab MR data
server.tool(
  'get_merge_request_diff',
  {
    projectId: z.string().describe('GitLab project ID'),
    mrIid: z.number().describe('Merge request internal ID'),
  },
  async ({ projectId, mrIid }) => {
    // Auth + fetch from GitLab
    const diff = await gitlabClient.getMRDiff(projectId, mrIid);

    // SAFETY: Strip sensitive data before sending to LLM context
    const sanitized = stripSecrets(diff); // Remove API keys, tokens, passwords

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(sanitized, null, 2)
      }]
    };
  }
);

// Define a RESOURCE: Read-only Jira project context
server.resource(
  'jira-project-summary',
  'jira://project/{projectKey}/summary',
  async (uri) => {
    const projectKey = extractProjectKey(uri);
    const summary = await jiraClient.getProjectSummary(projectKey);
    return {
      contents: [{
        uri: uri.toString(),
        mimeType: 'application/json',
        text: JSON.stringify(summary)
      }]
    };
  }
);

// Start with stdio transport (for local/CLI usage)
const transport = new StdioServerTransport();
await server.connect(transport);
```

### MCP Host with HTTP/SSE Transport (for Web Integration)

```javascript
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const app = express();
const mcpServer = new McpServer({ name: 'jira-gitlab-bridge', version: '1.0.0' });

// Register tools (same as above)
registerGitLabTools(mcpServer);
registerJiraTools(mcpServer);

// MCP over HTTP + Server-Sent Events
const transports = {}; // session store

app.get('/mcp/sse', authenticate, async (req, res) => {
  // SSE connection — LLM client connects here
  const transport = new SSEServerTransport('/mcp/messages', res);
  transports[transport.sessionId] = transport;

  res.on('close', () => {
    delete transports[transport.sessionId];
  });

  await mcpServer.connect(transport);
});

app.post('/mcp/messages', authenticate, async (req, res) => {
  // Handle incoming MCP messages
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (!transport) return res.status(404).json({ error: 'Session not found' });

  await transport.handlePostMessage(req, res, req.body);
});

app.listen(4000, () => console.log('MCP Host running on :4000'));
```

### Context Window Management — Token Budget Strategy

```javascript
class ContextWindowManager {
  constructor(maxTokens = 128000) {
    this.maxTokens = maxTokens;
    this.reservedForResponse = 4000;  // Keep headroom for LLM response
    this.availableForContext = maxTokens - this.reservedForResponse;
  }

  async buildContext(jiraTickets, gitlabDiffs, userQuery) {
    const parts = [];
    let usedTokens = 0;

    // Priority 1: System context (always included)
    const systemPrompt = this.getSystemPrompt(); // ~500 tokens
    usedTokens += countTokens(systemPrompt);

    // Priority 2: User query
    usedTokens += countTokens(userQuery);

    // Priority 3: Most recent/relevant GitLab diffs (truncate if needed)
    for (const diff of gitlabDiffs.slice(0, 5)) {
      const truncated = this.truncateToFit(diff, this.availableForContext - usedTokens - 1000);
      if (truncated) {
        parts.push(truncated);
        usedTokens += countTokens(truncated);
      }
    }

    // Priority 4: Jira context (remaining budget)
    const jiraSummary = summarizeTickets(jiraTickets); // Compress verbose Jira data
    if (usedTokens + countTokens(jiraSummary) < this.availableForContext) {
      parts.push(jiraSummary);
    }

    return parts.join('\n\n');
  }
}
```

### Security Boundary in MCP Host (CRITICAL)

```javascript
class MCPSecurityLayer {
  // What NEVER goes into LLM context
  static REDACT_PATTERNS = [
    /([A-Za-z0-9_\-]{20,})/g,        // Long tokens (API keys)
    /password\s*[:=]\s*\S+/gi,        // Passwords
    /-----BEGIN.*PRIVATE KEY-----/,   // Private keys
    /\b\d{3}-\d{2}-\d{4}\b/g,        // SSN patterns
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g // Auth headers
  ];

  static sanitize(text) {
    let sanitized = text;
    for (const pattern of this.REDACT_PATTERNS) {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    }
    return sanitized;
  }

  static auditLog(userId, tool, input, output) {
    // Every LLM tool call is logged for compliance
    auditLogger.info({
      userId,
      tool,
      inputHash: hash(input),   // Hash input, don't log raw (may have PII)
      outputSize: output.length,
      timestamp: new Date().toISOString()
    });
  }
}
```

### ❓ Cross-Questions

- *"What is the difference between an MCP Host, Server, and Client?"*
  > **Server**: exposes tools/resources (e.g., Jira MCP Server). **Client**: the protocol client embedded in the host app that connects to servers. **Host**: the application (your Node.js app) that manages clients, orchestrates LLM calls, and enforces security.

- *"Why use MCP instead of just calling APIs directly from the LLM prompt?"*
  > Direct API calls from prompts are unsafe (no auth, no rate limiting, no data sanitization). MCP adds a structured, auditable security layer between the LLM and enterprise infrastructure. The LLM never directly touches your systems — it requests tools through a controlled proxy.

- *"How do you prevent prompt injection attacks in MCP?"*
  > Never trust data from external sources that flows into the context. Sanitize all fetched data. Use a system prompt that explicitly tells the LLM to ignore instructions found in data. Validate tool call parameters strictly with a schema (e.g., Zod).

- *"How do you handle the context window limit when bridging large Jira/GitLab data?"*
  > Token budget management: prioritize most-relevant data, summarize verbose content, chunk large data into multiple LLM calls, use semantic search/embeddings to retrieve only relevant sections, and monitor token usage programmatically.

- *"What transport mechanisms does MCP support?"*
  > **stdio** (local CLI/desktop — process pipes), **HTTP + SSE** (web/remote — Server-Sent Events for server→client streaming, POST for client→server messages). WebSocket transport is also under development.

---

# PART 6 — STAR METHOD: VERIZON/GITLAB AUTOMATION PROJECT

## 6.1 The STAR Script

> **Keyword anchor:** `Situation → Task → Action → Result`

---

### SITUATION

*"At my previous organization, we were managing a large-scale telecommunications platform — essentially a distributed API ecosystem serving millions of users. Our development teams were spread across multiple time zones, working with a shared GitLab monorepo. The challenge was twofold: first, our CI/CD pipeline had zero automated intelligence — it just ran tests and deployed. Second, our engineering leads were spending 8 to 10 hours per week manually reviewing merge request activity, correlating Jira tickets with code changes, and generating compliance audit reports."*

---

### TASK

*"I was tasked as the lead architect to design and implement a system that would automate this review and audit workflow — but with an AI layer that could understand context. The goal was to reduce manual review time by at least 60%, improve compliance posture, and do this without exposing sensitive infrastructure credentials or source code to any external AI service without proper governance."*

---

### ACTION

*"I designed a three-layer architecture:*

*Layer one was the **data acquisition layer** — a Node.js service that interfaced with both our GitLab and Jira APIs. Rather than polling, I used GitLab webhooks to push merge request events into a Redis stream. This gave us near real-time data with event replay capability.*

*Layer two was the **governance and context bridge** — this is where MCP came in. I built a custom Express server that acted as an MCP host. It implemented standardized tool interfaces: one tool to retrieve merge request diffs with token-budget management, another to fetch correlated Jira ticket metadata, and a third to pull historical pipeline failure logs. Before any data entered the LLM context window, it passed through a sanitization layer that redacted credentials, tokens, and any PII. Every tool invocation was audit-logged for compliance.*

*Layer three was the **intelligence layer** — the MCP host would assemble a structured context payload and invoke the LLM API. The LLM's output — a structured JSON containing risk classification, review summary, and suggested Jira status transitions — was then written back to both GitLab as an MR comment and to our internal dashboard.*

*For the CI/CD integration, I used GitLab's pipeline API with a custom stage. The AI review ran as a non-blocking parallel job — it never delayed deployment, but flagged high-risk MRs for mandatory human review. I enforced code quality gates using ESLint, SonarQube integrated directly in the pipeline, and Husky hooks on developer machines for local enforcement.*

*The system was clustered — each Node.js process ran on its own CPU core using Node's cluster module, and CPU-bound tasks like large diff parsing were offloaded to worker threads to keep the event loop free.*"

---

### RESULT

*"Within 8 weeks of deployment:*
- *Manual review time dropped by 73% — exceeding our 60% target*
- *We caught 3 critical security misconfigurations in MRs that automated tests had missed*
- *Compliance audit report generation went from a 4-hour manual effort to a 2-minute automated export*
- *Developer NPS on the review process went up — they appreciated that AI context was added to their MRs as a collaborative tool, not a gate*
- *The architecture was presented internally as a reference design for two other business units to adopt"*

---

## 6.2 Generic Abstraction (If Interviewer Asks to Remove Specifics)

> *"I designed a distributed event-driven pipeline where webhook events from a code repository platform triggered a context assembly service. That service acted as a protocol-compliant bridge between enterprise data systems and a large language model. Data governance was enforced at the bridge layer — no raw credentials, PII, or secrets ever entered the AI context. The AI generated structured insights that were written back to the originating system and surfaced on an internal dashboard. The entire system was containerized, horizontally scalable, and integrated into the existing CI/CD quality gate chain."*

---

## 6.3 Anticipated Follow-Up Questions

| Question | Quick Answer (Keywords) |
|----------|------------------------|
| How did you handle LLM hallucinations? | `Structured output (JSON schema) → validation layer → fallback to human review` |
| How did you ensure data privacy? | `PII redaction → audit logs → no raw data in prompts → RBAC on tool access` |
| What if the LLM API is down? | `Circuit breaker → graceful degradation → MR proceeds without AI comment, alert fires` |
| How did you test the AI outputs? | `Golden dataset → output schema validation → A/B comparison with human reviews` |
| How did you manage context window limits? | `Token budget manager → semantic chunking → summarization of old data → priority queue` |
| Cost control for LLM calls? | `Caching identical diff analyses (hash-based) → batch processing off-peak → token monitoring` |
| How did you handle rate limits? | `Redis queue → p-limit concurrency control → exponential backoff → webhook replay` |

---

# PART 7 — QUICK REFERENCE CHEAT SHEET

## Architecture Decision Quick Answers

| Interviewer says... | You say... |
|--------------------|-----------|
| "Scale to 10x traffic" | `Horizontal scaling → Cluster + PM2 → K8s HPA → Redis for shared state` |
| "Reduce memory usage" | `Streams over buffering → connection pooling → garbage collection profiling` |
| "Improve API response time" | `Parallel Promise.all → DB indexing → Redis caching → CDN for static` |
| "Zero-downtime deployment" | `Cluster rolling restart → K8s rolling update → blue-green → health checks` |
| "Handle 100k concurrent users" | `Cluster → load balancer → connection pool → event loop optimization` |
| "Prevent security breaches" | `Helmet → rate limit → input sanitization → JWT + Redis blacklist → audit logs` |
| "Ensure code quality at scale" | `Husky hooks → ESLint → SonarQube gate → mandatory PR reviews` |

## Event Loop One-Liner Memory Aid

```
SYNC → nextTick → Promise → Timers → I/O → setImmediate → close
  ↑___________________________|  (microtasks run between each phase)
```

## MCP One-Liner Memory Aid

```
LLM → MCP Host (Auth + Sanitize + Audit) → MCP Server → Enterprise Data
                ↑ You own and control this layer
```

---

# PART 8 — BEHAVIORAL QUESTIONS (LEAD/ARCHITECT LEVEL)

| Question | STAR Keywords |
|----------|--------------|
| "Tell me about a time you disagreed with a technical decision" | `Data-driven case → respected hierarchy → proposed experiment → result-based resolution` |
| "How do you onboard junior developers?" | `Pair programming → documented ADRs → incremental ownership → safe failure zone` |
| "How do you handle technical debt?" | `Measure (SonarQube) → prioritize by risk → allocate 20% sprint capacity → track reduction` |
| "Describe your code review philosophy" | `Security first → clarity second → performance third → no nitpicks without rationale` |
| "How do you stay current with technology?" | `MDN/Node.js blog → architecture podcasts → OSS contributions → team knowledge shares` |

---

*Last updated: Pre-interview consolidation | Version 1.0*
*Focus: Node.js Internals · Async · Clustering · Streams · Security · MCP · STAR*