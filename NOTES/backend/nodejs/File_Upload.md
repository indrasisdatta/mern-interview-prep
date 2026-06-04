# React File Upload — Approaches & S3 Streaming

---

## Three Ways to Send a File from React

### 1. FormData — standard approach (small/medium files)

```js
const formData = new FormData();
formData.append('file', file); // File object — just a reference, NOT bytes in memory

await fetch('/upload', { method: 'POST', body: formData });
// Don't set Content-Type manually — browser sets multipart/form-data + boundary
```

> `File` is a reference to disk. Bytes only enter JS heap if you explicitly
> call `file.arrayBuffer()`. FormData does NOT load the file into memory.

---

### 2. ArrayBuffer — avoid for large files

```js
const buffer = await file.arrayBuffer(); // ❌ entire file now in JS heap

await fetch('/upload', {
  method: 'POST',
  headers: { 'Content-Type': file.type },
  body: buffer,
});
```

Only use this when you need to manipulate bytes before sending —
client-side encryption, hashing, or reading Excel headers for a preview.

---

### 3. Raw Stream — pairs with S3 parallel upload ✅

`fetch()` doesn't expose upload progress. Use `XMLHttpRequest` instead:

```js
import axios from 'axios';

const uploadVideo = async (file, onProgress) => {
  const response = await axios.post('/upload/video', file, {
    headers: {
      'Content-Type': file.type,
      'X-Filename': encodeURIComponent(file.name),
    },
    onUploadProgress: (e) => {
      const percent = Math.round((e.loaded / e.total) * 100);
      onProgress(percent);
    },
  });

  return response.data;
};

try {
  const result = await uploadVideo(file, setProgress);
  console.log('Uploaded:', result.url);
} catch (err) {
  console.error('Upload failed:', err.response?.data || err.message);
}
```

**Why this pairs with the S3 streaming server:**
- `body: file` / `xhr.send(file)` sends raw binary — no multipart envelope
- Server receives `req` as a raw Readable stream
- `req` pipes directly into S3 — file never fully loads in browser or server RAM
- Error handling is automatic — axios throws on non-2xx status, so you don't need to manually check xhr.status like in the XHR version. Wrap in try/catch at the call site
---

## Memory Comparison

| Approach | Browser RAM | Server RAM | Good For |
|---|---|---|---|
| FormData | ~0 (streaming) | Whole file (memoryStorage) | Excel, images, docs up to 10MB |
| ArrayBuffer | Whole file ❌ | Whole file ❌ | Client-side manipulation only |
| Raw stream | ~64KB chunks ✅ | ~chunk size ✅ | Videos, any file > 10MB |

---

## Decision Guide

| File type / size | Frontend | Server |
|---|---|---|
| Excel / CSV (< 10MB) | FormData | multer memoryStorage → XLSX parse |
| Images (< 5MB) | FormData | multer memoryStorage → Sharp |
| Images needing client resize | `file.arrayBuffer()` → canvas → FormData | multer memoryStorage |
| Videos / large files (> 10MB) | Raw stream via XHR | `req` piped to S3, no multer |
| Any file needing progress bar | XHR + upload events | Either approach |