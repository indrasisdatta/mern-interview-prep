# Excel File Upload — All Scenarios & Solutions

---

## Table of Contents

1. [Scenario Matrix — Pick Your Approach](#1-scenario-matrix--pick-your-approach)
2. [Foundation — Multer Setup & Validation](#2-foundation--multer-setup--validation)
3. [Scenario A — Small File, Inline Processing](#3-scenario-a--small-file-inline-processing)
4. [Scenario B — Medium/Large File, Queue + Notification](#4-scenario-b--mediumlarge-file-queue--notification)
5. [How the User Gets Notified — Full Pub/Sub Flow](#5-how-the-user-gets-notified--full-pubsub-flow)
6. [Scenario C — Very Large File, Disk + Streaming](#6-scenario-c--very-large-file-disk--streaming)
7. [Scenario D — Duplicate Upload Prevention](#7-scenario-d--duplicate-upload-prevention)
8. [Scenario E — Partial Failures & Error Reporting](#8-scenario-e--partial-failures--error-reporting)
9. [Scenario F — Multi-Sheet Excel](#9-scenario-f--multi-sheet-excel)
10. [Scenario G — Password Protected Excel](#10-scenario-g--password-protected-excel)
11. [Scenario H — Concurrent Uploads](#11-scenario-h--concurrent-uploads)
12. [Scenario I — Audit Trail & S3 Storage](#12-scenario-i--audit-trail--s3-storage)
13. [Validation Strategy — All Layers](#13-validation-strategy--all-layers)
14. [Architecture Decision Guide](#14-architecture-decision-guide)

---

## 1. Scenario Matrix — Pick Your Approach

```
File Size          Rows           Storage      Processing    Notify User
─────────────────────────────────────────────────────────────────────────
< 1MB              < 1,000        Memory       Inline        Immediate response
1MB – 10MB         1,000–50,000   Memory       Queue         SSE / WebSocket
10MB – 100MB       50k–500k       Disk → S3    Queue         SSE / WebSocket
> 100MB            > 500k         S3 direct    Queue stream  SSE / WebSocket
Any size           Any            Memory       Inline        Immediate (if < 500ms SLA)
```

---

## 2. Foundation — Multer Setup & Validation

### File Filter (runs before file hits memory/disk)

```js
import multer from 'multer';
import { AppError } from './errors.js';

const ALLOWED_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                           // .xls
];

const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    // Reject immediately — file never touches memory or disk
    return cb(new AppError('Only Excel files (.xlsx, .xls) are allowed', 400), false);
  }
  cb(null, true);
};

// ── Memory (small/medium files) ──
export const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB cap
  fileFilter,
});

// ── Disk (large files) ──
export const diskUpload = multer({
  storage: multer.diskStorage({
    destination: '/tmp/excel-uploads/',
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${req.user.id}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB cap
  fileFilter,
});
```

### Column Schema Validation (run after parsing, before processing)

```js
import { z } from 'zod';

const UserRowSchema = z.object({
  name:  z.string().min(1).max(100),
  email: z.string().email(),
  age:   z.coerce.number().int().min(18).max(120),
  role:  z.enum(['admin', 'user', 'manager']),
});

function validateRows(rows) {
  const errors = [];
  const valid = [];

  rows.forEach((row, index) => {
    const result = UserRowSchema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
    } else {
      errors.push({
        row: index + 2,  // +2 → 1-based + skip header row
        issues: result.error.flatten().fieldErrors,
      });
    }
  });

  return { valid, errors };
}
```

---

## 3. Scenario A — Small File, Inline Processing

**When:** < 1,000 rows, < 1MB, response expected immediately

```
Client → POST /upload → parse → validate → bulk insert → 200 OK (done)
```

```js
import XLSX from 'xlsx';

app.post('/upload/users',
  uploadLimiter,
  memoryUpload.single('file'),
  asyncHandler(async (req, res) => {

    // ── Guard: file present ──
    if (!req.file) throw new AppError('No file uploaded', 400);

    // ── Parse ──
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // ── Check empty before row-by-row parsing ──
    const ref = sheet['!ref'];
    if (!ref) throw new AppError('Excel file is empty', 400);

    const range = XLSX.utils.decode_range(ref);
    if (range.e.r < 1) throw new AppError('File has no data rows (only header found)', 400);

    // ── Parse rows ──
    const rows = XLSX.utils.sheet_to_json(sheet);

    // ── Validate structure ──
    const { valid, errors } = validateRows(rows);

    if (valid.length === 0) {
      return res.status(400).json({
        message: 'No valid rows found',
        errors,
      });
    }

    // ── Bulk insert ──
    const result = await UserService.bulkCreate(valid);

    res.status(200).json({
      mode: 'sync',
      totalRows: rows.length,
      inserted: result.insertedCount,
      skipped: errors.length,
      errors,  // return row-level errors to client
    });
  })
);
```

---

## 4. Scenario B — Medium/Large File, Queue + Notification

**When:** 1,000–50,000 rows, 1MB–10MB

### The Core Problem with Waiting

```
10,000 rows × DB insert latency
  = potentially 5–10 seconds of open HTTP connection
  = timeout risk (Nginx default: 60s, ALB default: 60s)
  = blocked server thread
  = bad UX
```

### Flow

```
Client → POST /upload → parse → validate → push to BullMQ → 202 Accepted { jobId }
                                                   ↓
                                           Worker picks up job
                                                   ↓
                                           Processes in batches
                                                   ↓
                                           Publishes to Redis pub/sub
                                                   ↓
                                    SSE connection pushes to client
```

### Upload Route

```js
import { Queue } from 'bullmq';
import { redis } from './redis.js';

const importQueue = new Queue('excel-import', { connection: redis });

app.post('/upload/users/large',
  uploadLimiter,
  memoryUpload.single('file'),
  asyncHandler(async (req, res) => {

    if (!req.file) throw new AppError('No file uploaded', 400);

    // Parse upfront — so we can validate columns before queuing
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    if (!sheet['!ref']) throw new AppError('Empty file', 400);

    const rows = XLSX.utils.sheet_to_json(sheet);
    if (rows.length === 0) throw new AppError('No data rows found', 400);

    // Validate column headers exist (fail fast before queuing)
    const requiredColumns = ['name', 'email', 'age', 'role'];
    const actualColumns = Object.keys(rows[0]);
    const missing = requiredColumns.filter(col => !actualColumns.includes(col));

    if (missing.length > 0) {
      throw new AppError(`Missing required columns: ${missing.join(', ')}`, 400);
    }

    // Track the upload in DB — so user can see history
    const upload = await UploadRecord.create({
      userId: req.user.id,
      filename: req.file.originalname,
      totalRows: rows.length,
      status: 'queued',
    });

    // Push job to BullMQ — pass parsed rows, NOT the buffer
    // (Buffer is not serializable to Redis efficiently for large data)
    const job = await importQueue.add('process-excel', {
      uploadId: upload._id.toString(),
      userId: req.user.id,
      rows,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 50,
    });

    // Respond immediately — don't wait for processing
    res.status(202).json({
      mode: 'async',
      jobId: job.id,
      uploadId: upload._id,
      totalRows: rows.length,
      message: 'File queued. Connect to /upload/status/:uploadId for live updates.',
    });
  })
);
```

### BullMQ Worker

```js
import { Worker } from 'bullmq';
import { redis, publisher } from './redis.js';

const worker = new Worker('excel-import', async (job) => {
  const { uploadId, userId, rows } = job.data;
  const batchSize = 500;
  const errors = [];
  let insertedCount = 0;

  // Update status → processing
  await UploadRecord.findByIdAndUpdate(uploadId, { status: 'processing' });

  // Validate all rows
  const { valid, errors: validationErrors } = validateRows(rows);
  errors.push(...validationErrors);

  // Process in batches
  for (let i = 0; i < valid.length; i += batchSize) {
    const batch = valid.slice(i, i + batchSize);

    try {
      const result = await UserService.bulkCreate(batch);
      insertedCount += result.insertedCount;
    } catch (err) {
      // Batch-level failure — log which rows affected
      errors.push({
        batch: Math.floor(i / batchSize) + 1,
        rowRange: `${i + 2}–${i + batchSize + 1}`,
        error: err.message,
      });
    }

    // Report progress back to BullMQ (visible in Bull Board dashboard)
    await job.updateProgress(Math.round(((i + batchSize) / valid.length) * 100));
  }

  const finalStatus = errors.length === 0 ? 'completed' : 'completed_with_errors';

  // Persist final result to DB
  await UploadRecord.findByIdAndUpdate(uploadId, {
    status: finalStatus,
    insertedCount,
    errorCount: errors.length,
    errors,
    completedAt: new Date(),
  });

  // ── Publish to Redis pub/sub so SSE can push to client ──
  await publisher.publish(`upload:${uploadId}`, JSON.stringify({
    event: 'completed',
    uploadId,
    status: finalStatus,
    insertedCount,
    errorCount: errors.length,
    errors,
  }));

  return { insertedCount, errorCount: errors.length };

}, {
  connection: redis,
  concurrency: 3,  // process 3 jobs in parallel
});

worker.on('failed', async (job, err) => {
  logger.error({ jobId: job.id, err }, 'Excel import job failed');

  // Update DB and notify client even on failure
  await UploadRecord.findByIdAndUpdate(job.data.uploadId, {
    status: 'failed',
    error: err.message,
  });

  await publisher.publish(`upload:${job.data.uploadId}`, JSON.stringify({
    event: 'failed',
    uploadId: job.data.uploadId,
    error: err.message,
  }));
});
```

---

## 5. How the User Gets Notified — Full Pub/Sub Flow

This is the crucial piece. After returning `202 Accepted`, you need to push the result back to the client. Here's why pub/sub is necessary and how it works.

### Why pub/sub and not just "worker notifies client directly"?

```
Worker runs on Instance B
Client's SSE connection is open on Instance A

Worker cannot reach the client directly — it doesn't know which
instance holds that connection.

Solution: Worker → Redis pub/sub → ALL instances receive message
          → Instance A (which holds the SSE) → pushes to client
```

```
┌──────────────┐     job       ┌──────────────┐
│   Instance A │ ─────────────►│   BullMQ     │
│  (API server)│               │   (Redis)    │
│              │               └──────┬───────┘
│  SSE conn    │                      │ worker picks up
│  open with   │               ┌──────▼───────┐
│  client      │               │   Worker     │
│              │               │  (Instance B)│
│              │               │              │
│              │               │  on complete:│
│              │◄──────────────│  publish to  │
│  receives    │  Redis pub/sub│  Redis       │
│  message     │               └──────────────┘
│              │
│  pushes via  │
│  SSE to      │
│  browser     │
└──────────────┘
```

### Redis Setup — Separate clients for pub and sub

```js
// redis.js
import { createClient } from 'redis';

// General purpose client (get/set/zadd etc.)
export const redis = createClient({ url: process.env.REDIS_URL });

// Publisher — dedicated client (can't share with subscriber)
export const publisher = redis.duplicate();

// Each SSE connection creates its own subscriber client
export const createSubscriber = () => redis.duplicate();

await redis.connect();
await publisher.connect();
```

> **Why separate clients?** A Redis client in pub/sub mode can ONLY send subscribe/unsubscribe commands — it can't do get/set. You need dedicated clients for pub and sub.

### SSE Endpoint — The Notification Channel

```js
app.get('/upload/status/:uploadId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { uploadId } = req.params;

    // Verify this upload belongs to this user
    const upload = await UploadRecord.findOne({
      _id: uploadId,
      userId: req.user.id,
    });
    if (!upload) throw new AppError('Upload not found', 404);

    // ── If already done, return immediately (no SSE needed) ──
    if (['completed', 'completed_with_errors', 'failed'].includes(upload.status)) {
      return res.json({ status: upload.status, upload });
    }

    // ── Set SSE headers ──
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send current status immediately on connect
    sendEvent('status', { uploadId, status: upload.status, progress: 0 });

    // ── Subscribe to Redis channel for this upload ──
    const subscriber = createSubscriber();
    await subscriber.connect();
    await subscriber.subscribe(`upload:${uploadId}`, (message) => {
      const data = JSON.parse(message);
      sendEvent(data.event, data);  // push directly to this client

      // Close SSE once terminal event received
      if (['completed', 'failed'].includes(data.event)) {
        cleanup();
      }
    });

    // BullMQ progress events (worker calls job.updateProgress())
    // These come via a separate Bull Board event or you can
    // publish progress updates from the worker too:
    await subscriber.subscribe(`upload:${uploadId}:progress`, (message) => {
      sendEvent('progress', JSON.parse(message));
    });

    // ── Cleanup on client disconnect ──
    const cleanup = async () => {
      await subscriber.unsubscribe();
      await subscriber.quit();
      res.end();
    };

    req.on('close', cleanup);     // browser tab closed
    req.on('aborted', cleanup);   // network dropped

    // ── Safety: auto-close after 10 min (prevent zombie connections) ──
    const timeout = setTimeout(cleanup, 10 * 60 * 1000);
    req.on('close', () => clearTimeout(timeout));
  })
);
```

### Frontend — Consuming SSE

```js
// React hook
function useUploadStatus(uploadId) {
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!uploadId) return;

    const es = new EventSource(
      `/upload/status/${uploadId}`,
      { withCredentials: true }  // send cookies for auth
    );

    es.addEventListener('status', (e) => {
      setStatus(JSON.parse(e.data).status);
    });

    es.addEventListener('progress', (e) => {
      setProgress(JSON.parse(e.data).percent);
    });

    es.addEventListener('completed', (e) => {
      const data = JSON.parse(e.data);
      setResult(data);
      setStatus('completed');
      es.close(); // done — close connection
    });

    es.addEventListener('failed', (e) => {
      setStatus('failed');
      setResult(JSON.parse(e.data));
      es.close();
    });

    es.onerror = () => {
      // SSE auto-reconnects by default — you can disable that:
      es.close();
    };

    return () => es.close(); // cleanup on unmount
  }, [uploadId]);

  return { status, progress, result };
}

// Usage
function UploadPage() {
  const [uploadId, setUploadId] = useState(null);
  const { status, progress, result } = useUploadStatus(uploadId);

  const handleUpload = async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch('/upload/users/large', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    setUploadId(data.uploadId); // triggers SSE connection
  };

  return (
    <div>
      {status === 'processing' && <ProgressBar value={progress} />}
      {status === 'completed' && <SuccessMessage result={result} />}
      {status === 'failed' && <ErrorMessage result={result} />}
    </div>
  );
}
```

### Complete End-to-End Timeline

```
T+0ms    Client uploads file → POST /upload/users/large
T+150ms  Server parses + validates → pushes to BullMQ → 202 { uploadId }
T+151ms  Client opens SSE → GET /upload/status/:uploadId
T+152ms  Server subscribes to Redis channel upload:{uploadId}
T+155ms  SSE sends: event: status, data: { status: 'queued' }
T+200ms  Worker picks up job → starts processing
T+500ms  Worker publishes progress → Redis → SSE → client sees 25%
T+900ms  Worker publishes progress → Redis → SSE → client sees 75%
T+1200ms Worker completes → publishes to Redis: upload:{uploadId}
T+1201ms Instance A receives pub/sub message (even if worker was on B)
T+1202ms SSE pushes: event: completed, data: { insertedCount: 9842 }
T+1203ms Client closes SSE. Shows success toast.
```

---

## 6. Scenario C — Very Large File, Disk + Streaming

**When:** > 100MB, > 100,000 rows

### Why streaming is needed here

```
100,000 rows × parse to JSON → ~200MB in Node heap
200MB heap + other app memory → OOM crash risk
Solution: never hold all rows in memory at once
```

```js
import ExcelJS from 'exceljs';

app.post('/upload/users/stream',
  diskUpload.single('file'),
  asyncHandler(async (req, res) => {

    if (!req.file) throw new AppError('No file uploaded', 400);

    const upload = await UploadRecord.create({
      userId: req.user.id,
      filename: req.file.originalname,
      status: 'queued',
    });

    // Push to queue — pass file PATH not contents
    // (file is on disk, worker will stream it directly)
    await importQueue.add('process-excel-stream', {
      uploadId: upload._id.toString(),
      filePath: req.file.path,
      userId: req.user.id,
    });

    res.status(202).json({
      mode: 'async-stream',
      uploadId: upload._id,
      message: 'Large file queued for streaming processing.',
    });
  })
);
```

```js
// Worker — streams file instead of loading all rows
const streamWorker = new Worker('excel-import', async (job) => {
  const { uploadId, filePath } = job.data;
  const workbookReader = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    worksheets: 'emit',
  });

  const batchSize = 500;
  let batch = [];
  let insertedCount = 0;
  let rowCount = 0;
  const errors = [];

  for await (const worksheet of workbookReader) {
    for await (const row of worksheet) {
      if (row.number === 1) continue; // skip header

      const record = {
        name: row.getCell(1).value,
        email: row.getCell(2).value,
        age: row.getCell(3).value,
        role: row.getCell(4).value,
      };

      const result = UserRowSchema.safeParse(record);
      if (result.success) {
        batch.push(result.data);
      } else {
        errors.push({ row: row.number, issues: result.error.flatten().fieldErrors });
      }

      rowCount++;

      if (batch.length >= batchSize) {
        await UserService.bulkCreate(batch);
        insertedCount += batch.length;
        batch = [];

        // Publish progress
        await publisher.publish(`upload:${uploadId}:progress`, JSON.stringify({
          processed: rowCount,
          percent: Math.round((rowCount / job.data.totalRows) * 100),
        }));
      }
    }
  }

  // Flush remainder
  if (batch.length > 0) {
    await UserService.bulkCreate(batch);
    insertedCount += batch.length;
  }

  // Always cleanup temp file
  await fs.promises.unlink(filePath);

  // Notify via pub/sub
  await publisher.publish(`upload:${uploadId}`, JSON.stringify({
    event: 'completed',
    uploadId,
    insertedCount,
    errorCount: errors.length,
    errors,
  }));

}, { connection: redis });
```

---

## 7. Scenario D — Duplicate Upload Prevention

**Problem:** User clicks upload twice, or network hiccup causes retry → duplicate rows in DB.

```js
import crypto from 'crypto';

app.post('/upload/users',
  memoryUpload.single('file'),
  asyncHandler(async (req, res) => {

    // Generate hash of file contents — same file = same hash
    const fileHash = crypto
      .createHash('sha256')
      .update(req.file.buffer)
      .digest('hex');

    // Check if this exact file was processed in last 24 hours
    const isDuplicate = await UploadRecord.findOne({
      userId: req.user.id,
      fileHash,
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    if (isDuplicate) {
      return res.status(409).json({
        error: 'Duplicate upload',
        message: 'This exact file was uploaded recently.',
        previousUploadId: isDuplicate._id,
        processedAt: isDuplicate.createdAt,
      });
    }

    // Redis lock — prevents race condition if two requests arrive simultaneously
    const lockKey = `upload-lock:${req.user.id}:${fileHash}`;
    const locked = await redis.set(lockKey, '1', { NX: true, EX: 30 }); // 30s lock
    if (!locked) {
      return res.status(409).json({ error: 'Upload already in progress for this file' });
    }

    try {
      // ... process upload
      await UploadRecord.create({ userId: req.user.id, fileHash, ... });
    } finally {
      await redis.del(lockKey); // always release lock
    }
  })
);
```

---

## 8. Scenario E — Partial Failures & Error Reporting

**Problem:** 9,000 rows are valid, 50 have bad data. Should you reject all or insert the valid ones?

### Strategy — Insert valid, report invalid

```js
async function bulkCreateWithReport(rows) {
  const errors = [];
  const insertedIds = [];

  // Option 1: ordered: false — MongoDB continues after individual doc failure
  try {
    const result = await User.insertMany(rows, {
      ordered: false,    // don't stop on first error
      rawResult: true,
    });
    insertedIds.push(...result.insertedIds);
  } catch (err) {
    // BulkWriteError still contains partial results
    if (err.name === 'BulkWriteError') {
      insertedIds.push(...Object.values(err.result.insertedIds));

      err.writeErrors.forEach((writeErr) => {
        errors.push({
          row: writeErr.index + 2,
          error: writeErr.errmsg.includes('duplicate key')
            ? `Email already exists: ${rows[writeErr.index].email}`
            : writeErr.errmsg,
        });
      });
    } else {
      throw err; // unexpected error, rethrow
    }
  }

  return { insertedCount: insertedIds.length, errors };
}
```

### Error Report Download

For large error sets, don't return all errors in JSON — write them to a file:

```js
// After processing, generate error report Excel
if (errors.length > 0) {
  const errorWorkbook = new ExcelJS.Workbook();
  const sheet = errorWorkbook.addWorksheet('Errors');

  sheet.addRow(['Row Number', 'Error', 'Data']);
  errors.forEach(({ row, error, data }) => {
    sheet.addRow([row, error, JSON.stringify(data)]);
  });

  const buffer = await errorWorkbook.xlsx.writeBuffer();

  // Upload error report to S3
  const errorReportKey = `error-reports/${uploadId}.xlsx`;
  await s3.putObject({ Bucket: process.env.S3_BUCKET, Key: errorReportKey, Body: buffer });
  const errorReportUrl = await getSignedUrl(s3, new GetObjectCommand({
    Bucket: process.env.S3_BUCKET, Key: errorReportKey,
  }), { expiresIn: 3600 });

  // Include download link in SSE notification
  await publisher.publish(`upload:${uploadId}`, JSON.stringify({
    event: 'completed',
    insertedCount,
    errorCount: errors.length,
    errorReportUrl,  // ← user downloads this to see exactly which rows failed
  }));
}
```

---

## 9. Scenario F — Multi-Sheet Excel

```js
app.post('/upload/multi-sheet', memoryUpload.single('file'), asyncHandler(async (req, res) => {

  const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });

  // Option 1: always use first sheet
  const firstSheet = workbook.SheetNames[0];

  // Option 2: client specifies which sheet
  const targetSheet = req.query.sheet || workbook.SheetNames[0];
  if (!workbook.SheetNames.includes(targetSheet)) {
    throw new AppError(
      `Sheet "${targetSheet}" not found. Available: ${workbook.SheetNames.join(', ')}`,
      400
    );
  }

  // Option 3: process all sheets
  const results = {};
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);
    results[sheetName] = await processSheet(sheetName, rows);
  }

  res.json({
    sheets: workbook.SheetNames,
    results,
  });
}));
```

---

## 10. Scenario G — Password Protected Excel

```js
import { execFile } from 'child_process';
import { promisify } from 'util';

// XLSX library cannot read password-protected files
// Detect and return a clear error
app.post('/upload', memoryUpload.single('file'), asyncHandler(async (req, res) => {

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', password: '' });
    // Process normally...
  } catch (err) {
    if (err.message?.includes('password') || err.message?.includes('encrypted')) {
      throw new AppError(
        'This Excel file is password protected. Please remove the password and re-upload.',
        400
      );
    }
    throw err; // other parse errors
  }
}));
```

---

## 11. Scenario H — Concurrent Uploads

**Problem:** 100 users uploading 5MB files = 500MB RAM consumed by multer alone.

### Rate limiting at upload endpoint

```js
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

// Per-user upload limit (not just per-IP, since users may be behind same NAT)
const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 3,                  // max 3 uploads per 5 min per user
  keyGenerator: (req) => `upload:${req.user?.id || req.ip}`,
  store: new RedisStore({ sendCommand: (...args) => redis.sendCommand(args) }),
  message: { error: 'Too many uploads. Please wait 5 minutes before uploading again.' },
});

// Global concurrent upload cap
let activeUploads = 0;
const MAX_CONCURRENT = 20;

const concurrencyGuard = (req, res, next) => {
  if (activeUploads >= MAX_CONCURRENT) {
    return res.status(503).json({
      error: 'Server busy. Please try again in a moment.',
      retryAfter: 30,
    });
  }
  activeUploads++;
  res.on('finish', () => activeUploads--);
  res.on('close', () => activeUploads--);
  next();
};

app.post('/upload/users', uploadLimiter, concurrencyGuard, memoryUpload.single('file'), ...);
```

---

## 12. Scenario I — Audit Trail & S3 Storage

**When:** Compliance requirements — every uploaded file must be stored.

```js
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: process.env.AWS_REGION });

app.post('/upload/users/audit',
  memoryUpload.single('file'),
  asyncHandler(async (req, res) => {

    const uploadId = new mongoose.Types.ObjectId();
    const s3Key = `uploads/${req.user.id}/${uploadId}/${req.file.originalname}`;

    // Store original file in S3 before any processing
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: s3Key,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      Metadata: {
        uploadedBy: req.user.id,
        uploadedAt: new Date().toISOString(),
        originalName: req.file.originalname,
      },
    }));

    // Record the audit trail
    const upload = await UploadRecord.create({
      _id: uploadId,
      userId: req.user.id,
      filename: req.file.originalname,
      s3Key,                           // store reference, not file
      fileSize: req.file.size,
      fileHash: crypto.createHash('sha256').update(req.file.buffer).digest('hex'),
      status: 'queued',
    });

    // Now process (inline or queue depending on size)
    // ...

    res.status(202).json({ uploadId: upload._id, s3Key });
  })
);
```

---

## 13. Validation Strategy — All Layers

```
Layer 1 — Multer fileFilter (before file touches memory)
  ✅ MIME type check
  ✅ File size cap

Layer 2 — After parse, before processing
  ✅ File is not empty (check sheet['!ref'])
  ✅ Has at least 1 data row (range.e.r >= 1)
  ✅ Required columns exist (check keys of rows[0])
  ✅ Duplicate file hash check

Layer 3 — Row-level validation (Zod)
  ✅ Type checks (string, number, email)
  ✅ Range checks (age 18–120)
  ✅ Enum checks (valid role values)
  ✅ Collect ALL errors, don't fail on first row

Layer 4 — DB level
  ✅ Unique index on email → catch duplicates
  ✅ insertMany with ordered: false → partial success
  ✅ Transaction for all-or-nothing requirement
```

---

## 14. Architecture Decision Guide

```
┌─────────────────────────────────────────────────────────────┐
│                  File arrives at server                     │
└─────────────────────────┬───────────────────────────────────┘
                          │
                   Size > 100MB?
                  /              \
                YES               NO
                 │                 │
          DiskStorage          MemoryStorage
          ExcelJS stream       XLSX buffer
                 │                 │
                 └────────┬────────┘
                          │
                  Rows > 1,000?
                 /              \
               YES               NO
                │                 │
           Queue it          Process inline
           202 Accepted      200 OK (done)
           return jobId       return result
                │
                │
        How to notify user?
         /      |      \
        SSE  WebSocket  Poll
         ↑       ↑        ↑
     Best for  If WS   Simplest,
     one-way   already  fallback
     push      connected option
```

### Notification Method Comparison

| Method | Complexity | Best For | Reconnect |
|---|---|---|---|
| **Polling** (`GET /jobs/:id` every 3s) | Low | Simple apps, small teams | Client handles |
| **SSE** (`EventSource`) | Medium | One-way push, upload status | Auto (browser built-in) |
| **WebSocket** | High | Already have WS (chat/live app) | Manual |
| **Email/Push notification** | Medium | Long jobs (hours), user leaves page | N/A |

> **Rule of thumb:** Use SSE for upload notifications. It's one-way (server → client), auto-reconnects, works over HTTP/1.1, and needs zero extra library on the frontend (`EventSource` is native browser API).

---

*Covers: multer memory/disk, XLSX buffer, ExcelJS streaming, BullMQ, Redis pub/sub, SSE, S3, validation, deduplication, partial failures, concurrency, audit trail*