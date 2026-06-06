# FE System Design — File Upload UI (Multi-file, Chunked, Resumable)

> Resume project relevance: **Verizon Auto Triaging** (Excel data uploads), Cantor Fitzgerald billing (CSV imports). See backend counterpart at [Excel Upload Case Study](../../../../../backend/nodejs/Excel_Upload_Case_Study.md).
>
> Cross-link: [File Upload backend](../../../../../backend/nodejs/File_Upload.md) · [Accessibility](../../accessibility.md)

---

## 1. Problem statement

Design a file upload UI that supports:

- Single + multiple file selection (drag-drop + click-to-browse)
- Files up to 5GB each
- 1-50 files at a time, total payload up to 20GB
- Real-time progress per file and aggregate
- Pause / resume / cancel per file
- Network interruption recovery (resume from where it left off)
- File-type and size validation client-side
- Image preview (thumbnail) for image uploads
- Upload to S3-compatible store via pre-signed URLs (no upload-server bottleneck)

Use case examples:
- Verizon agent uploads order data Excel files for batch processing
- Citi user uploads NAV CSV files (fund daily data)
- Generic document upload (PDF/Word) for compliance

---

## 2. Requirements

### 2.1 Functional

- Drag-and-drop zone (with click-to-browse fallback)
- File queue with status badges (pending/uploading/paused/done/error)
- Per-file progress bar + aggregate progress
- Pause/resume/cancel/retry actions
- Image thumbnails for image uploads
- Client-side validation: size, type (MIME-sniff, not just extension)
- Server-side virus scan UX (post-upload async)
- Survive network blips
- Visible bandwidth-throttle option (for slow networks)

### 2.2 Non-functional

- Don't block the UI thread during large file processing
- Resume after browser refresh (best-effort via IndexedDB)
- Keyboard accessible
- Screen reader announces progress
- Mobile-friendly (touch drag-drop)

---

## 3. High-level architecture

```
┌──────────────────────────────────────────────────────────┐
│  Browser                                                  │
│                                                           │
│  Dropzone ──► UploadQueue ──► Uploader (per file)         │
│                                  │                        │
│                                  ▼                        │
│                       ┌─────────────────────┐             │
│                       │  Chunked uploader   │             │
│                       │  (Web Worker)        │             │
│                       └─────────────────────┘             │
│                                  │                        │
│                                  ▼                        │
│                       ┌─────────────────────┐             │
│                       │ Pre-signed URL fetch │             │
│                       └─────────────────────┘             │
│                                  │                        │
│                                  ▼                        │
│  IndexedDB (resume state)        │                        │
└──────────────────────────────────┼────────────────────────┘
                                   ↓
              ┌──────────────────────────────────┐
              │   App API (issue pre-signed URLs)│
              └──────────────────────────────────┘
                                   ↓
              ┌──────────────────────────────────┐
              │   S3 / S3-compatible (storage)   │
              │   Direct PUT from browser         │
              └──────────────────────────────────┘
                                   ↓ (lifecycle hooks)
              ┌──────────────────────────────────┐
              │   Virus scan, parse, ingest      │
              └──────────────────────────────────┘
```

**Key design choice:** browser uploads **directly to S3** via pre-signed URL. Our API never sees the bytes — eliminates the upload-server bandwidth/cost bottleneck.

---

## 4. The upload protocol — S3 multipart

For files >5MB (S3 limit), use multipart upload:

```
1. POST /api/uploads { fileName, size, type }
   ← { uploadId, key, partSize, presignedUrls[] }

2. For each chunk:
   PUT presignedUrls[i] (binary body)
   ← ETag in response header

3. POST /api/uploads/{uploadId}/complete { parts: [{partNumber, etag}] }
   ← { url }
```

### 4.1 Why S3 multipart

- **Resumable** — each part can retry independently
- **Parallel** — N parts uploaded concurrently
- **Bounded** — partial failures don't lose the whole upload
- **Cost-effective** — no upload-server, no in-memory buffering

### 4.2 Part size strategy

- S3 minimum: 5MB per part (except last)
- S3 maximum: 5GB per part
- S3 max parts: 10,000

For 5GB file → 100MB parts → 50 parts. For 50MB file → 5MB parts → 10 parts. Adaptive part size:

```js
function calcPartSize(fileSize) {
  const MIN = 5 * 1024 * 1024;       // 5MB
  const TARGET_PARTS = 100;
  const partSize = Math.max(MIN, Math.ceil(fileSize / TARGET_PARTS));
  return Math.min(partSize, 100 * 1024 * 1024); // cap at 100MB
}
```

---

## 5. Chunked upload implementation

### 5.1 Reading file chunks

```ts
async function readChunk(file: File, start: number, end: number): Promise<Blob> {
  return file.slice(start, end);   // O(1) — Blob.slice is a view
}
```

`Blob.slice()` doesn't copy data — it returns a reference. Reading bytes happens when sent over the network.

### 5.2 Uploading a single part

```ts
async function uploadPart(
  url: string,
  blob: Blob,
  onProgress: (loaded: number) => void,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);

    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag");
        if (etag) resolve(etag.replace(/^"|"$/g, ""));
        else reject(new Error("Missing ETag"));
      } else {
        reject(new Error(`Status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));

    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(blob);
  });
}
```

**Why XHR not `fetch`?** `fetch` doesn't expose upload progress events (until Streams API support solidifies). XHR's `upload.onprogress` is reliable and well-supported.

### 5.3 Orchestrating parts

```ts
class ChunkedUploader {
  private abortController = new AbortController();

  constructor(private file: File, private uploadId: string,
              private parts: { partNumber: number; presignedUrl: string }[],
              private partSize: number,
              private onProgress: (loaded: number) => void) {}

  async upload(parallelism = 3): Promise<{ partNumber: number; etag: string }[]> {
    const results: { partNumber: number; etag: string }[] = [];
    let nextPartIndex = 0;
    let totalLoaded = 0;
    const partLoaded = new Map<number, number>();

    const worker = async () => {
      while (nextPartIndex < this.parts.length) {
        const i = nextPartIndex++;
        const p = this.parts[i];
        const start = i * this.partSize;
        const end = Math.min(start + this.partSize, this.file.size);
        const blob = this.file.slice(start, end);

        const etag = await uploadPart(
          p.presignedUrl,
          blob,
          (loaded) => {
            partLoaded.set(i, loaded);
            totalLoaded = Array.from(partLoaded.values()).reduce((a, b) => a + b, 0);
            this.onProgress(totalLoaded);
          },
          this.abortController.signal
        );
        results.push({ partNumber: p.partNumber, etag });
      }
    };

    await Promise.all(Array.from({ length: parallelism }, worker));
    return results.sort((a, b) => a.partNumber - b.partNumber);
  }

  pause() { this.abortController.abort(); }
}
```

### 5.4 Parallelism trade-offs

- More parallel parts = faster on high-bandwidth networks
- Too many = overwhelms slow networks, browser throttles (Chrome caps ~6 conns/origin)
- Adaptive: monitor throughput, adjust between 2-6

```ts
function adaptiveParallelism(rttMs: number, bandwidthMbps: number) {
  if (bandwidthMbps < 5) return 2;
  if (bandwidthMbps < 25) return 4;
  return 6;
}
```

---

## 6. Resume after interruption

### 6.1 Persisting upload state

Store in IndexedDB:

```ts
interface UploadState {
  uploadId: string;
  key: string;
  fileName: string;
  fileSize: number;
  fileHash: string;          // SHA-256 of file — for matching after refresh
  partSize: number;
  completedParts: { partNumber: number; etag: string }[];
  startedAt: number;
}

async function saveUploadState(state: UploadState) {
  const db = await openDB("uploads", 1, { upgrade(db) { db.createObjectStore("uploads", { keyPath: "uploadId" }); } });
  await db.put("uploads", state);
}
```

### 6.2 Resume flow

```
1. User selects file (after refresh)
2. Compute file's SHA-256 hash
3. Check IndexedDB for any open upload matching hash + size
4. If found → fetch remaining presigned URLs from server → continue from missing parts
5. Else → start fresh
```

### 6.3 Compute hash in Web Worker

SHA-256 over a 1GB file takes 10+ seconds — must run off main thread.

```ts
// hash-worker.ts
self.onmessage = async (e) => {
  const file: File = e.data.file;
  const chunkSize = 4 * 1024 * 1024;   // 4MB
  const hashCtx = await crypto.subtle.digest;
  // For incremental hashing, use a streaming alg like sha256-js library
  // Or, for a much simpler partial dedup, hash only the first MB + size
  const chunk = file.slice(0, 1024 * 1024);
  const buffer = await chunk.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  self.postMessage(`${hashHex}-${file.size}`);
};
```

For exact resume (rare), do incremental SHA-256 with `js-sha256` streaming. For most apps, first-1MB + size is a good "same file?" check.

---

## 7. Validation

### 7.1 File size

```ts
const MAX_SIZE = 5 * 1024 ** 3;   // 5GB
if (file.size > MAX_SIZE) {
  return { ok: false, error: `File too large (max ${formatBytes(MAX_SIZE)})` };
}
```

### 7.2 File type — MIME sniffing

`file.type` from the OS can be wrong or spoofed. Trust the bytes:

```ts
async function detectMimeType(file: File): Promise<string> {
  const buf = await file.slice(0, 16).arrayBuffer();
  const bytes = new Uint8Array(buf);

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return "image/jpeg";
  }
  // PDF: 25 50 44 46
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf";
  }
  // XLSX/DOCX/ZIP: 50 4B 03 04 (PK..)
  if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
    return "application/zip";   // could be Office docs; further inspection needed
  }
  return file.type || "application/octet-stream";
}
```

Libraries: `file-type`, `mime-sniff`. Always validate again on server.

### 7.3 Magic number table (essentials)

| Format | First bytes |
|--------|-------------|
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| JPEG | `FF D8 FF` |
| GIF | `47 49 46 38` |
| PDF | `25 50 44 46` |
| ZIP/XLSX/DOCX/JAR | `50 4B 03 04` |
| CSV (no magic) | text-based |

---

## 8. Drag-and-drop component

```jsx
function Dropzone({ onFiles, accept = "*/*", multiple = true, maxSize }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    onFiles(Array.from(files));
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Drop files here or click to browse"
      className={`dropzone ${isDragging ? "dragging" : ""}`}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <p>Drag files here or click to browse</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
    </div>
  );
}
```

Critical a11y: `role="button"`, `tabIndex={0}`, `aria-label`, Enter/Space handlers (drag-drop is mouse-only; keyboard users need click-to-browse).

### 8.1 WCAG 2.5.7 — alternate to drag

WCAG 2.2 requires drag operations have a non-drag alternative. Click-to-browse covers it. Don't ship drag-only UIs.

---

## 9. UI state machine

```
                    ┌────────────────────┐
                    │       idle          │
                    └──────────┬─────────┘
                               │ selectFiles
                    ┌──────────▼─────────┐
                    │     pending        │ (validating)
                    └──────────┬─────────┘
                               │ valid
                    ┌──────────▼─────────┐
              ┌─────│    uploading       │◄────┐
              │     └─────┬──────┬───────┘     │
              │           │      │             │
              │ pause     │ done │ error       │ resume
              │           ▼      ▼             │
              │     ┌─────────┐ ┌────────┐     │
              │     │ paused  │ │ done    │    │
              │     └─────┬───┘ └────────┘     │
              │           │                    │
              └───────────┴────────────────────┘
                          │ cancel
                          ▼
                    ┌──────────┐
                    │ cancelled │
                    └──────────┘
```

Implementation via `useReducer` (see [FE design patterns](../../../react/design-patterns-frontend.md) § 14).

---

## 10. Component tree

```
<UploadManager>           // orchestrates queue, owns state
  <Dropzone />            // file selection
  <UploadList>            // virtualized for 50+ files
    <UploadItem>          // per file
      <Thumbnail />       // image preview (offthread)
      <ProgressBar />     // current state
      <Actions />         // pause/resume/retry/cancel
    </UploadItem>
  </UploadList>
  <AggregateProgress />   // overall %
</UploadManager>
```

### 10.1 Aggregate progress

```ts
const total = files.reduce((acc, f) => acc + f.size, 0);
const loaded = files.reduce((acc, f) => acc + f.bytesUploaded, 0);
const pct = total ? (loaded / total) * 100 : 0;
```

Throttle re-renders via `useDeferredValue` or aggregate updates per RAF.

---

## 11. Image thumbnails — generate off main thread

```ts
async function makeThumbnail(file: File, maxDim = 200): Promise<Blob> {
  if (!file.type.startsWith("image/")) return null;
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(maxDim / bitmap.width, maxDim / bitmap.height);
  const w = bitmap.width * ratio, h = bitmap.height * ratio;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
}
```

`createImageBitmap` + `OffscreenCanvas` work in Web Workers — keep main thread free. Display via `URL.createObjectURL(blob)`.

---

## 12. Progress UX

| State | UX |
|-------|-----|
| Pending | Greyed icon, "Queued" badge |
| Uploading | Progress bar + speed + ETA |
| Paused | Pause icon, "Paused at 45%" |
| Error | Red badge, error message, Retry button |
| Done | Green check, file size + "Done" |
| Virus scanning | Spinner + "Scanning..." after upload completes |
| Scan complete (clean) | Green check |
| Scan failed | Red — file unavailable |

### 12.1 Speed and ETA calc

```ts
function speed(loaded: number, startMs: number) {
  const elapsedSec = (Date.now() - startMs) / 1000;
  return loaded / elapsedSec;   // bytes/sec
}

function eta(remaining: number, speedBytesSec: number) {
  if (speedBytesSec === 0) return Infinity;
  return remaining / speedBytesSec;   // seconds
}
```

Smooth over last N samples to avoid jitter:

```ts
class SpeedTracker {
  private samples: { t: number; loaded: number }[] = [];
  add(loaded: number) {
    const now = Date.now();
    this.samples.push({ t: now, loaded });
    this.samples = this.samples.filter(s => now - s.t < 10_000); // last 10s
  }
  bytesPerSec() {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    return (last.loaded - first.loaded) / ((last.t - first.t) / 1000);
  }
}
```

---

## 13. Error handling & retry

| Error | Retry? | Strategy |
|-------|--------|----------|
| Network failure mid-part | Yes | Exponential backoff, max 3 |
| 4xx (signed URL expired) | Yes | Refresh pre-signed URLs and retry |
| 5xx S3 | Yes | Backoff + retry |
| Total file rejected (server-side) | No | Show error, user re-selects |
| User cancel | No | Clean up state |

### 13.1 Backoff with jitter

```ts
async function retry<T>(fn: () => Promise<T>, max = 3): Promise<T> {
  for (let i = 0; i <= max; i++) {
    try { return await fn(); }
    catch (e) {
      if (i === max) throw e;
      const delay = Math.min(1000 * 2 ** i, 16_000) + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}
```

---

## 14. Accessibility

- Dropzone is focusable, has `aria-label`, supports Enter/Space
- Progress bars use `<progress>` element or `role="progressbar"` with `aria-valuenow/min/max`
- File queue announces additions/state changes via polite live region
- Error messages use `role="alert"`
- Per-item action buttons have explicit aria-labels: "Pause upload of report.xlsx"
- Keyboard ordering: dropzone → queue items → action buttons within items

```jsx
<div role="status" aria-live="polite">
  {announcement}   {/* "Uploading 3 of 5 files, 45% complete" */}
</div>
```

Debounce announcement updates — every 10% progress, not every byte.

---

## 15. Mobile considerations

- Touch drag works with `dragover` events on most modern mobile browsers
- File picker on mobile = native picker (camera, gallery, files)
- Bandwidth: lower parallelism, larger part sizes
- Show estimated data usage warning for cellular networks via `navigator.connection.type`
- Background uploads stop when tab is backgrounded (no Service Worker fix yet — works as expected)

---

## 16. Trade-off matrix

| Decision | Option A | Option B | Choice + Why |
|----------|----------|----------|--------------|
| Storage path | Through our server | Direct to S3 | **Direct to S3** — eliminates upload-server bottleneck |
| Single PUT vs multipart | Single | Multipart | **Multipart** for >5MB — resumable, parallel |
| Progress API | fetch | XHR | **XHR** — reliable upload progress |
| Hash for resume | Full file | First-MB + size | **First-MB + size** by default; full SHA-256 in worker for stricter dedup |
| Worker for upload | Main thread | Web Worker | **Web Worker** for big files + thumbnail generation |
| Validation | Extension only | MIME sniff | **MIME sniff** — extensions are spoofable |
| State persistence | None | IndexedDB | **IndexedDB** — survives refresh |
| Drag-only | No | Yes | **Drag + click** — WCAG 2.5.7 |

---

## 17. Architectural variants

### 17.1 TUS protocol

[Tus.io](https://tus.io/) — a dedicated resumable upload protocol. Server-side library. More flexibility than S3 multipart but you run your own server. Useful when not on AWS, or when S3 multipart's part-size constraints are too rigid.

### 17.2 Uppy

Battle-tested open-source uploader (Transloadit). Drops in: queue, drag-drop, multiple sources (camera, URL, Dropbox), TUS, S3 multipart adapters, plugins. Often a great choice — use unless you have specific reasons to roll your own.

### 17.3 Service-worker background upload

Service Worker + Background Sync API can resume uploads even after the tab closes. Limited browser support (Chrome only as of 2026), batch size limits. Worth exploring for mobile.

---

## 18. Interview talking points

**Q: "Why upload directly to S3 instead of through your server?"**
A: Eliminates the upload-server bandwidth and memory pressure. Our API issues a pre-signed URL with a short TTL (e.g., 15min) and a constrained policy (max size, content-type, key prefix). Browser PUTs directly to S3. Server cost stays proportional to API traffic, not data volume. We never see the bytes — keeps our compliance scope tight.

**Q: "How would you resume an upload after a network drop?"**
A: S3 multipart gives this natively. Each part has its own pre-signed URL and ETag. Our client persists `(uploadId, completed parts)` to IndexedDB. On resume, we ask the server for remaining parts' pre-signed URLs and continue. After a refresh, we identify the file via a hash (first 1MB + size as a quick fingerprint, full SHA-256 in a Web Worker for stricter matching).

**Q: "Why XHR and not fetch?"**
A: fetch doesn't expose upload progress events reliably until the Streams API support is universal. XHR's `upload.onprogress` is granular and well-supported. Once `fetch + ReadableStream` upload progress is on par across browsers (currently Chrome only), I'd migrate.

**Q: "How do you validate file types?"**
A: Two layers. Client-side magic-number sniff via `Blob.slice(0, 16)` + byte signature check (libraries: file-type). Server-side validation independently with a stricter scanner — content can be malicious even if the type looks right. Extension matching alone is spoofable and shouldn't be relied on.

**Q: "What about virus scanning?"**
A: Async, post-upload. The client shows "Scanning…" after PUT completes. A backend lifecycle hook on the S3 bucket invokes a scanner (Lambda + ClamAV, or hosted service). Result published back to the client via WS or polling. The file is quarantined in a separate "incoming" bucket until clean, then promoted to "verified".

**Q: "How do you handle 50 files at once?"**
A: Queue with bounded parallelism — 3-6 concurrent files, each with 3-6 concurrent parts. Beyond that, browser conn limits kick in. Pause/resume per file lets users manage priority. Aggregate progress across the queue. UI shows the queue virtualized if it gets long.

**Q: "Mobile vs desktop differences?"**
A: Mobile: lower parallelism (2 files, 2 parts each), larger parts (less HTTP overhead), respect `navigator.connection.effectiveType` (skip on `slow-2g`/`2g` unless user confirms). Background uploads when the tab is idle can use Service Worker + Background Sync (Chrome) — limited but useful.

**Q: "What if the user closes the tab mid-upload?"**
A: For S3 multipart, parts already uploaded persist on S3 for the multipart's lifetime (we set ~7 day expiry on incomplete multipart). User returns, we restore from IndexedDB state, fetch a new presigned URL set for missing parts, resume. If the file is gone from their device, the upload is abandoned (S3 cleans up via lifecycle policy).

---

## 19. Diagram

```
   User                Browser                                S3                   Backend
    │                    │                                     │                      │
    │  drag/click        │                                     │                      │
    ├───────────────────►│                                     │                      │
    │                    │  validate (size, MIME-sniff)        │                      │
    │                    │                                     │                      │
    │                    │  POST /uploads {name, size, type}   │                      │
    │                    ├────────────────────────────────────────────────────────────►│
    │                    │   { uploadId, key, partSize, presignedUrls[] }              │
    │                    │◄────────────────────────────────────────────────────────────┤
    │                    │  save state to IndexedDB             │                      │
    │                    │                                     │                      │
    │                    │  PUT presignedUrls[0] (chunk 0)     │                      │
    │                    ├────────────────────────────────────►│                      │
    │                    │              ETag #1                │                      │
    │                    │◄────────────────────────────────────│                      │
    │                    │  PUT presignedUrls[1] (chunk 1)     │                      │
    │                    ├────────────────────────────────────►│                      │
    │   progress events  │  ...                                │                      │
    │◄───────────────────│                                     │                      │
    │                    │                                     │                      │
    │                    │  POST /uploads/{id}/complete        │                      │
    │                    │      {parts: [...]}                  │                      │
    │                    ├────────────────────────────────────────────────────────────►│
    │                    │       {url}                          │                      │
    │                    │◄────────────────────────────────────────────────────────────┤
    │   "Done"           │                                     │                      │
    │◄───────────────────│                                     │   async: scan/parse  │
    │                    │                                     │  ◄────────────────────┤
```

---

## 20. References & cross-links

- [Backend File Upload notes](../../../../../backend/nodejs/File_Upload.md)
- [Excel Upload Case Study](../../../../../backend/nodejs/Excel_Upload_Case_Study.md)
- [Tus.io protocol](https://tus.io/)
- [Uppy uploader](https://uppy.io/)
- [S3 Multipart Upload API](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
- [Accessibility](../../accessibility.md) — drag alternatives, progress announcements
- [Browser rendering pipeline](../../browser-rendering-pipeline.md) — Web Workers, OffscreenCanvas
