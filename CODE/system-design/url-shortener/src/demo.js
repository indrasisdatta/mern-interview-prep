// Demo script — runs against a local server at http://localhost:3000
// Usage: start the server (npm start) in one terminal, then `npm run demo`

const BASE = process.env.BASE_URL || "http://localhost:3000";

async function shorten(url, customAlias) {
  const res = await fetch(`${BASE}/shorten`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, customAlias }),
  });
  return { status: res.status, body: await res.json() };
}

async function resolve(code) {
  const res = await fetch(`${BASE}/${code}`, { redirect: "manual" });
  return { status: res.status, location: res.headers.get("location") };
}

async function stats(code) {
  const res = await fetch(`${BASE}/${code}/stats`);
  return res.json();
}

async function main() {
  console.log("\n=== URL Shortener Demo ===\n");

  const targets = [
    { url: "https://anthropic.com", alias: "claude" },
    { url: "https://www.anthropic.com/news/claude-opus-4-5" },
    { url: "https://github.com/anthropics/claude-code" },
    { url: "https://docs.anthropic.com/en/docs/agents-and-tools/mcp" },
    { url: "https://www.indrasis.dev" },   // demo URL
  ];

  console.log("Creating short URLs:");
  const created = [];
  for (const t of targets) {
    const r = await shorten(t.url, t.alias);
    console.log(`  ${r.status} ${JSON.stringify(r.body)}`);
    if (r.body.shortCode) created.push(r.body.shortCode);
  }

  console.log("\nResolving each (and a non-existent one):");
  for (const code of [...created, "nope404"]) {
    const r = await resolve(code);
    console.log(`  GET /${code} → ${r.status}${r.location ? ` → ${r.location}` : ""}`);
  }

  console.log("\nClicking 'claude' alias 5 more times to build up analytics:");
  for (let i = 0; i < 5; i++) await resolve("claude");

  // Wait for analytics flush (1s)
  await new Promise((r) => setTimeout(r, 1100));

  console.log("\nStats for 'claude':");
  console.log(" ", await stats("claude"));

  console.log("\nDemo complete.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
