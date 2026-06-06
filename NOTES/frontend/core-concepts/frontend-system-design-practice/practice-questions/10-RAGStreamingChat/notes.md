# FE System Design — RAG Streaming Chat UI

> Resume project: **Cognizant Verizon (current)** — production RAG applications, text-streaming via WebSockets, complex async state with TanStack Query, sub-second model responses.
>
> Cross-link: [Real-Time Dashboard](../6-RealTimeDashboard/notes.md) · [TanStack Query](../../../react/tanstack-query.txt) · [React advanced topics](../../../react/advanced-topics.md) · [Node AI](../../../../../backend/nodejs/Node_AI.md) · [MCP Transport](../../../../../backend/nodejs/MCP_Transport.md)

---

## 1. Problem statement

Design the frontend for a production-grade RAG-powered chat experience:

- User types a question → assistant streams a response token-by-token
- Streaming uses Server-Sent Events (SSE) or WebSocket
- Conversation history persists; user can scroll back through 1000+ messages
- Assistant responses may include:
  - Streaming markdown (code blocks, lists, tables)
  - **Tool calls** to MCP servers (search Jira, fetch GitLab MR, query DB)
  - **Citations** to retrieved documents
  - Multi-step reasoning (interim thoughts visible)
- User can **stop** generation mid-stream
- User can **regenerate** / edit a previous prompt
- File / image uploads as inputs (multimodal)
- Operate against latency budgets (first token < 1s, complete response variable)

---

## 2. Requirements

### 2.1 Functional

- Compose box with multiline + submit on Enter (Shift+Enter = newline)
- Streaming response visible token-by-token
- Stop button cancels in-flight generation cleanly
- Conversation history virtualized (1000+ messages)
- Markdown rendering progressively as tokens arrive
- Code blocks with syntax highlighting + copy button
- Tool call UI — show tool name, args, partial result, final result
- Citations as links to source docs
- Edit previous prompt → regenerate from that point
- Export conversation (JSON / markdown)
- New chat / chat list / rename / delete chat

### 2.2 Non-functional

- **First token visible:** < 1s p95
- **Smooth streaming:** no jank during high token rate
- **Reliability:** survives WS/SSE disconnects mid-stream (resume or restart cleanly)
- **Accessibility:** live region for streaming announcements; keyboard navigable
- **Memory:** conversation list with 100 chats × 100 msgs avg shouldn't exhaust
- **Security:** sanitize markdown (no XSS), CSP, secure tool-call display

---

## 3. High-level architecture

```
              ┌──── Browser ─────────────────────────────────────┐
              │                                                  │
              │   ┌──────────────────────────────────────────┐   │
              │   │  Conversation View                        │   │
              │   │  ┌──────────────┐  ┌─────────────────┐   │   │
              │   │  │ Sidebar      │  │ Message Stream  │   │   │
              │   │  │ (chat list)  │  │ (virtualized)   │   │   │
              │   │  └──────────────┘  │ ┌─────────────┐ │   │   │
              │   │                    │ │ User msg    │ │   │   │
              │   │                    │ │ Assistant msg│ │   │   │
              │   │                    │ │ Tool call    │ │   │   │
              │   │                    │ │ Citation     │ │   │   │
              │   │                    │ └─────────────┘ │   │   │
              │   │                    │ Compose box     │   │   │
              │   │                    └─────────────────┘   │   │
              │   └──────────────────────────────────────────┘   │
              │   ┌──────────────────────────────────────────┐   │
              │   │  State                                    │   │
              │   │  - TanStack Query: chats, history          │   │
              │   │  - Stream client: current SSE/WS handle    │   │
              │   │  - Message store (per-message append)      │   │
              │   └──────────────────────────────────────────┘   │
              └──────────────────────────────────────────────────┘
                                  ↑
                                  │ SSE / WS
                                  │
                        ┌─────────┴──────────┐
                        │  Chat API           │
                        │  (Node + LangChain) │
                        └──────────┬──────────┘
                                   │
                       ┌───────────┼─────────────┐
                       │           │             │
                  ┌────▼────┐  ┌───▼────┐  ┌─────▼────┐
                  │ LLM     │  │ Vector │  │  MCP     │
                  │ (Claude)│  │  DB    │  │  servers │
                  └─────────┘  └────────┘  └──────────┘
```

---

## 4. Transport — SSE vs WebSocket

| Property | SSE | WebSocket |
|----------|-----|-----------|
| Direction | server → client only | bidirectional |
| Protocol | HTTP/1.1 + 2 | WS (over TCP, sometimes via HTTP/1.1 upgrade) |
| Auto reconnect | Browser built-in | Implement yourself |
| Proxy-friendly | Yes (HTTP) | Sometimes problematic |
| Browser auth | Cookies sent automatically; headers via `EventSource` require `withCredentials` polyfill | Cookies sent on handshake; harder to set custom headers |
| Multiplex per origin | 6 connections (HTTP/1.1); unlimited on HTTP/2 | One per channel; can multiplex protocol-level |
| Backpressure | HTTP built-in | Manual |
| Browser support | All modern | All modern |
| Cancellation | `EventSource.close()` | `WebSocket.close()` |

**For chat streaming, SSE is the right default.** Reasons:
- Streams are server→client only (no client-side messages mid-stream)
- HTTP/2 handles connection multiplexing — no 6-conn limit problem
- Built-in reconnect with Last-Event-ID
- Easier to operate (no special LB / proxy config)
- Cleaner debug story (responses visible in DevTools Network panel)

**Choose WebSocket when:**
- You need true bidirectional protocol (cancel inflight from client; client sends interactions mid-stream)
- You're already on a WS stack
- Verizon's existing infra used WS — that determined our choice on the resume project

### 4.1 SSE client

```ts
const ev = new EventSource(`/api/chat/stream?conversationId=${id}`);

ev.onmessage = (e) => {
  const event = JSON.parse(e.data);
  handleEvent(event);
};
ev.onerror = (e) => {
  console.warn("SSE error", e);
  // EventSource auto-retries by default; observe readyState
};
ev.addEventListener("done", () => ev.close());
```

But standard `EventSource` doesn't support POST (only GET). For chat, you usually POST the prompt. Use `fetch` + `ReadableStream`:

```ts
async function startStream(payload, onEvent, signal) {
  const resp = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!resp.ok || !resp.body) throw new Error("Stream failed");

  const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = parseSSEBlock(block);    // -> { event, data }
      onEvent(event);
    }
  }
}

function parseSSEBlock(block) {
  const lines = block.split("\n");
  let event = "message", data = "";
  for (const l of lines) {
    if (l.startsWith("event:")) event = l.slice(6).trim();
    else if (l.startsWith("data:"))  data += l.slice(5).trim();
  }
  return { event, data: data ? JSON.parse(data) : null };
}
```

`AbortController` cancels the stream:

```ts
const controller = new AbortController();
startStream(payload, handleEvent, controller.signal);
// On Stop button:
controller.abort();
```

---

## 5. Event types — typed stream protocol

```ts
type StreamEvent =
  | { type: "token";       text: string }
  | { type: "tool_start";  toolCallId: string; toolName: string; args: any }
  | { type: "tool_result"; toolCallId: string; result: any }
  | { type: "citation";    citationId: string; doc: { title: string; url: string; snippet: string } }
  | { type: "thinking";    text: string }      // interim reasoning
  | { type: "error";       message: string; code?: string }
  | { type: "done";        finishReason: "stop" | "length" | "tool_call" | "stopped" }
  ;
```

Discriminated union — perfect for exhaustive handling. See [TypeScript advanced § 7](../../typescript-advanced.md#7-discriminated-unions--the-workhorse-pattern).

```ts
function handleEvent(e: StreamEvent) {
  switch (e.type) {
    case "token":       messageStore.appendToken(currentMsgId, e.text); break;
    case "tool_start":  messageStore.addToolCall(currentMsgId, e); break;
    case "tool_result": messageStore.updateToolCall(currentMsgId, e.toolCallId, e.result); break;
    case "citation":    messageStore.addCitation(currentMsgId, e); break;
    case "thinking":    messageStore.setThinking(currentMsgId, e.text); break;
    case "error":       messageStore.setError(currentMsgId, e); break;
    case "done":        messageStore.finish(currentMsgId, e.finishReason); break;
  }
}
```

---

## 6. Message store — appending tokens efficiently

Naive: re-render the entire message tree on every token = O(N) per token. For 1000 tokens, O(N²) total.

### 6.1 Per-message external store

```ts
class MessageStore {
  private messages = new Map<string, Message>();
  private listeners = new Map<string, Set<() => void>>();

  appendToken(msgId: string, text: string) {
    const m = this.messages.get(msgId);
    if (!m) return;
    // Mutate the content reference — keep message ref stable to allow memo
    m.content = (m.content || "") + text;
    this.notify(msgId);
  }

  subscribe(msgId: string, cb: () => void) {
    if (!this.listeners.has(msgId)) this.listeners.set(msgId, new Set());
    this.listeners.get(msgId)!.add(cb);
    return () => this.listeners.get(msgId)!.delete(cb);
  }

  private notify(msgId: string) {
    this.listeners.get(msgId)?.forEach((cb) => cb());
  }

  get(msgId: string) { return this.messages.get(msgId); }
}
```

```ts
function useMessage(id: string) {
  return useSyncExternalStore(
    (cb) => messageStore.subscribe(id, cb),
    () => messageStore.get(id),
    () => undefined
  );
}
```

Only the message currently streaming re-renders.

### 6.2 RAF batching for high token rates

If model emits 100 tokens/sec, 100 setStates/sec is fine for one message. But if multiple messages stream in parallel (rare for chat), batch:

```ts
private dirty = new Set<string>();
private scheduled = false;
private scheduleFlush() {
  if (this.scheduled) return;
  this.scheduled = true;
  requestAnimationFrame(() => {
    for (const id of this.dirty) this.notify(id);
    this.dirty.clear();
    this.scheduled = false;
  });
}
```

---

## 7. Markdown rendering — incremental + safe

### 7.1 Library choice

| Library | Notes |
|---------|-------|
| **react-markdown** | Mature, plugin-based (rehype/remark). Re-parses the entire markdown each token — fine for streams up to ~5k chars; slower beyond. |
| **markdown-it** + custom React shim | More performant for huge streams; lacks turnkey React integration |
| **Streaming markdown parsers** (custom) | Best perf, parses incrementally; complex to build |

For most chat UIs, **react-markdown with `useDeferredValue`** is sufficient:

```jsx
function StreamingMarkdown({ content }) {
  const deferred = useDeferredValue(content);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize, rehypeHighlight]}
      components={{
        code: SyntaxHighlightedCode,
        a: ExternalLink,
      }}
    >
      {deferred}
    </ReactMarkdown>
  );
}
```

`useDeferredValue` lets React skip frames when tokens arrive faster than the markdown reconciler can keep up — keeps the UI responsive.

### 7.2 Sanitization — XSS prevention

LLM output is **untrusted**. Always sanitize:

```js
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

// Strict schema: no script, no inline event handlers, no javascript: links
const schema = {
  ...defaultSchema,
  tagNames: [...defaultSchema.tagNames, "details", "summary"],
  protocols: { href: ["http", "https", "mailto"] },
};
```

DO NOT use `dangerouslySetInnerHTML` with model output without sanitization. Treat the model as a hostile user input.

### 7.3 Code block UX

```jsx
function CodeBlock({ inline, className, children }) {
  const lang = /language-(\w+)/.exec(className || "")?.[1];
  const code = String(children).trim();
  const [copied, setCopied] = useState(false);

  if (inline) return <code className="inline">{children}</code>;

  return (
    <div className="code-block">
      <header>
        <span>{lang ?? "text"}</span>
        <button onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }} aria-label="Copy code">
          {copied ? "Copied!" : "Copy"}
        </button>
      </header>
      <pre><code className={className}>{children}</code></pre>
    </div>
  );
}
```

Lazy-load `react-syntax-highlighter` only when first code block appears — saves initial bundle.

---

## 8. Tool call UI (Verizon MCP integration)

Tool calls reveal the agent's intermediate work — searches, file reads, code modifications.

### 8.1 Visual model

```
┌─────────────────────────────────────────┐
│  🔧 search_jira                          │
│  ───────────────────────────────────     │
│  args: { query: "ORDER-12345" }          │
│                                          │
│  → Found 1 issue: "Order stuck in       │
│    'awaiting-payment' for 3 days"       │
│                                          │
│  ▼ Show details                          │
└─────────────────────────────────────────┘
```

### 8.2 Implementation

```jsx
function ToolCall({ call }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-call" role="group" aria-label={`Tool call: ${call.toolName}`}>
      <header>
        <ToolIcon name={call.toolName} />
        <code>{call.toolName}</code>
        {call.status === "pending" && <Spinner aria-label="Running" />}
        {call.status === "done" && <CheckIcon />}
        {call.status === "error" && <ErrorIcon />}
      </header>
      <pre className="args">{JSON.stringify(call.args, null, 2)}</pre>
      {call.result && (
        <details onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary>{summarizeResult(call.result)}</summary>
          <pre>{JSON.stringify(call.result, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
```

States: `pending` → `done` | `error`. Animate the spinner; reduced-motion shows static dots.

### 8.3 MCP-specific concerns

Tool args/results from MCP can be large (full code diffs, JSON dumps). Truncate display + show "expand":

```jsx
function CollapsibleJson({ value, maxChars = 500 }) {
  const str = JSON.stringify(value, null, 2);
  const [open, setOpen] = useState(false);
  if (str.length <= maxChars) return <pre>{str}</pre>;
  return (
    <>
      <pre>{open ? str : str.slice(0, maxChars) + "…"}</pre>
      <button onClick={() => setOpen(!open)}>{open ? "Collapse" : "Expand"}</button>
    </>
  );
}
```

---

## 9. Citations

Inline citations linking to source documents:

```
The order is stuck at the payment gateway [1].
Last successful refresh was 2 days ago [2].

[1] order-system-docs/payment-gateway.md
[2] runbook/order-stuck.md
```

### 9.1 Rendering inline

Model emits `[1]` in the response text + a separate citation event:

```ts
case "citation":
  messageStore.addCitation(currentMsgId, { id: "1", doc: {...} });
```

UI replaces `[N]` in rendered text with a tooltip-linked superscript:

```jsx
// Custom rehype plugin to transform [N] into <Citation n={N}/>
```

---

## 10. Stop button + cancel mid-stream

```jsx
function ComposeBox({ conversationId }) {
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = async () => {
    const msgId = generateId();
    messageStore.add({ id: msgId, role: "user", content: text });
    const aiId = generateId();
    messageStore.add({ id: aiId, role: "assistant", content: "" });
    setText("");
    setStreaming(true);
    abortRef.current = new AbortController();

    try {
      await startStream(
        { conversationId, msgId, aiId, text },
        handleEventFor(aiId),
        abortRef.current.signal
      );
    } catch (e) {
      if (e.name === "AbortError") {
        messageStore.appendToken(aiId, "\n\n_[Stopped]_");
      } else {
        messageStore.setError(aiId, { message: e.message });
      }
    } finally {
      setStreaming(false);
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <form onSubmit={(e) => { e.preventDefault(); send(); }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }}}/>
      {streaming
        ? <button type="button" onClick={stop} aria-label="Stop generation">Stop</button>
        : <button type="submit" aria-label="Send" disabled={!text.trim()}>Send</button>}
    </form>
  );
}
```

### 10.1 Server-side cancel

`AbortController.signal` propagates to the underlying `fetch`; server sees the connection close. The server in turn must cancel the LLM stream (Anthropic/OpenAI clients accept their own `signal`):

```ts
// server.ts (Node)
const llmStream = await client.messages.create({
  model: "claude-opus-4-7",
  messages: [...],
  stream: true,
  signal: req.signal,   // propagates from client
});
```

Otherwise the LLM keeps generating tokens that nobody receives — wasted compute.

---

## 11. Resume / regenerate

### 11.1 Resume after disconnect

If the SSE connection drops mid-stream, the partial message in the store is still there. On reconnect, the server can resume:

```
POST /chat/stream
  Last-Event-ID: 2025-06-06T12:34:56.789Z-msg-abc-token-432
```

Server resumes from token 433 onward. The token cursor must be deterministic — track per-message token index server-side.

**Simpler fallback:** discard the partial response, mark it `interrupted`, offer "Continue" button which restarts generation with the partial text as prefix.

### 11.2 Regenerate

User clicks "Regenerate":
1. Delete the assistant message
2. Re-run from the original user message
3. New message gets a fresh ID; old can be retained as "variant 1"

For variant exploration ("show me an alternative"), keep both responses with a switcher.

### 11.3 Edit prompt

User clicks "Edit" on their previous message:
1. Truncate the conversation to just before that message
2. Show editable textarea inline
3. On Submit, restart from the edited prompt
4. Original conversation can be retained as a "branch" if you want history

---

## 12. Virtualization for long conversations

1000+ messages × variable height + nested markdown blocks = significant DOM. Virtualize.

```jsx
import { useVirtualizer } from "@tanstack/react-virtual";

function MessageList({ messages, streamingMsgId }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  // Auto-scroll to bottom when streaming
  useEffect(() => {
    if (streamingMsgId) {
      v.scrollToIndex(messages.length - 1, { align: "end", behavior: "smooth" });
    }
  }, [streamingMsgId, messages.length]);

  return (
    <div ref={parentRef} className="messages-scroll">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((vi) => (
          <div key={messages[vi.index].id}
               ref={v.measureElement}
               data-index={vi.index}
               style={{ position: "absolute", top: 0, transform: `translateY(${vi.start}px)`, width: "100%" }}>
            <Message message={messages[vi.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 12.1 Variable height + streaming

A streaming message grows. `useVirtualizer` with `measureElement` handles this — it re-measures on size change. Mark the streaming message memo-bust so it re-renders on each token.

### 12.2 Auto-scroll behavior

Three states:
- User pinned to bottom: auto-scroll to follow new tokens
- User scrolled up to read history: don't fight them; show "Jump to latest" button when streaming
- User scrolls back down: restore auto-scroll

```ts
const [pinned, setPinned] = useState(true);

useEffect(() => {
  if (!pinned || !streamingMsgId) return;
  v.scrollToIndex(messages.length - 1, { align: "end" });
}, [pinned, streamingMsgId, messages.length]);

function onScroll(e) {
  const el = e.currentTarget;
  const atBottom = Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 50;
  setPinned(atBottom);
}
```

---

## 13. Accessibility — chat-specific

| Need | Implementation |
|------|----------------|
| Announce streaming response | `aria-live="polite"` `aria-atomic="false"` on the streaming message |
| Don't announce every token | Debounce: announce at sentence boundary (regex `[.!?]\s`) or every 1s |
| Stop button reachable | First focus after Send activates; same DOM position to preserve focus continuity |
| Skip to compose box | Skip-link "Skip to message input" |
| Read order: tool calls are inline | Nest them in the message; mark with `role="group"` `aria-label` |
| Citations as links | Real `<a>` elements with descriptive labels |
| Code blocks | `aria-label="Code in JavaScript"`, copy button accessible |
| Long thinking text | Wrap in `<details>` `<summary>"Show reasoning"</summary>` — collapse by default for AT |

```jsx
function StreamingMessage({ message }) {
  const announceRef = useRef("");
  const announceTimer = useRef<number>();

  useEffect(() => {
    // Debounce announcements at sentence boundaries
    const text = message.content || "";
    const lastBoundary = Math.max(text.lastIndexOf(". "), text.lastIndexOf("? "), text.lastIndexOf("! "));
    if (lastBoundary > announceRef.current.length) {
      clearTimeout(announceTimer.current);
      announceTimer.current = window.setTimeout(() => {
        announceLiveRegion(text.slice(announceRef.current.length, lastBoundary + 1));
        announceRef.current = text.slice(0, lastBoundary + 1);
      }, 500);
    }
  }, [message.content]);

  return (
    <article aria-label="Assistant response">
      <div aria-live="polite" aria-atomic="false" className="sr-only" id="live-region">
        {/* Sentence-bounded text injected via announceLiveRegion */}
      </div>
      <Markdown content={message.content} />
    </article>
  );
}
```

---

## 14. Conversation persistence

| Storage | Use |
|---------|-----|
| **TanStack Query cache** | In-memory conversation lookup, optimistic updates |
| **Server DB** | Source of truth |
| **IndexedDB** | Offline draft, partial response saved on disconnect, recently-viewed chats cache |

### 14.1 Optimistic UI for new messages

```ts
const sendMessage = useMutation({
  mutationFn: (msg) => api.sendMessage(msg),
  onMutate: async (msg) => {
    queryClient.setQueryData<Message[]>(["chat", convId], (prev = []) => [...prev, msg]);
    return { msg };
  },
  onError: (err, msg, ctx) => {
    queryClient.setQueryData<Message[]>(["chat", convId], (prev = []) =>
      prev.filter((m) => m.id !== ctx?.msg.id)
    );
    toast.error("Couldn't send. Retry?");
  },
});
```

But for streaming, the assistant message is built up by stream events, not by query — manage via the external `messageStore`.

---

## 15. Error handling

| Failure | UX |
|---------|----|
| Stream initial fails (401, 5xx) | Toast + message bubble shows "Couldn't reach assistant" + Retry |
| Stream errors mid-flight | Show error inline in the partial response; offer Retry (regenerate from this prompt) |
| Tool call fails | Inline error in the tool block, "Continue without tool" or "Retry tool" |
| Rate-limited | Toast "Slow down — please wait 30s", disable compose with countdown |
| Network drop | Auto-retry once with new stream; if fails, show "Reconnect" button |
| Browser tab backgrounded | Continue receiving (browser doesn't pause SSE); pause animations |

---

## 16. Performance budgets

| Metric | Target | Strategy |
|--------|--------|----------|
| TTFB (initial chat load) | < 500ms | Cache conversation list aggressively |
| First token | < 1s | Backend streaming starts ASAP; UI ready to receive on submit |
| Token jitter | < 50ms gap between consecutive tokens | Stream proxy not buffering; flush per token at server |
| INP | < 200ms during streaming | Defer markdown reconciliation via `useDeferredValue` |
| Bundle initial | < 200KB | Lazy syntax highlighter, lazy markdown extensions |
| Memory (long chat) | < 200MB | Virtualize, trim history to last N visible |

### 16.1 Lazy-load heavy deps

```ts
const SyntaxHighlighter = lazy(() => import("./SyntaxHighlighter"));
```

Most prompts get short text responses; load the syntax highlighter only when needed.

---

## 17. Multimodal — image / file inputs

```jsx
function ComposeBox({ ... }) {
  const [attachments, setAttachments] = useState<File[]>([]);

  return (
    <form>
      <textarea ... />
      <button type="button" onClick={() => filePickerRef.current?.click()}>
        📎 Attach
      </button>
      <input ref={filePickerRef} type="file" multiple hidden
             onChange={(e) => setAttachments([...attachments, ...Array.from(e.target.files!)])} />
      {attachments.map((f) => (
        <AttachmentChip key={f.name} file={f} onRemove={() => /* */} />
      ))}
      ...
    </form>
  );
}
```

For images, generate thumbnails using `createImageBitmap` (see [File Upload UI](../8-FileUploadUI/notes.md)).

For documents (PDF, Excel), upload via the same flow as the [File Upload UI](../8-FileUploadUI/notes.md) — S3 multipart pre-signed URLs — then reference by URL in the chat request body.

---

## 18. Trade-off matrix

| Decision | Option A | Option B | Choice + Why |
|----------|----------|----------|--------------|
| Transport | SSE | WebSocket | **SSE** for streaming-only; WS if bidirectional mid-stream interactions or existing WS infra |
| Per-token re-render | React state | External store + useSyncExternalStore | **External store** — sub-message re-render granularity |
| Markdown parser | react-markdown each token | Streaming parser | **react-markdown + useDeferredValue** — pragmatic |
| Cancel | Page navigation only | AbortController | **AbortController** — clean propagation to server |
| Sanitization | None / DOMPurify | rehype-sanitize | **rehype-sanitize** — schema-driven, integrates with markdown |
| History storage | Server | Server + IndexedDB cache | **Both** — offline-friendly, fast list load |
| Tool result display | Collapsed by default | Expanded | **Collapsed** — keeps message scannable |
| Live region | Per-token | Sentence-bounded | **Sentence-bounded debounce** — screen readers can't keep up otherwise |

---

## 19. Interview talking points

**Q: "SSE or WebSocket for streaming chat?"**
A: SSE by default. Streams are one-way (server → client) for chat token output, and SSE gives us HTTP semantics — proxy-friendly, easy debugging, built-in auto-reconnect with Last-Event-ID. The client uses fetch + ReadableStream so we can POST the prompt (vanilla `EventSource` is GET-only). WebSocket wins when we need real-time bidirectional events (e.g., interrupt the agent with new context mid-stream), or when the org's infra is already WS-native — that's what we used at Verizon.

**Q: "How do you avoid re-rendering the whole message tree on every token?"**
A: Keep messages in an external store (Map keyed by id). Subscribe per message via `useSyncExternalStore`. Only the streaming message re-renders per token. For high token rates, batch notifications per `requestAnimationFrame` so we cap at 60 reconciliations/sec regardless of token velocity.

**Q: "How does Stop work end-to-end?"**
A: Client uses `AbortController.signal` passed to `fetch`. On abort, the underlying TCP connection closes. The server detects the closed connection via its own `req.signal` and propagates to the LLM client (Anthropic/OpenAI SDKs accept signal). LLM stream is cancelled; no more tokens generated. Saves compute and budget. UX: the assistant message gets a `_[Stopped]_` suffix; Send button returns.

**Q: "How do you handle XSS in markdown rendering?"**
A: Treat the LLM as untrusted. Use rehype-sanitize with a strict schema — no `<script>`, no inline event handlers, only `http`/`https`/`mailto` protocols. Code blocks rendered as text. External links open in new tab with `rel="noopener noreferrer"`. CSP `script-src 'self'` blocks even if sanitize misses something. Same defense-in-depth principle as for user-generated content.

**Q: "How do you make the streaming response accessible?"**
A: `aria-live="polite"` `aria-atomic="false"` on a hidden live region. Debounce announcements at sentence boundaries — screen readers can't keep up with per-token streams and will fall behind or skip. Tool calls wrapped in `role="group"` `aria-label`. Code blocks have a `aria-label` describing language. Citations are real `<a>` elements with descriptive text.

**Q: "Conversation has 1000+ messages — how do you keep it performant?"**
A: Virtualize via `@tanstack/react-virtual`. Variable heights handled via `measureElement`. Stream-active message marked memo-bust so it re-renders on each token without affecting the rest. Auto-scroll to bottom on each token only when user is pinned to bottom; if they've scrolled up, show "Jump to latest" instead of yanking them back.

**Q: "Tool calls — UI design?"**
A: Inline in the assistant message, collapsible, with three states: pending (spinner), done (check + summary + expandable raw result), error (red + reason). Args formatted as JSON; large results truncated with "Expand" toggle. For MCP calls specifically — show the MCP server name and tool name as `server.tool_name`. Animation respects `prefers-reduced-motion`.

**Q: "What happens when SSE disconnects mid-stream?"**
A: Two strategies. Optimistic resume: server tracks token index, client reconnects with `Last-Event-ID`, server resumes from next token. Pessimistic restart: discard partial response, mark message as `interrupted`, offer "Continue from here" which restarts the stream using the partial as prefix. Implement optimistic resume only when the backend can support deterministic token indexing — otherwise pessimistic is safer.

**Q: "How would you implement multi-variant responses ('show me another version')?"**
A: Same conversation, multiple assistant messages with `variantOf` linking back to the prompt. UI shows a switcher above the assistant bubble: "1/3 ←→". Each variant is a separate stream. Selected variant determines what the next user message refers to (the rest are hidden from LLM context unless user explicitly references).

---

## 20. Diagram

```
   User Browser                                            Server
   ┌──────────────────────────────────┐                    ┌───────────────────────┐
   │  ChatUI                          │                    │  /chat/stream (POST)   │
   │   ┌─────────────────────────┐    │                    │                       │
   │   │ Compose: "Why is order  │    │ HTTP POST (SSE)    │                       │
   │   │  ORDER-12345 stuck?"    │────┼─────────────────────►                       │
   │   └─────────────────────────┘    │                    │                       │
   │   ┌─────────────────────────┐    │                    │                       │
   │   │ Assistant (streaming):  │    │   event: token     │     LLM stream         │
   │   │  "Let me check the      │◄───┼────────────────────│  ← Claude/etc.         │
   │   │   order status..."      │    │                    │                       │
   │   └─────────────────────────┘    │                    │                       │
   │   ┌─────────────────────────┐    │   event: tool_start│     MCP call           │
   │   │ 🔧 jira.search          │◄───┼────────────────────│  ← server             │
   │   │   args: ORDER-12345     │    │                    │                       │
   │   │   [running...]          │    │   event: tool_result                       │
   │   │   ✓ Found 1 issue       │◄───┼────────────────────│                       │
   │   └─────────────────────────┘    │                    │                       │
   │   ┌─────────────────────────┐    │   event: token     │                       │
   │   │ Assistant: "Payment     │◄───┼────────────────────│                       │
   │   │  gateway is unreachable │    │                    │                       │
   │   │  [1]"                   │    │   event: citation  │                       │
   │   └─────────────────────────┘◄───┼────────────────────│                       │
   │                                  │   event: done      │                       │
   │   [Stop] / [Regenerate]          │◄────────────────────│                       │
   └──────────────────────────────────┘                    └───────────────────────┘
```

---

## 21. Cross-links

- [Real-Time Dashboard](../6-RealTimeDashboard/notes.md) — WS reconnect, virtualization
- [File Upload UI](../8-FileUploadUI/notes.md) — multimodal attachments
- [TanStack Query](../../../react/tanstack-query.txt) — query cache for chats/history
- [React advanced topics](../../../react/advanced-topics.md) — useDeferredValue, useSyncExternalStore
- [TypeScript advanced](../../typescript-advanced.md) — discriminated unions for stream events
- [Accessibility](../../accessibility.md) — live regions, sentence-bounded announcements
- [Web Security](../../../performance-security/WebSecurity.md) — XSS prevention, CSP
- [Node AI notes](../../../../../backend/nodejs/Node_AI.md) — LangChain, streaming patterns
- [MCP Transport notes](../../../../../backend/nodejs/MCP_Transport.md) — MCP protocol details
