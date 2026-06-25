# Mock Interview Review — MERN Lead / Architect (11+ YOE)

**Candidate:** Indrasis Datta
**Role targeted:** UI Lead / MERN & Generative AI Architect
**Format:** 7 main questions, each with live cross-questions, followed by a final evaluation.

> **How to read this doc:** For each question you'll find the main question, the follow-ups (cross-questions) I asked, a condensed version of what you answered, the mistakes worth fixing, and a model answer you can study. The last section lists every topic area to revise.

---

## Question 1 — Micro-frontend architecture

**Main question:** Walk through your Module Federation micro-frontend architecture — the composition model and why you chose it, and how independent teams shipped without breaking each other.

**Cross-questions:**
1. With `singleton: true`, what happened on version skew (remote on React 18.2 vs host on 18.3, or a major bump)? Did you pin `requiredVersion`/`strictVersion`?
2. You listed Tailwind among shared singletons — Tailwind is build-time CSS, not a runtime module. How did that actually work, and how did you avoid duplicated utility CSS / `@layer` collisions across remotes?

**What you answered (condensed):**
Host shell holds header/footer and embeds children by route; React, the VDS design system, and Tailwind shared as singletons; remotes lazy-loaded with Suspense. Pinned `requiredVersion`/`strictVersion` to the host, so React 18 child + React 19 host would break on `createRoot`/`hydrate` API differences; could keep two versions at the cost of bundle weight and complexity. Each child has its own Tailwind prefix to avoid collisions.

**Verdict:** Strong. Clean mental model and the right trade-off framing.

**Mistakes / what to tighten:**
- **Tailwind "singleton" was loosely stated.** A prefix prevents class *collisions*, but it does **not** dedupe the shipped CSS — each remote still emits its own utility layer. You only truly dedupe by extracting a shared, pre-built design-system stylesheet loaded once by the host.

**Model answer (what you could have said):**
> "We used Module Federation: one host owning the shell (routing, header, footer, auth) and remotes owning feature domains, each independently deployable. React, React-DOM, and our VDS component library were declared `shared` with `singleton: true` and `strictVersion: true`, pinned to the host's range — so a remote built against a mismatched React major would fail loudly at load rather than silently double-loading and breaking hooks/context. When a team genuinely couldn't upgrade in lockstep we allowed a second version, accepting the bundle cost as a temporary bridge. Tailwind is build-time, so it isn't a runtime singleton — each remote compiles its own utilities. We controlled that two ways: a `prefix` per remote to prevent class collisions, and a single shared pre-built design-token stylesheet loaded once by the host so the common layer wasn't duplicated. For `@layer` ordering we standardized the layer declaration order in a shared preset so remotes couldn't reorder each other's base/components/utilities."

---

## Question 2 — Performance & the JS runtime

**Main question:** Unpack "efficient memory management in complex event loops." Give a concrete perf problem: the symptom, which Core Web Vital it mapped to, what "memory management in event loops" actually meant, the tool you used, and the fix.

**Cross-questions:**
1. Your `Map` → `WeakMap` switch — what were the keys, were they actually becoming unreachable, and why was `WeakMap` *specifically* the fix rather than "we stopped adding to the map"?

**What you answered (condensed):**
Lighthouse in dev; `web-vitals` package logging p75 to Sentry in prod (LCP < 2.5s, INP, CLS < 0.1). SRE flagged a Node.js memory issue in Grafana/Prometheus; compared Chrome heap-snapshot deltas and found a `Map` of socket connection data growing unbounded and never cleared. Switched to `WeakMap`, nulled references, added `clearTimeout`.

**Verdict:** Decent. Good RUM setup; real leak story.

**Mistakes / what to tighten:**
- **Wrong INP threshold.** You said INP < 1s. INP "good" is **< 200ms**; 200–500ms is "needs improvement"; > 500ms is "poor." Know the three CWV numbers cold: LCP < 2.5s, INP < 200ms, CLS < 0.1.
- **WeakMap semantics were fuzzy at first.** You initially implied `WeakMap` itself frees memory. It doesn't free anything on its own — it only allows a value to be GC'd once its **key object** is unreachable everywhere else.
- **Frontend vs backend mismatch.** The resume bullet frames this as UI/Core Web Vitals work, but your story was a Node.js backend leak. Fine as a story, but be clear which layer you're talking about.

**Model answer (what you could have said):**
> "The leak was server-side. We kept per-connection metadata in a plain `Map` keyed by the socket object. A plain `Map` holds a **strong** reference to both key and value, so even after a socket closed and was dereferenced everywhere else, the `Map` kept the whole entry — and the heap — alive. Heap snapshots in Chrome DevTools (attached to Node via `--inspect`) showed the retained-size delta growing across snapshots, all rooted in that `Map`. The fix was a `WeakMap` keyed by the socket: once the connection closed and the socket object became unreachable elsewhere, the entry became eligible for GC automatically — no manual cleanup race. We also added `clearTimeout` for orphaned timers, which themselves pin closures in memory. `WeakMap` was the right tool *because* the keys naturally went out of scope at connection end; if we'd been keying by a string ID we'd have kept a plain `Map` plus an explicit `delete` on disconnect."

---

## Question 3 — RAG architecture

**Main question:** Take your most serious RAG system end to end: corpus (size, type, change rate), chunking + embedding + vector DB choice and why, and — most important — retrieval quality: how did you distinguish a *retrieval* failure from a *generation* failure, and what numbers proved retrieval was good?

**Cross-questions:**
1. How did you actually chunk 50–100MB PDFs? Size/overlap, and how did you handle tables / multi-column layouts?
2. If an agent said "the answer is wrong," how would you tell whether the right chunk was retrieved but ignored, vs never retrieved at all?

**What you answered (condensed):**
Support-agent lookup over product docs/terms tied to an order. PDFs ~50–100MB, changing ~monthly. Embedded with HuggingFace MiniLM, stored in FAISS on S3, top-k retrieval. Planned a hybrid pgvector/Postgres approach for metadata + keyword + semantic. Chunking via `RecursiveCharacterTextSplitter`, size 200 / overlap 20. Admitted: not sure about quality-measurement metrics or the retrieval-vs-generation debug fork.

**Verdict:** Weakest round — and the most important one for a "GenAI Architect" title.

**Mistakes / what to tighten:**
- **Conflated chunking with embedding.** "We used MiniLM for chunking and embedding" — MiniLM (`all-MiniLM-L6-v2`) is the **embedding** model; it turns text into vectors. Chunking is a separate, earlier step.
- **Chunk size too small.** `RecursiveCharacterTextSplitter` size 200 defaults to **200 characters** (~40–50 tokens). That fragments product terms across chunks. ~500–1000 tokens is more typical for docs like this.
- **No evaluation story.** You couldn't name a single retrieval metric or how you knew the system was good enough to ship. For an architect, this is the gap.
- **Couldn't articulate the debug fork.** This is the single most useful RAG-debugging move and should be reflexive.

**Model answer (what you could have said):**
> "Corpus: ~50–100MB of product docs and T&Cs, changing roughly monthly, so a scheduled re-index was fine — no streaming ingestion needed. Chunking came first: `RecursiveCharacterTextSplitter` at ~800 tokens with ~100-token overlap, splitting on headings/paragraphs so a single clause didn't straddle two chunks; for tables and multi-column PDFs I used a layout-aware parser (e.g. Unstructured / a PDF layout model) instead of naive text extraction, because column order gets scrambled otherwise. Then `all-MiniLM-L6-v2` for embeddings into FAISS, persisted to S3, top-k = 5.
> On quality, I separated **retrieval** from **generation**. For retrieval I built a small labelled set of question→gold-chunk pairs and tracked **recall@k** and **MRR** — did the correct chunk land in the top-k, and how high. For generation I tracked **faithfulness/groundedness** (is the answer supported by the retrieved context) and answer relevance, using an LLM-as-judge or RAGAS. The debug fork: when an answer was wrong I first checked whether the gold chunk was even in the retrieved top-k. If it *was* and the answer was still wrong → generation problem (prompt, context ordering, model). If it *wasn't* → retrieval problem (chunking, embedding model, k too low, no hybrid search). That single check tells you which half of the system to fix, and it's why I planned the move to pgvector hybrid search — keyword + semantic — to lift recall on exact-term queries like policy codes."

---

## Question 4 — State management architecture

**Main question:** You list both Redux and React Query everywhere. What's your dividing line — what lives where and why — and on the Verizon real-time dashboard, where did streaming data live so the two systems didn't fight?

**Cross-questions:**
1. React Query is request/response. How did *real-time* data get into it — polling, `setQueryData`, subscriptions?
2. At high update frequency, every cache write can re-render every subscriber. How did you prevent a render storm?

**What you answered (condensed):**
Redux for client global state (auth/`isLoggedIn`, user prefs, selected filters that carry across screens); React Query for server state (caching, background refetch, retry). Filters in Redux via `useSelector`, API results cached by React Query, and two components requesting the same endpoint shared one cached result. Initial load via REST, then a WebSocket with a cursor pushed only new/changed records; "invalidated queryClient" before updating; used `requestAnimationFrame` to batch events at ~60fps; chart repaint in `useLayoutEffect`.

**Verdict:** Strong on the dividing line and the rAF batching (a highlight). One real flaw.

**Mistakes / what to tighten:**
- **`invalidateQueries` was the wrong call for pushed data.** You already *received* the new record over the WebSocket. `invalidateQueries` marks the cache stale and triggers a **refetch** — a new network round-trip per message. At high frequency that's the exact storm you were avoiding. Correct move: `queryClient.setQueryData` to write the payload straight into the cache, zero network. (You conceded this — good.) Reserve `invalidateQueries` for when you genuinely need server reconciliation.
- **`useLayoutEffect` for chart repaint is debatable.** It runs synchronously *before* paint and blocks it — appropriate for measure-then-position to avoid flicker, but for heavy chart repaints it can *hurt* by blocking the frame. Default to `useEffect` / `requestAnimationFrame` unless you must measure layout first.

**Model answer (what you could have said):**
> "Rule of thumb: if the server owns the truth, it's React Query; if the client owns it, it's Redux. So auth flags, UI preferences, and cross-screen filter selections live in Redux; anything fetched — and its caching, dedup, retry, background refresh — lives in React Query. They don't fight because they own *different* data: filters in Redux are the *inputs*, and they're part of the React Query key, so changing a filter naturally produces a new query.
> For real-time: REST for the initial snapshot, then a WebSocket pushing deltas. I wrote those deltas **directly into the React Query cache with `setQueryData`** — no `invalidateQueries`, because I already had the data and didn't want a refetch per message. To stop render storms I coalesced incoming events in a `requestAnimationFrame` buffer so I committed at most one cache update per frame (~60fps) instead of one per message, and I used `select`/structural sharing so components only re-rendered when their slice actually changed. Charts repainted off the batched update; I'd reserve `useLayoutEffect` only for the case where I had to measure the DOM before painting to avoid a visible jump."

---

## Question 5 — Technical leadership & decision-making

**Main question:** A specific time you pushed a technical decision and got real pushback — the disagreement, how you handled it, and honestly: were you right?

**Cross-questions:**
1. Where's your line — when do you commit to a reasonable trade-off vs escalate because it'll cost you later? And a time you actually *held firm*.

**What you answered (condensed):**
Proposed SSE for the dashboard/notifications; was overruled toward WebSockets because they already existed in a module and were faster to implement. Agreed, given sprint bandwidth and limited developers. Reflected that SSE was architecturally cleaner since the UI only listened one-way; WebSockets suit bidirectional cases (chat, collab). When pushed for a decision rule and a hold-firm story, you re-stated the bandwidth reason.

**Verdict:** Mixed-to-weak — the thinnest dimension for an 11-YOE lead.

**Mistakes / what to tighten:**
- **Didn't answer the leadership question.** The story was "I proposed, was overruled, complied." That shows disagree-and-commit maturity (good) but not *leadership* — driving a contested call.
- **No decision framework.** At lead level you're expected to articulate when you flex vs when you fight.
- **No "hill I died on" story.** You need at least one prepared.

**Model answer (what you could have said):**
> "My rule: I flex on reversible, implementation-level decisions — two-way doors — and I hold firm on one-way doors: anything touching security, data integrity, auth, or a public contract that's expensive to unwind. The SSE-vs-WebSocket call was a two-way door — both worked, WebSockets were already there, and switching later would be cheap — so I committed and moved on. The one I *did* hold firm on: a team wanted to ship role-based access checks on the client only to hit a deadline. I escalated and refused, because that's a security one-way door — once it's in production and clients depend on the behavior, you can't quietly fix it, and a leaked privileged action is unrecoverable. I lost a sprint of goodwill but we moved the enforcement server-side. Three months later a pen test confirmed it — the client-only version would have failed. That's the difference: I spend capital on the decisions that are expensive or impossible to reverse, and I conserve it everywhere else."

*(Substitute your own real hold-firm example — the structure is: it was a one-way door → here's what I refused → here's the cost I paid → here's how it paid off.)*

---

## Question 6 — Agentic systems & MCP

**Main question:** Your Verizon "custom MCP servers" defect-automation engine. What tools/resources did the MCP server expose, how did the flow go from Jira ticket to MR, who decided what code to change, and what guardrails stopped the agent from confidently shipping garbage?

**Cross-questions:**
1. `PreToolUse`/`PostToolUse` are Claude Code *hooks*, not MCP server features. Separate them: what did your MCP *server* expose as tools, and where did the PII scrubbing actually live?

**What you answered (condensed):**
Initially described the "MCP server using PreTool/PostTool hooks" to strip PII before/after the LLM. Flow: a human enters a Jira ticket; the LLM analyzes the description (URLs, screenshots, Figma, Kibana stack traces → file/line), inspects the git repo, and proposes a fix. Guardrails: Husky pre-commit (unit + a11y tests), pre-push (prod build), SonarQube on the MR (code smells, security, vulnerabilities), a separate review agent commenting on the diff, and a human approving manually. On the cross-question, you clarified the custom MCP server was a **gateway** fronting the Jira/Figma/GitLab MCPs; the PII hook was a Copilot `PreToolUse` hook running locally in VS Code, and server-side automation on Jira events was still **planned**.

**Verdict:** Mixed. The guardrail layering was your single best moment; the concept confusion and the resume overstatement are the issues.

**Mistakes / what to tighten:**
- **Conflated MCP with Claude Code hooks.** An **MCP server** *exposes tools/resources/prompts* to a model. **`PreToolUse`/`PostToolUse`** are *client-side hooks* (Claude Code vocabulary specifically) that run around tool calls. Don't say "the MCP server used PreTool hooks."
- **Didn't name the tool surface initially.** When asked what the server exposed, you pivoted to PII handling. Lead with the tools: `fetch_jira_ticket`, `get_kibana_stacktrace`, `read_repo_file`, `create_gitlab_mr`, etc.
- **Tooling attribution slip.** You attributed `PreToolUse` to GitHub Copilot — that naming is Claude Code's. Keep tool/product attribution exact.
- **Resume overstates maturity.** The bullet says "automated the entire defect lifecycle … reducing remediation time by 50%" in finished past tense, but it's a locally-validated prototype with production rollout still planned. Soften the wording or volunteer that line before an interviewer corners you.

**Model answer (what you could have said):**
> "The custom MCP server was a **gateway**: instead of the host connecting to the Jira, Figma, and GitLab MCP servers separately, it connected once to ours, which federated their tools behind a single surface and added a PII-scrubbing layer in the middle. The tools it exposed were things like `fetch_jira_ticket`, `get_kibana_stacktrace` (parse the trace to a file + line), `read_repo_file`, and `create_gitlab_mr`. The agent loop read the ticket, resolved the failing file from the stack trace, read the surrounding code, proposed a patch, and opened an MR. Guardrails were defense-in-depth: Husky pre-commit ran unit + a11y tests, pre-push ran a prod build, SonarQube scanned the MR for smells and vulnerabilities, a separate review agent commented the diff against the original defect, and a **human gave final approval** — the agent never merged autonomously. The PII scrubbing was a *client-side hook* (a `PreToolUse`-style hook in our local agent setup), not part of the MCP server itself. Today it runs locally in VS Code and is validated; the next phase is triggering it server-side on Jira webhook events."

---

## Question 7 — Node.js under load

**Main question:** A service holding many WebSocket connections + REST + LLM/embedding calls hits a CPU-bound task. What happens to the other clients and *why* (given the event loop)? How do you architect around it? And horizontally behind a load balancer — what breaks with WebSockets and how do you fix it?

**What you answered (condensed):**
CPU-bound work on the main thread blocks everything — the call stack is full, nothing else runs; offload to a worker thread. Behind an LB, a socket opened on instance A but a later emit hitting instance B fails because B doesn't know the connection; sticky sessions fix routing but cause load imbalance, so for scale use Redis pub/sub (or Kafka) so instances publish/subscribe socket events.

**Verdict:** Strong. Correct instincts across the board.

**Mistakes / what to tighten:**
- **`worker_threads` ≠ libuv threadpool.** You said "offload to a worker thread so libuv handles it." libuv's threadpool auto-handles certain *native* async ops (fs, crypto, some zlib, DNS). Arbitrary CPU-bound **JavaScript** must go to a `worker_thread` yourself — libuv won't offload your JS for you.
- **Kafka is heavier than needed** for ephemeral socket fan-out; Redis pub/sub (e.g. socket.io's Redis adapter) is the standard fit. Mention Kafka only if you also need durability/replay.

**Model answer (what you could have said):**
> "Node runs your JavaScript on a single main thread, so a CPU-bound task there blocks the event loop entirely — pending REST requests queue, WebSocket messages aren't processed, timers don't fire — because nothing else can run until the call stack clears. libuv's threadpool handles *native* async I/O like fs and crypto behind the scenes, but it won't offload my own JS, so for CPU-bound JS — parsing, local embedding, heavy transforms — I move it to a `worker_thread` (or a separate job service / queue for anything substantial), keeping the event loop free to serve connections. Horizontally, the WebSocket problem is connection affinity: a socket lives in instance A's memory, so a message routed to instance B has no matching connection. Sticky sessions pin a client to one instance but skew load. The scalable fix is a **Redis pub/sub backplane** — socket.io's Redis adapter — so any instance can publish to a room and every instance with relevant sockets delivers it; the connection state stays local but the *messaging* is shared. I'd only reach for Kafka if I also needed durability or replay, which ephemeral socket fan-out doesn't."

---

## Areas to revise

Grouped by priority — top group is what's most likely to cost you offers.

### High priority (close these first)
1. **RAG evaluation & debugging** — retrieval metrics (recall@k, MRR), generation metrics (faithfulness/groundedness, answer relevance), RAGAS or LLM-as-judge, and the retrieve-vs-generate debug fork. This is non-negotiable for a GenAI-architect title.
2. **RAG ingestion fundamentals** — chunking strategies (recursive/semantic/layout-aware), token vs character sizing, sensible chunk/overlap defaults, table & multi-column PDF parsing, hybrid (keyword + semantic) search and when it matters.
3. **Leadership narrative** — a crisp flex-vs-hold-firm decision rule (two-way vs one-way doors) and one prepared "hill I died on" story with cost and payoff.

### Medium priority (precision gaps)
4. **MCP vs agent-client concepts** — MCP exposes tools/resources/prompts; hooks (`PreToolUse`/`PostToolUse`) are client-side and Claude-Code-specific. MCP gateway/aggregator pattern. Agentic guardrail design (you're already strong here — keep it).
5. **Core Web Vitals numbers** — LCP < 2.5s, **INP < 200ms**, CLS < 0.1, plus what each measures and the common culprits.
6. **JS memory model** — strong vs weak references, when `WeakMap`/`WeakRef` actually help, GC roots, reading heap-snapshot deltas.
7. **React Query for real-time** — `setQueryData` vs `invalidateQueries`, subscription patterns, `select`/structural sharing, render-storm mitigation.

### Lower priority (already solid — keep sharp)
8. **Node concurrency** — event-loop blocking, `worker_threads` vs libuv threadpool, queues/job services for heavy work.
9. **WebSocket horizontal scaling** — connection affinity, sticky sessions trade-offs, Redis pub/sub backplane (vs Kafka).
10. **Micro-frontends** — Module Federation `shared`/`singleton`/`strictVersion`, dual-version bridging, build-time CSS dedup vs collision prevention.
11. **Resume hygiene** — align past-tense impact claims (the 50% MCP automation) with what's actually in production; pre-empt the seam yourself.

---

*Strongest areas demonstrated: frontend architecture (micro-frontends, state management, render performance) and Node.js under load. Biggest leverage for your next interview: RAG evaluation rigor + leadership storytelling.*