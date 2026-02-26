AGILE

Roles

    Product Owner (PO): The voice of the customer. They decide what needs to be built by managing the Product Backlog. They focus on ROI and value.

    Scrum Master: The "Coach." They aren't a project manager; they are a servant leader who ensures the team follows Scrum theory and removes any blockers (impediments) slowing the team down.

    Developers: The people doing the work. In Agile, "Developer" refers to anyone creating the increment (coders, designers, testers). They are self-organizing and decide how the work gets done.

Events:

    The Sprint: The container for all other events. Usually 1–4 weeks long where a "Done" product increment is created.

    Sprint Planning: The team meets to decide what can be delivered in the upcoming Sprint and how that work will be achieved.

    Daily Scrum (Stand-up): A 15-minute daily check-in for the Developers to sync. It’s not a status report for the manager; it’s a planning session for the next 24 hours.

    Sprint Review: Occurs at the end of the Sprint to demo the work to stakeholders and get feedback.

    Sprint Retrospective: The most important event for improvement. The team looks inward to discuss what went well, what didn't, and how to improve the process for the next Sprint.

Artifacts 

    Product Backlog: An ordered, evolving list of everything needed in the product. It’s the single source of truth for requirements.

    Sprint Backlog: The specific set of items from the Product Backlog chosen for the current Sprint, plus a plan for delivering them.

    Increment: The sum of all the Product Backlog items completed during a Sprint, which must meet the "Definition of Done" and be usable.

Acceptance Criteria (AC)
The "What" — Unique to every task. Acceptance Criteria are the specific requirements that must be met for a particular User Story to be considered complete from a functional perspective. These are usually written by the Product Owner.

Focus: Functionality and business logic.

Example (for a "Login" feature):
User can log in with a valid email and password.
An "Error" message appears if the password is wrong.
There is a "Forgot Password" link that works.

Definition of Done (DoD)
The "How" — Universal for every task. The DoD is a shared, standardized checklist that the entire team agrees to for every piece of work. It ensures global quality and prevents "technical debt."

Focus: Quality, compliance, and "shippability."

Example (applies to every story):
Code is peer-reviewed.
Unit tests are passed.
Documentation is updated.
Deployed to the staging environment.

Definition of Ready (DoR): The criteria a task must meet (clear, estimated, small) before a team will even start it. 
 - Acceptance criteria are defined (e.g., "Verify error on invalid password")
 - UI mockups are attached
 - the story is estimated at 3 points
 - there are no external dependencies.

### 1. Project Management & Agile 


1.1. Conflict in Scrum: If a Product Owner adds a critical feature in the middle of a Sprint, how do you handle it?
    My priority is to protect the team's focus while remaining aligned with business value. First, I would ask the Product Owner to help me understand the urgency.

    If it's truly critical, I would facilitate a conversation between the PO and the Dev team to see what can be swapped out. We never just 'add' work, because that leads to technical debt and missed deadlines.

    Finally, I would use the Sprint Retrospective to ask why this 'critical' item appeared mid-sprint. Was it a surprise from a client, or did we fail in our Refinement sessions? My goal is to prevent this 'mid-sprint churn' from becoming a habit.

1.2. Estimation: "How do you estimate story points for a complex React task vs. a Backend API task?"
- Check historical Spring velocity (e.g. in last 3 sprints, team completed 30 SP on an avg => 80 hrs per person x 10 people = 800 )

Estimate - 5, 8, 13 points
If > 13, break it into multiple sub-tasks 

1.3. Failed Sprints: "Tell me about a time your team couldn't meet a sprint goal. What did you do during the Retrospective?"
- 3 prod bugs came up, so we had to move 2 features to product backlog for next sprint 
- In Retrospective meeting, we did a RCA and discussed what caused it and how we could avoid it in future 
- Caused due to inconsistent timezone in API response (old data sent UTC but new data sent in US based timezone)
- Fix: Updated data to always return UTC and based on user browser timezone, we converted it in the UI
- Changed our DoD for global time zone check

1.4. Process Improvement: "Can you describe a situation where you streamlined a development process (e.g., automated deployments or code reviews)?"
 - Saved deployment cycles by adding Git pre-commit and pre-push hooks using Husky library 
 - Updated Jenkins pipeline (npm ci) and UI build assets
 - Collaborated with SRE team to integrate SonarQube for low-level code reviews, allowing us to focus on high-level architecture and logic 
 
### 2. Behavioral & Situational (STAR Method)
Use the STAR technique (Situation, Task, Action, Result) for these.

2.1. Conflict Resolution: "Describe a time you had a technical disagreement with a colleague. How did you reach a consensus?"
 - BE wanted to send huge API response but UI wanted structured proper 
 Solution:
 - The server would handle the data-heavy calculations (sums, averages, and sorting). This is more efficient at the database/server level and reduced the payload size.
 - The UI team agreed to handle data defensive logic. Since the BE team was short-staffed, they couldn't guarantee every non-essential field would be populated

2.2. Handling Pressure: "Tell me about a project where you had to meet an extremely tight deadline. How did you prioritize your work?"
- During initial onboarding, it took time to understand existing code and deliver on time
- Used AI tools properly (Gemini, Github Copilot Ask mode) to understand the existing code base and ask for solutions
- Added VS code tools like SonarLint, ESLint so that most issues could be handled during development time only instead of waiting till git commit/push and Sonar checks

2.3. Ownership: "Describe a situation where you took the lead on a task that wasn't officially your responsibility."
(Aligned personal learning with company's needs)
- Our product roadmap had a long-term goal for an AI chatbot
- As I was already studying Generative AI and LangChain in my spare time, I developed a Proof of Concept (POC) for a RAG to answer based on uploaded files 
- This POC was built only in spare time without impacting current sprint deliverables 
- Showed working prototype to stakeholders 
- Specialized AI Engineer took it forward to integrate in production 

2.4. Dealing with Failure: "Tell me about a mistake you made in a recent project. How did you handle the fallout and what did you learn?"
- Trying to take too many tasks at once (dev work, PR, prod bugs)
- Split the prod bugs with another senior dev
- For peer reviews, either one of us could approve 
- Delegated the current sprint tasks to 2 Junior/mid devs

### 3. Leadership & Mentoring
Even if the role isn't "Lead," Capgemini looks for mentoring qualities in MERN developers.

3.1. Code Quality: "How do you give constructive feedback during a code review to a junior developer who keeps making the same mistakes?"
- Try to understand the gap (tech knowledge or process related)
- Connect separately to explain the Definition of Done
- Give another Jira task as sample reference for learning
- Process related can be handled by tools like SonarLint, ESLint, git hooks etc
- Tech knowledge has to be updated by self learning, encourage to learn and use AI efficiently

3.2. Knowledge Sharing: "How do you stay updated with the fast-moving MERN ecosystem, and how do you share that knowledge with your team?"
- Follow YouTube channels and Medium articles
- In-house community called Yammer - people share posts. We can connect with them directly to learn more. That's how I started learning Gen AI.
- We conduct a session once or twice a month where any one can present a topic. It doesn't always have to be related to the project directly but something we can make use of.

3.3. Delegation: "If you are overloaded with tasks, how do you decide what to delegate and what to handle yourself?"

### 4. Client & Communication
4.1. Simplifying Tech: "How would you explain the benefits of 'Server-Side Rendering' (Next.js) to a non-technical client who only cares about costs?"
- SSR helps with SEO and TTFB to associate impacts 
- Google search is more likely to show results at the top 
- (Bounce rate) If TTFB > 3 secs causes 30% bounce rate. SSR reduces this time, so users would stay and increases chances of higher revenue 
- (Conversion rate) With server handling most of the work, the app can operate in low 4G connection making accessible to a wider audience

4.2. Handling Feedback: "What would you do if a client or stakeholder is unhappy with a feature you spent weeks developing?"
- Communication and understand the problem (UI issue/Functional issue/Value issue)
- If the acceptance criteria was not met, then Testing/DoD failed 
- AC met then Refinement process failed 
- Shorten the feedback loop (show them wireframe/demo in 3 days)
- Refine our Definition of Ready (story enters sprint only after stakeholders sign off on mock ups and logic flow)
- Update Definition of Done to include Stakeholder approved validation steps

