# Pastebin System Design


## STEP 1: REQUIREMENTS

### Functional:
1) Paste text contents in textarea, optional expiry time and submit 
2) It saves the content and generates URL with unique identifier 
3) Allows to share URL with this id so that others can view it 

### Non-functional:
1) High availability
2) Low latency 
3) Read heavy system 
4) URL shouldn't be easily guessable e.g. Not /paste/1 /paste/2

**Back of the envelope estimation:** 
- Daily active pastes = 10M = 10^7 
- Writes per sec = 10^7 / 86400 (instead of 86400 ~ 100,000 ~10^^5 ) = 10^7 / 10^5 = 100 writes/sec
- Reads (100x) = 10,000 reads/sec
- Avg pastebin size = 10 KB. Daily storage = 10^7 * 10 KB = 10^8 KB = 100 GB / day 
- 5 year storage = 100 * 365 * 5 = 182.500 TB
(This is for permananent storage)

Pastebin default TTL = 2 days and users can set custom TTL even lesser 

Active storage = 100 GB / day * 2 = 200 GB


## STEP 2: API DESIGN 

### Create a Paste:
Request POST:
    `{ "content": "...", "expiry": 86400 }`

Response (201 created): 

    { 
        "pasteId": "aBxdA", 
        "url": "https://pastebin.com/aBxdA", 
        "expiresAt": "2026-09-22T03:30:45Z" 
    }

### Retrieve a Paste:
Request GET: `/api/v1/pastes/{pasteId}`

Response: 

    {
        "pasteId": "aBxdA",
        "content": ".....",
        "createdAt": "2026-09-20T03:30:45Z",
        "expiresAt": "2026-09-22T03:30:45Z"
    }

## STEP 3: DATA MODEL & STORAGE 

```
pasteId          P.K 
s3StorageKey
content 
createdAt
expiresAt 
```

- Metadata are stored in NoSQL DB
- Files are stored in Object storage (S3)

Acess is pure key look-up with no joins and read-heavy. So NoSQL key-value store (DynamoDB, Cassandra) fits naturally and scales horizontally. They also have native TTL, which solves the expiry cleanup for free.


## STEP 4: HIGH LEVEL ARCHITECTURE

1. Write operation:
- API asks KGS (Key gen) for unique short key
- writes the metadata row in NoSQL 
- dumps the contents to S3 object storage 

2. Read operation:
- Checks cache first. On hit, returns immediately 
- On miss, hits DB and verifies expiresAt > current timestamp. Updates cache and rerurns API response 
- Expired or missing - return 404 

## STEP 5: OPTIMIZATION

### 1. Key generation:
- Random base62: 7 char 62^7 = 3.5T combinations 
  insert if not exists, retry on rare collision 
  (No DB check needed for every insert as collision is very rare) 
- Key Generation Service (KGS): pre-generates keys offline into an unused_keys table and hands them out in blocks to app server
- Hash-based (MD5/SHA of content, take N chars): free dedup but identical paste collide into one URL

### 2. TTL & expiry:
 - NoSQL native TTL rather than a cron job to check and delete old records 
 - S3 life cycle policies to delete file 
 - During read, expiresAt is checked and returns 404 if it's expired content 

### 3. Caching & read scalability:
 - Cache eviction is not needed as pastes are immutable once written 
 - Cache-aside with LRU eviction on hot keys 
 - CDN cache with max-age <= TTL

### 4. Availability & consistency:

### 5. Security:
 - Rate limiting on writes 

-----------
 
```
                    [ Client / Browser ]
                              │
                              ▼
                   [ Cloudflare CDN / WAF ]  <--- Rate Limiting (Token Bucket)
                              │
                              ▼
                   [ API Gateway / ALB ]
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
       [ Read Service ]             [ Write Service ]
                │                           │
         ┌──────┴──────┐             ┌──────┴──────────────┐
         ▼             ▼             ▼                     ▼
   [ Redis Cache ] [ NoSQL DB ]   [ KGS Service ]   [ S3 Object Store ]
   (LRU Eviction)  (DynamoDB)      (Pre-gen Keys)     (Paste Bodies)
   ```



S3 pre-signed URL for upload 

How does KGS work?