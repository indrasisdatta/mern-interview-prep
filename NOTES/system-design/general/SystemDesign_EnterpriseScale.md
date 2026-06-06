> **Theme:** Scalability Patterns · Micro-frontend Isolation · Cloud/AI System Integration  
> **Goal:** Think, speak, and draw like a Principal Engineer who has shipped at scale.

---

## 📅 Weekly Map

| Day | Focus | Depth |
|---|---|---|
| Mon | Micro-frontend Architecture (Module Federation vs Shadow DOM) | Deep |
| Tue | Caching Layer Topographies (Redis + CloudFront) | Deep |
| Wed | Structural Token Patterns for Stateless Auth | Deep |
| Thu | RAG Pipeline Architecture (Chunking + Vector DBs + Hybrid Search) | Deep |
| Fri | LLM Token Throttle & Exponential Backoff Queue Design | Deep |
| Sat–Sun | Whiteboard System Diagrams (MERN Portal + Multi-Agent Pipeline) | Synthesis |

---

# MON — Micro-Frontend Architecture

## 1. Why Micro-Frontends at Enterprise Scale?

A monolithic frontend in a company with 15+ product teams becomes a release bottleneck — one failing test blocks everyone's deploy. Micro-frontends (MFEs) solve this by giving each team independent build, deploy, and runtime ownership.

**Real use case:** Flipkart, IKEA, and Zalando migrated to MFEs to let 50+ squads deploy independently to the same shell app URL.

---

## 2. Module Federation (Webpack 5)

### What it is
Module Federation lets one JavaScript application **dynamically load code from another application at runtime**, sharing dependencies (React, ReactDOM) to avoid duplication.

### Core Concepts

```
Host App (Shell)        Remote App (MFE)
──────────────          ──────────────────
webpack.config.js       webpack.config.js
  plugins: [              plugins: [
    new ModuleFederationPlugin({  new ModuleFederationPlugin({
      name: 'shell',        name: 'cartMFE',
      remotes: {            filename: 'remoteEntry.js',
        cart: 'cartMFE@    exposes: {
          https://cdn.x/     './CartWidget':
          remoteEntry.js'      './src/CartWidget'
      },                    }
      shared: ['react',   shared: ['react',
               'react-dom']          'react-dom']
    })                    })
  ]                     ]
```

**remoteEntry.js** is the manifest file — a small JS file that tells the host: "here are the modules I expose and the chunks needed to load them."

### Runtime Loading in the Shell

```jsx
// Shell App — lazy loads the CartWidget from the cart team's CDN
import React, { Suspense, lazy } from 'react';

const CartWidget = lazy(() => import('cart/CartWidget'));

function Header() {
  return (
    <Suspense fallback={<SkeletonHeader />}>
      <CartWidget userId={user.id} onCheckout={handleCheckout} />
    </Suspense>
  );
}
```

### Shared Dependency Strategy (Critical Interview Point)

```js
// WRONG — each MFE ships its own React, causing React Context breaks
shared: ['react']

// CORRECT — singleton enforcement ensures one React instance in memory
shared: {
  react: {
    singleton: true,      // only one instance allowed
    requiredVersion: '^18.0.0',
    eager: false,         // lazy load shared lib, reduces initial bundle
  },
  'react-dom': { singleton: true, requiredVersion: '^18.0.0' },
}
```

> **Interview Trap:** If two MFEs load different React versions, `useContext` breaks silently because the context object is instance-specific. Singleton enforcement is non-negotiable.

### Versioned Remote URLs for Zero-Downtime Deploys

```js
// Don't hardcode URLs — fetch the manifest at startup
const manifest = await fetch('/mfe-manifest.json').then(r => r.json());
// manifest.json = { cart: "https://cdn.cart-team.com/v3.4.1/remoteEntry.js" }

// Shell dynamically configures remotes before booting
window.__webpack_init_sharing__('default');
const container = window['cartMFE'];
await container.init(__webpack_share_scopes__.default);
```

**mfe-manifest.json** (versioned, served from a central config service):
```json
{
  "cart": "https://cdn.x.com/mfe/cart/v3.4.1/remoteEntry.js",
  "checkout": "https://cdn.x.com/mfe/checkout/v2.0.0/remoteEntry.js",
  "search": "https://cdn.x.com/mfe/search/v5.1.3/remoteEntry.js"
}
```

This pattern enables **canary releases** — update the manifest for 5% of users to point to a new remote version. Roll back by reverting the manifest, not redeploying code.

---

## 3. Shadow DOM Isolation

### What it is
Shadow DOM is a **browser-native encapsulation boundary**. Styles, event listeners, and DOM queries inside a Shadow Root cannot leak out, and external styles cannot penetrate in (by default).

```js
// Creating an isolated MFE with Shadow DOM
class CheckoutMFE extends HTMLElement {
  connectedCallback() {
    const shadow = this.attachShadow({ mode: 'open' });
    // React mounts INSIDE the shadow root — fully isolated
    const container = document.createElement('div');
    shadow.appendChild(container);
    ReactDOM.createRoot(container).render(<CheckoutApp />);
  }
}
customElements.define('checkout-mfe', CheckoutMFE);
```

**Host app usage:**
```html
<checkout-mfe user-id="abc123" theme="dark"></checkout-mfe>
```

### Style Isolation Comparison

| Concern | Module Federation | Shadow DOM |
|---|---|---|
| CSS leakage | Requires CSS Modules / scoped CSS | Native hard boundary |
| Global theme vars | `var(--brand-color)` works if inherited | CSS custom properties DO pierce Shadow DOM |
| Third-party widget isolation | Partial | Complete (ideal for payment widgets) |
| Angular / Vue MFEs | Works with adapters | Works natively via Web Components |

### Passing Data Across the Shadow Boundary

```js
// Parent to Shadow DOM child — via attributes or properties
document.querySelector('checkout-mfe').userData = { id: 'u1', cart: [...] };

// Shadow DOM child to parent — via CustomEvents (they bubble by default)
this.dispatchEvent(new CustomEvent('checkout-complete', {
  detail: { orderId: '12345' },
  bubbles: true,
  composed: true // composed:true allows crossing Shadow DOM boundaries
}));
```

---

## 4. Module Federation vs Shadow DOM — Decision Framework

```
Q: Do you need runtime code sharing (lazy remotes, shared React)?
  └─ YES → Module Federation is the answer.

Q: Do you need hard CSS/style isolation or embedding third-party widgets?
  └─ YES → Shadow DOM (as Web Components) is the answer.

Q: Do you have a mixed framework team (React MFE + Angular MFE)?
  └─ YES → Shadow DOM + Custom Elements solves the framework boundary.

Q: Do you need both?
  └─ Module Federation to load the bundle, Shadow DOM to mount it.
     This is the production-grade approach for bank/fintech portals.
```

**Real pattern at enterprise scale:**
- Shell (Module Federation host) loads remote manifests.
- Each remote exposes a Web Component (`<cart-widget />`).
- Web Component mounts its internal React tree inside a Shadow Root.
- Shared state flows through a lightweight event bus (Redux Toolkit with a cross-MFE event channel or a pub/sub service).

---

# TUE — Caching Layer Topographies

## 1. Mental Model: The Caching Hierarchy

```
User Browser
    │
    ▼
[Browser Cache / Service Worker]   ← Fastest (0ms, local)
    │
    ▼
[CDN Edge — CloudFront / Fastly]   ← ~5ms, global PoP
    │
    ▼
[API Gateway Cache / Nginx]        ← ~15ms, regional
    │
    ▼
[Application Cache — Redis]        ← ~1ms, in-datacenter
    │
    ▼
[Database — MongoDB / PostgreSQL]  ← ~50–500ms
```

Each layer answers a different question. A senior architect designs **all layers together**, not just Redis.

---

## 2. Redis Caching Patterns

### Cache-Aside (Lazy Loading) — Most Common

```js
// Node.js / Express service
async function getProduct(productId) {
  const cacheKey = `product:${productId}`;

  // 1. Check cache
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // 2. Cache miss — fetch from DB
  const product = await ProductModel.findById(productId).lean();
  if (!product) return null;

  // 3. Write to cache with TTL
  await redis.setex(cacheKey, 3600, JSON.stringify(product)); // 1-hour TTL

  return product;
}
```

**Pros:** Only caches what's requested. No wasted memory.  
**Cons:** First request after expiry is slow (cold start). Use **probabilistic early expiration** to avoid thundering herds.

### Write-Through — For Strong Consistency

```js
async function updateProduct(productId, data) {
  // Write to DB first
  const updated = await ProductModel.findByIdAndUpdate(productId, data, { new: true });

  // Immediately update the cache to prevent stale reads
  await redis.setex(`product:${productId}`, 3600, JSON.stringify(updated));

  return updated;
}
```

**Use when:** Read-heavy + data must never serve stale (inventory levels, pricing).

### Redis Data Structure Choices (Architect-Level)

```js
// String — simple key/value, sessions, feature flags
await redis.set('feature:darkMode:user:u1', '1', 'EX', 86400);

// Hash — user sessions (efficient partial updates, no serialization overhead)
await redis.hset('session:sess_abc', {
  userId: 'u1', role: 'admin', cartId: 'cart_xyz'
});
await redis.expire('session:sess_abc', 3600);

// Sorted Set — leaderboards, rate limiting windows
await redis.zadd('api:rate:user:u1', Date.now(), `req:${Date.now()}`);
// Sliding window rate limiter — count requests in last 60s
const count = await redis.zcount('api:rate:user:u1', Date.now() - 60000, '+inf');

// List — job queues, activity feeds (use BullMQ instead in production)

// Pub/Sub — real-time cross-service notifications (use with WebSockets)
redis.subscribe('order:created', (msg) => notifyDashboard(JSON.parse(msg)));
```

### Thundering Herd Prevention

When a popular cache key expires, 10,000 requests hit the DB simultaneously.

```js
async function getSafeProduct(productId) {
  const cacheKey = `product:${productId}`;
  const lockKey = `lock:${cacheKey}`;

  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  // Acquire distributed lock (only one request rebuilds the cache)
  const lockAcquired = await redis.set(lockKey, '1', 'NX', 'EX', 10);

  if (lockAcquired) {
    // Winner — fetch and cache
    const product = await ProductModel.findById(productId).lean();
    await redis.setex(cacheKey, 3600, JSON.stringify(product));
    await redis.del(lockKey);
    return product;
  } else {
    // Losers — wait briefly and read from cache (stale or fresh)
    await sleep(50);
    return JSON.parse(await redis.get(cacheKey));
  }
}
```

---

## 3. CloudFront CDN Topography

### Multi-Origin Architecture

```
Client Request
    │
    ▼
CloudFront Distribution
    │
    ├─── /api/*          ─────► ALB → Node.js / Express cluster
    │       (Cache-Control: no-store for API responses by default)
    │
    ├─── /static/*       ─────► S3 Bucket (origin)
    │       (Cache-Control: max-age=31536000, immutable for hashed assets)
    │
    └─── /images/*       ─────► Lambda@Edge (resize on the fly)
             (Cache-Control: max-age=86400, vary: Accept)
```

### CloudFront Cache Behavior Configuration

```
Behavior: /api/products/*
  Origin: ALB
  Cache Policy: CachingDisabled (TTL = 0)
  Origin Request Policy: AllViewerExceptHostHeader
  Response Headers: Cache-Control: no-store, Pragma: no-cache

Behavior: /static/js/*, /static/css/*
  Origin: S3
  Cache Policy: CachingOptimized (TTL = 1 year)
  Compress Objects: true
  (Webpack outputs [contenthash] filenames, so cache busting is automatic)

Behavior: /api/products/featured  ← exception for semi-static API
  Origin: ALB
  Cache Policy: Custom (TTL = 60s, stale-while-revalidate = 30s)
  Cache Key: URI + User-Agent header (mobile vs desktop)
```

### Lambda@Edge for Personalization at the Edge

```js
// Lambda@Edge — viewer-request event (runs at every edge PoP)
exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const country = request.headers['cloudfront-viewer-country']?.[0]?.value;

  // Route Indian users to ap-south-1 origin
  if (country === 'IN') {
    request.origin.custom.domainName = 'api-india.myapp.com';
  }

  // A/B test header injection
  const variant = Math.random() < 0.1 ? 'B' : 'A';
  request.headers['x-ab-variant'] = [{ key: 'X-AB-Variant', value: variant }];

  return request;
};
```

### Cache Invalidation Strategy

```bash
# Surgical invalidation (preferred — precise, costs $0.005/1000 paths)
aws cloudfront create-invalidation \
  --distribution-id E1234ABCD \
  --paths "/api/products/featured" "/static/data/homepage.json"

# Version-based invalidation (best practice — no invalidation needed)
# Instead of /data/homepage.json → use /data/homepage.v3.json
# and update your app to reference the new path
```

> **Interview Point:** Invalidation has eventual consistency (~15s propagation to all 400+ PoPs). Use versioned paths for instant cache busting. Invalidation is for emergency rollbacks only.

---

## 4. Caching Anti-Patterns to Call Out in Interviews

| Anti-Pattern | What Goes Wrong | Fix |
|---|---|---|
| Cache everything with same TTL | Pricing data stale for hours | Segment TTLs by data volatility |
| No cache stampede protection | DB overload on expiry | Mutex locks / probabilistic refresh |
| Caching user-specific data at CDN | User A sees User B's cart | Vary headers or don't CDN-cache private data |
| Redis as primary DB | Data loss on restart | Redis persistence (AOF/RDB) + replicas |
| Unbounded cache growth | OOM crash | `maxmemory-policy: allkeys-lru` in Redis config |

---

# WED — Structural Token Patterns for Stateless Auth

## 1. JWT Architecture Review (Architect-Level)

### Token Anatomy

```
Header.Payload.Signature
  │        │         │
  ▼        ▼         ▼
base64   base64   HMAC-SHA256(header.payload, SECRET)
{        {
 "alg":   "sub": "u1",
 "HS256"  "role": "admin",
 "typ":   "iat": 1700000000,
 "JWT"    "exp": 1700003600,  // 1 hour
}         "jti": "uuid-v4"   // unique token ID for revocation
}
```

> **Never put PII (email, address) in JWT payload** — it's base64 encoded, not encrypted. Anyone can decode it. Use opaque token IDs that reference server-side sessions for sensitive claims.

---

## 2. Access Token + Refresh Token Architecture

```
┌─────────────┐       Login        ┌────────────────────────┐
│   Browser   │ ──────────────────► │   Auth Service         │
│             │                     │                        │
│             │ ◄────────────────── │ Access Token (15 min)  │
│             │  accessToken (mem)  │ Refresh Token (7 days) │
│             │  refreshToken (httpOnly cookie)              │
└─────────────┘                     └────────────────────────┘
      │
      │  API Request + accessToken in Authorization header
      ▼
┌─────────────┐
│  API Server │ — verifies signature locally (no DB call) — stateless
└─────────────┘
      │
      │  accessToken expired → 401
      ▼
┌─────────────┐  POST /auth/refresh (cookie auto-sent by browser)
│   Browser   │ ──────────────────────────────────────────────────►
│             │                    Auth Service issues new tokens
│             │ ◄──────────────────────────────────────────────────
└─────────────┘
```

### Refresh Token Rotation (Security-Critical)

```js
// Auth Service — POST /auth/refresh
async function refreshTokens(req, res) {
  const oldRefreshToken = req.cookies.refreshToken;

  // Validate the incoming refresh token
  const payload = jwt.verify(oldRefreshToken, REFRESH_SECRET);
  const storedFamily = await redis.get(`rt:${payload.familyId}`);

  // REUSE DETECTION: If the family was already rotated, revoke entire family
  if (storedFamily !== oldRefreshToken) {
    await redis.del(`rt:${payload.familyId}`); // invalidate all tokens in family
    return res.status(401).json({ error: 'Token reuse detected — re-login required' });
  }

  // Issue new token pair
  const newAccessToken = jwt.sign({ sub: payload.sub, role: payload.role }, ACCESS_SECRET, { expiresIn: '15m' });
  const newRefreshToken = jwt.sign({ sub: payload.sub, familyId: payload.familyId }, REFRESH_SECRET, { expiresIn: '7d' });

  // Store the new refresh token, overwriting the old one
  await redis.setex(`rt:${payload.familyId}`, 604800, newRefreshToken);

  res.cookie('refreshToken', newRefreshToken, { httpOnly: true, secure: true, sameSite: 'Strict' });
  res.json({ accessToken: newAccessToken });
}
```

> **Token Family** = a chain of refresh tokens issued from the same login event. If an attacker steals and uses a refresh token that was already rotated, the server detects reuse and kills the entire family, forcing re-login.

---

## 3. Stateless Auth at Scale — Structural Patterns

### Pattern 1: Embedded RBAC Claims

```js
// Payload includes permissions — API server needs no DB call
{
  "sub": "u1",
  "roles": ["admin", "billing_read"],
  "org": "org_abc",
  "plan": "enterprise",
  "features": ["ai_assistant", "advanced_analytics"],
  "exp": 1700003600
}

// Middleware — fully stateless, no DB/Redis lookup
function authorize(requiredRole) {
  return (req, res, next) => {
    const { roles } = req.jwtPayload;
    if (!roles.includes(requiredRole)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}
```

**Trade-off:** Permission changes don't take effect until token expiry (max 15 min). Acceptable for most SaaS. For instant revocation, use a short-lived token + Redis blocklist check.

### Pattern 2: Token Revocation via Allowlist (Short-Lived + Redis)

```js
// On login — store JTI in Redis
const jti = uuidv4();
await redis.setex(`jti:${jti}`, 900, '1'); // 15-min TTL matches token expiry

// On middleware — verify token AND check allowlist
async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  const payload = jwt.verify(token, ACCESS_SECRET);

  const valid = await redis.exists(`jti:${payload.jti}`);
  if (!valid) return res.status(401).json({ error: 'Token revoked' });

  req.user = payload;
  next();
}

// On logout — delete the JTI (instant revocation)
async function logout(req, res) {
  await redis.del(`jti:${req.user.jti}`);
  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out' });
}
```

### Pattern 3: PASETO (Modern JWT Alternative)

PASETO (Platform-Agnostic Security Tokens) eliminates JWT's algorithm confusion attacks (`alg: none` exploit) by enforcing a single algorithm per token version.

```js
import { V4 } from 'paseto';

const key = await V4.generateKey('local'); // Symmetric

// Encrypt (not just sign — payload is confidential)
const token = await V4.encrypt({ sub: 'u1', role: 'admin' }, key, {
  expiresIn: '15 minutes'
});

// Decrypt + verify expiry
const payload = await V4.decrypt(token, key);
```

> **Use PASETO** when: compliance requires payload confidentiality, or you want to eliminate alg-confusion attack surface. Use for internal service-to-service auth tokens.

---

## 4. mTLS for Service-to-Service Auth (Zero-Trust)

At enterprise scale, inter-service calls (Node.js microservice A calling microservice B) must authenticate. JWTs work but mTLS is stronger — both sides prove identity via certificates.

```
Service A (client cert: serviceA.crt)
    │
    │  TLS handshake: "I am Service A" (signed by internal CA)
    ▼
Service B (verifies against internal CA cert)
    │ Accepts only if cert is valid + subject matches expected CN
    ▼
Response returned
```

**AWS Implementation:** Use **AWS Private CA** + **ACM** to provision certs, and configure **Application Load Balancer mutual TLS** to enforce it at the network layer, no application code change.

---

# THU — Building a Production-Grade RAG Pipeline

## 1. RAG Architecture Overview

```
                          ┌─────────────────────────────┐
INGEST PATH               │     KNOWLEDGE BASE           │
                          │                              │
Raw Documents             │   Document Store (S3)        │
(PDF, DOCX, Web) ────────►│   ↓ Chunker                 │
                          │   ↓ Embeddings Model         │
                          │   ↓ Vector DB (ChromaDB/     │
                          │       FAISS/Pinecone)        │
                          └──────────────┬───────────────┘
                                         │ Indexed vectors
QUERY PATH                               │
                                         ▼
User Query ─────► Query Embedder ──► Vector Search (k-NN)
                                         │
                              ┌──────────┴──────────┐
                              │   Hybrid Retriever   │
                              │  (Vector + BM25)     │
                              └──────────┬──────────┘
                                         │ Top-k chunks
                                         ▼
                            ┌────────────────────────┐
                            │   Context Builder       │
                            │  (rerank + truncate)    │
                            └────────────┬───────────┘
                                         │ Prompt
                                         ▼
                              LLM (Claude / GPT-4o)
                                         │
                                         ▼
                              Grounded Answer + Sources
```

---

## 2. Semantic Text Chunking Strategies

### Why Chunking Matters

Vector DBs store fixed-size embeddings. If a chunk is too small, it loses context. Too large, the embedding averages over unrelated content, degrading retrieval precision.

### Strategy 1: Fixed-Size with Overlap (Baseline)

```python
def fixed_chunk(text, chunk_size=512, overlap=50):
    tokens = tokenizer.encode(text)
    chunks = []
    for i in range(0, len(tokens), chunk_size - overlap):
        chunk_tokens = tokens[i:i + chunk_size]
        chunks.append(tokenizer.decode(chunk_tokens))
    return chunks
```

**Use when:** Processing homogeneous documents (legal contracts, uniform articles).  
**Weakness:** Cuts mid-sentence. The overlap mitigates but doesn't eliminate this.

### Strategy 2: Recursive Character Splitting (LangChain Default)

```python
from langchain.text_splitter import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,      # characters
    chunk_overlap=200,
    separators=["\n\n", "\n", ". ", " ", ""],  # tries each in order
)

# Tries to split on paragraph breaks first, then sentences, then words
chunks = splitter.split_text(document_text)
```

**Why better:** Respects natural language boundaries. A paragraph break is a stronger semantic boundary than a mid-sentence split.

### Strategy 3: Semantic / Embedding-Based Splitting (Best Quality)

Split where the **embedding distance** between consecutive sentences spikes — a spike indicates a topic shift.

```python
from sentence_transformers import SentenceTransformer
import numpy as np

model = SentenceTransformer('all-MiniLM-L6-v2')

def semantic_chunk(text, threshold=0.3):
    sentences = text.split('. ')
    embeddings = model.encode(sentences)

    chunks = []
    current_chunk = [sentences[0]]

    for i in range(1, len(sentences)):
        # Cosine similarity between consecutive sentence embeddings
        sim = np.dot(embeddings[i-1], embeddings[i]) / (
            np.linalg.norm(embeddings[i-1]) * np.linalg.norm(embeddings[i])
        )
        cosine_distance = 1 - sim

        if cosine_distance > threshold:
            # Topic boundary detected — start a new chunk
            chunks.append('. '.join(current_chunk))
            current_chunk = []

        current_chunk.append(sentences[i])

    chunks.append('. '.join(current_chunk))
    return chunks
```

**Use when:** Documents mix topics (e.g., an annual report with financial + ESG + risk sections). Retrieval precision improves ~20–30%.

### Strategy 4: Hierarchical / Parent-Child Chunking

Store **large parent chunks** for context, but **index small child chunks** for precision.

```
Document
├── Section (parent, 2000 tokens)  ← stored in docstore
│   ├── Paragraph 1 (child, 200 tokens) ← indexed in vector DB
│   ├── Paragraph 2 (child, 200 tokens) ← indexed in vector DB
│   └── Paragraph 3 (child, 200 tokens) ← indexed in vector DB
```

```python
# Query retrieves small child chunk (precise match)
# Then fetches the parent chunk to give LLM full context
child_chunk = vector_db.similarity_search(query, k=5)
parent_chunk = doc_store.get(child_chunk.parent_id)
# LLM sees parent_chunk (rich context), not just child_chunk
```

**Use when:** Retrieval precision AND answer quality both matter (enterprise knowledge bases, RAG on documentation).

### Chunking Strategy Selection Matrix

| Document Type | Strategy | Chunk Size |
|---|---|---|
| Legal contracts (uniform) | Fixed + overlap | 512 tokens |
| Web articles, blogs | Recursive character | 1000 chars |
| Research papers, annual reports | Semantic splitting | Dynamic |
| Long manuals with sections | Hierarchical | Parent: 2000, Child: 200 |
| Code documentation | Language-aware (AST) | Per function/class |

---

## 3. Vector Database Routing — FAISS vs ChromaDB

### FAISS (Facebook AI Similarity Search)

FAISS is an **in-process C++ library** with Python bindings — it runs inside your process, no server needed.

```python
import faiss
import numpy as np

DIMENSION = 384  # all-MiniLM-L6-v2 output dimension

# Build an index (Flat L2 = exact search, no approximation)
index = faiss.IndexFlatL2(DIMENSION)

# For scale (>1M vectors) — use IVF + PQ (approximate, faster)
quantizer = faiss.IndexFlatL2(DIMENSION)
index = faiss.IndexIVFPQ(quantizer, DIMENSION, 
    nlist=1024,   # number of Voronoi cells
    m=8,          # number of sub-quantizers
    nbits=8       # bits per sub-quantizer
)
index.train(training_vectors)   # must train IVF indexes

# Add vectors
index.add(np.array(embeddings, dtype='float32'))

# Search — returns distances and indices
distances, indices = index.search(np.array([query_embedding], dtype='float32'), k=10)

# Persist to disk
faiss.write_index(index, 'knowledge_base.faiss')
index = faiss.read_index('knowledge_base.faiss')
```

**FAISS is ideal for:**
- Serverless / Lambda functions (no network hop to a vector DB)
- Batch offline indexing pipelines
- When you need sub-millisecond search on vectors that fit in memory (~10M vectors @ 384-dim ≈ 15GB RAM)

**FAISS limitation:** No metadata filtering, no persistence by itself, not horizontally scalable. You manage index sharding yourself.

### ChromaDB

ChromaDB is an **embedded vector DB with persistence, metadata filtering, and a server mode**.

```python
import chromadb
from chromadb.utils import embedding_functions

client = chromadb.PersistentClient(path="./chroma_db")

ef = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name="all-MiniLM-L6-v2"
)

collection = client.get_or_create_collection(
    name="enterprise_kb",
    embedding_function=ef,
    metadata={"hnsw:space": "cosine"}  # cosine similarity
)

# Upsert documents
collection.upsert(
    ids=["doc_1_chunk_3", "doc_2_chunk_1"],
    documents=["...chunk text...", "...chunk text..."],
    metadatas=[
        {"source": "policy_v3.pdf", "section": "HR", "date": "2024-01"},
        {"source": "handbook.pdf", "section": "Engineering", "date": "2024-03"}
    ]
)

# Query with metadata pre-filtering
results = collection.query(
    query_texts=["What is the remote work policy?"],
    n_results=5,
    where={"section": "HR"},              # metadata filter applied BEFORE vector search
    where_document={"$contains": "remote"} # keyword pre-filter
)
```

### Routing Decision

```
Volume < 500K vectors AND need fast dev iteration?
  └─► ChromaDB (embedded mode)

Volume > 5M vectors AND need distributed scale?
  └─► Pinecone (managed) or Weaviate (self-hosted)

Need in-process, ultra-low latency, custom sharding logic?
  └─► FAISS

Enterprise with strict data residency + metadata filtering?
  └─► Weaviate or Qdrant (self-hosted on EKS)

Multi-tenancy (isolate per org/user)?
  └─► Qdrant (native collection isolation) or Pinecone namespaces
```

---

## 4. Hybrid Search

Pure vector search misses exact keyword matches. Pure BM25 misses semantic similarity. Hybrid combines both.

### Architecture

```
User Query: "What is the deadline for GDPR breach notification?"
       │
       ├──► BM25 (keyword)  → matches "GDPR", "breach", "notification" (exact)
       │
       └──► Vector search   → matches "data breach reporting requirements" (semantic)
                │
                ▼
         Reciprocal Rank Fusion (RRF) — merge ranked lists
                │
                ▼
         Re-ranker model (cross-encoder) — score top-20 for final top-5
                │
                ▼
         Top 5 chunks → LLM context
```

### Reciprocal Rank Fusion Implementation

```python
def reciprocal_rank_fusion(rankings: list[list[str]], k=60) -> list[str]:
    """
    rankings: list of result lists from different retrievers
    k: smoothing constant (60 is standard)
    Returns: merged ranking by RRF score
    """
    scores = {}
    for ranking in rankings:
        for rank, doc_id in enumerate(ranking):
            if doc_id not in scores:
                scores[doc_id] = 0
            scores[doc_id] += 1 / (k + rank + 1)

    return sorted(scores.keys(), key=lambda x: scores[x], reverse=True)

# Usage
bm25_results = bm25_search(query)       # returns doc IDs by BM25 rank
vector_results = vector_search(query)   # returns doc IDs by cosine similarity

fused = reciprocal_rank_fusion([bm25_results, vector_results])
top_chunks = fetch_chunks(fused[:20])   # fetch top 20 for re-ranking

# Optional: cross-encoder re-ranking (more expensive but more accurate)
from sentence_transformers import CrossEncoder
reranker = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-6-v2')
scores = reranker.predict([(query, chunk.text) for chunk in top_chunks])
final_chunks = [chunk for _, chunk in sorted(zip(scores, top_chunks), reverse=True)][:5]
```

---

# FRI — LLM Token Throttle Limits & Exponential Backoff Queues

## 1. The Problem Space

Every LLM API (Claude, OpenAI, Cohere) has:
- **RPM (Requests Per Minute)** — e.g., Claude Sonnet: 1000 RPM on Tier 3
- **TPM (Tokens Per Minute)** — e.g., 80,000 input tokens/min
- **ITPM / OTPM** — input vs output token limits (output is more expensive)

At enterprise scale, a single event (marketing email blast, end-of-month report generation) creates a **spike of 500+ concurrent LLM calls**. Without a queue, 90% return HTTP 429 (Too Many Requests).

---

## 2. Exponential Backoff with Jitter

The naive fix (retry immediately) makes the problem worse — all retries land at the same time.

```js
// Node.js — production exponential backoff with full jitter
async function callWithBackoff(fn, options = {}) {
  const {
    maxRetries = 5,
    baseDelayMs = 1000,
    maxDelayMs = 32000,
    jitter = true,
  } = options;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isRateLimit = error.status === 429 || error.message.includes('rate_limit');
      const isRetryable = isRateLimit || error.status === 503 || error.status === 500;

      if (!isRetryable || attempt === maxRetries) throw error;

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s ...
      let delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);

      // Full jitter — spreads retries across the window
      if (jitter) delay = Math.random() * delay;

      // Respect Retry-After header if present (Claude API sends this)
      const retryAfter = error.headers?.['retry-after'];
      if (retryAfter) delay = Math.max(delay, parseInt(retryAfter) * 1000);

      console.log(`Rate limited. Retrying in ${Math.round(delay)}ms (attempt ${attempt + 1})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Usage
const response = await callWithBackoff(() =>
  anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  })
);
```

---

## 3. Token-Aware Request Queue (BullMQ + Redis)

For batch workloads (processing 10,000 documents overnight), use a **token-budget-aware queue** that paces requests to stay under TPM limits.

```
                     ┌──────────────────────────────────┐
Document Events      │   BullMQ Queue (Redis-backed)     │
(S3 upload, etc.) ──►│                                  │
                     │  Job: { docId, prompt, tokens }  │
                     │  Priority: HIGH / NORMAL / LOW    │
                     └──────────────────┬───────────────┘
                                        │
                              ┌─────────▼──────────┐
                              │  Token Rate Limiter │
                              │  (Redis Sliding     │
                              │   Window Counter)   │
                              └─────────┬──────────┘
                                        │ OK to proceed
                              ┌─────────▼──────────┐
                              │  Worker Pool        │
                              │  (N concurrent      │
                              │   workers)          │
                              └─────────┬──────────┘
                                        │
                              ┌─────────▼──────────┐
                              │  Claude / OpenAI    │
                              │  API               │
                              └────────────────────┘
```

### Token Rate Limiter (Redis Sliding Window)

```js
// Redis Lua script — atomic token consumption check
const consumeTokensScript = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])   -- 80000 tokens/min
  local tokens = tonumber(ARGV[2])  -- tokens this request needs
  local now = tonumber(ARGV[3])     -- current timestamp ms
  local window = tonumber(ARGV[4])  -- window size ms (60000)

  -- Remove expired entries
  redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

  -- Count tokens used in the current window
  local used = 0
  local entries = redis.call('ZRANGE', key, 0, -1, 'WITHSCORES')
  for i = 1, #entries, 2 do
    used = used + tonumber(entries[i])
  end

  if used + tokens > limit then
    return 0  -- reject
  end

  -- Record this request's token usage
  redis.call('ZADD', key, now, tokens .. ':' .. now)
  redis.call('EXPIRE', key, math.ceil(window / 1000) + 1)
  return 1  -- accept
`;

async function consumeTokenBudget(estimatedTokens) {
  const result = await redis.eval(
    consumeTokensScript, 1,
    'llm:token_budget',   // key
    80000,                // TPM limit
    estimatedTokens,      // tokens needed
    Date.now(),           // now
    60000                 // 60s window
  );
  return result === 1;
}
```

### BullMQ Worker with Token Awareness

```js
import { Worker, Queue } from 'bullmq';
import Anthropic from '@anthropic-ai/sdk';

const llmQueue = new Queue('llm-processing', { connection: redis });
const anthropic = new Anthropic();

const worker = new Worker('llm-processing', async (job) => {
  const { docId, prompt, estimatedTokens } = job.data;

  // Wait for token budget to be available
  let budgetAvailable = false;
  while (!budgetAvailable) {
    budgetAvailable = await consumeTokenBudget(estimatedTokens);
    if (!budgetAvailable) {
      await new Promise(r => setTimeout(r, 500)); // wait 500ms and retry
    }
  }

  // Call LLM with backoff
  const response = await callWithBackoff(() =>
    anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  );

  // Store result
  await saveResult(docId, response.content[0].text);
  return { docId, tokensUsed: response.usage.input_tokens + response.usage.output_tokens };

}, {
  connection: redis,
  concurrency: 5,          // 5 parallel workers
  limiter: {
    max: 20,               // max 20 jobs per interval
    duration: 1000,        // per second (RPM control)
  }
});

// Add jobs with priority
await llmQueue.add('process-doc', { docId: 'doc1', prompt: '...', estimatedTokens: 800 }, {
  priority: 1,             // 1 = high priority
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 }
});
```

---

## 4. Token Estimation Before API Call

Avoid surprise overages by estimating tokens before queuing.

```js
import Anthropic from '@anthropic-ai/sdk';

// Claude token counter (uses tiktoken-compatible counting)
function estimateTokens(text) {
  // Rule of thumb: 1 token ≈ 4 characters (English)
  // For production: use the official tokenizer
  return Math.ceil(text.length / 4);
}

// Better: use Anthropic's token counting endpoint
async function countTokensExact(prompt) {
  const response = await anthropic.messages.countTokens({
    model: 'claude-sonnet-4-20250514',
    messages: [{ role: 'user', content: prompt }]
  });
  return response.input_tokens;
}

// Truncate context to fit within budget
function truncateContext(chunks, maxContextTokens = 60000) {
  let totalTokens = 0;
  const selected = [];

  for (const chunk of chunks) {
    const tokens = estimateTokens(chunk.text);
    if (totalTokens + tokens > maxContextTokens) break;
    selected.push(chunk);
    totalTokens += tokens;
  }

  return selected;
}
```

---

## 5. Multi-Tenant Token Budget Management

In a SaaS product, different customers have different LLM quotas.

```js
// Per-tenant token budget (Redis)
async function consumeTenantBudget(tenantId, tokens) {
  const key = `tenant:${tenantId}:tokens:${getMonthKey()}`;
  const monthlyLimit = await getTenantPlan(tenantId); // e.g., 10M tokens/month for Enterprise

  const current = await redis.incrby(key, tokens);
  await redis.expire(key, 2678400); // expire in 31 days

  if (current > monthlyLimit) {
    await redis.decrby(key, tokens); // rollback
    throw new Error(`Tenant ${tenantId} monthly token quota exceeded`);
  }

  return { used: current, limit: monthlyLimit, remaining: monthlyLimit - current };
}
```

---

# WEEKEND CONSOLIDATION — System Diagram Notes

## Diagram 1: Global High-Concurrency MERN Portal

### Architecture Decisions to Articulate

```
GLOBAL USERS (50M MAU, 100K concurrent peak)
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                    TRAFFIC INGRESS                           │
│  Route 53 (GeoDNS) → nearest region                        │
│  CloudFront (CDN) → static assets, API caching             │
│  WAF → rate limiting, SQL injection, bot protection         │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────────┐
          ▼              ▼                  ▼
    ap-south-1     us-east-1           eu-west-1
    (India)        (US Primary)        (Europe)
          │              │                  │
          ▼              ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                  FRONTEND (React MFE)                        │
│  S3 + CloudFront → Shell App (Module Federation host)       │
│  MFEs: /home, /search, /cart, /checkout, /account          │
│  CDN cache: static = 1yr, data = 30s                        │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  API LAYER                                   │
│  ALB → Node.js/Express cluster (ECS Fargate, auto-scale)   │
│  Services: Product, Order, User, Search, Notification       │
│  Inter-service: REST (sync) / SQS (async event-driven)      │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────────┐
          ▼              ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌───────────────┐
│  Redis       │  │  MongoDB     │  │ Elasticsearch  │
│  Cluster     │  │  Atlas       │  │ (search/facets)│
│  (sessions,  │  │  (primary    │  │                │
│  cache, rate │  │   data store)│  │                │
│  limiting)   │  │  Global      │  └───────────────┘
└──────────────┘  │  Clusters +  │
                  │  Sharding    │
                  └──────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  ASYNC / EVENT-DRIVEN                        │
│  SQS → Lambda → Notifications (SES email, SNS push)        │
│  EventBridge → Order state machine (Step Functions)         │
│  Kinesis → Real-time analytics → Redshift                   │
└─────────────────────────────────────────────────────────────┘
```

### Key Numbers to Memorize for Interviews

| Component | Scale Target | Design Choice |
|---|---|---|
| CDN Cache Hit Rate | >95% for static | CloudFront + immutable hashed assets |
| API P99 latency | <200ms | Redis cache-aside + connection pooling |
| DB reads | 100K RPS | MongoDB read replicas + Redis cache |
| DB writes | 10K RPS | MongoDB primary (sharded by userId) |
| Concurrent WebSockets | 500K | Dedicated Socket.IO cluster + Redis pub/sub |
| MFE deploy frequency | 50x/day (per team) | Versioned remoteEntry.js + manifest service |

---

## Diagram 2: Enterprise Multi-Agent Automation Pipeline

```
TRIGGER SOURCES
  User Chat │  Scheduled │  Webhook (Jira/GitHub/Slack)
            │            │
            └─────┬──────┘
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              ORCHESTRATOR AGENT                              │
│  (Claude claude-sonnet-4-20250514 with tool use)            │
│                                                             │
│  Responsibilities:                                          │
│  • Parse intent and decompose into subtasks                 │
│  • Route subtasks to specialist agents                      │
│  • Aggregate results and handle failures                    │
│  • Maintain conversation state (DynamoDB)                   │
└────────────────────┬────────────────────────────────────────┘
                     │ spawns/delegates
     ┌───────────────┼───────────────────────┐
     ▼               ▼                       ▼
┌─────────┐   ┌───────────────┐   ┌────────────────────┐
│  RAG    │   │  Code Agent   │   │  Integration Agent │
│  Agent  │   │  (code gen,   │   │  (Jira, Salesforce,│
│         │   │   test, debug)│   │   GitHub, Slack)   │
│ Tools:  │   │               │   │                    │
│ •search │   │ Tools:        │   │ Tools:             │
│ •fetch  │   │ •code_exec    │   │ •jira_create_ticket│
│ •embed  │   │ •test_runner  │   │ •github_pr_review  │
└────┬────┘   └───────┬───────┘   └────────┬───────────┘
     │                │                    │
     ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                TOOL EXECUTION LAYER                          │
│  Each tool call goes through:                               │
│  1. Auth check (mTLS + JWT)                                 │
│  2. Rate limiter (per-agent token budget)                   │
│  3. Sandboxed execution (Lambda for code, VPC for APIs)     │
│  4. Result validation + schema check                        │
│  5. Audit log (CloudWatch + S3 Glacier)                     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              STATE & MEMORY LAYER                            │
│  Short-term: In-context (Claude's context window)           │
│  Mid-term: Redis (session, tool results, ~1hr)              │
│  Long-term: Vector DB (ChromaDB) — RAG memory               │
│  Persistent: DynamoDB (task history, agent decisions)       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│            HUMAN-IN-THE-LOOP CHECKPOINTS                    │
│  Risk Classifier → if risk_score > 0.7:                    │
│    → Pause pipeline                                         │
│    → Send Slack approval request                            │
│    → Wait for human decision (timeout: 4h → auto-reject)   │
│  Audit trail → every agent decision logged immutably        │
└─────────────────────────────────────────────────────────────┘
```

### Agent Failure Handling

```js
// Orchestrator handles subtask failures gracefully
async function runSubtask(agentType, task, context) {
  try {
    return await agents[agentType].run(task, context);
  } catch (error) {
    if (error.type === 'tool_use_failed') {
      // Retry with simplified task
      return await agents[agentType].run(simplify(task), context);
    }
    if (error.type === 'context_length_exceeded') {
      // Summarize context and retry
      const summarized = await summarizeContext(context);
      return await agents[agentType].run(task, summarized);
    }
    // Fallback: escalate to human
    await notifyHuman(task, error);
    return { status: 'escalated', reason: error.message };
  }
}
```

---

# 🎯 Interview Answer Frameworks

## "How would you design X at scale?" — Structure

```
1. CLARIFY (2 min)
   - What's the scale? (users, RPS, data volume)
   - What are the consistency requirements? (strong vs eventual)
   - Any compliance constraints? (GDPR, HIPAA, SOC 2)
   - Expected read/write ratio?

2. HIGH-LEVEL ARCHITECTURE (5 min)
   - Draw the components (CDN → LB → App → Cache → DB)
   - Identify the bottleneck first

3. DEEP DIVE on the hard parts (10 min)
   - Data model and sharding strategy
   - Caching strategy with TTL reasoning
   - Async vs sync trade-offs
   - Failure modes and mitigations

4. SCALE MATH (3 min)
   - "At 100K RPS, with 20% cache miss rate, that's 20K DB queries/sec..."
   - Show you think in numbers

5. TRADE-OFFS (2 min)
   - "We chose eventual consistency here to get 10x throughput..."
   - "We could have used X but chose Y because..."
```

---

## Key Trade-Off Tables

### Module Federation vs Shadow DOM

| Factor | Module Federation | Shadow DOM |
|---|---|---|
| Runtime code sharing | ✅ Native | ❌ Manual |
| CSS isolation | ⚠️ Requires CSS Modules | ✅ Native hard boundary |
| Framework agnostic | ⚠️ Webpack-centric | ✅ Web standard |
| Dev experience | ⚠️ Complex config | ✅ Browser APIs |
| Bundle deduplication | ✅ Shared scope | ❌ Each WC ships own deps |

### FAISS vs ChromaDB vs Pinecone

| Factor | FAISS | ChromaDB | Pinecone |
|---|---|---|---|
| Deployment | In-process | Embedded / Server | Managed SaaS |
| Metadata filtering | ❌ Manual | ✅ Native | ✅ Native |
| Scale | 10M vectors (RAM) | 1M vectors | 1B+ vectors |
| Cost | Free | Free | $$$ |
| Multi-tenancy | ❌ Manual | ⚠️ Collections | ✅ Namespaces |

---

# 📚 Reference: Essential Numbers

```
Redis GET/SET latency:        ~0.1–0.5ms (local network)
CloudFront edge latency:      ~5–15ms
MongoDB indexed query:        ~5–20ms
MongoDB full collection scan: ~100ms–10s (avoid in prod)

JWT verify (HS256):           ~0.5ms (CPU-bound, fast)
JWT verify (RS256):           ~3ms (asymmetric, slower but allows public key distribution)

FAISS exact search (1M vecs): ~10ms (CPU), ~1ms (GPU)
ChromaDB query (100K vecs):   ~20–50ms
Pinecone query (10M vecs):    ~20–100ms

Claude Sonnet input:          3$ per MTok (check current pricing)
Claude Sonnet output:         15$ per MTok (output is 5x more expensive — optimize output length)

Embedding model (MiniLM):     ~50ms per batch of 32 (CPU)
Embedding model (Ada-002):    API call ~100–300ms (includes network)
```

---

*Notes compiled for AI-Augmented MERN Lead / Architect interview prep — Week 2: System Design & Enterprise Scale*