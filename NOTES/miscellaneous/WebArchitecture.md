# Web Protocols & Security Notes

---

## Table of Contents

1. [HTTPS & TLS](#1-https--tls)
2. [HTTPS at a CDN — What is Hidden vs Exposed?](#2-https-at-a-cdn--what-is-hidden-vs-exposed)
3. [HTTP Fundamentals](#3-http-fundamentals)
4. [CORS & Preflight](#4-cors--preflight)
5. [CSRF & Cookie Security](#5-csrf--cookie-security)
6. [Authentication Flows](#6-authentication-flows)
7. [CDN Concepts](#7-cdn-concepts)
8. [Web Security Headers](#8-web-security-headers)
9. [Quick Reference Cheat Sheet](#9-quick-reference-cheat-sheet)

---

## 1. HTTPS & TLS

### What is HTTPS?
HTTPS = HTTP + TLS (Transport Layer Security). TLS is the successor to SSL (people still say "SSL" colloquially).

### TLS Handshake (Simplified)
```
Client                        Server
  |------- ClientHello -------->|   (TLS version, cipher suites, random bytes)
  |<------ ServerHello ---------|   (chosen cipher, server certificate)
  |<------ Certificate ---------|   (server's public key + CA signature)
  |--- Key Exchange (ECDHE) --->|   (agree on a shared secret)
  |<------- Finished -----------|
  |-------- Finished ---------->|
  |===== Encrypted Traffic ====>|
```

### What TLS Provides
| Property | Meaning |
|---|---|
| **Confidentiality** | Data is encrypted; no one in the middle can read it |
| **Integrity** | Data cannot be tampered with (MAC/AEAD) |
| **Authentication** | Server proves its identity via certificate |

### Certificate Chain of Trust
- Server cert is signed by an **Intermediate CA**, which is signed by a **Root CA**
- Root CAs are pre-installed in browsers/OS
- If any link in the chain is untrusted → browser shows security warning

---

## 2. HTTPS at a CDN — What is Hidden vs Exposed?

> **This was a direct interview question. Understand it deeply.**

### The Setup
```
User ──HTTPS──► CDN Edge Node ──HTTPS──► Origin Server
         TLS #1                   TLS #2
```
There are **two separate TLS connections**:
1. User ↔ CDN (TLS terminates at the CDN edge)
2. CDN ↔ Origin Server (new TLS connection, or sometimes HTTP internally)

### What is HIDDEN (encrypted) from the outside world
These are encrypted within the TLS tunnel and cannot be seen by a passive network observer (ISP, router, attacker doing a MITM):

| Hidden From Network | Why |
|---|---|
| **HTTP Headers** (Authorization, Cookie, Content-Type, etc.) | Inside TLS payload |
| **Request Body / POST data** | Inside TLS payload |
| **URL Path and Query String** (`/api/users?id=123`) | Inside TLS payload |
| **Response body** | Inside TLS payload |
| **Response headers** | Inside TLS payload |

### What is EXPOSED (visible) to the network
Even with HTTPS, some information leaks:

| Exposed | Why |
|---|---|
| **Destination IP address** | TCP/IP layer — below TLS |
| **Destination Port** (usually 443) | TCP/IP layer |
| **SNI (Server Name Indication)** | TLS ClientHello — sent in plaintext so the server knows which cert to present. The **domain name** (`api.example.com`) is visible here |
| **Approximate payload size** | Packet sizes are visible even if content is not |
| **Timing information** | How long requests take |
| **Certificate details** | Public info — sent during handshake |

> **Key takeaway**: HTTPS hides *content* but not *metadata*. The domain name leaks via SNI. With **Encrypted Client Hello (ECH)**, even SNI can be encrypted — this is a newer TLS 1.3 extension.

### What the CDN Can See
Because TLS terminates at the CDN:

- The CDN **decrypts your traffic** entirely — it sees everything: headers, cookies, body, path
- It re-encrypts for the request to origin
- This is called **TLS termination** or **SSL offloading**
- This is why you must **trust your CDN provider** (Cloudflare, Akamai, AWS CloudFront)

### Why CDNs Do TLS Termination
- Can inspect and cache content (can't cache encrypted data)
- Can apply WAF (Web Application Firewall) rules
- Can compress, modify headers, redirect
- Reduces TLS handshake latency for the end user (CDN is geographically closer)

### Summary Table

| Who Can See What | Network Observer | CDN | Origin Server |
|---|---|---|---|
| Domain name (SNI) | ✅ Yes | ✅ Yes | ✅ Yes |
| URL path/query | ❌ No | ✅ Yes | ✅ Yes |
| Headers (Cookie, Auth) | ❌ No | ✅ Yes | ✅ Yes |
| Request body | ❌ No | ✅ Yes | ✅ Yes |
| IP address | ✅ Yes | ✅ Yes | ❌ No (sees CDN IP) |

---

## 3. HTTP Fundamentals

### HTTP Request Structure
```
METHOD /path?query HTTP/1.1
Host: example.com
Header-Name: Header-Value

[optional body]
```

### HTTP Methods
| Method | Purpose | Has Body | Idempotent | Safe |
|---|---|---|---|---|
| GET | Retrieve resource | No | Yes | Yes |
| POST | Create/submit | Yes | No | No |
| PUT | Replace resource | Yes | Yes | No |
| PATCH | Partial update | Yes | No | No |
| DELETE | Remove resource | No | Yes | No |
| HEAD | GET without body | No | Yes | Yes |
| OPTIONS | Check allowed methods (used in CORS preflight) | No | Yes | Yes |

### Important HTTP Status Codes

**2xx — Success**
| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | Created (POST success) |
| 204 | No Content (DELETE success) |

**3xx — Redirection**
| Code | Meaning |
|---|---|
| 301 | Moved Permanently (update bookmarks) |
| 302 | Found (temporary redirect) |
| 304 | Not Modified (use cached version) |

**4xx — Client Error**
| Code | Meaning |
|---|---|
| 400 | Bad Request |
| 401 | Unauthorized (not authenticated) |
| 403 | Forbidden (authenticated but not allowed) |
| 404 | Not Found |
| 409 | Conflict |
| 422 | Unprocessable Entity (validation error) |
| 429 | Too Many Requests (rate limiting) |

**5xx — Server Error**
| Code | Meaning |
|---|---|
| 500 | Internal Server Error |
| 502 | Bad Gateway |
| 503 | Service Unavailable |
| 504 | Gateway Timeout |

### HTTP/1.1 vs HTTP/2 vs HTTP/3
| Feature | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transport | TCP | TCP | QUIC (UDP) |
| Multiplexing | No (head-of-line blocking) | Yes (streams) | Yes (improved) |
| Header compression | No | HPACK | QPACK |
| Server Push | No | Yes | Yes |
| TLS | Optional | Required (in practice) | Required |

---

## 4. CORS & Preflight

### What is CORS?
**Cross-Origin Resource Sharing** — a browser security mechanism that controls whether a web page can make requests to a **different origin** than the one it was loaded from.

**Origin = Protocol + Domain + Port**
- `https://app.example.com` ≠ `https://api.example.com` (different subdomain)
- `http://example.com` ≠ `https://example.com` (different protocol)
- `https://example.com:3000` ≠ `https://example.com:4000` (different port)

### Same-Origin Policy (SOP)
By default, browsers block cross-origin **reads** (AJAX/fetch). CORS is the mechanism to **relax** this restriction with server permission.

> Note: SOP blocks reading responses, not sending requests. This is why CSRF is still possible (see Section 5).

### CORS Flow — Simple Requests

A request is "simple" if it meets all these criteria:
- Method: GET, POST, or HEAD
- Content-Type: `text/plain`, `application/x-www-form-urlencoded`, or `multipart/form-data`
- No custom headers

```
Browser (app.example.com)          API (api.other.com)
        |
        |--- GET /data  ---------------------->|
        |    Origin: https://app.example.com   |
        |                                      |
        |<-- 200 OK  --------------------------|
        |    Access-Control-Allow-Origin: *    |
        |    (or the specific origin)          |
```

If the response does **not** include `Access-Control-Allow-Origin`, the browser **blocks** reading the response (even though the server did respond).

### Preflight Request — The Key Interview Question

> **Is it the OPTIONS request that is restricted, or the actual request?**

**Answer**: Neither the OPTIONS nor the actual request is "restricted" in the sense of being blocked outright. The OPTIONS preflight is a **browser-initiated safety check** sent before the actual request. The **actual request is what might be blocked** if the preflight fails or the CORS headers are missing/wrong.

Here's the exact flow:

```
Browser                                 Server
   |                                       |
   |-- OPTIONS /api/data ----------------->|   ← Preflight (automatic, browser-sent)
   |   Origin: https://app.example.com     |
   |   Access-Control-Request-Method: POST |
   |   Access-Control-Request-Headers: Authorization, Content-Type
   |                                       |
   |<-- 204 No Content --------------------|   ← Server responds to preflight
   |   Access-Control-Allow-Origin: https://app.example.com
   |   Access-Control-Allow-Methods: POST, GET, OPTIONS
   |   Access-Control-Allow-Headers: Authorization, Content-Type
   |   Access-Control-Max-Age: 86400       |   ← Cache preflight for 24 hours
   |                                       |
   |-- POST /api/data (actual request) --->|   ← Only sent if preflight approved
   |   Authorization: Bearer <token>       |
   |   Content-Type: application/json      |
   |                                       |
   |<-- 200 OK -----------------------------|
```

**When is a preflight triggered?**
A preflight is required when the request is NOT a "simple request":
- Method is PUT, DELETE, PATCH, or custom
- Content-Type is `application/json` (most API calls!)
- Custom headers are present (e.g., `Authorization`, `X-Custom-Header`)

**What happens if preflight fails?**
- The browser **never sends the actual request**
- The developer sees a CORS error in the console
- The server never sees the actual request (so no data mutation happens)

### CORS Response Headers (Server Must Set These)
| Header | Purpose |
|---|---|
| `Access-Control-Allow-Origin` | Which origins are allowed (`*` or specific) |
| `Access-Control-Allow-Methods` | Allowed HTTP methods |
| `Access-Control-Allow-Headers` | Allowed request headers |
| `Access-Control-Allow-Credentials` | Allow cookies/auth headers (cannot use `*` with this) |
| `Access-Control-Max-Age` | Cache preflight response (seconds) |
| `Access-Control-Expose-Headers` | Which response headers the browser can read |

### Express.js CORS Setup (MERN context)
```javascript
const cors = require('cors');

app.use(cors({
  origin: ['https://app.example.com', 'https://www.example.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,       // Allow cookies
  maxAge: 86400            // Cache preflight 24 hours
}));

// Important: handle OPTIONS explicitly for preflight
app.options('*', cors());
```

---

## 5. CSRF & Cookie Security

### What is CSRF?
**Cross-Site Request Forgery** — an attack where a malicious website tricks the user's browser into making an **authenticated request** to another site.

**Why it works**: Browsers automatically attach cookies to requests, even cross-origin ones. The Same-Origin Policy blocks reading responses but not sending requests.

### Attack Example
```
1. User logs in to bank.com — gets session cookie
2. User visits evil.com
3. evil.com has hidden: <img src="https://bank.com/transfer?to=attacker&amount=5000">
4. Browser sends request to bank.com WITH the session cookie attached
5. Bank processes the transfer
```

### How to Prevent CSRF in Cookies

#### Method 1: SameSite Cookie Attribute (Modern — Recommended)
```http
Set-Cookie: session=abc123; SameSite=Strict; Secure; HttpOnly
Set-Cookie: session=abc123; SameSite=Lax; Secure; HttpOnly
```

| SameSite Value | Behavior |
|---|---|
| `Strict` | Cookie never sent on cross-site requests (most secure, can break OAuth flows) |
| `Lax` | Cookie sent on top-level navigation (clicking a link) but NOT on cross-site sub-requests (AJAX, img, iframe). **Default in modern browsers** |
| `None` | Always sent, but **must** be paired with `Secure` |

**`Lax` is the practical sweet spot** — protects against CSRF while allowing normal link navigation.

#### Method 2: CSRF Token (Double Submit / Synchronizer Token)
```
Server generates a random token → stores in session
Server sends token in form/header
Client must include token in every state-changing request
Server validates token on every POST/PUT/DELETE
```

**Double Submit Cookie Pattern** (stateless):
```javascript
// Server: set a CSRF token in a readable cookie (NOT HttpOnly)
res.cookie('csrf-token', generateToken(), { SameSite: 'Strict', Secure: true });

// Client: read the cookie and send it as a header
const csrfToken = getCookie('csrf-token');
fetch('/api/transfer', {
  method: 'POST',
  headers: { 'X-CSRF-Token': csrfToken },
  credentials: 'include'
});

// Server: verify the header matches the cookie
if (req.headers['x-csrf-token'] !== req.cookies['csrf-token']) {
  return res.status(403).send('CSRF token mismatch');
}
```
An attacker from evil.com cannot read your cookies (SOP), so they can't set the correct header.

#### Method 3: Origin/Referer Header Validation
```javascript
app.use((req, res, next) => {
  const origin = req.headers.origin || req.headers.referer;
  if (origin && !origin.startsWith('https://app.example.com')) {
    return res.status(403).send('CSRF detected');
  }
  next();
});
```

### Cookie Security Attributes
```http
Set-Cookie: session=abc123;
  HttpOnly;          // JS cannot access (protects from XSS stealing cookies)
  Secure;            // Only sent over HTTPS
  SameSite=Lax;      // CSRF protection
  Path=/;            // Available to all paths
  Domain=.example.com; // Available to subdomains
  Max-Age=3600       // Expires in 1 hour
```

| Attribute | What it Prevents |
|---|---|
| `HttpOnly` | XSS stealing cookies via `document.cookie` |
| `Secure` | Cookie sent over plain HTTP (MITM) |
| `SameSite=Lax/Strict` | CSRF attacks |

### CSRF vs XSS
| | CSRF | XSS |
|---|---|---|
| **What** | Tricks browser into making requests | Injects malicious scripts into page |
| **Target** | The server (using user's identity) | The user's browser/data |
| **Countermeasure** | SameSite cookies, CSRF tokens | CSP, output encoding, HttpOnly |

---

## 6. Authentication Flows

### Session-Based Authentication
```
1. User submits credentials
2. Server validates → creates session in DB → sends session ID in cookie
3. Every request: browser sends cookie → server looks up session in DB
4. Logout: server deletes session
```
- Stateful (server must store sessions)
- Easy to invalidate
- Scales poorly without shared session store (Redis)

### JWT (JSON Web Token) Authentication
```
Header.Payload.Signature
eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

**JWT Structure:**
- **Header**: `{ "alg": "HS256", "typ": "JWT" }` (base64url encoded)
- **Payload**: `{ "userId": "123", "role": "admin", "exp": 1716000000 }` (base64url encoded, NOT encrypted)
- **Signature**: `HMACSHA256(header + "." + payload, secret)`

**JWT is stateless** — server doesn't store anything. Validates by re-computing the signature.

```
Client                    Server
  |--- POST /login --------->|
  |<-- { token: "eyJ..." } --|
  |                           |
  |--- GET /profile ----------|
  |    Authorization: Bearer eyJ...
  |<-- 200 { user data } -----|
```

**JWT Storage Options:**
| Storage | XSS Risk | CSRF Risk | Notes |
|---|---|---|---|
| `localStorage` | High (JS accessible) | Low (must set header manually) | Not recommended |
| `sessionStorage` | High | Low | Not recommended |
| `HttpOnly Cookie` | Low (JS cannot read) | Medium (use SameSite) | **Recommended** |
| Memory (JS variable) | Low | Low | Lost on refresh |

### OAuth 2.0 / Authorization Code Flow
```
User → App → Authorization Server → User grants permission
         ← Authorization Code ←
App → Authorization Server (code + client secret)
    ← Access Token + Refresh Token ←
App → Resource Server (Access Token)
    ← Protected Resource ←
```

Key terms:
- **Access Token**: Short-lived (minutes-hours), used to access API
- **Refresh Token**: Long-lived (days-weeks), used to get new access tokens
- **PKCE** (Proof Key for Code Exchange): Prevents auth code interception for public clients (SPAs, mobile)

---

## 7. CDN Concepts

### What is a CDN?
A **Content Delivery Network** is a globally distributed network of servers (PoPs — Points of Presence) that cache and serve content from a location geographically close to the user.

### How CDNs Reduce Latency
```
Without CDN:
User (Mumbai) ────────────────────────── Origin (US East) = ~200ms RTT

With CDN:
User (Mumbai) ──── CDN Edge (Mumbai) ── Origin (US East)
               ~5ms RTT (cached)        (only on cache miss)
```

1. **Geographic proximity**: CDN edge node is near the user → fewer hops → lower RTT
2. **TCP connection reuse**: CDN keeps persistent connections to origin
3. **TLS termination at edge**: TLS handshake happens at the nearby CDN node (not origin)
4. **Caching**: Static assets (images, JS, CSS) served from cache → origin not hit at all

### Cache-Control Headers (CDN & Browser)
```http
Cache-Control: public, max-age=31536000, immutable     # Static assets (1 year)
Cache-Control: public, max-age=3600                    # Semi-static (1 hour)
Cache-Control: no-cache                                # Revalidate before using
Cache-Control: no-store                                # Never cache (sensitive data)
Cache-Control: private                                 # Browser can cache, CDN cannot
```

| Directive | Meaning |
|---|---|
| `public` | Can be cached by CDN/proxies |
| `private` | Browser only, not CDN |
| `max-age=N` | Fresh for N seconds |
| `s-maxage=N` | CDN-specific max-age (overrides max-age for CDN) |
| `no-cache` | Must revalidate (ETag/Last-Modified) before using |
| `no-store` | Never store anywhere |
| `immutable` | Content will never change (safe for hashed filenames) |

### Cache Invalidation
- **URL fingerprinting** (best): `app.3f4a9b.js` — new hash on every build, cached forever
- **Purge API**: Programmatically tell CDN to clear a path
- **TTL expiry**: Wait for `max-age` to pass

### CDN and Dynamic vs Static Content
| Content Type | CDN Caching |
|---|---|
| Images, JS, CSS, fonts | ✅ Cache aggressively |
| HTML (if not personalized) | ✅ Short TTL or stale-while-revalidate |
| API responses (public data) | ✅ With appropriate TTL |
| Authenticated API responses | ❌ Do not cache (private data) |
| Session data | ❌ Never cache |

### CDN Additional Features
- **DDoS protection**: Absorbs traffic at edge before it reaches origin
- **WAF (Web Application Firewall)**: Block malicious requests (SQLi, XSS patterns)
- **Image optimization**: Resize, convert to WebP on the fly
- **Edge computing**: Run JS at the edge (Cloudflare Workers, Vercel Edge Functions)
- **Load balancing**: Distribute traffic across multiple origins

---

## 8. Web Security Headers

### Essential Security Headers

```http
# Prevent clickjacking (embedding in iframes)
X-Frame-Options: DENY
# or modern equivalent:
Content-Security-Policy: frame-ancestors 'none'

# Prevent MIME type sniffing
X-Content-Type-Options: nosniff

# Force HTTPS (HSTS)
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload

# Control browser features
Permissions-Policy: camera=(), microphone=(), geolocation=()

# Referrer information control
Referrer-Policy: strict-origin-when-cross-origin

# Content Security Policy (prevent XSS)
Content-Security-Policy: default-src 'self'; script-src 'self' https://trusted.cdn.com
```

### Content Security Policy (CSP)
CSP tells the browser which sources are valid for each type of content.

```http
Content-Security-Policy:
  default-src 'self';                           # Fallback for everything
  script-src 'self' https://cdn.example.com;    # JS sources
  style-src 'self' 'unsafe-inline';             # CSS (unsafe-inline needed for some frameworks)
  img-src 'self' data: https:;                  # Images
  connect-src 'self' https://api.example.com;   # Fetch/XHR targets
  font-src 'self' https://fonts.gstatic.com;    # Fonts
  frame-src 'none';                             # No iframes
  report-uri /csp-violation-report;             # Report violations
```

---

## 9. Quick Reference Cheat Sheet

### HTTPS at a CDN — Interview Answer
> "There are two TLS connections. The first is between the user and the CDN edge, and the second is between CDN and origin. The CDN **terminates TLS**, meaning it decrypts your traffic to cache/inspect it, then re-encrypts it to origin.
>
> **Hidden from network observers**: URL path, query string, all headers (cookies, Authorization), and body — all inside the TLS tunnel.
>
> **Exposed**: The destination IP address, port, and the **domain name via SNI** (Server Name Indication in the TLS ClientHello — sent in plaintext). So a network observer can see *who* you're talking to but not *what* you're saying.
>
> The CDN itself sees everything since it terminates TLS — that's why you must trust your CDN provider."

### Preflight in CORS — Interview Answer
> "A preflight is an automatic **OPTIONS request** that the browser sends *before* a non-simple cross-origin request (e.g., a POST with `Content-Type: application/json` or any request with custom headers like `Authorization`).
>
> The OPTIONS request itself is not restricted — the server should respond to it with the appropriate `Access-Control-Allow-*` headers. If the server's response doesn't grant permission, **the browser blocks the actual request** from ever being sent — the real POST/PUT/DELETE never reaches the server.
>
> So to directly answer: neither the OPTIONS nor the actual request is 'restricted' — OPTIONS is a check, and the actual request is what gets blocked if the check fails."

### Prevent CSRF in Cookies — Interview Answer
> "The most modern and effective approach is the **`SameSite` cookie attribute**. Setting `SameSite=Lax` (the browser default now) prevents the cookie from being sent on cross-site sub-requests like AJAX calls or image loads, while still allowing it on top-level navigations. `SameSite=Strict` is even more restrictive.
>
> For older browsers or defense-in-depth, use a **CSRF token**: the server generates a random token, the client reads it (from a non-HttpOnly cookie or response body) and sends it back as a custom header. An attacker's site can't read your cookies due to the Same-Origin Policy, so they can't forge the header.
>
> Combine `SameSite=Lax` with `HttpOnly` and `Secure` for full cookie hardening."

---

### Summary: Cookie Security Flags
```
Secure     → HTTPS only
HttpOnly   → No JS access (blocks XSS theft)
SameSite   → Controls cross-site sending (blocks CSRF)
```

### Summary: CORS Preflight Trigger Conditions
A preflight is NOT needed for:
- GET/HEAD/POST with simple content types and no custom headers

A preflight IS needed for:
- Any PUT, DELETE, PATCH
- POST with `Content-Type: application/json`
- Any request with `Authorization` or other custom headers

### Summary: What CDN Hides/Exposes
```
Network observer sees:  IP, port, domain (SNI)
Network observer misses: path, query, headers, body
CDN sees:               EVERYTHING (it terminates TLS)
Origin server sees:     Everything (from CDN), but user's real IP may be CDN IP
                        (use X-Forwarded-For header to get real IP)
```
