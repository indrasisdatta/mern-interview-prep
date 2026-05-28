### 1. Developer productivity: Jira issue RCA and MR creation

I implemented two independent agents: a Fix Agent and a Reviewer Agent
 
 i. Fix agent: automates bug RCA by integrating Jira and GitLab via MCP. It retrieves defect context, analyzes stack traces and relevant code, generates a fix, validates it using lint/tests, and creates a merge request with a structured explanation.

- Fetch context: agent uses a custom Jira tool to pull defect details using Jira ID. 
- Analyze & fix: Since the code is already open in IDE, AI performs a RCA and suggests a code fix immediately. 
- Automate admin: Once the fix is done, it uses a custom Gitlab tool to automatically create the MR. 

ii. Reviewer Agent: implemented using Agent Skills - runs in an independent session, fetches the MR diff and provides structured review feedback. 
 - Uses skills/Reviewer.md
 - Fetches MR via GitLab MCP
 - Analyzes: diff, context, Adds comments / suggests fixes
 - Approve/reject (human-confirmed) 

Gitlab rule: prevent author approval.

 The reviewer agent uses a GitLab MCP tool authenticated via a PAT. The actions it can perform - like commenting or approving MRs are governed by the token's permissions and GitLab's approval rules. This ensures role-based access control is preserved

#### Questions:
Q1. How do you ensure the fix is correct? (Control / guardrails)
  - Pre-commit hook: Husky runs ESLint and Prettier. 
  - Pre-push hook: Husky triggers axe-core for automated accessibility checks and runs Unit Tests
Q2. How exactly is RCA done? 
    - The agent extracts the error type and file path from the Jira description.
    - If it finds a correlation_id, it uses a Kibana MCP Tool to fetch the specific JSON logs. This provides the "runtime state"—what the user was doing when the app crashed.
    - It uses the file paths from the logs to open the relevant React/Node.js files in your IDE. 
    - It maps the error message (e.g., Cannot read property 'map' of undefined) to the exact line of code. It then reasons: "The Kibana logs show the API returned a 404, but the code doesn't check if the data exists before mapping."

Q3. How do you evaluate? 

- % of bugs auto-resolved
- time saved per ticket
- MR acceptance rate

Q4. How do you handle large codebases? Does the LLM get overwhelmed if the RCA spans 20 different files?  
- For Backend Issues: When a Jira ticket includes a custom field correlation_id, my agent uses the Kibana tool to fetch the exact server-side logs. This gives the AI the specific stack trace needed to identify the backend failure point.
- For Frontend Issues: Since I haven't integrated a client-side tracker like Sentry yet, the agent uses Pattern Matching. 
    - It takes the URL or component name from the Jira description and uses the IDE's workspace index to locate the relevant React files. From there, it reasons through the logic to find the bug. 
    - Copilot's @workspace index acts as a built-in RAG system

(Future plan: Do Sentry integration for Frontend, explore RAG for code)

Q5. Are you sending our proprietary code and Jira data to a public LLM? How is that safe?
- We use Github Copilot Enterprise, which ensures our code and prompt are not used for model training. 
- Only diffs and relevant files are sent 
- Allowed using PAT 
- Human in the loop - for MR creation and approval 
- Common middleware to sanitize PII 
- Hooks (specifically PreToolUse)  allow you to intercept an agent's intent before it calls an MCP tool.
- MCP Proxy: The Security receives the tool call, runs a regex-based scrubber (like mcp-patterns), and then forwards the clean data to the actual target server.
```
Copilot -> Security Proxy MCP -> [Jira, GitLab, Kibana, etc.]
```

```
Agent (LLM reasoning)
 ↓
PreToolUse Hook (validate intent & tool call)
 ↓
Security Proxy MCP (sanitize request)
 ↓
MCP Tool (Jira/GitLab/Kibana)
 ↓
Security Proxy MCP (sanitize response)
 ↓
Agent (LLM reasoning on clean data)
 ↓
Post-validation (tests, policies, human approval)
```

Q6. Isn't it expensive to call an LLM every time a Jira ticket is created?  
We use Model Routing: 
   - a cheaper model (GPT-4o-mini) for log parsing 
   - a 'reasoning' model (Claude 3.5 Sonnet) only for the actual code fix.

Q7. What if the AI suggests a fix that 'looks' right but introduces a subtle logic bug or a security flaw?  
 - Husky hooks are executed while committing and pushing the code 
- Review agent does an additional check

Q8. This works on your local IDE, but how do we scale this to a team of 50 developers?
- Move the MCP tools from a local setup to a service-side MCP or CI/CD integrated bot. 

Q9. Security measures
 - Identity and access control 
    - Use scoped PAT with least privilege
    - Enforce platform-level controls (Gitlab approval rules, no self approval)
    - Separate identities for fix agent (write access), reviewer (read, comment, approve)
 - Sensitive data protection 
    - Don't send full codebase, send minimal diffs and relevant files 
    - PreToolUse hook (checks whether tool is allowed, sending too much data, input contains sensitive fields)
    - Security proxy MCP (sanitize req and res to remove sensitive data and PII)
 - Prompt injection prevention
    - Treat Jira, gitlab, Kibana logs content as untrusted 
    - Tool calls are schema validated and not directly executed from model output
    - MCP tool function shouldn't expose delete and admin_access functions, so even if prompt is bypassed, it can't be executed
 - Secrets protection
    - secret scanning (code, logs, prompts)
    - Never send secret, API keys to LLM. Store it in env file
 - Human in the loop
    - No auto-merge to production 
    - CI validaiton + manua l approval

Q10. Cost optimization  


Q11. Performance metrics 

Q12. Scaling 


What if logs are missing?
What if error is intermittent?
What if multiple services are involved?



#### Copilot - Common Hook patterns:
- Block dangerous commands: PreToolUse hook to deny rm, DROP table etc. 
- Auto-format after edits: PostToolUse hok to run Prettier/ESLint on JS files 
- Audit Tool usage: PostToolUse hook logs every invocation to a log file 
- Approval gating: PreToolUse with permissionDecistion: ask for sensitive tools
- Inject project context: SessionStart hook injects branch, version and env details 

#### Security Considerations

- Review Hook Scripts: Inspect all scripts before enabling - especially in shared repos
- Least Privilege: Hooks should only have access to what they need
- Validate All Input: Sanitize stdin input to prevent injection attacks
- Secure Credentials: Never hardcode secrets - use env variables or secure storage
- Protect Hook Files: Use chat.tools.edits.autoApprove to prevent agent self-edits