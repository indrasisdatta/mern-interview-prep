# React Server Components RCE — December 3, 2025 ("React2Shell")

> **CVE-2025-55182** — CVSS score **10.0** (maximum severity). Unauthenticated Remote Code Execution in React 19's Server Components.

---

## A quick correction on dates / framing

- The original RCE was disclosed by **Meta and Vercel on December 3, 2025** (not Dec 2). It was discovered by researcher **Lachlan Davidson** through Meta's bug bounty.
- First exploits in the wild were seen on **December 4, 2025**, and over **4,100 exploitation attempts** were observed in the first two hours of disclosure.
- The Better Stack article you linked actually covers **two follow-up vulnerabilities** (DoS = CVE-2025-55184, Source Code Leak = CVE-2025-55183) that were discovered *after* the main RCE during the security-research wave that always follows a major disclosure. Worth knowing both stories for the interview.

---

## Quick Summary (the 30-second pitch)

React 19's **Server Components (RSC)** use a streaming protocol called **Flight** to send serialized component trees between the server and client. The server-side deserializer for Flight payloads (in `react-server-dom-webpack`, `react-server-dom-parcel`, and `react-server-dom-turbopack`) **failed to validate untrusted input**. An attacker could send a single crafted `POST` request to any Server Function endpoint and trick the deserializer into traversing the prototype chain to reach JavaScript's global `Function` constructor — effectively letting them execute arbitrary code on the Node.js server. **No authentication required.** **Default Next.js configurations were vulnerable out of the box.**

---

## What is the React Flight protocol? (you'll need to explain this)

RSC sends data from server to client in **chunks**, and each chunk can reference another chunk using a `$`-prefixed notation. Example:

- **Chunk 0:** `["$1"]` → "look at chunk 1"
- **Chunk 1:** `{"name": "$2"}` → "the value of name is in chunk 2"
- **Chunk 2:** `"cherry"`

The deserializer follows these references and assembles the final object. This is what makes RSC efficient for streaming complex UIs — but it's also what attackers exploited.

---

## How the exploit worked (root cause)

The attack used a special reference syntax `$@` (self-reference) along with **prototype chain traversal**:

1. Attacker sends a `POST` request with `Content-Type: multipart/form-data` (the form Server Functions accept).
2. The body contains a crafted payload that uses `$@` self-references to access the prototype chain.
3. By walking the prototype chain, the attacker reaches `Function.constructor` — the **global JavaScript `Function` constructor**.
4. `Function("malicious code")` lets you build a new function at runtime from a string — equivalent to `eval()`.
5. The server executes the attacker's code inside the Node.js process.

### The vulnerable behavior (in plain terms)

The deserializer **trusted the structure of incoming Flight payloads** because it assumed they came from a legitimate React client. It:
- Did **not validate** the shape or contents of the payload.
- **Followed references blindly**, even into `__proto__` / constructor chains.
- Allowed attacker-controlled fields to influence what server-side function got resolved and called.

### Specific mistakes the framework made

- ❌ Trusted that RSC requests would only come from the React client.
- ❌ Did not validate the structure of incoming RSC payloads.
- ❌ Parsed untrusted user input too generously.
- ❌ Let attacker-controlled fields reach RSC server logic without sanitization.
- ❌ The `requireModule` function used `__webpack_require__` to load modules referenced by ID in the payload, with no allowlist.

---

## Affected versions

- **React Server Components:** 19.0.0 through 19.2.0
- **Packages:**
  - `react-server-dom-webpack`
  - `react-server-dom-parcel`
  - `react-server-dom-turbopack`
- **Next.js:** unpatched 15.x and 16.x releases (initially tracked as CVE-2025-66478, later rejected as a duplicate of CVE-2025-55182 since the root cause lives in React itself).

> Important nuance: the **vulnerability lives in React's own packages**, but it surfaces through frameworks (Next.js, Remix) because they're the ones exposing RSC endpoints. Next.js enables RSC by default, which is why so many apps were exposed without doing anything explicit.

---

## The official fix

- Update `react-server-dom-webpack`, `react-server-dom-parcel`, `react-server-dom-turbopack` to **19.0.1**, **19.1.2**, or **19.2.1**.
- Update Next.js to the patched release for your line (e.g., `next@15.0.5+`).
- There's also an automated codemod: `npx fix-react2shell-next`.

Patches added **input validation** on the deserialization path so that prototype-chain traversal and constructor access are blocked.

---

## The follow-up vulnerabilities (from the Better Stack article)

After CVE-2025-55182 dropped, security researchers swarmed the RSC codebase and found two more issues:

### CVE-2025-55184 — Denial of Service (CVSS 7.5, High)
- Attacker sends a payload with **circular references**: chunk 0 points to chunk 1, chunk 1 points back to chunk 0.
- The deserializer loops forever resolving them, pinning the Node.js event loop at 100% CPU.
- Single-threaded Node = entire server frozen for legitimate users.
- **Fix:** a `cycleProtection` counter that throws an error after 1000 iterations.

### CVE-2025-55183 — Source Code Exposure (CVSS 5.3, Medium)
- Attacker uses the Flight directive `$F` to pass a reference to a **Server Action function itself** as that function's own argument.
- If the action does something like `` `Hello, ${name}!` ``, JavaScript implicitly calls `.toString()` on the function.
- `Function.prototype.toString()` returns the **source code** of the function — leaking server-side logic, including hardcoded secrets.
- **Fix:** React now overrides `.toString()` on server references to return a placeholder like `"function () { [omitted code] }"`.

---

## How to prevent this class of attack (general principles)

1. **Never trust the structure of incoming serialized data.** Validate the shape, types, and depth of payloads before deserializing.
2. **Don't let untrusted input traverse `__proto__` or `constructor`.** Use safe deserializers; if writing your own, explicitly block prototype access.
3. **Patch quickly.** Subscribe to security advisories for your framework. RSC went from disclosure to active exploitation in roughly a day.
4. **Don't hardcode secrets in source code.** Use environment variables (`process.env.DB_SECRET`). If your code leaks, the secrets shouldn't.
5. **Principle of least privilege.** Run Node.js with minimal OS permissions so an RCE doesn't immediately become a full server compromise.
6. **Dependency scanning** — Dependabot, Snyk, GitHub security alerts will flag known-vulnerable versions of `react-server-dom-*`.
7. **Runtime protections** — RASP/CWPP solutions, WAFs (Cloudflare deployed network-level filters), and observability tools to detect suspicious POSTs with `$@` patterns or connections to IMDS endpoints (e.g. `169.254.169.254` — the AWS metadata service, a classic target for credential theft after RCE).
8. **Incident response:** if you suspect exposure, **rotate all secrets, API keys, and DB credentials** — attackers were actively harvesting these.

---

## Likely interview follow-up questions

**Q: What is "insecure deserialization"?**
A: It's a class of vulnerability (CWE-502) where a program reconstructs an object from external input without validating it. If the deserializer is powerful enough to do things like instantiate classes, traverse prototypes, or invoke methods, an attacker who controls the input can manipulate program behavior — often leading to RCE.

**Q: Why is this comparable to Log4Shell?**
A: Both are unauthenticated, pre-auth RCEs in a ubiquitous library that's a transitive dependency in millions of apps. Both exploit deserialization-style trust gaps. Both went from disclosure to mass exploitation in hours. React + Next.js together cover a huge percentage of the web — about 40% of developers use React, ~18-20% use Next.js.

**Q: If the bug is in React, why did Next.js get a CVE?**
A: Because Next.js is what *exposes* the vulnerable endpoint to the internet — it's the framework that turns RSC on by default and routes incoming requests into React's Flight deserializer. Same root cause, but Next.js applications were where the attack surface lived. (CVE-2025-66478 was later rejected as a duplicate of CVE-2025-55182.)

**Q: How would you detect exploitation in your logs?**
A: Look for `POST` requests with `multipart/form-data` containing `$@` patterns or `#constructor` strings in the body, and any outbound connections to cloud metadata endpoints like `169.254.169.254` shortly after.

**Q: What's the broader lesson?**
A: New, powerful runtime features (like RSC, which blurs server/client boundaries) introduce new attack surfaces. The protocol designers assumed RSC payloads would come from a trusted React client — but anything reachable over HTTP must be treated as untrusted. **"Trust the structure of the data" is never a security assumption you can make.**

---

## Key takeaway for the interview

> "The React2Shell RCE is a textbook insecure-deserialization vulnerability. React's Flight protocol was designed to be efficient at streaming serialized component trees, but the deserializer trusted the structure of incoming data, didn't validate it, and let attacker-controlled references walk the prototype chain into the global `Function` constructor — turning a POST request into arbitrary code execution. The fix was input validation. The lesson is: **any data that crosses a trust boundary needs to be validated, no matter what protocol you think it's coming from.**"

---

---

# Other Recent npm / React Ecosystem Incidents

The React RCE didn't happen in a vacuum. The JavaScript ecosystem has been hit by a wave of supply-chain attacks since mid-2025. Here are three more you should know — they show a clear evolution from "isolated phishing" to "self-replicating worm." Mentioning these in an interview shows you actually follow the security landscape.

---

## Incident 1: Nx "s1ngularity" Attack — August 26–27, 2025

### What happened
Multiple malicious versions of the **Nx build system** (a popular monorepo tool used heavily in React/Angular shops — millions of weekly downloads) were published to npm. The compromised versions ran a **post-install script** that:

- Scanned the developer's machine for **GitHub tokens, npm tokens, SSH keys, API keys, `.npmrc` files, and cryptocurrency wallets**.
- Did something unprecedented: **weaponized AI CLI tools** like Claude CLI, Gemini CLI, and Amazon `q` already installed on the dev's machine. It used them to do reconnaissance and find more secrets to exfiltrate. This was the **first documented case of malware abusing developer AI assistants**.
- Encoded stolen data with double-base64.
- Created a **public GitHub repo inside the victim's own account** named `s1ngularity-repository` and uploaded the loot. Using the victim's own GitHub as the exfiltration channel meant traffic looked legitimate.

### Affected versions
`nx@20.9.0 – 20.12.0` and `nx@21.5.0 – 21.8.0` (and related `@nrwl/*` packages).

### Root cause
A **vulnerable GitHub Actions workflow** in the Nx repository:
- It used the `pull_request_target` trigger, which runs with elevated permissions.
- It interpolated the **PR title directly into a shell command** — classic command injection.
- An attacker opened a PR with a malicious title, ran code in the trusted CI context, and exfiltrated Nx's **long-lived npm publishing token** to a webhook.
- They then used that token to publish the malicious versions.

### Why it matters
This was the watershed moment. It demonstrated:
- **Long-lived npm tokens in CI/CD are a critical risk.** Once stolen, an attacker has the keys to the kingdom.
- **`pull_request_target` is dangerous if misused** — it gives PRs from forks access to repo secrets.
- **Post-install scripts run arbitrary code on every machine that does `npm install`.** This was the prevention: `npm ci --ignore-scripts` would have blocked the payload entirely.

### Aftermath
- Around 2,349 credentials harvested from 1,079 developer systems.
- The stolen tokens were later linked to enabling the **Shai-Hulud** attack the following month (see below).
- Nx switched to **npm Trusted Publishers** (OIDC-based publishing with no long-lived token) and manual release approval.

---

## Incident 2: Shai-Hulud Worm — September 2025 onward (the first npm worm)

### What happened
On **September 14–15, 2025**, security researchers detected something new: an npm supply-chain attack that **self-replicated**. Dubbed **Shai-Hulud** (after the giant sand worms in *Dune*), it was the first true npm worm.

When a developer or CI runner installed a compromised package:
1. The payload ran during the **preinstall phase** (before any security tools could inspect the dependency).
2. It deployed a **weaponized version of TruffleHog** (a real secrets scanner) on the victim's machine to find any tokens, keys, or secrets.
3. It exfiltrated everything to a **public GitHub repository** named "Shai-Hulud" created under the victim's own account.
4. **Here's the worm part:** if it found an **npm token** with publish rights, it would automatically pull down the maintainer's other packages, inject the same malware, bump the version, and republish them. **Each victim became a new infection vector.**

### Scale
- **V1 (September 2025):** ~500 npm packages compromised, including packages from CrowdStrike's namespace.
- **V2 "The Second Coming" (November 24, 2025):** ~700+ packages compromised, 27,000+ malicious GitHub repos created, ~14,000 secrets exposed across 487 organizations. Even more aggressive — included a destructive fallback that could **wipe the user's home directory**.
- **Mini Shai-Hulud (May 2026):** continued, compromised 170+ npm packages + 2 PyPI packages — first supply-chain attack to span both ecosystems.
- Major affected maintainers/packages: **Zapier, PostHog, Postman**, CrowdStrike's namespace.

### Root cause
This wasn't a single vulnerability — it was the **chained consequence of long-lived tokens existing in the ecosystem**. The first wave likely used npm tokens stolen during the Nx s1ngularity attack. After that, each infection harvested more tokens, which infected more packages, recursively.

### Why it matters
- **First wormable npm attack.** Previously, supply-chain attacks were one-off events. Shai-Hulud changed the game — it scales exponentially.
- CISA issued an official advisory.
- The defensive lesson: **short-lived, scoped tokens** (Trusted Publishers / OIDC), **mandatory `--ignore-scripts`** in CI, and **dependency cooldown** policies (don't install packages until they're a few days old).

---

## Incident 3: TanStack Supply Chain Attack — May 11, 2026 *(directly React-related)*

### What happened
On **May 11, 2026** between 19:20 and 19:26 UTC, an attacker published **84 malicious versions across 42 `@tanstack/*` npm packages** — including **`@tanstack/react-router`** (12.7M+ weekly downloads), `@tanstack/react-start`, `@tanstack/router-core`, and the routers for Vue/Solid as well. They were live on npm for roughly **20–26 minutes** before takedown.

### The malicious payload
- Every compromised package contained a new file: **`router_init.js`**, a 2.3MB obfuscated blob.
- The payload was a credential stealer targeting CI systems specifically — it exfiltrated **AWS, GCP, Kubernetes, HashiCorp Vault credentials, GitHub tokens, SSH keys, and `.npmrc` contents**.
- It was also a **worm**, hardcoded to spread to other TanStack packages and dynamically discover packages by searching for compromised maintainers' other work.

### Root cause — three chained GitHub Actions vulnerabilities
This is the most technically sophisticated of the bunch. **No npm tokens were stolen, no accounts were compromised** — the attacker hijacked TanStack's own CI pipeline.

1. **The "Pwn Request" pattern:** The attacker forked the `TanStack/router` repo, renamed it (`zblgg/configuration`) to evade fork searches, and opened a PR. A vulnerable workflow used `pull_request_target`, which gave the *attacker's PR code* access to the base repo's secrets context.
2. **GitHub Actions cache poisoning:** The malicious workflow run wrote a **poisoned pnpm store** into the shared GitHub Actions cache that crosses the fork↔base trust boundary.
3. **OIDC token extraction from runner memory:** When the legitimate release pipeline ran later, it pulled the poisoned cache and the attacker **extracted the OIDC token from the runner process's memory**, then used it to publish the malicious packages **through TanStack's own legitimate Trusted Publishers flow**.

### Why this one is scary
- It's the **first documented supply-chain attack with valid SLSA provenance.** The malicious packages were *cryptographically attested* as having come from TanStack's real CI pipeline — because they did. This broke the assumption that provenance attestations alone prove a package is safe.
- **No long-lived secrets were involved.** TanStack had already moved to Trusted Publishers (the recommended fix after s1ngularity). This attack showed even Trusted Publishers can be subverted if the upstream CI is compromised.
- React apps are everywhere — `@tanstack/react-router` is in countless production codebases.

### Aftermath
- TanStack reverted, republished clean versions, and made the postmortem public.
- The blast radius spread to **Mistral AI, UiPath (65 packages), OpenSearch, Guardrails AI** as the worm propagated — totaling 170+ affected packages by end of day.
- Attributed to threat group **TeamPCP** (also tracked as DeadCatx3, PCPcat, ShellForce, CipherForce), who also hit Aqua Security's Trivy (March 2026) and Bitwarden CLI (April 2026).

---

## The pattern across all of these incidents

| Lesson | Why it matters |
|---|---|
| **Long-lived secrets in CI are toxic.** | s1ngularity stole a long-lived npm token → enabled Shai-Hulud → enabled TanStack. One leak cascades for months. |
| **`pull_request_target` is a sharp knife.** | Used incorrectly, it gives PR code access to repo secrets. Both Nx and TanStack fell to misuses of this. |
| **`npm ci --ignore-scripts` is your friend in CI.** | Most of these payloads ran in `preinstall`/`postinstall` hooks. Disabling lifecycle scripts during CI install neutralizes them. |
| **Dependency cooldown periods save you.** | A simple policy of "don't install package versions less than N days old" would have blocked every one of these — the malicious versions all lived for hours, not days. |
| **Trusted Publishers / OIDC ≠ invincible.** | TanStack proved attackers can poison the CI environment itself. Defense in depth still matters. |
| **Browser secret hygiene matters even in the terminal.** | These payloads scan for `.npmrc`, `.gitconfig`, SSH keys, wallet files — anything sensitive on disk. Use credential helpers, not files. |

---

## How to talk about these in the interview

If asked "tell me about recent supply chain attacks," you can say:

> "The npm ecosystem went through a really rough year. It started with the **Nx s1ngularity attack** in August 2025, where a bad GitHub Actions workflow leaked Nx's publishing token. A month later, those stolen tokens helped fuel **Shai-Hulud**, the first self-replicating npm worm — it harvested credentials from victims and used their npm tokens to infect more packages, scaling exponentially. By May 2026, attackers had evolved enough to hit **TanStack**, including `@tanstack/react-router` which is used in a huge number of React apps. That attack chained three GitHub Actions bugs to subvert the supposedly-safer Trusted Publishers system and publish malware with *valid SLSA provenance*. The arc shows the threat model is shifting from 'protect the maintainer's password' to 'assume the entire CI pipeline is the new attack surface.'"

---

## Sources

- Wiz: https://www.wiz.io/blog/critical-vulnerability-in-react-cve-2025-55182
- SentinelOne: https://www.sentinelone.com/blog/protecting-against-critical-react2shell-rce-exposure/
- Checkmarx: https://checkmarx.com/zero-post/react2shell-cve-2025-55182-deserialization-to-remote-code-execution-in-react-and-next-js/
- Microsoft Security Blog: https://www.microsoft.com/en-us/security/blog/2025/12/15/defending-against-the-cve-2025-55182-react2shell-vulnerability-in-react-server-components/
- Better Stack (follow-up vulns): https://betterstack.com/community/guides/scaling-nodejs/react-server-security-vulnerabilities/
- Palo Alto Unit 42: https://unit42.paloaltonetworks.com/cve-2025-55182-react-and-cve-2025-66478-next/

### Sources for additional incidents

- Nx s1ngularity postmortem (official): https://nx.dev/blog/s1ngularity-postmortem
- Wiz on s1ngularity: https://www.wiz.io/blog/s1ngularity-supply-chain-attack
- StepSecurity on s1ngularity: https://www.stepsecurity.io/blog/supply-chain-security-alert-popular-nx-build-system-package-compromised-with-data-stealing-malware
- Unit 42 on Shai-Hulud: https://unit42.paloaltonetworks.com/npm-supply-chain-attack/
- CISA advisory on Shai-Hulud: https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem
- Microsoft Security on Shai-Hulud 2.0: https://www.microsoft.com/en-us/security/blog/2025/12/09/shai-hulud-2-0-guidance-for-detecting-investigating-and-defending-against-the-supply-chain-attack/
- TanStack postmortem (official): https://tanstack.com/blog/npm-supply-chain-compromise-postmortem
- Wiz on TanStack/Mini Shai-Hulud: https://www.wiz.io/blog/mini-shai-hulud-strikes-again-tanstack-more-npm-packages-compromised
- Snyk on TanStack: https://snyk.io/blog/tanstack-npm-packages-compromised/