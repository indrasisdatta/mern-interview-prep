# Node.js Notes 

---

## Table of Contents

1. [Node.js Internals & Architecture](#1-nodejs-internals--architecture)
2. [Event Loop — Deep Dive](#2-event-loop--deep-dive)
3. [Express.js & Middleware](#3-expressjs--middleware)
4. [CORS & Security Headers](#4-cors--security-headers)
5. [File Handling & Excel Upload](#5-file-handling--excel-upload)
6. [Concurrency — Worker Threads, Child Processes & Cluster](#6-concurrency--worker-threads-child-processes--cluster)
7. [Streams & Backpressure](#7-streams--backpressure)
8. [Memory Management & Leak Detection](#8-memory-management--leak-detection)
9. [Rate Limiting Strategies](#9-rate-limiting-strategies)
10. [Global Error Handling](#10-global-error-handling)
11. [Circuit Breaker Pattern](#11-circuit-breaker-pattern)
12. [Caching with Redis](#12-caching-with-redis)
13. [Job Queues — BullMQ / SQS / Kafka](#13-job-queues--bullmq--sqs--kafka)
14. [WebSockets & Real-time](#14-websockets--real-time)
15. [Authentication Patterns — JWT & Refresh Tokens](#15-authentication-patterns--jwt--refresh-tokens)
16. [Graceful Shutdown](#16-graceful-shutdown)
17. [Observability — Logging, Metrics & Tracing](#17-observability--logging-metrics--tracing)
18. [Database Best Practices](#18-database-best-practices)
19. [Security Hardening](#19-security-hardening)
20. [Design Patterns for Node.js at Scale](#20-design-patterns-for-nodejs-at-scale)
21. [Testing Strategy](#21-testing-strategy)
22. [Scaling Architecture Checklist](#22-scaling-architecture-checklist)
23. [Node.js 24 — What's New](#23-nodejs-24--whats-new)

---

## 1. Node.js Internals & Architecture

### Core Components

```
┌─────────────────────────────────────────────┐
│              Your Application               │
├─────────────────────────────────────────────┤
│            Node.js Standard Library         │
├─────────────────────────────────────────────┤
│   V8 Engine          │   Node.js Bindings   │
│   (JS execution)     │   (C++ addons)       │
├─────────────────────────────────────────────┤
│              LibUV                          │
│   (Event Loop, Thread Pool, Async I/O)      │
├──────────────────────┬──────────────────────┤
│   OS Kernel          │   Thread Pool        │
│   (Network, TCP/IP)  │   (fs, crypto, dns)  │
└──────────────────────┴──────────────────────┘
```

### Main Thread Lifecycle

```
start → parse & execute top-level code
      → register callbacks (timers, I/O handlers)
      → event loop begins
      → offload async work to libuv / OS
      → process callbacks as they complete
      → exit when event loop has nothing left
```

### What runs where?

| Operation | Handled By |
|---|---|
| `fs.readFile`, `fs.writeFile` | libuv Thread Pool |
| `crypto.pbkdf2`, `crypto.scrypt` | libuv Thread Pool |
| `zlib` compression | libuv Thread Pool |
| DNS resolution (`dns.lookup`) | libuv Thread Pool |
| TCP/UDP sockets, HTTP | OS Kernel (async via epoll/kqueue) |
| `setTimeout`, `setInterval` | libuv Timer (main thread) |
| `setTimeout(fn, 0)` vs `setImmediate` | Non-deterministic at top-level, deterministic inside I/O |

> **Architect insight:** The default libuv thread pool size is **4**. For CPU-heavy apps (lots of crypto/fs), increase it:
> ```bash
> UV_THREADPOOL_SIZE=16 node server.js
> ```
> Max useful value is the number of CPU cores. Beyond that you get context-switching overhead.

---

## 2. Event Loop — Deep Dive

### Phases (in order)

```
   ┌───────────────────────────┐
┌─►│  1. Timers                │  setTimeout / setInterval callbacks
│  └───────────────────────────┘
│  ┌───────────────────────────┐
│  │  2. Pending Callbacks     │  I/O callbacks deferred from previous tick
│  └───────────────────────────┘
│  ┌───────────────────────────┐
│  │  3. Idle / Prepare        │  internal use only
│  └───────────────────────────┘
│  ┌───────────────────────────┐
│  │  4. Poll                  │  fetch new I/O events; execute I/O callbacks
│  └───────────────────────────┘
│  ┌───────────────────────────┐
│  │  5. Check                 │  setImmediate() callbacks
│  └───────────────────────────┘
│  ┌───────────────────────────┐
│  │  6. Close Callbacks       │  socket.on('close', ...), server.close()
│  └───────────────────────────┘
│
│  ← No more tasks? → EXIT
└──── Tasks pending? → REPEAT
```

> ⚠️ **Bug in original notes:** "Any tasks pending? true → exit" is **backwards**.
> Correct: **No tasks pending → exit. Tasks pending → repeat.**

### Microtask Queues (run between EVERY phase transition)

```
Call Stack → empties → process.nextTick queue → Promise microtask queue → next event loop phase
```

Node has **two** microtask queues:
1. `process.nextTick` queue — **higher priority**
2. Promise microtask queue (`Promise.resolve().then(...)`)

```js
// Execution order demo
setTimeout(() => console.log('1. setTimeout'), 0);
setImmediate(() => console.log('2. setImmediate'));

Promise.resolve().then(() => console.log('3. Promise'));
process.nextTick(() => console.log('4. nextTick'));

console.log('5. sync');

// Output:
// 5. sync
// 4. nextTick
// 3. Promise
// 1. setTimeout  (or 2 first — non-deterministic at top level)
// 2. setImmediate
```

### `setTimeout` vs `setImmediate` — the gotcha

```js
// TOP-LEVEL: order is NON-DETERMINISTIC (depends on OS scheduling)
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));

// setTimeout secretly needs 1ms to pass - libuv enforces 1ms instead of 0
// Run 1: startup took 0.6ms → 1ms NOT yet elapsed
//   → Timers phase: nothing to run
//   → Check phase: setImmediate fires
//   Output: immediate → timeout

// Run 2: startup took 1.3ms → 1ms HAS elapsed  
//   → Timers phase: setTimeout fires
//   → Check phase: setImmediate fires
//   Output: timeout → immediate

// INSIDE I/O CALLBACK: setImmediate ALWAYS runs first
const fs = require('fs');
fs.readFile(__filename, () => {
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate')); // ← always first here
});
```

> **Why?** Inside an I/O callback we're already in the Poll phase. The event loop moves to Check (setImmediate) before cycling back to Timers.

### Tricky Interview Question

```js
async function main() {
  console.log('A');
  await Promise.resolve();
  console.log('B');
  process.nextTick(() => console.log('C'));
  await Promise.resolve();
  console.log('D');
}
main();
console.log('E');

// A → E → B → C → D
// 'C' is registered after B executes, but nextTick fires before the next await resolves
```

---

## 3. Express.js & Middleware

### Types of Middleware

**1. Application-level** — runs for every request

```js
app.use(cors(corsConfig));
app.use(helmet());
app.use(rateLimiter);
app.use(express.json({ limit: '1mb' }));
```

**2. Router-level** — scoped to a router or route

```js
const userRouter = express.Router();
userRouter.use(authenticate);        // all /users routes
userRouter.use(authorize('admin'));  // all /users routes

userRouter.get('/dashboard', getDashboard);
userRouter.get('/profile', getProfile);
userRouter.put('/settings', updateSettings);

app.use('/users', userRouter);

// Single-route middleware
app.post('/admin/nuke', authenticate, authorize('superadmin'), nukeHandler);
```

**3. Error-handling middleware** — must have exactly **4 arguments**

```js
// Global error handler — register LAST
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const isOperational = err.isOperational ?? false;

  logger.error({
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    requestId: req.id,
  });

  // Don't leak stack traces to clients in production
  res.status(statusCode).json({
    status: 'error',
    message: isOperational ? err.message : 'Something went wrong',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});
```

**4. Built-in middleware**

```js
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
app.use(express.static('public'));
```

### Operational vs Programmer Errors

```js
// Custom error class — key for clean error handling at scale
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // Expected errors (404, 401, validation)
    Error.captureStackTrace(this, this.constructor);
  }
}

// Usage
throw new AppError('User not found', 404);

// Programmer errors (null ref, syntax) → isOperational = false → crash & restart
```

### `asyncHandler` wrapper (avoid try/catch everywhere)

```js
// Wrapper to forward async errors to Express error middleware
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await UserService.findById(req.params.id);
  if (!user) throw new AppError('User not found', 404);
  res.json(user);
}));
```

---

## 4. CORS & Security Headers

### CORS Headers

| Header | Purpose |
|---|---|
| `Access-Control-Allow-Origin` | Which origins can access the resource |
| `Access-Control-Allow-Methods` | Allowed HTTP methods |
| `Access-Control-Allow-Headers` | Which request headers are permitted |
| `Access-Control-Allow-Credentials` | Allow cookies/auth headers cross-origin |
| `Access-Control-Max-Age` | How long preflight result can be cached (seconds) |

```js
import cors from 'cors';

const corsConfig = {
  origin: (origin, callback) => {
    const whitelist = process.env.ALLOWED_ORIGINS?.split(',') ?? [];
    if (!origin || whitelist.includes(origin)) {
      callback(null, true);
    } else {
      callback(new AppError('Not allowed by CORS', 403));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  credentials: true,
  maxAge: 86400, // 24 hours — reduces preflight requests
};

app.use(cors(corsConfig));
```

### Helmet — Security Headers in One Line

```js
import helmet from 'helmet';

app.use(helmet()); // Sets 11 security headers automatically

// Key headers Helmet sets:
// Content-Security-Policy
// X-Content-Type-Options: nosniff
// X-Frame-Options: SAMEORIGIN
// Strict-Transport-Security (HSTS)
// X-XSS-Protection (legacy browsers)
// Referrer-Policy
```

### Payload Size — Prevent DoS

```js
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// Catch payload-too-large errors
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      message: 'Payload too large. Max size is 1MB.',
    });
  }
  next(err);
});
```

---

## 5. File Handling & Excel Upload

### Multer Setup

```js
import multer from 'multer';

// Memory storage for small files (< 5MB)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('Only Excel files are allowed', 400), false);
    }
  },
});
```

### Buffer Approach (small files)

```js
import XLSX from 'xlsx';

app.post('/upload/excel', memoryUpload.single('file'), async (req, res) => {
  if (!req.file) throw new AppError('No file uploaded', 400);

  // ✅ Corrected from original notes:
  // req.file.buffer is already available with memoryStorage (no fs.readFile needed)
  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });

  const firstSheetName = workbook.SheetNames[0];
  // ✅ Bug fix: must pass workbook.Sheets[name], not the name string
  const data = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName]);

  res.json({ rows: data.length, data });
});
```

> ⚠️ **Two bugs in original notes fixed above:**
> 1. `fs.readFile(filepath)` is **async** — it returns `undefined` without a callback. Use `fs.readFileSync` or the Promise version.
> 2. `XLSX.utils.sheet_to_json(firstSheet)` — `firstSheet` is just a **name string**. The correct call is `XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName])`.

### Streaming Approach — Large Files (ExcelJS)

```js
import ExcelJS from 'exceljs';
import multer from 'multer';

const diskUpload = multer({ dest: '/tmp/uploads/' });

app.post('/upload/large-excel', diskUpload.single('file'), async (req, res) => {
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(req.file.path, {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
  });

  const errors = [];
  let rowCount = 0;
  const batchSize = 500;
  let batch = [];

  for await (const worksheetReader of workbookReader) {
    for await (const row of worksheetReader) {
      if (row.number === 1) continue; // skip header

      const record = { name: row.getCell(1).value, email: row.getCell(2).value };
      batch.push(record);
      rowCount++;

      if (batch.length >= batchSize) {
        await UserService.bulkInsert(batch); // flush batch to DB
        batch = [];
      }
    }
  }

  if (batch.length) await UserService.bulkInsert(batch); // flush remainder

  await fs.promises.unlink(req.file.path); // cleanup temp file
  res.json({ processedRows: rowCount, errors });
});
```

**Why streaming over buffer for large files:**

| Concern | Buffer | Stream |
|---|---|---|
| Memory | Entire file in RAM | One chunk at a time |
| Validation latency | After full load | As first rows arrive |
| Backpressure | Manual | Built-in |
| 10 users × 100MB | 1GB RAM needed | ~10MB RAM needed |

---

## 6. Concurrency — Worker Threads, Child Processes & Cluster

### Decision Matrix

```
Is the task CPU-intensive JS? → Worker Thread
Need a separate binary/runtime (Python, Git)? → Child Process
Need fault isolation for untrusted/crash-prone code? → Child Process
Need shared memory & low overhead? → Worker Thread
Need to scale across all CPU cores for HTTP? → Cluster
Need horizontal scaling across machines? → Load balancer + multiple instances
```

### Worker Threads (CPU-bound JS)

```js
// main.js
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

if (isMainThread) {
  function runWorker(data) {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: data });
      worker.on('message', resolve);
      worker.on('error', reject);
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
      });
    });
  }

  // Use case: hashing 10,000 passwords without blocking the event loop
  app.post('/bulk-hash', asyncHandler(async (req, res) => {
    const results = await runWorker({ passwords: req.body.passwords });
    res.json(results);
  }));
} else {
  // This runs in the worker thread
  const { passwords } = workerData;
  const hashed = passwords.map(p => crypto.scryptSync(p, 'salt', 64).toString('hex'));
  parentPort.postMessage(hashed);
}
```

### SharedArrayBuffer — Zero-copy communication

```js
// For performance-critical scenarios (image pixel manipulation, ML preprocessing)
const sharedBuffer = new SharedArrayBuffer(1024);
const sharedArray = new Int32Array(sharedBuffer);

const worker = new Worker('./processor.js', {
  workerData: { sharedBuffer }, // No copy — same memory
});

// Atomics for thread-safe operations
Atomics.add(sharedArray, 0, 1);
Atomics.wait(sharedArray, 0, 0); // block until value changes
```

### Child Processes

```js
import { fork, spawn, exec, execFile } from 'child_process';

// fork — best for background Node.js workers (has IPC channel)
const worker = fork('./workers/reportGenerator.js');
worker.send({ reportType: 'quarterly', userId: 42 });
worker.on('message', (result) => console.log('Report ready:', result));

// spawn — stream large output (memory efficient)
const ls = spawn('ls', ['-la', '/var/log']);
ls.stdout.pipe(res); // pipe directly to HTTP response

// exec — small output shell commands (vulnerable to injection with user input!)
exec('git log --oneline -5', (err, stdout) => console.log(stdout));

// execFile — safer, no shell, buffered (use over exec for user input)
execFile('ffmpeg', ['-i', inputPath, outputPath], (err) => { ... });
```

### Cluster — Utilize All CPU Cores

```js
import cluster from 'cluster';
import os from 'os';

if (cluster.isPrimary) {
  const numCPUs = os.availableParallelism(); // Node 18+, better than cpus().length

  console.log(`Primary ${process.pid} running. Forking ${numCPUs} workers...`);

  for (let i = 0; i < numCPUs; i++) cluster.fork();

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    cluster.fork(); // auto-restart crashed workers
  });

  // Zero-downtime rolling restart (used in CI/CD)
  process.on('SIGUSR2', () => {
    const workers = Object.values(cluster.workers);
    let i = 0;
    const restartNext = () => {
      if (i >= workers.length) return;
      const worker = workers[i++];
      worker.on('exit', () => {
        cluster.fork().on('listening', restartNext);
      });
      worker.kill('SIGTERM');
    };
    restartNext();
  });
} else {
  // Each worker runs its own Express server
  await import('./server.js');
  console.log(`Worker ${process.pid} started`);
}
```

> **Cluster vs Worker Threads:**
> - **Cluster** → improves **throughput** (handles more HTTP requests in parallel)
> - **Worker Threads** → improves **latency** (unblocks event loop for CPU-bound work)
> - In production, use **PM2 cluster mode** instead of manual cluster code

### PM2 — Production Process Manager

```js
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'api-server',
    script: 'dist/server.js',
    instances: 'max',           // one per CPU core
    exec_mode: 'cluster',
    watch: false,
    max_memory_restart: '1G',   // restart if memory exceeds 1GB
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
```

```bash
pm2 start ecosystem.config.js --env production
pm2 monit       # real-time monitoring
pm2 logs        # tail logs
pm2 reload api-server  # zero-downtime reload
```

---

## 7. Streams & Backpressure

### Stream Types

```js
import fs from 'fs';
import zlib from 'zlib';
import { Transform } from 'stream';

// Readable
const readable = fs.createReadStream('large-data.csv');

// Writable
const writable = fs.createWriteStream('output.csv');

// Transform — modify data in flight
const csvFilter = new Transform({
  objectMode: true,
  transform(chunk, encoding, callback) {
    if (chunk.age > 18) this.push(chunk); // filter rows
    callback();
  },
});

// Duplex — TCP socket (read + write independently)
// net.Socket is a Duplex stream
```

### Piping — Preferred Pattern

```js
// File compression pipeline
fs.createReadStream('usersData.csv')
  .pipe(zlib.createGzip())
  .pipe(fs.createWriteStream('usersData.csv.gz'))
  .on('finish', () => console.log('Compressed successfully'));

// Using pipeline() — better error handling than pipe()
import { pipeline } from 'stream/promises';

await pipeline(
  fs.createReadStream('usersData.csv'),
  zlib.createGzip(),
  fs.createWriteStream('usersData.csv.gz'),
);
// Automatically destroys all streams on error — no leaks
```

> **Use `pipeline()` over `pipe()` in production.** `pipe()` doesn't forward errors — a read error won't close the write stream, causing file descriptor leaks. `pipeline()` handles this correctly.

### Backpressure Explained

```js
const readable = fs.createReadStream('10gb-file.csv');
const writable = fs.createWriteStream('destination.csv');

readable.on('data', (chunk) => {
  const canContinue = writable.write(chunk);
  if (!canContinue) {
    readable.pause(); // consumer is full — stop reading
    writable.once('drain', () => readable.resume()); // resume when drained
  }
});

// pipe() and pipeline() handle all of the above automatically
```

### Real Use Case — S3 Streaming Upload

```js
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

app.post('/upload/video', memoryUpload.none(), async (req, res) => {
  const fileStream = req; // req is a Readable stream itself

  const upload = new Upload({
    client: new S3Client({ region: 'us-east-1' }),
    params: {
      Bucket: process.env.S3_BUCKET,
      Key: `videos/${Date.now()}-${req.headers['x-filename']}`,
      Body: fileStream,
      ContentType: req.headers['content-type'],
    },
    queueSize: 4,       // parallel upload parts
    partSize: 5 * 1024 * 1024, // 5MB parts
  });

  const result = await upload.done();
  res.json({ url: result.Location });
});
```

Approach          Browser RAM     Server RAM      Good for
───────────────────────────────────────────────────────────────
FormData          ~0 (streaming)  Whole file*     Excel, images, docs
                                  (memoryStorage) up to 10MB

ArrayBuffer       Whole file      Whole file      Client-side manipulation
                  ❌ avoid large  ❌ avoid large  (encryption, preview)

Raw stream        ~64KB chunks    ~chunk size     Videos, large files
                  ✅              ✅              anything > 10MB

*DiskStorage avoids server RAM — saves to disk instead

---

## 8. Memory Management & Leak Detection

### Common Memory Leak Sources

```js
// ❌ 1. Event listeners accumulating
const emitter = new EventEmitter();
setInterval(() => {
  emitter.on('data', handler); // new listener added every second — never removed!
}, 1000);

// ✅ Fix
emitter.once('data', handler); // auto-removes after firing
// or
emitter.on('data', handler);
// later...
emitter.off('data', handler);

// ❌ 2. Growing global cache with no eviction
const cache = {};
app.get('/user/:id', (req, res) => {
  cache[req.params.id] = heavyObject; // grows forever
});

// ✅ Fix — use LRU cache with TTL
import LRU from 'lru-cache';
const cache = new LRU({ max: 1000, ttl: 1000 * 60 * 10 }); // 10 min TTL

// ❌ 3. Closure holding large objects
function processReport() {
  const hugeBuffer = Buffer.alloc(100 * 1024 * 1024); // 100MB
  return function getStats() {
    return hugeBuffer.length; // closure keeps hugeBuffer in memory forever
  };
}

// ✅ Fix — extract only what you need, nullify reference
function processReport() {
  const hugeBuffer = Buffer.alloc(100 * 1024 * 1024);
  const length = hugeBuffer.length;
  hugeBuffer = null; // allow GC
  return () => length;
}

// ❌ 4. Unresolved Promises (dangling)
async function fetchWithNoTimeout() {
  // If the DB never responds, this Promise stays in memory indefinitely
  const result = await db.query('SELECT * FROM logs');
}

// ✅ Fix — always use timeouts
const result = await Promise.race([
  db.query('SELECT * FROM logs'),
  new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 5000)),
]);

// ❌ 5. Timers not cleared
const interval = setInterval(() => heavyTask(), 1000);
// If the module is "unloaded" but interval still references it, it won't be GCd

// ✅ Fix
process.on('SIGTERM', () => clearInterval(interval));
```

### WeakMap/WeakRef — GC-friendly caches

```js
// WeakMap — key is GCd when no other references exist
const cache = new WeakMap();

function processUser(user) {
  if (cache.has(user)) return cache.get(user);
  const result = expensiveOperation(user);
  cache.set(user, result); // auto-evicted when 'user' object is GCd
  return result;
}
```

### Heap Snapshot Debugging

```bash
# 1. Start with inspector
node --inspect dist/server.js

# 2. Open chrome://inspect → "Open dedicated DevTools for Node"
# 3. Memory tab → Take Snapshot (Baseline)
# 4. Run load test against the suspected endpoint
#    ab -n 10000 -c 50 http://localhost:3000/api/users
# 5. Memory tab → Take Snapshot (After load)
# 6. Select "Comparison" view → sort by "Size Delta"
# 7. Objects with large positive delta are leaking
```

```js
// Programmatic heap snapshot (for production diagnosis)
import v8 from 'v8';

app.get('/admin/heap-snapshot', adminOnly, (req, res) => {
  const filename = `heap-${Date.now()}.heapsnapshot`;
  const stream = v8.writeHeapSnapshot(`/tmp/${filename}`);
  res.json({ file: stream });
});
```

### V8 GC Tuning (large-heap services)

```bash
# Increase old-space for memory-intensive services
node --max-old-space-size=4096 server.js  # 4GB heap

# Expose GC for manual triggering (debugging only, never production)
node --expose-gc server.js
global.gc(); // force GC
```

---

## 9. Rate Limiting Strategies

### Algorithms Compared

| Algorithm | Behaviour | Best For |
|---|---|---|
| **Token Bucket** | Allows bursts up to bucket capacity | APIs needing burst tolerance (uploads, sales events) |
| **Leaky Bucket** | Fixed output rate, excess dropped/queued | Smooth, predictable rate (payment APIs) |
| **Fixed Window** | Counter resets at fixed interval boundary | Simple cases; has boundary attack vulnerability |
| **Sliding Window** | Weighted average across rolling window | More accurate, prevents boundary gaming |

### express-rate-limit (single instance)

```js
import { rateLimit } from 'express-rate-limit';

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  limit: 100,
  message: { status: 429, error: 'Too many requests, please try again later.' },
  standardHeaders: 'draft-7', // X-RateLimit-* headers
  legacyHeaders: false,
  keyGenerator: (req) => req.ip, // default
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  limit: 5,                   // 5 failed attempts
  skipSuccessfulRequests: true, // only count failures
});

app.use(globalLimiter);
app.post('/auth/login', authLimiter, loginHandler);
```

> ⚠️ `express-rate-limit` is **in-memory** — useless with multiple instances (K8s, PM2 cluster). Each pod gets its own counter.

### Redis-backed Rate Limiting (production)

```js
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';

const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
    prefix: 'rl:', // Redis key prefix
  }),
});

app.use(limiter);
```

### Custom Token Bucket with Lua Script (atomic, no race condition)

```lua
-- token_bucket.lua — runs atomically in Redis
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])  -- tokens per second
local now = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(bucket[1]) or capacity
local last_refill = tonumber(bucket[2]) or now

local elapsed = now - last_refill
tokens = math.min(capacity, tokens + elapsed * refill_rate)

if tokens >= requested then
  tokens = tokens - requested
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  redis.call('EXPIRE', key, 3600)
  return 1  -- allowed
else
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  return 0  -- denied
end
```

```js
const tokenBucket = async (req, res, next) => {
  const allowed = await redisClient.eval(tokenBucketScript, {
    keys: [`tb:${req.ip}`],
    arguments: ['100', '1.67', String(Date.now() / 1000), '1'],
  });
  if (!allowed) return res.status(429).json({ error: 'Rate limit exceeded' });
  next();
};
```

---

## 10. Global Error Handling

### Layered Error Handling Architecture

```js
// 1. Route-level: asyncHandler catches Promise rejections → forwards to next(err)
// 2. Express error middleware: operational errors
// 3. process.on('unhandledRejection'): missed Promise errors
// 4. process.on('uncaughtException'): synchronous throws escaping call stack

// ── Express error middleware ──
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  logger.error({ err, reqId: req.id, path: req.path });

  res.status(statusCode).json({
    status: 'error',
    message: err.isOperational ? err.message : 'Internal server error',
  });
});

// ── Unhandled Promise rejections ──
process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'UNHANDLED REJECTION');
  gracefulShutdown('unhandledRejection');
});

// ── Uncaught exceptions — synchronous bugs ──
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'UNCAUGHT EXCEPTION — process will exit');
  gracefulShutdown('uncaughtException');
});
```

> **Architect note:** `uncaughtException` should **always** terminate the process. The app is now in an unknown state. Let your process manager (PM2, K8s) restart it. Using `uncaughtException` to "keep the server running" is an anti-pattern.

---

## 11. Circuit Breaker Pattern

Protects your service when an upstream dependency (DB, third-party API) degrades.

```
CLOSED → normal operation, requests pass through
    ↓ (failure threshold exceeded)
OPEN → fail fast, return cached/fallback response immediately
    ↓ (after timeout)
HALF-OPEN → probe a few requests
    ↓ success → CLOSED | failure → OPEN
```

```js
import CircuitBreaker from 'opossum';

const options = {
  timeout: 3000,             // 3s — if call takes longer, it's a failure
  errorThresholdPercentage: 50, // open if 50% of calls fail
  resetTimeout: 30000,       // try again after 30s in OPEN state
  volumeThreshold: 10,       // min requests before stats are evaluated
};

const breaker = new CircuitBreaker(callPaymentAPI, options);

breaker.fallback(() => ({
  status: 'pending',
  message: 'Payment service temporarily unavailable. Will retry automatically.',
}));

breaker.on('open', () => logger.warn('Circuit OPEN — payment service down'));
breaker.on('halfOpen', () => logger.info('Circuit HALF-OPEN — testing payment service'));
breaker.on('close', () => logger.info('Circuit CLOSED — payment service recovered'));

app.post('/checkout', asyncHandler(async (req, res) => {
  const result = await breaker.fire(req.body.payment);
  res.json(result);
}));
```

### Exponential Backoff + Jitter

```js
// For retrying transient failures (e.g., 503 from a third-party API)
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 300) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      
      const exponentialDelay = baseDelay * 2 ** attempt;
      const jitter = Math.random() * 200; // prevent thundering herd
      const delay = exponentialDelay + jitter;

      logger.warn({ attempt, delay }, `Retrying after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Usage
const data = await retryWithBackoff(() => stripeClient.charges.create(payload));
```

---

## 12. Caching with Redis

### Cache Strategies

| Strategy | Description | Use Case |
|---|---|---|
| **Cache-aside** | App checks cache first; on miss, fetches from DB and writes to cache | General-purpose, most common |
| **Write-through** | Write to cache + DB simultaneously | Strong consistency needs |
| **Write-behind** | Write to cache, async flush to DB | High write throughput |
| **Read-through** | Cache fetches from DB on miss automatically | Cache libraries |

### Cache-Aside Pattern

```js
class UserService {
  async getUserById(id) {
    const cacheKey = `user:${id}`;

    // 1. Check cache
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // 2. Cache miss — hit DB
    const user = await User.findById(id).lean();
    if (!user) throw new AppError('User not found', 404);

    // 3. Populate cache with TTL
    await redis.setex(cacheKey, 3600, JSON.stringify(user)); // 1 hour TTL

    return user;
  }

  async updateUser(id, updates) {
    const user = await User.findByIdAndUpdate(id, updates, { new: true });

    // Invalidate cache on update
    await redis.del(`user:${id}`);

    return user;
  }
}
```

### Cache Stampede — Prevent with Mutex

```js
// Problem: 1000 concurrent requests all get a cache miss at the same time
//          → all 1000 hit the DB simultaneously → DB overload

import Redlock from 'redlock';
const redlock = new Redlock([redis]);

async function getCachedUser(id) {
  const cacheKey = `user:${id}`;

  let data = await redis.get(cacheKey);
  if (data) return JSON.parse(data);

  // Only one process acquires the lock; others wait
  const lock = await redlock.acquire([`lock:${cacheKey}`], 5000);

  try {
    // Double-check after acquiring lock (another process may have populated cache)
    data = await redis.get(cacheKey);
    if (data) return JSON.parse(data);

    const user = await User.findById(id).lean();
    await redis.setex(cacheKey, 3600, JSON.stringify(user));
    return user;
  } finally {
    await lock.release();
  }
}
```

### Redis Patterns for Real-World Use Cases

```js
// 1. Distributed session store
import session from 'express-session';
import RedisStore from 'connect-redis';

app.use(session({
  store: new RedisStore({ client: redis }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, httpOnly: true, maxAge: 86400000 },
}));

// 2. Pub/Sub for real-time events across instances
const publisher = redis.duplicate();
const subscriber = redis.duplicate();

await subscriber.subscribe('order:created', (message) => {
  const order = JSON.parse(message);
  notifyWarehouse(order);
});

// From any instance:
await publisher.publish('order:created', JSON.stringify(newOrder));

// 3. Leaderboard with Sorted Sets
await redis.zadd('leaderboard', score, userId);
const topTen = await redis.zrevrange('leaderboard', 0, 9, 'WITHSCORES');
const userRank = await redis.zrevrank('leaderboard', userId);
```

---

## 13. Job Queues — BullMQ / SQS / Kafka

### When to Use Queues

- Email / SMS notifications (decouple sending from request lifecycle)
- Report generation (long-running, shouldn't block HTTP response)
- Image/video processing
- Webhook delivery with retry
- Rate-limited third-party API calls
- Audit log ingestion

### BullMQ (Redis-backed, best for Node.js monolith/microservices)

```js
import { Queue, Worker, QueueEvents } from 'bullmq';

const connection = { host: process.env.REDIS_HOST, port: 6379 };

// ── Producer ──
const emailQueue = new Queue('email', { connection });

app.post('/register', asyncHandler(async (req, res) => {
  const user = await UserService.create(req.body);

  // Add job — returns immediately
  await emailQueue.add('welcome-email', { userId: user.id, email: user.email }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: 100, // keep last 100 failed jobs for inspection
  });

  res.status(201).json({ user });
}));

// ── Consumer (can be a separate process/service) ──
const emailWorker = new Worker('email', async (job) => {
  const { userId, email } = job.data;
  await EmailService.sendWelcome(email);
  logger.info({ jobId: job.id, userId }, 'Welcome email sent');
}, {
  connection,
  concurrency: 5, // process 5 jobs simultaneously
});

emailWorker.on('failed', (job, err) => {
  logger.error({ jobId: job.id, err }, 'Email job failed');
});

// ── Job progress tracking ──
const worker = new Worker('report', async (job) => {
  const data = await fetchData();
  await job.updateProgress(50);     // 50%
  const report = await generateReport(data);
  await job.updateProgress(100);    // 100%
  return report;
}, { connection });
```

### SQS Pattern (AWS, distributed teams)

```js
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({ region: 'us-east-1' });
const QUEUE_URL = process.env.SQS_QUEUE_URL;

// Producer
export async function enqueueOrder(order) {
  await sqs.send(new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify(order),
    MessageGroupId: order.userId, // FIFO queue — preserve order per user
    MessageDeduplicationId: order.idempotencyKey,
  }));
}

// Consumer (long-polling)
async function pollQueue() {
  while (true) {
    const response = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 20, // long-polling — cheaper than short-polling
    }));

    for (const message of response.Messages ?? []) {
      try {
        await processOrder(JSON.parse(message.Body));
        // Only delete after successful processing (at-least-once delivery)
        await sqs.send(new DeleteMessageCommand({
          QueueUrl: QUEUE_URL,
          ReceiptHandle: message.ReceiptHandle,
        }));
      } catch (err) {
        logger.error({ err, messageId: message.MessageId }, 'Failed to process');
        // Message becomes visible again after VisibilityTimeout → DLQ after maxReceiveCount
      }
    }
  }
}
```

### Kafka (event streaming at scale — Confluent/MSK)

```js
import { Kafka } from 'kafkajs';

const kafka = new Kafka({ brokers: [process.env.KAFKA_BROKER], clientId: 'order-service' });

// Producer
const producer = kafka.producer();
await producer.connect();

await producer.send({
  topic: 'orders.created',
  messages: [{ key: order.id, value: JSON.stringify(order) }],
});

// Consumer
const consumer = kafka.consumer({ groupId: 'inventory-service' });
await consumer.connect();
await consumer.subscribe({ topic: 'orders.created', fromBeginning: false });

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    const order = JSON.parse(message.value.toString());
    await InventoryService.reserve(order);
  },
});
```

> **When to choose what:**
> - **BullMQ** — Node.js services, need job dashboards, retries, priorities
> - **SQS** — AWS ecosystem, simple reliable queuing, managed DLQ
> - **Kafka** — event streaming, replay, fan-out to multiple consumers, high throughput (millions/sec)

---

## 14. WebSockets & Real-time

### Socket.IO with Redis Adapter (multi-instance)

```js
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';

const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_URL },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Redis adapter — events broadcast across all instances
const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();
await Promise.all([pubClient.connect(), subClient.connect()]);
io.adapter(createAdapter(pubClient, subClient));

// Auth middleware
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    socket.user = await verifyJWT(token);
    next();
  } catch (err) {
    next(new Error('Authentication failed'));
  }
});

// Namespace for chat
const chat = io.of('/chat');

chat.on('connection', (socket) => {
  const userId = socket.user.id;

  socket.on('join:room', async (roomId) => {
    await socket.join(`room:${roomId}`);
    socket.to(`room:${roomId}`).emit('user:joined', { userId });
  });

  socket.on('message:send', async (data) => {
    const message = await MessageService.create({ ...data, userId });
    // Broadcast to all sockets in the room (across all instances via Redis)
    chat.to(`room:${data.roomId}`).emit('message:new', message);
  });

  socket.on('disconnect', (reason) => {
    logger.info({ userId, reason }, 'Socket disconnected');
  });
});
```

### Server-Sent Events (SSE) — simpler one-way streaming

```js
// Great for: live dashboards, notifications, progress updates
app.get('/events/order-status/:orderId', authenticate, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('connected', { orderId: req.params.orderId });

  // Subscribe to Redis pub/sub for this order
  const sub = redis.duplicate();
  sub.subscribe(`order:${req.params.orderId}:status`);
  sub.on('message', (channel, message) => sendEvent('status-update', JSON.parse(message)));

  req.on('close', () => {
    sub.unsubscribe();
    sub.quit();
  });
});
```

---

## 15. Authentication Patterns — JWT & Refresh Tokens

### Access + Refresh Token Flow

```
Client                    API Server                   Redis
  │                           │                           │
  │── POST /auth/login ──────►│                           │
  │                           │─── store refreshToken ───►│
  │◄── { accessToken (15m),   │                           │
  │      refreshToken (7d) } ─│                           │
  │                           │                           │
  │── GET /api/data           │                           │
  │   Bearer: accessToken ──►│                           │
  │◄── 200 OK ────────────────│                           │
  │                           │                           │
  │── POST /auth/refresh ─────►│                           │
  │   refreshToken ──────────►│─── check token exists ───►│
  │◄── { new accessToken } ───│◄── exists ────────────────│
```

```js
import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET;

// Login
app.post('/auth/login', asyncHandler(async (req, res) => {
  const user = await UserService.verifyCredentials(req.body);

  const accessToken = jwt.sign(
    { sub: user.id, role: user.role },
    ACCESS_TOKEN_SECRET,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { sub: user.id },
    REFRESH_TOKEN_SECRET,
    { expiresIn: '7d' }
  );

  // Store refresh token in Redis (allows server-side invalidation)
  await redis.setex(`refresh:${user.id}`, 7 * 24 * 3600, refreshToken);

  // Send refresh token as HttpOnly cookie (not accessible by JS)
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ accessToken, user: { id: user.id, role: user.role } });
}));

// Refresh
app.post('/auth/refresh', asyncHandler(async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) throw new AppError('No refresh token', 401);

  const payload = jwt.verify(token, REFRESH_TOKEN_SECRET);

  // Check token still exists in Redis (logout invalidates it)
  const stored = await redis.get(`refresh:${payload.sub}`);
  if (stored !== token) throw new AppError('Token revoked', 401);

  const newAccessToken = jwt.sign(
    { sub: payload.sub, role: payload.role },
    ACCESS_TOKEN_SECRET,
    { expiresIn: '15m' }
  );

  res.json({ accessToken: newAccessToken });
}));

// Logout — invalidate by deleting from Redis
app.post('/auth/logout', authenticate, asyncHandler(async (req, res) => {
  await redis.del(`refresh:${req.user.id}`);
  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out' });
}));

// authenticate middleware
export const authenticate = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) throw new AppError('No token provided', 401);

  const payload = jwt.verify(token, ACCESS_TOKEN_SECRET);
  req.user = payload;
  next();
});

// authorize middleware (RBAC)
export const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    throw new AppError('Insufficient permissions', 403);
  }
  next();
};
```

---

## 16. Graceful Shutdown

A graceful shutdown ensures in-flight requests complete before the process exits.

```js
// server.js
const server = app.listen(PORT, () => logger.info(`Server on port ${PORT}`));

// Keep track of open connections
const connections = new Set();
server.on('connection', (socket) => {
  connections.add(socket);
  socket.on('close', () => connections.destroy(socket));
});

async function gracefulShutdown(signal) {
  logger.info({ signal }, 'Shutdown initiated');

  // 1. Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      // 2. Close DB connections (allows in-flight queries to complete)
      await mongoose.connection.close();
      await redisClient.quit();

      // 3. Drain job queues
      await emailWorker.close();

      logger.info('All resources closed. Exiting.');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  });

  // Force-destroy idle connections to speed up shutdown
  for (const socket of connections) socket.destroy();

  // Kill everything after 10s (safety net)
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref(); // .unref() — don't keep process alive just for this timer
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // K8s sends this
process.on('SIGINT', () => gracefulShutdown('SIGINT'));   // Ctrl+C
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection');
  gracefulShutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  gracefulShutdown('uncaughtException');
});
```

---

## 17. Observability — Logging, Metrics & Tracing

### Structured Logging with Pino (fastest Node.js logger)

```js
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: 'order-api', env: process.env.NODE_ENV },
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }  // human-readable in dev
    : undefined,                   // JSON in production (for Datadog/CloudWatch)
  redact: ['req.headers.authorization', 'body.password', 'body.creditCard'],
});

// Request logging middleware
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  req.log = logger.child({ requestId: req.id }); // bind requestId to all logs in this req

  res.on('finish', () => {
    req.log.info({
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: Date.now() - req.startTime,
    }, 'Request completed');
  });

  req.startTime = Date.now();
  next();
});
```

### Health Checks

```js
app.get('/health', (req, res) => {
  // Kubernetes liveness probe — is the process alive?
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/health/ready', asyncHandler(async (req, res) => {
  // Kubernetes readiness probe — is the app ready to receive traffic?
  const dbPing = await mongoose.connection.db.command({ ping: 1 });
  const redisPing = await redisClient.ping();

  const checks = {
    db: dbPing.ok === 1 ? 'healthy' : 'unhealthy',
    redis: redisPing === 'PONG' ? 'healthy' : 'unhealthy',
  };

  const allHealthy = Object.values(checks).every(s => s === 'healthy');
  res.status(allHealthy ? 200 : 503).json({ status: allHealthy ? 'ready' : 'degraded', checks });
}));
```

### Prometheus Metrics

```js
import promClient from 'prom-client';

promClient.collectDefaultMetrics({ prefix: 'node_' });

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'statusCode'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000],
});

app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: req.route?.path ?? req.path, statusCode: res.statusCode });
  });
  next();
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', promClient.register.contentType);
  res.end(await promClient.register.metrics());
});
```

### Distributed Tracing (OpenTelemetry)

```js
// tracing.js — must be loaded BEFORE everything else
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT, // Jaeger / Datadog / Grafana Tempo
  }),
  instrumentations: [getNodeAutoInstrumentations()],
  // Auto-instruments: HTTP, Express, MongoDB, Redis, pg, mysql2...
});

sdk.start();

// Start server: node --require ./tracing.js server.js
```

---

## 18. Database Best Practices

### Connection Pooling (Mongoose)

```js
await mongoose.connect(process.env.MONGO_URI, {
  maxPoolSize: 10,       // max concurrent connections (tune to DB tier)
  minPoolSize: 2,        // keep 2 connections warm
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4,             // IPv4, skip IPv6 resolution
});

// Monitor pool events
mongoose.connection.on('poolCreatedEvent', (e) => logger.debug({ e }, 'Pool created'));
```

### Read Replicas — Offload Read Traffic

```js
// Use primary for writes, replica for reads
const primaryConnection = mongoose.createConnection(process.env.MONGO_PRIMARY_URI);
const replicaConnection = mongoose.createConnection(process.env.MONGO_REPLICA_URI);

const UserModel = primaryConnection.model('User', UserSchema);
const UserReadModel = replicaConnection.model('User', UserSchema);

// Writes → primary
await UserModel.create(userData);

// Heavy read queries (reports, analytics) → replica
const stats = await UserReadModel.aggregate([...]).read('secondary');
```

### Indexing Strategy

```js
// Compound index — follows ESR rule (Equality, Sort, Range)
UserSchema.index({ tenantId: 1, status: 1, createdAt: -1 });

// Partial index — only index documents matching filter (smaller, faster)
OrderSchema.index(
  { userId: 1, createdAt: -1 },
  { partialFilterExpression: { status: 'pending' } }
);

// Text index for full-text search
ProductSchema.index({ name: 'text', description: 'text' });

// TTL index — auto-delete expired documents (sessions, OTP)
OTPSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Explain query to check if index is hit
const explanation = await User.find({ email }).explain('executionStats');
console.log(explanation.executionStats.executionStages.stage); // IXSCAN vs COLLSCAN
```

### Transactions (Mongoose)

```js
// Use transactions for multi-document operations that must be atomic
async function transferFunds(fromId, toId, amount) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const from = await Account.findById(fromId).session(session);
    if (from.balance < amount) throw new AppError('Insufficient funds', 400);

    await Account.findByIdAndUpdate(fromId, { $inc: { balance: -amount } }, { session });
    await Account.findByIdAndUpdate(toId, { $inc: { balance: amount } }, { session });
    await Transaction.create([{ from: fromId, to: toId, amount }], { session });

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
```

---

## 19. Security Hardening

### Input Validation (Zod)

```js
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(100).regex(/^(?=.*[A-Z])(?=.*[0-9])/),
  role: z.enum(['user', 'admin']).default('user'),
  age: z.number().int().min(18).max(120).optional(),
});

// Validation middleware
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: result.error.flatten().fieldErrors,
    });
  }
  req.body = result.data; // strip unknown fields
  next();
};

app.post('/users', validate(CreateUserSchema), createUserHandler);
```

### NoSQL Injection Prevention

```js
// ❌ Vulnerable — attacker sends { "email": { "$gt": "" } }
const user = await User.findOne({ email: req.body.email });

// ✅ Mongoose auto-sanitizes, but explicitly cast types
const user = await User.findOne({ email: String(req.body.email) });

// Or use express-mongo-sanitize middleware
import mongoSanitize from 'express-mongo-sanitize';
app.use(mongoSanitize()); // strips $ and . from user input
```

### Password Hashing

```js
import bcrypt from 'bcrypt';
// bcrypt is synchronous and blocking — use it in a Worker Thread for bulk operations
// For a single login, it's fine on the main thread (it's fast enough)

const SALT_ROUNDS = 12; // 10 for dev, 12-14 for production

// Hash on register
const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

// Verify on login
const isValid = await bcrypt.compare(plainPassword, hashedPassword);

// Argon2 is the modern alternative (winner of Password Hashing Competition)
import argon2 from 'argon2';
const hash = await argon2.hash(password, { type: argon2.argon2id });
const valid = await argon2.verify(hash, password);
```

### API Key Hashing

```js
// Never store raw API keys — store their SHA-256 hash
import crypto from 'crypto';

function generateApiKey() {
  const raw = crypto.randomBytes(32).toString('hex'); // 64-char key shown once
  const hashed = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hashed };
}

// On authenticate
const incomingHash = crypto.createHash('sha256').update(incomingKey).digest('hex');
const apiKey = await ApiKey.findOne({ hashedKey: incomingHash });
```

---

## 20. Design Patterns for Node.js at Scale

### Repository Pattern — Decouple DB from Business Logic

```js
// interfaces/IUserRepository.ts
interface IUserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(data: CreateUserDTO): Promise<User>;
  update(id: string, data: UpdateUserDTO): Promise<User>;
}

// repositories/MongoUserRepository.ts
class MongoUserRepository implements IUserRepository {
  async findById(id: string) { return User.findById(id).lean(); }
  async findByEmail(email: string) { return User.findOne({ email }).lean(); }
  async create(data: CreateUserDTO) { return User.create(data); }
  async update(id: string, data: UpdateUserDTO) {
    return User.findByIdAndUpdate(id, data, { new: true }).lean();
  }
}

// services/UserService.ts — depends on abstraction, not implementation
class UserService {
  constructor(private userRepo: IUserRepository) {}

  async getUserProfile(id: string) {
    const user = await this.userRepo.findById(id);
    if (!user) throw new AppError('User not found', 404);
    return user;
  }
}

// Dependency Injection (manual)
const userService = new UserService(new MongoUserRepository());

// Swap to PostgreSQL? → new PostgresUserRepository() — no service changes needed
```

### Event-Driven Architecture with EventEmitter

```js
import { EventEmitter } from 'events';

class DomainEventBus extends EventEmitter {}
export const eventBus = new DomainEventBus();
eventBus.setMaxListeners(50); // avoid memory leak warning

// Order service emits
eventBus.emit('order.created', { orderId, userId, items });

// Inventory service listens
eventBus.on('order.created', async ({ orderId, items }) => {
  await InventoryService.reserve(items);
});

// Notification service listens independently
eventBus.on('order.created', async ({ userId, orderId }) => {
  await NotificationService.sendOrderConfirmation(userId, orderId);
});
```

### Dependency Injection with a Container (tsyringe)

```js
import { container, injectable, inject } from 'tsyringe';

@injectable()
class EmailService {
  async send(to: string, subject: string, body: string) { ... }
}

@injectable()
class UserService {
  constructor(@inject(EmailService) private emailService: EmailService) {}

  async register(data: CreateUserDTO) {
    const user = await this.userRepo.create(data);
    await this.emailService.send(user.email, 'Welcome!', '...');
    return user;
  }
}

container.registerSingleton(EmailService);
container.registerSingleton(UserService);

// In route handler
const userService = container.resolve(UserService);
```

### API Versioning

```js
// Prefix-based (most common)
app.use('/api/v1', v1Router);
app.use('/api/v2', v2Router);

// Header-based (cleaner URLs)
app.use((req, res, next) => {
  const version = req.headers['api-version'] ?? '1';
  req.apiVersion = parseInt(version, 10);
  next();
});

app.get('/users', (req, res) => {
  if (req.apiVersion >= 2) return v2.getUsers(req, res);
  return v1.getUsers(req, res);
});
```

---

## 21. Testing Strategy

### Unit → Integration → E2E Pyramid

```
         ┌───────┐
         │  E2E  │  ← few, slow, test full flows
         ├───────┤
         │  Int  │  ← DB + services together (Testcontainers)
         ├───────┤
         │ Unit  │  ← many, fast, mock dependencies
         └───────┘
```

### Unit Tests (Vitest + mocking)

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserService } from './UserService';

const mockUserRepo = {
  findById: vi.fn(),
  create: vi.fn(),
};

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new UserService(mockUserRepo as any);
  });

  it('should throw 404 when user not found', async () => {
    mockUserRepo.findById.mockResolvedValue(null);
    await expect(service.getUserProfile('123')).rejects.toMatchObject({
      message: 'User not found',
      statusCode: 404,
    });
  });
});
```

### Integration Tests (Supertest + Testcontainers)

```js
import { MongoDBContainer } from '@testcontainers/mongodb';
import supertest from 'supertest';
import { app } from '../app';
import mongoose from 'mongoose';

let container;

beforeAll(async () => {
  container = await new MongoDBContainer().start();
  await mongoose.connect(container.getConnectionString());
});

afterAll(async () => {
  await mongoose.disconnect();
  await container.stop();
});

describe('POST /users', () => {
  it('creates a user and returns 201', async () => {
    const res = await supertest(app)
      .post('/users')
      .send({ email: 'test@example.com', password: 'Password1!' })
      .expect(201);

    expect(res.body.user).toMatchObject({ email: 'test@example.com' });
    expect(res.body.user.password).toBeUndefined(); // never leak hashed password
  });
});
```

---

## 22. Scaling Architecture Checklist

```
API Layer
  ✅ Keep controllers thin — business logic in services
  ✅ Input validation at boundary (Zod/Joi)
  ✅ asyncHandler for all async routes
  ✅ Consistent error response shape

Performance
  ✅ Cluster mode / PM2 for full CPU utilization
  ✅ Redis caching with TTL + cache invalidation strategy
  ✅ Connection pooling (DB + Redis)
  ✅ HTTP keep-alive, compression (gzip/brotli)
  ✅ Stream large payloads (files, reports)
  ✅ CDN for static assets and cacheable API responses

Resilience
  ✅ Circuit breakers for all external dependencies
  ✅ Retry with exponential backoff + jitter
  ✅ Job queues for decoupled async processing
  ✅ DLQ for failed jobs
  ✅ Rate limiting (Redis-backed, per-user + global)
  ✅ Graceful shutdown (SIGTERM handler)
  ✅ Health + readiness endpoints

Security
  ✅ Helmet (security headers)
  ✅ Input sanitization (NoSQL injection, XSS)
  ✅ Payload size limits
  ✅ HttpOnly + Secure cookies for refresh tokens
  ✅ Secrets via environment variables / Secrets Manager
  ✅ API key hashing (SHA-256), no raw keys in DB

Observability
  ✅ Structured JSON logging (Pino/Winston) with request IDs
  ✅ Prometheus metrics + Grafana dashboards
  ✅ Distributed tracing (OpenTelemetry → Jaeger/Datadog)
  ✅ Liveness + readiness probes
  ✅ Alerting on error rate, p99 latency, memory

Data
  ✅ DB indexes (ESR rule, partial indexes)
  ✅ Read replicas for analytics/reports
  ✅ Transactions for multi-document atomic ops
  ✅ TTL indexes for ephemeral data (sessions, OTP)
  ✅ Regular EXPLAIN/query profiling

Horizontal Scaling
  ✅ Stateless API (no in-memory session state)
  ✅ Shared state in Redis (sessions, locks, pubsub)
  ✅ Load balancer (ALB / Nginx / Traefik)
  ✅ K8s HPA based on CPU/RPS metrics
  ✅ UV_THREADPOOL_SIZE tuned for workload
```

---

## 23. Node.js 24 — What's New

> References: [What's new in Node.js 24](https://blog.codeminer42.com/whats-new-in-node-js-24/)

**Key additions relevant to backend work:**

```js
// 1. Built-in test runner (no Jest/Vitest needed for simple tests)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

test('adds numbers', () => {
  assert.equal(1 + 1, 2);
});

// 2. Native fetch (stable since Node 21, fully matured)
const res = await fetch('https://api.example.com/data');
const json = await res.json();

// 3. navigator.hardwareConcurrency (browser API parity)
console.log(navigator.hardwareConcurrency); // number of CPU cores

// 4. WebSocket client (no ws package needed for simple cases)
const ws = new WebSocket('wss://stream.example.com');
ws.onmessage = (event) => console.log(event.data);

// 5. Improved Permission Model (experimental)
// node --allow-fs-read=./data --allow-net server.js
// Restricts what the process can access — useful for plugin sandboxing

// 6. os.availableParallelism() — more accurate than os.cpus().length
// (accounts for cgroup CPU limits in containers/K8s)
import os from 'os';
const threads = os.availableParallelism(); // use this for UV_THREADPOOL_SIZE

// 7. V8 12.4 — faster JSON serialization, improved RegExp
```

> **Architect takeaway:** Node 24 is now LTS-eligible. The built-in test runner, native fetch, and WebSocket client reduce dependencies. The Permission Model is worth watching for zero-trust plugin architectures.

---

## 24.1 WebSockets Are Stateful — Sticky Sessions for a MERN Chat App

#### Why a WebSocket is stateful

A WebSocket is a single long-lived **TCP connection** pinned to **one** Node instance. Everything about that connection — the socket object, which rooms it joined, the authenticated user — lives in **that one instance's RAM**. There is no shared "connection table" across instances.

This creates **two separate problems** that people constantly conflate. You need a different tool for each.

```
Problem A — CONNECTION AFFINITY (which instance does the client land on?)
   Client ──upgrade──▶ Load Balancer ──▶ ??? (Instance 1, 2 or 3?)
   Fix: sticky sessions  OR  force websocket-only transport

Problem B — CROSS-INSTANCE BROADCAST (User A on inst-1 → User B on inst-2)
   inst-1 has A's socket in RAM, inst-2 has B's socket in RAM.
   inst-1 has NO WAY to reach B's socket directly.
   Fix: Redis adapter (pub/sub) — NOT sticky sessions
```

> ⚠️ **Common misconception:** "I added sticky sessions so multi-instance chat works." No. Sticky sessions only solve Problem A. Two users on two different instances still can't talk without a **Redis adapter** (Problem B). You almost always need **both**.

#### When do you even need sticky sessions?

| Transport | Needs sticky sessions? | Why |
|---|---|---|
| Socket.IO default (HTTP long-polling → upgrade) | **Yes** | The handshake is *multiple* HTTP requests carrying a session id (`sid`). If request #2 lands on a different instance that never saw the `sid`, you get `Session ID unknown` / constant disconnects. |
| `transports: ['websocket']` (skip polling) | Mostly no | A single upgrade request; once the TCP connection is established it stays pinned to that instance anyway. Stickiness still recommended as a safety net. |
| Raw `ws` / native WebSocket | No (for the connection itself) | Single upgrade, single pinned TCP socket. But you still need Problem-B fan-out. |

Tradeoff of forcing `transports: ['websocket']`: you lose the long-polling fallback, which breaks clients behind restrictive corporate proxies/old load balancers that block the upgrade. For a public chat app, keep polling enabled and use sticky sessions.

#### Architecture for a MERN chat app at scale

```
            ┌──────────── Redis (pub/sub adapter) ────────────┐
            │     broadcasts events across ALL instances      │
            └───────┬───────────────┬───────────────┬─────────┘
                    │               │               │
   ┌──────────┐  ┌──┴───┐        ┌──┴───┐        ┌──┴───┐
   │   LB /   │─▶│ Node │        │ Node │        │ Node │
   │ Ingress  │  │ inst1│        │ inst2│        │ inst3│
   │ (sticky) │  └──────┘        └──────┘        └──────┘
   └────┬─────┘    ▲                                ▲
        │          │ User A pinned here   User B pinned here
    React clients ─┘ (sticky keeps A on inst1 for its whole session)

Presence / "who's online" → stored in Redis (centralized), NOT in instance RAM.
Message persistence → MongoDB.
```

#### React client (socket.io-client)

```jsx
// src/lib/socket.js
import { io } from 'socket.io-client';

let socket;

export function connectSocket(token) {
  socket = io(`${import.meta.env.VITE_API_URL}/chat`, {  // note the /chat namespace
    auth: { token },                 // JWT sent on handshake (read in io.use on server)
    transports: ['websocket', 'polling'], // keep polling fallback → sticky sessions matter
    withCredentials: true,           // send the affinity cookie set by the LB/ingress
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
  return socket;
}

export const getSocket = () => socket;
```

```jsx
// src/components/ChatRoom.jsx
import { useEffect, useState, useRef } from 'react';
import { connectSocket, getSocket } from '../lib/socket';

export default function ChatRoom({ roomId, token }) {
  const [messages, setMessages] = useState([]);
  const [connected, setConnected] = useState(false);
  const [online, setOnline] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = connectSocket(token);
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join:room', roomId);        // re-join on every (re)connect
    });

    // CRITICAL on reconnect: the new connection may land on a DIFFERENT instance.
    // It has no memory of your rooms, so you MUST re-join. socket.io fires
    // 'connect' again after a reconnect, so the handler above covers it.
    socket.io.on('reconnect', () => socket.emit('join:room', roomId));

    socket.on('disconnect', (reason) => {
      setConnected(false);
      // 'io server disconnect' → server forced it (e.g. auth expired); must reconnect manually
      if (reason === 'io server disconnect') socket.connect();
    });

    socket.on('message:new', (msg) => setMessages((m) => [...m, msg]));
    socket.on('presence:update', (users) => setOnline(users));
    socket.on('connect_error', (err) => console.error('socket auth/connect error', err.message));

    return () => {
      socket.emit('leave:room', roomId);
      socket.off();                 // remove all listeners
      socket.disconnect();
    };
  }, [roomId, token]);

  const send = (text) => {
    // optimistic UI; server echoes the persisted message back via 'message:new'
    socketRef.current?.emit('message:send', { roomId, text }, (ack) => {
      if (ack?.error) console.error('send failed', ack.error);
    });
  };

  return (
    <div>
      <div>{connected ? '🟢 connected' : '🔴 reconnecting…'} — {online.length} online</div>
      <ul>{messages.map((m) => <li key={m._id}>{m.user}: {m.text}</li>)}</ul>
      <MessageInput onSend={send} />
    </div>
  );
}
```

> **Why the re-join on reconnect matters:** with sticky sessions a reconnect *usually* returns to the same instance, but not guaranteed (instance died, was redeployed, or sticky cookie expired). Rooms are in-instance state, so always treat reconnect as "I'm on a fresh instance that knows nothing about me."

#### Node.js server (multi-instance with Redis adapter)

This is the §14 code, completed with presence and an ack callback.

```js
// chat.socket.js
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

export async function initChat(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL, credentials: true },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── Problem B fix: cross-instance broadcast via Redis pub/sub ──
  const pubClient = createClient({ url: process.env.REDIS_URL });
  const subClient = pubClient.duplicate();
  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));

  const chat = io.of('/chat');

  chat.use(async (socket, next) => {
    try {
      socket.user = await verifyJWT(socket.handshake.auth.token);
      next();
    } catch {
      next(new Error('Authentication failed'));
    }
  });

  chat.on('connection', (socket) => {
    const userId = socket.user.id;

    socket.on('join:room', async (roomId) => {
      await socket.join(`room:${roomId}`);

      // Presence is GLOBAL state → keep it in Redis, not in this instance's RAM.
      await pubClient.sAdd(`presence:room:${roomId}`, userId);
      const online = await pubClient.sMembers(`presence:room:${roomId}`);
      // .to() goes through the Redis adapter → reaches sockets on every instance
      chat.to(`room:${roomId}`).emit('presence:update', online);
    });

    socket.on('message:send', async ({ roomId, text }, ack) => {
      try {
        const message = await MessageService.create({ roomId, text, userId });
        chat.to(`room:${roomId}`).emit('message:new', message); // fan-out across instances
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ error: err.message });
      }
    });

    socket.on('disconnect', async () => {
      // Clean presence for every room this socket was in
      for (const room of socket.rooms) {
        if (room.startsWith('room:')) {
          const roomId = room.slice('room:'.length);
          await pubClient.sRem(`presence:room:${roomId}`, userId);
          chat.to(room).emit('presence:update', await pubClient.sMembers(`presence:room:${roomId}`));
        }
      }
    });
  });

  return io;
}
```

#### Making sticky sessions actually happen

**A) Kubernetes — nginx Ingress (cookie-based, recommended)**

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: chat-ingress
  annotations:
    nginx.ingress.kubernetes.io/affinity: "cookie"
    nginx.ingress.kubernetes.io/affinity-mode: "persistent"   # stick even after scaling up
    nginx.ingress.kubernetes.io/session-cookie-name: "chat_aff"
    nginx.ingress.kubernetes.io/session-cookie-max-age: "86400"
    # WebSocket upgrade timeouts (default 60s closes idle WS connections)
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
spec:
  rules:
    - host: chat.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend: { service: { name: chat-svc, port: { number: 80 } } }
```

**B) Kubernetes — Service-level (L4, IP-based, coarser)**

```yaml
apiVersion: v1
kind: Service
metadata: { name: chat-svc }
spec:
  selector: { app: chat }
  sessionAffinity: ClientIP            # all requests from one client IP → same pod
  sessionAffinityConfig:
    clientIP: { timeoutSeconds: 10800 }
  ports: [{ port: 80, targetPort: 3000 }]
```

> ClientIP affinity is weaker: many users behind one corporate NAT share an IP and pile onto one pod. Cookie affinity at the ingress is finer-grained. Prefer the ingress approach.

**C) Plain Nginx**

```nginx
upstream chat_backend {
    ip_hash;                       # or: hash $cookie_chat_aff consistent;
    server node1:3000;
    server node2:3000;
}
server {
    location / {
        proxy_pass http://chat_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;     # required for WS upgrade
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
```

**D) Node `cluster` module (single machine, multiple workers)**

The built-in cluster module round-robins TCP connections, which **breaks** Socket.IO's polling handshake (handshake requests scatter across workers). Use Socket.IO's official helpers:

```js
// primary.js — routes connections to workers by sid hash + lets workers talk
import cluster from 'cluster';
import { createServer } from 'http';
import { setupMaster, setupWorker } from '@socket.io/sticky';
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter';
import { availableParallelism } from 'os';

if (cluster.isPrimary) {
  const httpServer = createServer();
  setupMaster(httpServer, { loadBalancingMethod: 'least-connection' }); // sticky routing
  setupPrimary();                                  // inter-worker message bus
  httpServer.listen(3000);
  for (let i = 0; i < availableParallelism(); i++) cluster.fork();
} else {
  // worker.js
  const { Server } = await import('socket.io');
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  io.adapter(createAdapter());   // cluster adapter — fan-out between workers
  setupWorker(io);               // receive sticky-routed connections
  // ... your chat namespace handlers ...
}
```

> For a *single machine* the cluster-adapter handles cross-worker fan-out. The moment you run on **multiple machines / pods**, switch the adapter back to the **Redis adapter** — only Redis (or another external bus) spans hosts.

**Mental model:** *Sticky sessions* keep one client glued to one instance for connection stability. The *Redis adapter* lets instances broadcast to each other. *Redis* (or Mongo) holds presence/messages because instance RAM is not shared. All three jobs are distinct.

---

## 24.2 Tradeoffs of Event-Driven Systems (Kafka, SNS) — End to End

Event-driven means services communicate by **publishing facts** ("OrderCreated") rather than **calling each other** ("POST /reserve-stock"). The producer doesn't know or care who consumes.

#### The honest tradeoff table

| You gain | You pay with |
|---|---|
| **Decoupling** — add a consumer without touching the producer | **Eventual consistency** — no read-after-write across services; "order placed" but inventory shows it 200ms later |
| **Load leveling** — broker buffers a traffic spike | **Harder debugging** — a request spans N services & a broker; you *need* distributed tracing (correlation IDs) |
| **Resilience** — consumer down ≠ producer down; messages wait | **At-least-once delivery** — duplicates happen; every consumer must be **idempotent** |
| **Fan-out** — one event, many independent reactions | **Ordering is limited** — global ordering is expensive; you get per-partition / per-group ordering at best |
| **Replay** (Kafka) — re-process history for a new service or after a bug | **The dual-write problem** — writing to DB *and* publishing an event is not atomic; you need the **outbox pattern** |
| **Throughput** — Kafka does millions/sec | **Operational + cognitive cost** — schema evolution, consumer lag, poison messages, DLQs, more infra |

#### Kafka vs SNS vs SNS→SQS (when to reach for which)

| | Kafka | SNS (standard) | SNS → SQS fan-out | EventBridge |
|---|---|---|---|---|
| Model | Distributed **log** (pull, offsets) | Pub/sub **push** | Pub/sub + durable per-subscriber queue | Event bus + routing rules |
| Replay / history | ✅ retained, re-readable | ❌ fire-and-forget | ⚠️ until consumed | ❌ |
| Ordering | ✅ per partition | ❌ (FIFO variant: per group) | per SQS-FIFO group | ❌ |
| Durability if consumer down | ✅ (retention) | ❌ message lost | ✅ sits in SQS | limited |
| Throughput | Very high | High | High | Moderate |
| Ops burden | High (self/MSK/Confluent) | None (managed) | None | None |
| Best for | streaming, analytics, replay, high volume | simple notifications | reliable fan-out to N services | AWS-native routing/integration |

> **Key insight:** raw SNS is push-and-forget — if a subscriber is down, the message is *gone*. The production-grade AWS pattern is **SNS → SQS fan-out**: SNS fans the event out into one SQS queue *per* consumer, so each consumer gets a durable, independently-retryable copy with its own DLQ.

#### End-to-end example: e-commerce "order placed"

```
                         ┌─────────────────────────────┐
 POST /orders ──▶ Order  │  publish  "order.created"    │
                 Service │  {orderId, userId, items[]}  │
                         └──────────────┬──────────────-┘
                                        │  (broker: Kafka topic / SNS topic)
                 ┌──────────────────────┼──────────────────────┐
                 ▼                      ▼                       ▼
          Inventory svc          Payment svc             Notification svc
          reserve stock          charge card             send confirmation email
                 │                      │                       │
                 ▼                      ▼                       ▼
       emit inventory.reserved   emit payment.captured    (no further event)
                 └──────────► Order svc updates status ◄──────┘
                              (saga / choreography)
```

**Producer with the transactional outbox (solves the dual-write problem)**

```js
// Don't do: await db.save(order); await broker.publish(event);
// If the process dies between the two lines → order saved, event lost (or vice versa).
// Instead: write the event INTO the DB in the SAME transaction, then relay it.

await db.transaction(async (tx) => {
  await tx.orders.insert(order);
  await tx.outbox.insert({                    // same transaction → atomic
    id: crypto.randomUUID(),
    topic: 'order.created',
    payload: JSON.stringify(order),
    status: 'PENDING',
  });
});

// A separate relay polls the outbox (or uses Debezium/CDC) and publishes,
// marking rows SENT only after the broker acks. At-least-once, never lost.
async function relayOutbox(producer) {
  const rows = await db.outbox.findPending(100);
  for (const row of rows) {
    await producer.send({ topic: row.topic, messages: [{ key: row.id, value: row.payload }] });
    await db.outbox.markSent(row.id);
  }
}
```

**Kafka consumer — idempotent (duplicates are guaranteed)**

```js
const consumer = kafka.consumer({ groupId: 'inventory-service' });
await consumer.subscribe({ topic: 'order.created' });

await consumer.run({
  eachMessage: async ({ message }) => {
    const order = JSON.parse(message.value.toString());

    // Idempotency: this event may be delivered twice. Dedupe on a stable key.
    const seen = await redis.set(`processed:inv:${order.orderId}`, '1', { NX: true, EX: 86400 });
    if (!seen) return;                          // already handled — skip

    try {
      await InventoryService.reserve(order);
    } catch (err) {
      // Don't swallow: throwing makes Kafka NOT commit the offset → redelivery.
      // For poison messages, route to a DLQ topic after N attempts.
      throw err;
    }
  },
});
```

**SNS → SQS fan-out — each consumer gets its own durable queue**

```js
// One SNS topic, multiple SQS subscribers. Each SQS has its own DLQ + retry.
await sns.send(new PublishCommand({
  TopicArn: process.env.ORDER_TOPIC_ARN,
  Message: JSON.stringify(order),
  MessageAttributes: { eventType: { DataType: 'String', StringValue: 'order.created' } },
}));

// inventory-queue consumer (long-poll), payment-queue consumer, email-queue consumer
// each poll their OWN queue independently — one slow consumer can't block the others.
```

> **Architect insight:** the three things that bite teams new to event-driven systems, in order: (1) forgetting **idempotency** → double-charged customers; (2) the **dual-write** gap → lost events, fixed with the outbox; (3) no **DLQ + tracing** → a poison message silently stalls a partition/queue and nobody notices for hours. Build all three in from day one, not after the incident.
>
> **When NOT to go event-driven:** if you need an immediate synchronous answer ("is this coupon valid?"), call the service directly. Events are for *facts that already happened*, not *questions that need an answer now*.

---

## 24.3 SQS vs BullMQ vs Other Queues — Practical Examples

First, a category distinction that prevents most bad choices:

```
TASK / JOB QUEUE  → "do this unit of work, retry it, tell me when done"
   BullMQ, SQS, RabbitMQ, pg-boss, Redis Streams
EVENT LOG / STREAM → "append facts, many consumers read at their own pace, replay"
   Kafka, Kinesis           (covered in §24.2 — NOT a job queue)
```

Using Kafka as a job queue (per-job ack, priorities, delayed retry) is painful — it has no native per-message ack/visibility model. Pick a real queue.

#### Comparison

| | BullMQ | SQS | RabbitMQ | pg-boss | Redis Streams |
|---|---|---|---|---|---|
| Backing store | Redis | AWS managed | Erlang broker | PostgreSQL | Redis |
| Delivery | at-least-once | at-least-once | at-least-once (acks) | at-least-once | at-least-once |
| Ordering | per-queue-ish | FIFO queues | per-queue | FIFO | per-stream |
| Priorities | ✅ | ❌ | ✅ | ✅ (singleton/throttle) | ❌ |
| Delayed / scheduled | ✅ delay + cron repeat | ⚠️ max 15 min delay | via plugin | ✅ cron | manual |
| Retries + DLQ | ✅ backoff + failed set | ✅ DLQ + maxReceiveCount | ✅ DLX | ✅ retry + dead state | manual |
| Rate limiting | ✅ built-in | ❌ | ❌ | ✅ throttle | ❌ |
| Dashboard | ✅ Bull Board | CloudWatch | management UI | query SQL | RedisInsight |
| Ops burden | run Redis | none (managed) | run RabbitMQ | none (use existing PG) | run Redis |
| Cross-language | Redis clients | ✅ any AWS SDK | ✅ AMQP everywhere | SQL clients | Redis clients |
| Sweet spot | Node services needing rich job features | AWS, simple/reliable, huge scale | complex routing, many languages | "already have Postgres, no new infra" | lightweight, low-level control |

#### BullMQ — rich features (priority, delay, repeat, rate limit)

```js
import { Queue, Worker } from 'bullmq';
const connection = { host: process.env.REDIS_HOST, port: 6379 };

const reportQueue = new Queue('reports', { connection });

// delayed job (run in 1 hour) with priority
await reportQueue.add('monthly', { userId }, { delay: 3_600_000, priority: 1,
  attempts: 5, backoff: { type: 'exponential', delay: 2000 } });

// repeatable / cron job — every weekday at 9am
await reportQueue.add('daily-digest', {}, { repeat: { pattern: '0 9 * * 1-5' } });

// worker with rate limit: max 10 jobs / second (e.g. third-party API cap)
new Worker('reports', async (job) => {
  await ReportService.generate(job.data);
}, { connection, concurrency: 5, limiter: { max: 10, duration: 1000 } });
```

> **Use BullMQ when:** your workers are Node, and you want delayed jobs, cron repeats, priorities, per-queue rate limiting, progress tracking, and a UI (Bull Board) — without standing up a separate broker. The cost: you operate Redis, and durability is only as good as your Redis persistence config (AOF/RDB).

#### SQS — managed, simple, massive scale

```js
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
const sqs = new SQSClient({ region: 'us-east-1' });

// Consumer with long-polling. DLQ + maxReceiveCount are configured on the queue, not in code.
while (true) {
  const { Messages = [] } = await sqs.send(new ReceiveMessageCommand({
    QueueUrl: process.env.QUEUE_URL, MaxNumberOfMessages: 10, WaitTimeSeconds: 20,
  }));
  for (const m of Messages) {
    try {
      await processJob(JSON.parse(m.Body));
      await sqs.send(new DeleteMessageCommand({ QueueUrl: process.env.QUEUE_URL, ReceiptHandle: m.ReceiptHandle }));
    } catch (e) {
      // Don't delete → after VisibilityTimeout it reappears → after maxReceiveCount → DLQ
      logger.error({ e, id: m.MessageId }, 'job failed, will redeliver');
    }
  }
}
```

> **Use SQS when:** you're on AWS, want zero infra to manage, and need rock-solid durability at any scale. The cost: no priorities, no cron (max 15-min delay), and "done" is implicit (delete the message). Pair with a library like `sqs-consumer` in production instead of a hand-rolled loop.

#### RabbitMQ — flexible routing across services/languages

```js
import amqp from 'amqplib';
const conn = await amqp.connect(process.env.RABBIT_URL);
const ch = await conn.createChannel();

// topic exchange: route by key, e.g. "order.created", "order.cancelled"
await ch.assertExchange('orders', 'topic', { durable: true });
ch.publish('orders', 'order.created', Buffer.from(JSON.stringify(order)), { persistent: true });

// consumer binds with a pattern — one consumer for all order events, another for cancellations only
const { queue } = await ch.assertQueue('billing', { durable: true });
await ch.bindQueue(queue, 'orders', 'order.*');
ch.prefetch(10);                                  // backpressure: max 10 unacked
await ch.consume(queue, async (msg) => {
  try { await handle(JSON.parse(msg.content)); ch.ack(msg); }
  catch { ch.nack(msg, false, false); }           // reject → dead-letter exchange
});
```

> **Use RabbitMQ when:** you need rich routing (topic/direct/fanout/headers exchanges), explicit acks/nacks, and polyglot services. The cost: you operate the broker.

#### pg-boss — queue on top of Postgres (no new infra)

```js
import PgBoss from 'pg-boss';
const boss = new PgBoss(process.env.DATABASE_URL);
await boss.start();

await boss.send('resize-image', { key: 's3://bucket/photo.jpg' }, { retryLimit: 3, retryBackoff: true });
await boss.schedule('cleanup', '0 3 * * *');       // cron, stored in PG
await boss.work('resize-image', async ([job]) => { await resize(job.data); });
```

> **Use pg-boss when:** you already run Postgres and want jobs, retries, and cron *without* adding Redis/RabbitMQ. Transactional bonus: enqueue a job in the **same DB transaction** as your business write (a poor-man's outbox). The cost: lower throughput ceiling than Redis/SQS.

#### Redis Streams — lightweight consumer groups

```js
await redis.xAdd('events', '*', { type: 'signup', userId });           // produce
await redis.xGroupCreate('events', 'workers', '0', { MKSTREAM: true }); // once

const res = await redis.xReadGroup('workers', 'worker-1',
  [{ key: 'events', id: '>' }], { COUNT: 10, BLOCK: 5000 });            // consume
// ... process ...
await redis.xAck('events', 'workers', id);                              // ack
```

> **Use Redis Streams when:** you want at-least-once consumer groups with minimal dependencies and you're comfortable handling acks/claims yourself. BullMQ is built on top of this — reach for raw streams only when you need the low-level control.

#### Decision shortcut

```
On AWS, want zero ops, huge scale, simple jobs ............ SQS
Node services, need delay/cron/priority/rate-limit/UI ..... BullMQ
Complex routing, many languages, explicit acks ............ RabbitMQ
Already have Postgres, don't want new infra ............... pg-boss
Need replay / stream to many independent consumers ........ Kafka (§24.2)
```

---

## 24.4 Graceful Shutdown vs `process.exit(1)` — How It Actually Works

#### What `process.exit(code)` really does

`process.exit()` terminates the Node process **as soon as the current synchronous code returns to the event loop's exit check** — it does **not** wait for pending async work, may **truncate buffered stdout/stderr** writes, and skips most cleanup. The **code** is *only* the exit status reported to the OS/orchestrator:

```
process.exit(0)  → "I finished successfully"
process.exit(1)  → "I failed" (generic non-zero error)
```

> ⚠️ **Misconception:** people think `exit(1)` is "the violent one." It isn't. `exit(0)` and `exit(1)` are **equally abrupt** — both abandon in-flight work instantly. The only difference is the status number. *Graceful* vs *abrupt* is about **what you run before calling exit**, not about the code you pass.

#### The signals you trap (and the one you can't)

| Signal | Source | Trappable? | Meaning |
|---|---|---|---|
| `SIGTERM` | K8s, `docker stop`, PM2, systemd | ✅ | "Please shut down." → run graceful shutdown |
| `SIGINT` | Ctrl+C | ✅ | Same, interactive |
| `SIGKILL` (`kill -9`) | OS / K8s after grace period | ❌ never | Instant death — you get no chance to clean up |

K8s lifecycle: it sends **SIGTERM**, waits `terminationGracePeriodSeconds` (default **30s**), then sends **SIGKILL**. Your entire graceful shutdown must finish *inside* that window.

#### How graceful shutdown works — the sequence

```
SIGTERM received
   │
   ├─ 1. Fail readiness probe  → K8s stops routing NEW traffic to this pod
   │      (gives Endpoints time to propagate before you close the server)
   ├─ 2. server.close()        → stop accepting NEW connections; existing ones finish
   ├─ 3. stop queue consumers  → worker.close() so no new jobs are picked up
   ├─ 4. wait for in-flight    → let current HTTP requests + active jobs finish
   ├─ 5. close resources       → DB pool, Redis, flush logs/metrics
   ├─ 6. process.exit(0)       → clean success
   │
   └─ SAFETY NET: if steps 2–5 hang past N seconds → process.exit(1) (forced)
```

#### Real example — API + BullMQ worker + Mongo (corrects the §16 snippet)

```js
import http from 'http';
const server = http.createServer(app);
server.listen(PORT);

let shuttingDown = false;                 // re-entrancy guard (SIGTERM can fire twice)
let isReady = true;
app.get('/readyz', (_req, res) => res.status(isReady ? 200 : 503).end());

const connections = new Set();
server.on('connection', (socket) => {
  connections.add(socket);
  socket.on('close', () => connections.delete(socket));  // ← §16 had .destroy(); Set uses .delete()
});

async function gracefulShutdown(signal) {
  if (shuttingDown) return;               // ignore repeated signals
  shuttingDown = true;
  logger.info({ signal }, 'graceful shutdown started');

  // 1. Fail readiness FIRST so K8s drains traffic before we close the listener.
  isReady = false;
  await new Promise((r) => setTimeout(r, 5000));   // let Endpoints propagate

  // SAFETY NET — must beat terminationGracePeriodSeconds (e.g. 30s → set this to 25s)
  const forceTimer = setTimeout(() => {
    logger.error('cleanup hung — forcing exit');
    process.exit(1);                       // non-zero: we did NOT shut down cleanly
  }, 25_000).unref();                      // .unref() so it can't keep the process alive itself

  try {
    // 2. Stop accepting new HTTP connections; in-flight requests still complete.
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())));

    // 3. Stop the worker from grabbing NEW jobs; let the ACTIVE one finish.
    await emailWorker.close();             // BullMQ waits for the current job

    // 4. Close resources (in-flight queries already drained above).
    await mongoose.connection.close(false);
    await redisClient.quit();
    await logger.flush?.();                // flush async log/metric buffers

    clearTimeout(forceTimer);
    logger.info('clean shutdown complete');
    process.exit(0);                       // success
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }

  // help close stubborn keep-alive sockets so server.close() can resolve
  for (const s of connections) s.end();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  gracefulShutdown('uncaughtException');   // try to clean up, then exit(1) via the path above
});
```

K8s side — the readiness drain plus a `preStop` hook closes the traffic race:

```yaml
spec:
  terminationGracePeriodSeconds: 30
  containers:
    - name: api
      readinessProbe: { httpGet: { path: /readyz, port: 3000 }, periodSeconds: 5 }
      lifecycle:
        preStop:
          exec: { command: ["sh", "-c", "sleep 10"] }   # buffer before SIGTERM-driven close
```

#### Side-by-side: same incident, two endings

```
Scenario: K8s rolling deploy, pod handling a payment + a running BullMQ job.

process.exit(1) on SIGTERM            │  graceful shutdown
─────────────────────────────────────┼──────────────────────────────────────
TCP connections cut instantly        │  in-flight request finishes (200 to client)
client sees ERR_CONNECTION_RESET     │  no error surfaced to the user
DB write abandoned mid-transaction   │  transaction commits or rolls back cleanly
BullMQ job stuck "active" → retried  │  job completes (or is re-queued intentionally)
   → duplicate invoice email         │     → no duplicate
DB pool slot held ~60s by dead conn  │  pool slot released immediately
errors on EVERY deploy               │  zero dropped requests
```

> **Architect takeaway:** `process.exit(1)` mid-flight is a power cut during a file write — corruption waiting to happen, and it always strikes during the peak-traffic deploy. Graceful shutdown is just the disciplined sequence — *drain readiness → stop intake → finish in-flight → close resources → exit(0)* — with a forced `exit(1)` safety net so a hung cleanup can't outlast the orchestrator's grace period. Use `exit(1)` deliberately for "I tried to clean up and failed," never as the normal path.
>
> **Three things people get wrong:** (1) closing the HTTP server *before* failing readiness → requests dropped during the Endpoints-propagation window (fix: fail `/readyz` + `preStop sleep` first); (2) forgetting to close queue workers → jobs stuck "active"; (3) no re-entrancy guard → a second SIGTERM restarts the sequence and tears down resources twice.