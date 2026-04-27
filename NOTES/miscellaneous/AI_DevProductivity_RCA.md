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

Q5. Are you sending our proprietary code and Jira data to a public LLM? How is that safe?

Q6. Isn't it expensive to call an LLM every time a Jira ticket is created?

Q7. What if the AI suggests a fix that 'looks' right but introduces a subtle logic bug or a security flaw?

Q8. This works on your local IDE, but how do we scale this to a team of 50 developers?

