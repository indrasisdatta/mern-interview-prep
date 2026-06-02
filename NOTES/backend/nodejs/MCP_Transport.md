# MCP Transports — stdio, Streamable HTTP & SSE

Practical notes on the ways an MCP server and client can talk to each other, when to pick each, and Node.js code for all three.

---

## 1. The mental model: protocol vs. transport

MCP separates into two layers:

- **Protocol layer** — *what* is in the message. Always JSON-RPC 2.0 (tools, resources, prompts, notifications). This never changes regardless of transport.
- **Transport layer** — *how* the message physically travels between client and server.

> Analogy: the protocol is the letter; the transport is whether it goes by hand-delivery (stdio), courier (Streamable HTTP), or the old postal route that's being shut down (SSE).

Because the protocol is identical across transports, your tool/resource logic is written **once** and only the transport initialization differs.

---

## 2. The three transports at a glance

| | **stdio** | **Streamable HTTP** | **HTTP+SSE** *(legacy)* |
|---|---|---|---|
| Status | Standard | **Standard (current)** | **Deprecated** (spec 2025-03-26) |
| Introduced | 2024-11-05 | 2025-03-26 | 2024-11-05 |
| Location | Local only (subprocess) | Remote / network | Remote / network |
| Endpoints | stdin/stdout streams | **One** endpoint (`/mcp`, POST+GET) | **Two** endpoints (`/sse` + `/messages`) |
| Concurrency | Single client | Many clients | Many clients |
| Auth | Inherits local process | OAuth 2.1 / bearer tokens / headers | Headers |
| Use it for | Local tools, desktop clients, dev | Production remote servers | Only backwards-compat with old clients |

**Rule of thumb:** local → **stdio**; remote → **Streamable HTTP**; building new in 2026 → **never start with SSE**.

---

## 3. stdio transport

### What it is
The client launches the MCP server as a **child process** and talks to it over standard input/output. Messages are newline-delimited JSON-RPC. The server may log to `stderr`, but must never write non-MCP content to `stdout`.

### When to choose it
- Local integrations and command-line tools.
- Desktop clients (e.g. Claude Desktop, IDE extensions) that spawn the server.
- Development and quick prototyping — zero network, zero ports, zero auth wiring.
- Single-user, single-session scenarios.

### When NOT to choose it
- Anything multi-client or remote. It is local-only and collapses under concurrent load (it's a single process bound to one client over pipes).

### Node.js — stdio server

```js
// server-stdio.js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "local-tools", version: "1.0.0" });

server.registerTool(
  "read_file_stats",
  {
    title: "File stats",
    description: "Return byte size of a local file",
    inputSchema: { path: z.string() },
  },
  async ({ path }) => {
    const { statSync } = await import("node:fs");
    const size = statSync(path).size;
    return { content: [{ type: "text", text: `${size} bytes` }] };
  }
);

// Connect over stdio — the client spawns THIS process.
const transport = new StdioServerTransport();
await server.connect(transport);
// IMPORTANT: never console.log() to stdout here — it corrupts the JSON-RPC stream.
// Use console.error() (stderr) for logging instead.
```

### How a client launches it (config form)

```json
{
  "mcpServers": {
    "local-tools": {
      "command": "node",
      "args": ["server-stdio.js"]
    }
  }
}
```

### Node.js — stdio client (programmatic)

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["server-stdio.js"],
});

const client = new Client({ name: "demo-client", version: "1.0.0" });
await client.connect(transport);

const result = await client.callTool({
  name: "read_file_stats",
  arguments: { path: "./package.json" },
});
console.log(result.content);
```

---

## 4. Streamable HTTP transport (the modern standard)

### What it is
The server exposes **one** HTTP endpoint (e.g. `https://example.com/mcp`) that accepts both **POST** and **GET**:

- Client **POSTs** a JSON-RPC message.
- Server replies with **either** a plain JSON body (simple request/response) **or** upgrades the connection to a **Server-Sent Events stream** when it needs to stream progress, partial results, or server-initiated notifications.
- The client sets `Accept: application/json, text/event-stream` and the server chooses the response mode.

There is no separate "events" endpoint — that single-endpoint design is the whole point, and it's what fixes SSE's problems.

Despite the name, it does **not** require HTTP/2 — it runs fine on HTTP/1.1 with chunked transfer encoding.

### When to choose it
- Any **remote / networked** MCP server.
- **Production** deployments behind a load balancer or gateway.
- Multi-client / multi-tenant services.
- When you need streaming progress, long-running tool calls, or server push.
- Hosted clients (e.g. ChatGPT-style integrations) that connect over HTTP and expect OAuth 2.1.

### Stateless vs. stateful
- **Stateless** — no session kept between calls; any node can serve any request. Best for horizontal scaling, serverless, simple tool servers.
- **Stateful** — a session is established on `initialize` and tracked via the `Mcp-Session-Id` header; needed for resumable streams or per-session context.

### Node.js — stateless Streamable HTTP server (Express)

Good default for scalable, simple servers. A fresh transport per request avoids request-ID collisions.

```js
// server-http-stateless.js
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

function buildServer() {
  const server = new McpServer({ name: "remote-tools", version: "1.0.0" });
  server.registerTool(
    "echo",
    { title: "Echo", description: "Echo text back", inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: "text", text }] })
  );
  return server;
}

const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  // New server + transport per request => stateless, no shared state, no ID clashes.
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,   // undefined => stateless
    enableJsonResponse: true,        // allow plain JSON replies (no forced SSE)
  });
  res.on("close", () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// In stateless mode, GET (the SSE stream) isn't used for sessions.
app.get("/mcp", (_req, res) => res.status(405).end());

app.listen(3000, () => console.error("MCP server on http://localhost:3000/mcp"));
```

### Node.js — stateful Streamable HTTP server (sessions)

Use this when you need per-session context or resumable streams.

```js
// server-http-stateful.js
import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const app = express();
app.use(express.json());

const transports = {}; // sessionId -> transport

app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  let transport = sessionId ? transports[sessionId] : undefined;

  if (!transport && isInitializeRequest(req.body)) {
    // New session
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => { transports[id] = transport; },
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };

    const server = new McpServer({ name: "stateful-tools", version: "1.0.0" });
    server.registerTool(
      "remember",
      { title: "Remember", description: "Store a note for this session", inputSchema: { note: z.string() } },
      async ({ note }) => ({ content: [{ type: "text", text: `Stored: ${note}` }] })
    );
    await server.connect(transport);
  } else if (!transport) {
    return res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "No valid session ID" },
      id: null,
    });
  }

  await transport.handleRequest(req, res, req.body);
});

// GET opens the SSE stream for server->client notifications on an existing session.
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  const transport = transports[sessionId];
  if (!transport) return res.status(400).send("Invalid session");
  await transport.handleRequest(req, res);
});

app.listen(3000, () => console.error("Stateful MCP server on :3000/mcp"));
```

### Node.js — Streamable HTTP client

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp")
);

const client = new Client({ name: "http-client", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log(tools);

const result = await client.callTool({ name: "echo", arguments: { text: "hello" } });
console.log(result.content);
```

---

## 5. HTTP+SSE transport (legacy — deprecated)

### What it is
The original remote transport (spec 2024-11-05). It uses **two** endpoints:

- `GET /sse` — opens a long-lived Server-Sent Events stream (server → client).
- `POST /messages` — client → server JSON-RPC.

### Status
**Deprecated** as of the 2025-03-26 spec. The two-endpoint split caused awkward session correlation, made resumability hard, and complicated load balancing. Streamable HTTP replaced it.

### When to choose it
Only one reason: **backwards compatibility** with older clients that haven't migrated to Streamable HTTP. For anything new, skip it.

### Backwards-compatibility pattern
A server can host both: keep the old `/sse` + `/messages` endpoints **and** expose the new single `/mcp` endpoint. Clients that fail the new POST (e.g. `405`/`404`) fall back to issuing a GET to open an SSE stream the old way.

### Node.js — legacy SSE server (for compat only)

```js
// server-sse-legacy.js  (only for old clients)
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

const app = express();
const server = new McpServer({ name: "legacy", version: "1.0.0" });
const transports = {}; // sessionId -> transport

// 1) Client opens the event stream here.
app.get("/sse", async (_req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;
  res.on("close", () => delete transports[transport.sessionId]);
  await server.connect(transport);
});

// 2) Client posts messages here, keyed by sessionId.
app.post("/messages", async (req, res) => {
  const transport = transports[req.query.sessionId];
  if (!transport) return res.status(400).send("No session");
  await transport.handlePostMessage(req, res);
});

app.listen(3000);
```

---

## 6. Decision guide — which transport?

```
Is the server on the SAME machine as the client and spawned by it?
│
├─ YES ──────────────────────────────► stdio
│
└─ NO (remote / networked)
     │
     ├─ Building something new? ─────► Streamable HTTP   ✅ default
     │
     └─ Must support old clients that
        only speak the 2024-11-05 transport?
        └─ Add HTTP+SSE endpoints alongside Streamable HTTP (compat only)
```

Quick heuristics:
- **Local tool / desktop app / CLI / dev loop** → stdio.
- **Hosted API, SaaS connector, multi-user, needs auth & scaling** → Streamable HTTP (stateless if you can, stateful only if you need sessions).
- **Migrating an old deployment** → run both, deprecate SSE over time.

---

## 7. Practical use cases mapped to transports

| Use case | Transport | Why |
|---|---|---|
| Filesystem / Git tool for a desktop AI client | **stdio** | Local, single user, spawned by the client, no network surface |
| IDE extension exposing project context | **stdio** | Runs alongside the editor, per-session, no ports |
| Internal analytics tool, scriptable from CLI | **stdio** | Simplest path; pipe in/out |
| Company "search our docs" connector for many employees | **Streamable HTTP (stateless)** | Remote, concurrent users, scales horizontally, OAuth |
| SaaS product exposing its API as MCP tools | **Streamable HTTP** | Public network endpoint, auth, multi-tenant |
| Long-running job tool that streams progress | **Streamable HTTP (stateful)** | SSE upgrade streams progress notifications; session tracks the job |
| Agent that needs server-pushed events mid-task | **Streamable HTTP (stateful)** | GET stream delivers server→client notifications |
| Serverless / edge deployment (Workers, Lambda) | **Streamable HTTP (stateless)** | No per-node session state to manage |
| Keeping a 2024-era client working during migration | **HTTP+SSE** alongside Streamable HTTP | Backwards compatibility only |

---

## 8. One codebase, multiple transports

A common production pattern: ship **stdio for local dev** and **Streamable HTTP for prod**, switching on an env var. Tool logic is shared; only the transport setup branches.

```js
// entry.js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

export function buildServer() {
  const server = new McpServer({ name: "dual-mode", version: "1.0.0" });
  server.registerTool(
    "ping",
    { title: "Ping", description: "Health check", inputSchema: {} },
    async () => ({ content: [{ type: "text", text: "pong" }] })
  );
  return server;
}

if (process.env.MCP_TRANSPORT === "http") {
  await import("./server-http-stateless.js"); // boots Express on /mcp
} else {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}
```

```bash
# Local dev
node entry.js

# Production
MCP_TRANSPORT=http node entry.js
```

---

## 9. Gotchas & best practices

- **stdio: keep stdout clean.** Any stray `console.log`, banner, or debug print to stdout corrupts the JSON-RPC stream. Log to `stderr` (`console.error`).
- **Streamable HTTP ≠ HTTP/2.** It works on HTTP/1.1 with chunked encoding; don't block on HTTP/2.
- **Prefer stateless** for Streamable HTTP unless you genuinely need sessions — it scales trivially and avoids sticky-session/load-balancer headaches.
- **Stateful servers need sticky routing** or shared session storage (DB / pub-sub) across nodes, or a client's `Mcp-Session-Id` may land on a node that doesn't know it.
- **New transport per request** in stateless HTTP mode prevents request-ID collisions between concurrent clients.
- **Don't start new projects on SSE.** It's deprecated; only add it as a compatibility shim beside Streamable HTTP.
- **Auth lives at the transport edge.** stdio inherits the local process's permissions; HTTP transports should sit behind OAuth 2.1 / bearer tokens / a gateway.
- **A gateway can erase the question.** Tools like MCP gateways translate stdio↔HTTP, so a stdio-only server can be exposed to HTTP-only clients without rewriting it.

---

## SDK & version reference

- Package: `@modelcontextprotocol/sdk` (TypeScript/Node). Imports above use the widely-used v1 paths (`@modelcontextprotocol/sdk/server/...`). A newer v2 generation uses split packages (`@modelcontextprotocol/server`, `@modelcontextprotocol/node`, etc.) — check the SDK docs for which generation you've installed.
- Spec milestones: **2024-11-05** (stdio + SSE introduced) → **2025-03-26** (Streamable HTTP introduced, SSE deprecated) → retained in the late-2025 revision.
- Streamable HTTP support landed in the TypeScript SDK around v1.10.0 (April 2025).
- Install: `npm install @modelcontextprotocol/sdk zod express`