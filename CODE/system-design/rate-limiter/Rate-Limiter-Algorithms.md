# Rate Limiter Algorithms — Cheatsheet + Detailed Examples

> All answer the same question: *"Is this request allowed?"*
> They differ in **memory, accuracy, and burst behavior**.
>
> **PART A** = quick-recall intuition (skim before an interview).
> **PART B** = detailed request-by-request traces (to actually understand *why*).
> Detailed traces use **limit = 3 requests / 60s** so you can compare them directly.

---

# PART A — Quick Recall

## Master Table
| Algorithm | Memory | Boundary spike | Bursts | Use when |
|---|---|---|---|---|
| Fixed window | O(1) | ❌ Yes (2×) | uncontrolled | Simplest / low stakes |
| Sliding window **log** | O(requests) | ✅ No | No | Need exactness, small key set |
| Sliding window **counter** | O(1) | ✅ Mostly | No | **Default prod choice** |
| **Token bucket** ⭐ | O(1) | ✅ No | ✅ Controlled | **APIs allowing bursts** |
| Leaky bucket | O(1) | ✅ No | ❌ Smooths | Steady downstream output |

## 30-second recall
- **Fixed window** = counter per minute (spikes at edges).
- **Sliding log** = every timestamp (exact but heavy).
- **Sliding counter** = 2 windows blended (the practical one).
- **Token bucket** = save tokens, spend per request (bursts OK). ⭐
- **Leaky bucket** = steady drip, overflow dropped (smooths bursts).

## Token vs Leaky (classic contrast)
- **Token bucket** = *"do I have a token now?"* → **allows bursts** up to capacity.
- **Leaky bucket** = queue drained at fixed rate → **forbids bursts**, output always smooth.

---

# PART B — Detailed Examples

## 1. Fixed Window Counter

**Rule:** Chop time into fixed 60s windows aligned to the clock. Each window has its own counter from 0. Increment per request; reject when it would exceed the limit; hard-reset at the next window.

**Stores:** one number per key → `{window: "10:00", count: 3}`

### Trace — normal sequence
```
Windows:  [10:00:00–10:00:59]   [10:01:00–10:01:59]

Time        Window   Counter   Decision
--------    ------   -------   --------
10:00:05    10:00      1       ✅ allow
10:00:18    10:00      2       ✅ allow
10:00:45    10:00      3       ✅ allow  (limit reached)
10:00:50    10:00      3       ❌ reject (would be 4)
--- new window → counter resets to 0 ---
10:01:02    10:01      1       ✅ allow
10:01:30    10:01      2       ✅ allow
```

### The flaw — boundary spike
Reset is hard, so a client can fire a full limit at the END of one window and another at the START of the next:
```
10:00:57    10:00      1       ✅
10:00:58    10:00      2       ✅
10:00:59    10:00      3       ✅   ← 3 requests in last 3s of window
--- reset ---
10:01:00    10:01      1       ✅
10:01:01    10:01      2       ✅
10:01:02    10:01      3       ✅   ← 3 more in first 3s of next window
```
**Result:** 6 requests in a 5-second span = **2× the intended "3 per 60s".**

---

## 2. Sliding Window Log

**Rule:** Store the **exact timestamp of every allowed request**. On each new request: drop timestamps older than 60s, count what remains, allow only if under the limit, then record the new timestamp. Window = "last 60s from now" → slides continuously, no reset.

**Stores:** a timestamp per request → heavy.

### Trace
```
Log starts empty: []

Time        Step                                          Log after              Decision
--------    ------------------------------------------    --------------------   --------
10:00:10    drop <09:59:10 (none), count=0 → add          [00:10]                ✅
10:00:30    drop <09:59:30 (none), count=1 → add          [00:10,00:30]          ✅
10:00:50    drop <09:59:50 (none), count=2 → add          [00:10,00:30,00:50]    ✅
10:00:55    drop <09:59:55 (none), count=3 → FULL         [00:10,00:30,00:50]    ❌ reject
10:01:11    drop <10:00:11 → removes 00:10, count=2 → add [00:30,00:50,01:11]    ✅
```
At **10:01:11**, timestamp `10:00:10` is now >60s old → ages out → frees a slot → new request allowed. The window slid forward smoothly.

### Defeats the boundary-spike attack
```
Time        Log within last 60s               Count   Decision
--------    ------------------------------    -----   --------
10:00:57    [00:57]                            1       ✅
10:00:58    [00:57,00:58]                      2       ✅
10:00:59    [00:57,00:58,00:59]                3       ✅  (full)
10:01:00    [00:57,00:58,00:59] all <60s old   3       ❌ reject
10:01:01    same 3 still in window             3       ❌ reject
10:01:02    same 3 still in window             3       ❌ reject
```
**Exactly 3 in any rolling 60s — no leak.** Cost = stored a timestamp per request (huge at scale).

---

## 3. Sliding Window Counter

**Rule:** Keep just **two numbers** — current window count + previous window count — and blend by overlap. Approximates the log at O(1) memory.

**Formula:**
```
estimated = current_count + previous_count × (1 − elapsed_fraction_of_current_window)
```

### Trace
```
Previous window (10:00) ended with count = 3. Now in window 10:01.

Time        Position (elapsed)   previous × weight        current   estimate            Decision
--------    -----------------    ---------------------    -------   -----------------   --------
10:01:15    25% (0.25)           3 × (1−0.25) = 2.25      0         2.25 + 0 = 2.25     ✅ → current=1
10:01:30    50% (0.50)           3 × (1−0.50) = 1.50      1         1.50 + 1 = 2.50     ✅ → current=2
10:01:36    60% (0.60)           3 × (1−0.60) = 1.20      2         1.20 + 2 = 3.20     ❌ reject (>3)
10:01:54    90% (0.90)           3 × (1−0.90) = 0.30      2         0.30 + 2 = 2.30     ✅ (previous fading)
```
**Intuition:** early in the new window the previous window still counts heavily; its influence fades linearly to 0. ~95% of the log's accuracy at O(1) memory → **most common in production**.

### Side-by-side on the boundary burst
| Moment | Fixed Window | Sliding Log | Sliding Counter |
|---|---|---|---|
| 3 requests at 10:00:57–59 | ✅✅✅ | ✅✅✅ | ✅✅✅ |
| 3 requests at 10:01:00–02 | ✅✅✅ **(leak!)** | ❌❌❌ | ❌ around the 3rd |
| Memory | 1 number | 1 ts/request | 2 numbers |

---

## 4. Token Bucket ⭐

**Rule:** A bucket **refills tokens at a steady rate**, up to a max capacity. Each request **spends 1 token**. Token available → allow; empty → reject. Unused tokens accumulate (up to cap) → lets you **burst**.

**Two knobs:** `refill rate` = sustained rate | `capacity` = max burst.
**Stores:** `{tokens, last_refill_ts}` → O(1). Refill computed lazily on each request.

### Trace (capacity = 3, refill = 1 token / 20s)
```
Start: bucket full = 3 tokens

Time        Refill since last            Tokens before   Request?   Tokens after   Decision
--------    -------------------------    -------------   --------   ------------   --------
10:00:00    —                            3               yes        2              ✅ (spend 1)
10:00:05    +0 (only 5s, <20s)           2               yes        1              ✅
10:00:10    +0                           1               yes        0              ✅  (burst of 3 used up)
10:00:12    +0                           0               yes        0              ❌ reject (empty)
10:00:30    +1 (20s passed since 10:10)  1               yes        0              ✅
10:01:20    +3 (70s → cap at 3)          3               yes        2              ✅ (refilled to cap, not 3.5)
```
Key points:
- **Burst:** first 3 requests fire instantly because tokens were saved up.
- **Refill is lazy + capped:** at 10:01:20, 70s elapsed = 3.5 tokens' worth, but it **caps at capacity (3)** — you can't hoard infinite tokens.
- Long-run average is held to the refill rate; short bursts up to capacity are allowed.

---

## 5. Leaky Bucket

**Rule:** A **queue draining at a constant rate** (bucket with a hole). Requests **fill** it on arrival (bursty, event-driven); they **leak** out on a fixed timer (steady). If full on arrival → **overflow = reject**.

- **Fill** = arrival-driven (unpredictable)
- **Leak** = fixed timer (constant)

**Stores:** queue length + last-leak time → O(1).

### Trace (capacity = 3, leak = 1 request / second)
```
Time    Event                       Bucket after       Result
-----   -------------------------   ---------------    --------------------------
0.0s    A arrives                   [A]                queued ✅
0.2s    B arrives                   [A B]              queued ✅
0.3s    C arrives                   [A B C] (full)     queued ✅
0.4s    D arrives                   [A B C]            ❌ reject (no room / overflow)
1.0s    leak timer fires            [B C]  → A sent    A processed
1.1s    E arrives                   [B C E]            queued ✅ (slot freed)
2.0s    leak timer fires            [C E]  → B sent    B processed
3.0s    leak timer fires            [E]    → C sent    C processed
```
Key points:
- **Fills are irregular** (0.0, 0.2, 0.3, 0.4, 1.1) — driven by when clients arrive.
- **Leaks are like clockwork** (1.0, 2.0, 3.0) — one per second regardless of input.
- D rejected purely because the bucket was **full at that instant** (overflow), not a rate calc.
- **Output is always a smooth 1/sec**, even though input was a burst → traffic shaping.

**Mental model:** a single ticket counter — people join the line whenever they arrive (fill), the clerk serves 1/sec (leak), waiting room fits 3 (overflow turns away the 4th).

---

## Token vs Leaky — the one contrast to remember
- **Token bucket** allows a **burst** (spend saved tokens at once), then throttles to refill rate.
- **Leaky bucket** never lets a burst through — output is a **constant drip**; overflow is dropped.
- Pick **token** for APIs (occasional spikes are fine). Pick **leaky** when the downstream needs a **smooth, steady** feed (e.g. a provider that accepts exactly N/sec).