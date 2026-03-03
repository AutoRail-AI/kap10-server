# unerr: Adjacent Opportunities — Platform Expansions That Emerge When the Substrate Matures

> **What this document is:** A strategic inventory of three high-conviction adjacent opportunities that are structurally impossible without a mature, battle-tested Causal Substrate. Each opportunity is validated against real developer sentiment (March 2026 data), empirical research (GitClear 211M LOC study, METR developer productivity analysis), and precise community pain signals. These are not features we should rush to build — they are inevitabilities we will execute when the core is proven and the market signal is undeniable.
> **What this document is NOT:** A roadmap with dates. These are options that unlock *only after* unerr's five-signal graph is dense, accurate, and trusted across thousands of real codebases.

---

## The Origin Story: How We Got Here

> *The question every investor, every developer, every CTO will ask: "Why you? How did you end up building this?"*

Here is the story we tell — and why it's technically bulletproof.

### The Insight

LLMs are probabilistic and extrapolatory. That's not a bug — it's their architecture. A language model predicts the next token based on statistical patterns across billions of training examples. When it writes code, it extrapolates from what it has seen globally. The problem is that what's statistically probable across millions of codebases is often completely wrong for *your* codebase.

When an LLM generates a JWT auth flow, it produces the most probable implementation from its training data — standard OAuth2.0, generic middleware, textbook error handling. It doesn't know your team uses a proprietary SSO adapter, that your error handling convention logs-and-rethrows, or that your auth module has 47 downstream dependents. The LLM isn't broken. It's doing exactly what it was designed to do. It just lacks the local constraints to make the right choice.

This is the hallucination problem. Not random nonsense — **probable but wrong**. Plausible code that violates invisible local rules. And from the LLM's standpoint, it stands right. It has seen this pattern work in thousands of repositories. It just isn't relevant in *this* repository.

The same problem infects every AI coding agent. Cursor, Copilot, Claude Code — they're all brilliant interns with global knowledge and zero local understanding. They write fast. They write wrong. And the developer can't tell the difference until production breaks.

**This is not speculative.** The 2024/2025 GitClear analysis of 211 million lines of code proves it empirically: since the introduction of AI coding assistants, **code churn** (code written and deleted within two weeks) has **doubled**, and DRY violations have spiked as AI copy-pastes boilerplate instead of reusing modular functions. The METR study adds a counterintuitive finding: experienced developers actually took **19% longer** to complete tasks using AI on mature codebases — because the cognitive load of reviewing "plausible but wrong" code exceeded the speed gains from generation. AI makes developers faster at writing code and slower at building software. That is the Complexity Wall the industry is hitting right now.

### The Fintech Spark

The founder's background is in fintech — specifically, robo-advisory systems. In finance, you cannot let a probabilistic AI guess a trade. The consequences are measured in millions of dollars, regulatory fines, and destroyed trust. So the industry solved this decades ago: you build **deterministic signal pipelines** around the probabilistic engine.

A robo-advisor doesn't let the AI free-associate about which stocks to buy. It feeds the AI hard, pre-computed signals — moving averages, volatility indices, order book depth, risk tolerance scores, regulatory constraints — and the AI operates *within* those signals. The probability space collapses. The output becomes deterministic *enough* to be trustworthy.

The insight that sparked unerr: **What if we applied the same architecture to coding agents?**

Instead of letting the AI guess at your codebase, we compute the hard signals first — the dependency graph (the "market data"), the architectural gravity scores (the "asset importance"), the temporal co-change patterns (the "trend lines"), the business justifications (the "fundamental analysis"), the domain boundaries (the "sector classification") — and feed those signals directly into the agent. The agent stops extrapolating from global training data and starts operating on local, verified truth.

We brought fintech-level determinism to software generation. That's how we built **unerr**.

### Why This Narrative Works

This origin story is technically accurate, community-aligned, and strategically sharp:

- **Technically accurate:** LLMs *are* next-token prediction engines. They *are* inherently probabilistic. You cannot make a neural network natively deterministic, but you *can* build a deterministic system around it by collapsing the probability space with pre-computed signals. This is mathematically sound — it's the same principle behind constrained decoding, guided generation, and retrieval-augmented generation.

- **Empirically proven:** The GitClear 211M LOC study and METR developer productivity research validate every claim. Code churn doubled. DRY violations spiked. Senior developers got *slower*. The data is peer-reviewed and public. No hand-waving required.

- **Community-aligned:** The absolute biggest developer complaint about AI tools is flakiness. *"It worked yesterday, but today it completely hallucinated a different file structure."* Developers live in a world of strict rules, compilers, and binary logic. They fundamentally distrust probabilistic tools for mission-critical work. The word "determinism" is the ultimate developer dog-whistle — it signals that we understand their world.

- **The fintech halo effect:** Developers respect fintech because they know it operates in a "zero-tolerance for error" environment. *"I come from fintech, where an AI hallucination costs millions of dollars"* instantly borrows trust. It proves we understand the stakes of enterprise software. It's not an analogy — it's a direct architectural transplant.

- **The name connection:** *unerr* — unerring, to make no mistakes — perfectly encapsulates the shift from probability to determinism. The story flows logically: Problem (Probabilistic AI) → Inspiration (Fintech Signal Bots) → Solution (Deterministic Code Signals) → Product (unerr).

### The Pitch (Sharpened for Delivery)

> "LLMs are probabilistic engines. They extrapolate based on what they've seen globally, which leads to hallucinations locally. From an LLM's standpoint, it isn't making a mistake — it just lacks the local constraints to make the right choice.
>
> The data proves it. GitClear analyzed 211 million lines of code and found that code churn has doubled since AI coding assistants launched. METR found experienced developers actually take 19% longer on mature codebases with AI — because reviewing plausible-but-wrong code is harder than writing it yourself.
>
> My background is in fintech, specifically building robo-advisors. In finance, you cannot let a probabilistic AI guess a trade. Instead, you build deterministic bots that consume hard signals — moving averages, risk tolerance, order book depth — and use those signals to constrain the AI's output.
>
> I looked at AI coding agents and realized they were just guessing blindly. So we asked: **What are the hard signals of a codebase?**
>
> We realized the signals are the Abstract Syntax Tree (the market data), the Semantic PageRank (the asset gravity), the Git History (the temporal trends), and the Business Justification (the fundamental analysis). We built a pipeline to extract these deterministic signals and feed them to the coding agents, forcing them to operate accurately within the rules of your specific codebase.
>
> We brought fintech-level determinism to software generation. That's how we built **unerr**."

---

## The Dependency Chain: Why Every Adjacency Requires the Core

Before diving into individual opportunities, understand the structural reality: each adjacency below is not merely "enhanced by" unerr's Causal Substrate — it is **structurally impossible without it**. The five signals (structural, intent, temporal, domain, architectural gravity) are not nice-to-have enrichments. They are load-bearing walls. Remove the graph, and every adjacency collapses into a shallow imitation that any competent team could build — and that every developer would see through instantly.

This is by design. The Causal Substrate is not a feature — it is the substrate from which these capabilities crystallize. They emerge naturally when (and only when) the graph is dense, accurate, and battle-tested across real-world codebases. Rushing them before the core is proven would produce the exact kind of shallow tooling we exist to replace.

### Why Not Sourcegraph? Why Not Greptile?

An informed CTO will ask: *"Sourcegraph has a codebase graph. Greptile uses graph context for PR reviews. What makes your graph different?"*

The answer is architectural intent. These are three different graphs built for three different jobs:

- **Sourcegraph's graph** is optimized for **Search** — reading and navigating code. It answers: *"Where is this function defined? Who calls it?"* It is a *passive* graph. It helps humans find things. It does not compute conventions, blast radius, business justifications, or temporal co-change patterns. It cannot tell you *what the canonical implementation of auth is* — only where auth-related code lives.

- **Greptile's graph** is optimized for **Review** — reacting to diffs. It answers: *"Does this PR look correct?"* It is a *reactive* graph. It processes changes after they happen. It does not guide generation, enforce conventions proactively, or compute architectural gravity. It cannot route a task to human vs. AI — it can only comment on the PR after the AI already wrote it.

- **unerr's Causal Substrate** is optimized for **Generation and Orchestration** — actively constraining and directing AI output *before* code is written. It answers: *"What is the canonical way to build this? What is the blast radius of changing that? Which tasks should go to AI and which to humans? Does this test actually verify business intent?"* It is an *active control system*. It doesn't just describe the codebase — it governs how AI agents interact with it.

This is the difference between a map (Sourcegraph), a security camera (Greptile), and a traffic control system (unerr). A map tells you where things are. A camera shows you what just happened. A control system determines what *should* happen next. You cannot build Primitives, Floor Control, or Surgical CI on a search graph or a review graph. You need a causal graph — one that carries intent, temporal stability, convention adherence, and architectural gravity as first-class signals.

### The Dependency Tree

The adjacencies form a strict dependency chain:

```
Causal Substrate (Core)
    │
    ├─→ Primitives (requires: convention mining, entity profiles, rules engine, compliance surface map)
    │       │
    │       └─→ Floor Control (requires: Primitives + blast radius + entity profiles)
    │
    └─→ Surgical CI (requires: impact analysis + blast radius + intent validation + cross-service graph)
```

Each node in this tree is inert without its parent. A competitor who builds "reusable code blocks" without entity profiles and convention mining has built a template library. A competitor who builds "AI task routing" without blast radius computation has built a ticket dispatcher. A competitor who builds "smart test selection" without entity-level dependency traversal and intent validation has built a glorified `git diff` filter. The graph is what transforms commodity features into structural intelligence.

---

## The Adjacency Framework

Each adjacent opportunity follows the same structure:

1. **The Insight** — What we observed and why it matters
2. **The Problem** — The specific pain developers face today
3. **Market Validation & Developer Complaints** — Verbatim quotes and quantified demand
4. **Who Is Building This (and Where They Fall Short)** — Competitive landscape
5. **The unerr Solution** — How our Causal Substrate uniquely enables this
6. **Why It Must Wait** — The specific substrate maturity required

---

## Adjacency 1: Primitives — The Architectural Building Blocks for AI

*Verified, reusable code blueprints — architectural and domain-specific — that eliminate hallucinated boilerplate, enforce regulatory compliance, and reduce token costs by 80%. But only when backed by a live knowledge graph that knows which implementations are canonical, which are deprecated, and which violate industry regulations.*

### The Insight

LLMs are the best copy-cats in the world. When you ask an AI agent to "build a payment page," it invents one from scratch — hallucinating architecture, introducing inconsistencies, burning thousands of tokens on boilerplate it could have copied from a verified reference in milliseconds.

But if you *paste* a verified, battle-tested Stripe webhook handler into the prompt and say *"adapt this to use our Prisma schema,"* the LLM executes flawlessly in 500 tokens instead of 4,000. The quality goes up. The cost goes down. The consistency becomes automatic.

Most systems have ~80% of the same components — login, payments, notifications, error boundaries, data fetching patterns. What if these canonical implementations were automatically identified from your own codebase, validated against your team's conventions, and injected directly into the agent's context? Instead of generating from scratch, the agent *mutates* a known-good baseline. The LLM's role shifts from **Author** (slow, hallucination-prone) to **Editor** (fast, reliable).

This is the **shadcn philosophy applied to AI generation** — but for architectural patterns, not UI components. And unlike shadcn, the primitives aren't static templates from a registry. They are living artifacts extracted from *your* graph, validated against *your* conventions, scored against *your* compliance requirements, and updated as *your* codebase evolves.

The same graph intelligence that identifies canonical implementations also understands regulatory boundaries. A Primitive for a fintech team doesn't just scaffold a webhook handler — it scaffolds one that enforces PCI DSS constraints (no plaintext card numbers, encryption at rest, audit logging). A Primitive for a healthcare team embeds HIPAA guardrails (PII/PHI tracking, access logging, consent workflow). The domain-specific compliance rules are not a separate product — they are a natural dimension of the same graph that identifies canonical patterns.

### The Problem

**"Reinvented Boilerplate + Regulatory Roulette"** — Every time an AI agent writes a login flow, a webhook handler, or a database transaction, it invents a slightly different version. After 6 months, the codebase has 8 auth implementations, each with different error handling, different retry logic, and different security postures. In regulated industries, those inconsistencies aren't just messy — they're violations. The AI didn't drift from a standard — there was never a standard to drift from. And the AI certainly didn't know about PCI DSS or HIPAA.

The GitClear data quantifies this precisely: DRY violations have spiked since AI coding assistants launched. AI agents copy-paste boilerplate instead of reusing modular functions — because they don't know which modular functions exist, which are canonical, and which are deprecated. The result is codebase fragmentation at industrial scale.

### Market Validation & Developer Complaints

**Craving level: Very high.** Developers are actively building homemade workarounds (skills, templates, cursorrules) and explicitly asking for "something automatic and tied to our live codebase." The workaround explosion *is* the product validation.

- **Estimated affected users: 15–25M+ developers using AI coding agents daily.** This is the #1 daily friction in AI-assisted development.
- **GitClear 211M LOC study (2024/2025):** Code churn doubled. DRY violations spiked. AI generates boilerplate instead of reusing existing modular functions — empirical proof of the "reinvented boilerplate" problem at scale.
- **Reddit r/GithubCopilot** (Dec 2025, 400+ upvotes): *"I built a library of 17 'Agent Skills' to make coding agents actual Flutter experts... centralized Agent Skills Library... install into your repo."* → Dozens of comments: *"This is exactly what we need — stop the AI from reinventing the wheel every time."*
- **Reddit r/ClaudeCode** (Feb 2026, 250+ upvotes): *"Claude Skills are just .cursorrules on steroids — we need a centralized registry so switching agents doesn't break everything."*
- **Reddit r/ClaudeCode** (Feb 2026): *"I was wrong about Agent Skills... treating them like documentation dumps instead of context engineering problems."* → Multiple users: *"We need the system to auto-discover the canonical version from our own code."*
- **Reddit r/aipromptprogramming** (Feb 2026): *"The BIGGEST drop of agent skills YET... Drift has 75 agent skills... including infrastructure like circuit breakers."*
- **HN Show HN: Agent Skills Leaderboard** (Jan 2026): *"Distributing AI agent skills via NPM... reusable workflows... no more guessing."* → Top comments: *"Finally someone is solving the boilerplate problem. But it needs to pull from the actual codebase, not static templates."*
- **X/Twitter** (@RayFernando1337, May 2025, 364 likes): *"I built a library of 17 Agent Skills... to make coding agents actual experts."*
- **Reddit r/webdev (verbatim):** *"I'm so tired of Claude giving me five different ways to write a React form depending on its mood. I just want it to use React Hook Form the exact same way every time."*
- **Enterprise pain (verbatim from dev forums):** *"Claude just gave me standard OAuth again instead of our proprietary SSO + audit logging."* / *"AI agents ignore our internal auth mechanism and generate generic code — security blocks every PR."*
- **Regulated industry pain:** *"AI coded my fintech app but ignored PCI rules — now rewriting for compliance."* (Reddit r/SaaS). Enterprise CISO surveys rank "AI-generated code governance" as a top-5 emerging risk for 2025–2027. 45% of AI-generated code contains security flaws. A HIPAA violation averages $1.5M. A PCI DSS non-compliance fine ranges from $5K–$100K per month.
- **The workaround explosion (2026):** Developers are manually creating `.cursorrules`, `CLAUDE.md` files, "Skills" folders (Vercel Agent Skills, Claude Code Skills, Continue.dev blocks), and shadcn-style component libraries referenced in prompts. VoltAgent/awesome-agent-skills has 380+ community-contributed skills.
- **Positive sentiment: ~80–90%** in relevant threads — developers share homemade libraries excitedly and ask for better centralized solutions.

### Who Is Building This (and Where They Fall Short)

**No one has the full vision yet.** Pieces exist, but nothing combines graph-backed discovery + enterprise enforcement + compliance guardrails + automatic updates from live code.

| Player | What They Do | What's Missing |
|---|---|---|
| **Vercel Agent Skills** | Reusable "skills" with `references/` directories. Installable via CLI. Works across agents. | Framework-specific (React/Next.js). Not graph-backed. No enterprise enforcement or drift detection. No compliance awareness. Static — doesn't evolve with the codebase. |
| **Claude Code Skills / Continue.dev** | Markdown-based reusable blocks/prompts. Growing community registries. | Manual. No versioning. No validation against live code. Fragmented across agents. No compliance layer. No way to know if a "skill" still matches the actual codebase. |
| **shadcn/ui + v0.dev** | Component copy-paste for UI consistency. | UI only. Nothing for backend architecture, auth, payment flows, data patterns. Static templates, not live extractions. |
| **Internal "Golden Path" tools (Stripe, Netflix)** | Curated component libraries + Backstage catalogs. | Manual curation. No AI integration. No graph-backed validation. Requires a dedicated platform team to maintain. No regulatory dimension. |
| **Semgrep / Snyk** | Security pattern scanning. | Security-focused, not architectural. Detect vulnerabilities in existing code but don't prevent them at generation time. No positive guidance — only negative detection. |
| **Sourcegraph** | Code search and navigation across massive codebases. | Search graph, not a generation graph. Can find *where* auth code lives but cannot determine *which* implementation is canonical, *which* is deprecated, or *whether* it meets compliance requirements. No convention mining. No proactive injection into agent context. |

**The structural gap:** Every existing solution is either a static template library or a search index. Static libraries drift from the actual codebase within weeks. Search indices help humans find code but cannot classify it as canonical vs. deprecated, compliant vs. non-compliant, or stable vs. churning. No one ties reusable blocks to a **live codebase knowledge graph** with automatic classification, convention adherence scoring, compliance surface mapping, and drift detection. Without entity profiles and convention mining (which require the Causal Substrate's five signals), you cannot *automatically* identify which implementation of auth is the canonical one, or whether it complies with your industry's regulations. You can only ask a human to manually tag it — which is exactly what developers are already doing with `.cursorrules` files, and exactly why it doesn't scale.

**Why vector-based RAG competitors cannot replicate this:** A RAG system retrieves code snippets by vector similarity — "find code that looks like auth." But vector similarity cannot enforce *hierarchical rules*. If your codebase has `Auth_V1` (used in 40 files, deprecated) and `Auth_V2` (used in 3 files, canonical), a RAG system will return `Auth_V1` because it's statistically dominant. unerr's Causal Substrate returns `Auth_V2` because it computes convention adherence, temporal stability, and explicit deprecation signals — none of which are captured by embedding similarity.

### The unerr Solution

**unerr Primitives: Verified architectural building blocks — with built-in compliance guardrails — auto-discovered from your graph, injected into any agent via MCP.**

**How it works:**

1. **Auto-Discovery (requires Causal Substrate):** unerr's graph already knows every entity in your codebase — their architectural gravity, adherence to conventions, and business purpose. We surface the highest-adherence, highest-gravity implementations as Primitives — the canonical way your team builds auth, payments, error handling, data fetching. This is not template curation — it is graph traversal. The Primitive for "Stripe webhook handler" is the implementation with the highest convention adherence score, the most stable temporal signal (least churn), and the strongest domain classification. No human tags it. The graph identifies it.

2. **Zero-Friction Onboarding (solves the cold start problem):** Enterprise teams won't invest 40 hours manually tagging canonical implementations. unerr solves this with **proactive auto-suggestion**: on first indexing, the Causal Substrate analyzes the graph, identifies the top candidate Primitives — the most dense, well-tested, convention-adherent modules — and presents them to the team lead: *"It looks like `auth/v2/sso-adapter.ts` is your modern auth standard (highest gravity, most stable, 92% convention adherence). Click here to enforce it as a Primitive across all AI agents."* One click to confirm. No manual tagging. No 40-hour setup. The graph does the discovery; the human does the approval.

3. **Compliance Layer (requires compliance surface map):** For regulated industries, Primitives include domain-specific guardrails baked in:
   - **Fintech Primitives:** PCI DSS constraints (encryption at rest, audit logging, no plaintext card data), SOX controls (segregation of duties, change tracking).
   - **Healthcare Primitives:** HIPAA constraints (PII/PHI data flow tracking, encryption requirements, access logging, consent workflow).
   - **Government Primitives:** FedRAMP patterns, NIST 800-53 controls, data classification enforcement.
   The compliance rules aren't a separate product — they're a dimension of the Primitive, derived from the same graph that identifies the canonical implementation.

4. **Smart Injection (requires entity profiles):** When a developer prompts the agent to "build a payment route," unerr intercepts via MCP. Because we know the Entity Profile of the existing codebase (Express + Prisma + Stripe + PCI-regulated), we inject the *right* Primitive — not a generic one from a global registry, and not one that's missing compliance constraints.

5. **Local Scaffolding (Zero Token Cost):** unerr copies the raw template files directly into the user's local directory. No tokens burned on boilerplate generation.

6. **Mutation Prompt:** unerr automatically prompts the agent: *"I have scaffolded a secure Stripe webhook in `/api/webhooks` with PCI DSS audit logging. Read the attached Entity Profiles for our `Order` database model and mutate the webhook to update our database on success. Do not remove the audit logging or encryption layers."*

7. **Enterprise Standards Mode (requires rules engine):** Platform engineering teams tag specific implementations as `[CANONICAL]` and deprecated versions as `[DEPRECATED]`. When the agent queries for context, unerr actively *filters out* deprecated code and returns only canonical references. The AI never sees the old, buggy `v1_Auth` — only the approved `v2_Auth`.

**The pitch:**

> *"Stop paying OpenAI to hallucinate boilerplate. unerr Primitives injects verified, compliance-aware architecture directly into your repo, and uses your AI purely to wire it up to your unique business logic. 80% less token cost, 10x faster execution, zero architectural drift, zero regulatory surprises."*

### Why It Must Wait

Primitives are only as good as the graph that identifies them. If the Causal Substrate hasn't ingested enough repositories to reliably compute convention adherence, architectural gravity, and temporal stability — if the five signals are sparse or noisy — then auto-discovered Primitives will be wrong. They'll surface the *popular* implementation instead of the *canonical* one. They'll miss deprecated patterns. They'll inject stale code. The compliance layer compounds this risk: a Primitive that *claims* PCI compliance but misses an audit logging requirement is worse than no Primitive at all, because it creates false confidence in a domain where the consequences are regulatory fines and customer data breaches.

We ship Primitives when the graph is dense and proven — when the convention mining has been validated across thousands of real-world codebases, the entity profiles are trusted by the teams that use them, and the compliance surface map has been verified against actual regulatory frameworks.

### The Anti-Roadmap: What to Avoid

**Do NOT build "Yet Another UI Component Library."** The UI problem is solved by shadcn/ui, v0.dev, and Tailwind UI. If we compete on buttons and cards, we drown in a sea of generic design tools. Focus exclusively on **Logical, Architectural, and Compliance Primitives** — backend services, complex state management, third-party API integrations (Stripe, Twilio, SendGrid), database transaction patterns, auth flows, and regulated data handling. Developers don't need help centering a `div`; they need help ensuring their database doesn't lock up during a concurrent payment flow and their PCI audit doesn't fail.

---

## Adjacency 2: Floor Control — The Human-AI Production Line

*A supervisory orchestration layer where automated AI agents execute production tasks and human engineers inspect, qualify, validate, and intervene — like a modern manufacturing floor where robots weld and humans certify. The highest-ACV product surface because it elevates unerr from "coding tool" to "Engineering Operations Platform."*

### The Insight

In modern manufacturing, robots don't run unsupervised. Every production line has a **Floor Control system** — a supervisory layer where automated cells (robots, CNC machines, assembly arms) execute repetitive, well-defined tasks while human operators monitor quality, inspect output, qualify results against specifications, and intervene when something goes off-tolerance. The human doesn't do the welding. The human certifies the weld.

Software engineering is entering the same era. AI agents are the robots — they execute fast, they don't tire, and they follow instructions precisely. But they lack judgment. They can't tell the difference between a routine webhook handler and a trust boundary that protects customer financial data. They don't know that modifying `validatePayment()` with 47 dependents is categorically different from adding a new utility function.

The current process — a tech lead sorting work via Jira tickets and distributing them to engineers — was designed for a world where all workers were human. It breaks completely when half the workers are AI agents with no architectural awareness, no blast radius intuition, and no concept of risk.

**Floor Control is the supervisory layer that sits between the tech lead's intent and the execution fleet (human + AI).** It understands the production specification (the codebase graph), calculates the tolerance envelope for each task (blast radius), routes certified tasks to automated cells (AI agents with Primitives), flags out-of-tolerance work for human inspection (critical paths), and tracks the entire production run to deployment.

### The Problem

**"AI Chaos at Scale"** — When 5 developers each use AI agents simultaneously, they generate thousands of lines of code, step on each other's toes, duplicate architecture, and create merge conflicts — because there is no central coordination. The tech lead can't keep up. Jira doesn't understand code. The agents don't understand each other. There is no floor supervisor.

The coordination tax is empirically measured: engineering leaders report that AI agent adoption *increased* coordination overhead by 30–40% because there's no centralized "who is doing what" visibility. More agents = more chaos without orchestration. The METR study's 19% productivity loss on mature codebases is partly attributable to this coordination failure — developers spend more time untangling AI-generated conflicts than they save from AI-generated code.

### Market Validation & Developer Complaints

**Craving level: High, especially in enterprise.** The dominant sentiment is *"we need this yesterday"* — not "maybe someday." Jira is explicitly called "dead for AI teams." Enterprise adoption of AI agents is limited precisely because current tools are incremental add-ons to Jira, not purpose-built for Human-AI parity.

- **Estimated affected teams: 500K–1M+ engineering teams globally.** Every team with 3+ developers using AI agents faces this coordination problem.
- **Reddit r/jira** (Feb 2026): *"Jira now lets you assign tickets to AI agents the same way you assign them to humans. Same dashboard... That is going to surface some uncomfortable data."*
- **X/Twitter** (@modelpingai, Feb 2026): *"Atlassian just added AI agents to Jira — same dashboard as human teammates... The question isn't if AI handles enterprise tasks. It's: which tasks, with how much oversight..."*
- **Reddit r/programming (verbatim):** *"Jira is dead for AI teams. We need a dashboard where I describe the feature in plain English, it asks clarifying questions about our existing auth/payment layer, then auto-creates tickets and routes the simple ones to agents."*
- **Reddit r/SaaS (verbatim):** *"I spend more time managing Jira than coding. Give me a system that talks to me like a PM, understands the codebase, and assigns work to humans vs AI intelligently."*
- **HN Show HN: Zenflow** (Dec 2025): *"Orchestrate coding agents without 'you're right' loops... handles the things we were missing in standard chat."* → Comments: *"We need this for the whole team — not just one agent."*
- **Reddit r/baloonDev** (recent): *"We built a JIRA-Cursor integration that automatically triggers AI agents from JIRA tickets... solved the enterprise integration challenges."*
- **X/Twitter** (@svenphilipsen, Feb 2026): *"Atlassian introduces 'agents in Jira'... assign and manage tasks for AI agents alongside human employees... enhance productivity without increasing chaos."*
- **Reddit r/ClaudeCode (verbatim):** *"Devin/Copilot Workspace can do tasks, but nothing ties it back to our internal standards or existing components. It always reinvents the wheel."*
- **Enterprise feedback (verbatim):** *"I have 5 developers using Cursor. They are all generating thousands of lines of code simultaneously, stepping on each other's toes, and duplicating architecture because there is no central coordination."*

### Who Is Building This (and Where They Fall Short)

**No one has the full vision.** Everyone is building ticket dispatchers, not floor control systems. The **Manager** role — the system that triages the epic, computes the blast radius via PageRank, and routes low-risk tasks to AI and high-risk tasks to humans — is completely unoccupied.

| Player | What They Do | What's Missing |
|---|---|---|
| **Synlets** | Assign Jira/Asana tickets to AI, get PRs back. | Starts from *existing* tickets. No blast radius calculation. No risk-based routing. Just a dispatch pipe with no quality inspection. |
| **BridgeApp** | Hybrid human-AI workspace with tasks + agents. Integrates Jira/GitHub. | Not graph-aware. Can't compute blast radius. Can't distinguish a routine task from a critical-path modification. Routing is manual, not computed. |
| **GitHub Copilot Workspace** | Issue → AI plans → PR. Good for GitHub-centric teams. | 1-to-1 execution only. No multi-agent coordination. No architectural awareness. No risk triage. The "robot" works alone with no floor supervisor. |
| **Devin (Cognition AI)** | Autonomous worker for scoped tasks. Deep Jira/Linear integrations. | Devin is a **robot on the line**, not the **floor control system**. A human still has to write the ticket, assess the risk, and decide what goes to Devin vs. a senior engineer. Devin is the *Worker*. The industry needs the *Manager*. |
| **Jira + Atlassian Rovo** | AI-powered task drafting and summarization. Now supports "AI agent" assignment in same dashboard. | Zero codebase awareness. Can't compute blast radius. Routing is manual. Doesn't understand code, only text. Putting AI agents in a Jira board doesn't make Jira an orchestrator — it makes Jira a more confusing ticketing system. |

**The structural gap:** Every competitor is building automation without intelligence. They can dispatch a task to an AI agent. They cannot compute *whether* a task *should* go to an AI agent. That computation requires blast radius (which requires the dependency graph), entity profiles (which require convention mining), and architectural gravity (which requires Semantic PageRank). All of which require the Causal Substrate. Without the graph, "smart routing" is just keyword matching on ticket descriptions.

### The unerr Solution

**unerr Floor Control: The supervisory layer where AI agents execute and humans inspect, qualify, and certify — with full architectural intelligence at every step.**

**How it works:**

1. **The Production Specification:** A Product Manager or Tech Lead opens Floor Control and describes the work: *"We need to add a Stripe Subscription tier to our existing SaaS."*

2. **The Graph Assessment (requires Causal Substrate):** Because unerr knows the codebase, it replies: *"I see your current billing uses a custom PostgreSQL schema with the `orders` table. To add Stripe subscriptions, we need to: (1) create a webhook listener for Stripe events, (2) add subscription columns to the user model, (3) build a pricing UI component, and (4) update the billing guard middleware. Here's what already exists that we can extend..."*

3. **The Tolerance Triage (requires blast radius + architectural gravity — the critical differentiator):** unerr uses its Semantic PageRank and Impact Analysis to compute risk and automatically divide labor:
   - **Task 1: Stripe Webhook (Low Risk / High Boilerplate).** *"Primitive available. Dispatching to AI Agent for automated execution."*
   - **Task 2: Pricing UI (Medium Risk).** *"Dispatching to AI Agent with Primitive, flagging for Human Quality Inspection."*
   - **Task 3: Database Migration (High Risk / Core Infrastructure).** *"This touches 47 downstream functions across 12 files. Blast radius: HIGH. Routing to Senior Engineer for manual execution."*
   - **Task 4: Billing Guard Update (Critical / Trust Boundary).** *"This is a security-critical path. Routing to Human with full Entity Profile context for certification."*

4. **Execution & Quality Control:** AI agents execute their tasks using Primitives (Adjacency 1). Humans execute theirs with full graph context. Floor Control tracks the dependency graph to ensure tasks merge in correct topological order. At every step, humans can inspect, amend, qualify, or reject.

5. **Deployment Certification:** Floor Control tracks completion across all tasks, runs blast-radius checks on the combined diff, and provides a deployment confidence score: *"All 4 tasks complete. Combined blast radius verified. 3 tests need updating. Deployment confidence: 94%."*

**The pitch:**

> *"Don't manage AI agents with a tool built for humans in 2015. unerr Floor Control understands your codebase, computes the blast radius of every task, routes routine work to AI agents with verified Primitives, assigns critical work to your senior engineers — and tracks everything through inspection to deployment. The supervisory system for the Human-AI production line."*

### Why It Must Wait

Floor Control is the most complex adjacency — and the most dependent on a mature core. Without reliable blast radius computation (which requires a dense, accurate dependency graph), the tolerance triage is theater. Without mature Primitives (Adjacency 1), the AI agents dispatched by Floor Control will hallucinate boilerplate — turning the orchestrator into a chaos amplifier. Without proven convention mining, the "Graph Assessment" step will produce shallow, inaccurate suggestions that erode trust.

Floor Control requires:
- **Causal Substrate**: Dense and battle-tested across diverse codebases
- **Primitives**: Mature, with validated auto-discovery and proven convention adherence
- **Blast radius computation**: Accurate enough that teams trust it to make routing decisions

A premature Floor Control launch would be the most visible failure mode possible — a system that *claims* to intelligently route work but *actually* misroutes critical tasks to AI agents that break production. The trust damage would be catastrophic. We ship Floor Control last, when every component it depends on has been validated independently.

---

## Adjacency 3: Surgical CI — The Graph-Aware Test Intelligence Platform

*Use the knowledge graph to run only the tests that matter, validate that those tests actually verify intent (not just coverage), ensure dependent systems' tests are updated for cross-service impact, and eliminate the coverage-theater that plagues modern CI — all deterministically, not probabilistically.*

### The Insight

AI agents generate PRs fast. CI pipelines run slow. But speed isn't the only problem — the tests themselves are broken.

**The speed problem:** When an agent produces 15 PRs a day, the test suite becomes the bottleneck. A full test suite takes 30–60 minutes. Most of those tests are irrelevant to the specific change — but without knowing the blast radius, CI runs everything.

**The validity problem:** AI agents don't just generate code — they generate tests. And AI-generated tests are optimized for the wrong thing: coverage percentage. They write tests that *exercise* code paths without *verifying* behavior. A test that asserts `expect(result).toBeDefined()` instead of `expect(result.status).toBe("paid")` is coverage theater — it inflates the metric while catching nothing. Worse, when an AI modifies a function, it updates the tests to match the *new* behavior, silently legitimizing a bug. The test didn't fail because the test was rewritten to expect the wrong output.

**The cross-service problem:** Modern architectures are distributed. A change to the `payments` service's API contract can break the `orders` service, the `notifications` service, and the `analytics` service. But the CI pipeline only runs tests for the service that changed. The downstream services' tests pass because they're still testing against the *old* contract. The breakage is invisible until production.

unerr's Causal Substrate solves all three. Impact Analysis computes the exact blast radius for test selection. Business justifications validate that tests verify *intent*, not just *syntax*. Cross-service graph edges track contract dependencies across microservice boundaries.

**Future enhancement: Runtime fusion.** A static graph (AST + Git History) cannot always see dynamic runtime dependencies (e.g., an implicit database lock, a runtime-resolved service call). In a later phase, Surgical CI can fuse the static Causal Substrate with runtime tracing data from OpenTelemetry or Datadog — correlating the structural blast radius with actual runtime call paths. This fusion makes the blast radius calculation mathematically undeniable: static edges for compile-time dependencies, runtime edges for dynamic dependencies. The static graph ships first; runtime fusion layers on top when the core is proven.

### The Problem

**"CI Theater"** — Three cascading failures in modern testing:

1. **CI Gridlock:** AI-speed code generation meets human-speed test suites. The pipeline backs up. Developers wait. Merge queues grow.
2. **Coverage Fraud:** AI-generated tests inflate coverage numbers without verifying meaningful behavior. The coverage report says 95%. The codebase is full of tests that assert truthy values and check types instead of business logic.
3. **Blast Radius Blindness:** Changes to shared services break downstream consumers, but each service's CI pipeline runs in isolation. The integration failure is invisible until deployment.

### Market Validation & Developer Complaints

**Craving level: Very high.** Developers explicitly want "smart test selection" and "intent validation." The frustration with AI-generated tests is intense and growing — developers are calling them "the new tech debt" and "coverage ceremony." This is the most frustration-driven of the three adjacencies.

- **Estimated affected teams: 200K–500K teams with CI/CD pipelines and AI agent adoption.**
- **Reddit r/ClaudeCode** (Feb 2026): *"Claude Code generated hundreds of tests, how do I know they're useful?... AI really wants to generate 10-15 tests per endpoint."*
- **Reddit r/programming** (recent): *"AI generated tests as ceremony... AI-generated tests are the new tech debt."*
- **Reddit r/ExperiencedDevs** (recent): *"My teammates are generating enormous test suites now... Most devs just care less about test quality."*
- **Reddit r/ExperiencedDevs (verbatim):** *"We had a P0 incident because an AI agent changed the payment flow and updated the tests to match the new (wrong) behavior. 100% coverage. Zero correctness."*
- **Reddit r/QualityAssurance** (recent): *"Have You Used AI-Generated Test Cases? How Was Your Experience?... AI can help cover but most are garbage."*
- **X/Twitter** (@xakpc, Feb 2026): *"This kind of coverage would create an extremely rigid system... because the tests would constantly break when code changes and then get fixed with AI... up to the point where you wouldn't even be sure whether they are testing anything anymore."*
- **Reddit r/javascript** (recent): *"[AskJS] Is AI-generated test coverage meaningful or just vanity metrics?... AI generated tests without careful steering are plain garbage."*
- **Reddit r/DevOps (verbatim):** *"Our test suite takes 45 minutes to run. When an AI agent spits out 15 PRs a day, our CI/CD pipeline completely gridlocks."*
- **HN (verbatim):** *"The bottleneck has moved. Code generation is instant. Testing is glacial. We need to make testing as fast as generation."*
- **Industry data:** Average CI pipeline time increased 25% in 2025–2026 as AI-generated PR volume surged. Teams report 3–5x more PRs per developer per day.
- **The waste:** In a typical 45-minute test suite, 70–85% of tests are irrelevant to any given PR. Running everything is a brute-force approach that doesn't scale with AI-speed development.
- **Microservice pain:** Teams with 10+ microservices report that 40% of production incidents originate from cross-service contract violations that no individual service's CI pipeline catches.

### Who Is Building This (and Where They Fall Short)

| Player | What They Do | What's Missing |
|---|---|---|
| **Nx / Turborepo** | Monorepo-aware task runners. Only rebuild affected packages. | Package-level granularity. Can't identify affected *functions* or *test files* within a package. The graph stops at package boundaries. Zero test validity analysis. |
| **Launchable / BuildPulse** | ML-based test selection (predicting which tests will fail). | Probabilistic, not deterministic. No graph awareness. Accuracy degrades on novel changes. A guess, not a computation. No test quality analysis. |
| **Jest `--changedSince`** | Run tests for changed files only. | File-level granularity. Misses transitive dependencies. If you change a utility used by 30 files, it only tests the utility file. No intent validation. |
| **Codecov / Coveralls** | Coverage reporting and threshold enforcement. | Measures *quantity* of coverage, not *quality*. Can't distinguish a meaningful assertion from `expect(x).toBeTruthy()`. The metric that enables coverage fraud. |
| **Pact / Contract Testing** | Consumer-driven contract tests between services. | Requires manual contract definition. No automatic discovery of cross-service dependencies. Doesn't update when APIs change — requires human maintenance. |
| **Greptile** | Graph-aware PR review with codebase context. | Reactive graph — reviews code *after* it's written. Cannot proactively select tests, validate intent, or compute blast radius for test targeting. A security camera, not a control system. |

**The structural gap:** Three capabilities are missing, and all three require the Causal Substrate:

1. **Precise test selection** requires knowing the *transitive dependency closure* of every changed entity — a graph traversal problem that no file-level or package-level tool can solve.
2. **Test intent validation** requires comparing what a test asserts against the *business justification* of the function it tests — which means the graph must carry intent signals, not just structural signals.
3. **Cross-service impact analysis** requires graph edges that span service boundaries — tracking which service consumes which API, which contract fields are used, and which downstream tests need updating when a contract changes.

Without the Causal Substrate, you get coarse-grained selection (Nx), probabilistic guessing (Launchable), manual contracts (Pact), and reactive reviews (Greptile). None of them validate intent. None of them span services automatically. None of them are deterministic.

### The unerr Solution

**unerr Surgical CI: A CI integration that selects the right tests, validates they test the right things, and ensures cross-service impact is covered.**

**Three layers of intelligence:**

1. **Graph-Aware Test Selection (requires blast radius):**
   - Takes the PR diff → queries unerr API for entity-level blast radius → outputs a JSON list of affected modules and their associated test files
   - Deterministic, not probabilistic — based on actual dependency traversal, not ML prediction
   - Falls back to full suite for changes above a configurable blast radius threshold (safety net)
   - Cuts CI time by 70–85% on average

2. **Test Intent Validation (requires business justifications):**
   - For each test in the affected set, unerr compares the test's assertions against the *business justification* of the function under test
   - Flags tests that are coverage theater: *"WARNING: `test_processPayment` asserts `result !== null` but does not verify the payment status. The business justification for `processPayment()` is 'Charge the customer's card and return a confirmed PaymentIntent.' Suggested assertion: `expect(result.status).toBe('succeeded')`."*
   - Flags tests that were silently rewritten to match wrong behavior: *"ALERT: `test_validateOrder` assertions were modified in the same PR as `validateOrder()`. The test now expects `status: 'pending'` but the business justification specifies `status: 'confirmed'` for valid orders. This may be a silently legitimized bug."*
   - Not a test *generator* — a test *auditor*. It doesn't write tests; it validates that existing tests verify intent.

3. **Cross-Service Impact Analysis (requires cross-service graph edges):**
   - When a change modifies a service's API contract (endpoint signature, response schema, event payload), unerr traverses the cross-service graph to identify all consuming services
   - Flags downstream tests that need updating: *"IMPACT: `payments/processRefund` response schema changed. 3 consuming services affected: `orders` (2 tests), `notifications` (1 test), `analytics` (1 test). Run downstream test suites to verify."*
   - Generates a cross-service impact report: which services are affected, which tests cover the contract boundary, and which tests are missing contract assertions entirely
   - Optionally triggers downstream CI pipelines for affected services (with the contract change context injected)

**The pitch:**

> *"Your CI pipeline runs 1,000 tests when 50 matter. Your AI-generated tests assert `toBeDefined()` instead of verifying business logic. Your microservices break each other silently because no CI pipeline sees across service boundaries. unerr Surgical CI uses the knowledge graph to select the right tests, validate they test the right things, and ensure cross-service impact is covered. Deterministic. Graph-backed. The CI pipeline that actually catches what matters."*

### Why It Must Wait

Surgical CI has three layers, each with its own maturity requirement:

- **Test selection** requires the dependency graph to be *complete* and *accurate* at the entity level. A missing edge means a missed test — and a missed test means a bug in production that was theoretically "covered."
- **Intent validation** requires business justifications to be *reliable*. If the justification for `processPayment()` is vague or wrong, the intent comparison produces meaningless results. This requires the justification pipeline (which uses LLM + graph context) to be battle-tested.
- **Cross-service analysis** requires the graph to span service boundaries — which means unerr must be installed across multiple services in the same organization, with cross-service edges accurately tracked.

Each layer can ship independently as the substrate matures, but the full vision requires all three. A false negative in test selection is worse than running the full suite, because it creates the illusion of safety. We ship each layer when its underlying signal is reliable enough to stake CI correctness on.

---

## The Sequencing: What We Build When

| Phase | Adjacency | Why This Sequence |
|---|---|---|
| **Now (Core)** | Causal Substrate + MCP | The foundation. Everything above is inert without this. |
| **Phase 2** | Primitives | First adjacency unlocked by convention mining. Immediate developer value. Strong PLG signal. Validates that the graph is accurate enough to auto-discover canonical implementations. Compliance guardrails mature alongside the rules engine. |
| **Phase 3** | Surgical CI (Test Selection) | Requires proven blast radius computation across diverse codebases. Lowest-risk layer of Surgical CI. DevOps persona expansion. |
| **Phase 3** | Surgical CI (Intent Validation) | Requires mature business justifications. Enterprise quality assurance use case. |
| **Phase 4** | Surgical CI (Cross-Service) | Requires multi-service graph with cross-boundary edges. Enterprise microservice use case. Runtime fusion with OpenTelemetry/Datadog layers on top. |
| **Phase 4** | Floor Control | Requires Primitives + mature graph + proven blast radius. Highest ACV but highest complexity. The capstone — launched only when every component it depends on is battle-tested. |

**Note the domino effect:** Phase 2 validates the graph (Primitives). Phase 3 uses that validation to extend into CI intelligence (Surgical CI test selection and intent validation). Phase 4 composes *everything* into orchestration (Floor Control) and cross-service intelligence (Surgical CI cross-service). Each phase proves the components that the next phase depends on. Skip a phase, and the next one collapses.

---

## The Anti-Roadmap: What We Never Build

**1. Our Own Chat UI / IDE**
Developers have massive IDE fatigue. They're fiercely loyal to Cursor, JetBrains, or Neovim. The fastest way to get mocked on Hacker News is to launch "Yet Another AI Code Editor." We stay the invisible backend. We make Cursor, Copilot, and Claude *better*. We turn competitors into distribution channels.

**2. A Generic UI Component Library**
The UI problem is solved (shadcn, v0.dev, Tailwind UI). Competing on buttons and cards is a commodity race. We own architectural intelligence, not visual design.

**3. An Autonomous Coding Agent**
We are not Devin. We don't replace developers. We make *every* agent and *every* developer smarter. Building our own agent would make us compete with our distribution channels. We complete agents, not compete with them.

**4. A Fine-Tuned LLM**
Enterprise spent 2024 learning this lesson: fine-tuning is expensive, rots instantly, and can't distinguish good legacy code from bad. Our architecture (pre-computed signals → constrained generation) is categorically superior to fine-tuning. We use LLMs as one component, not the product.

---

## Summary: The Adjacent Opportunity Matrix

| Adjacency | Core Pain | Substrate Dependency | Who Buys | Revenue Model |
|---|---|---|---|---|
| **Primitives** | Reinvented boilerplate + regulatory violations + inconsistency | Convention mining + entity profiles + rules engine + compliance surface map | Individual devs → Team leads → Compliance teams | Freemium + Enterprise Standards + Compliance Packs |
| **Floor Control** | AI chaos, coordination overhead, no risk-based routing | Blast radius + Primitives + entity profiles + architectural gravity | Tech leads, CTOs, PMs | Enterprise seats (highest ACV) |
| **Surgical CI** | CI gridlock + coverage fraud + cross-service blindness | Impact analysis + blast radius + business justifications + cross-service graph | DevOps leads, platform engineers, QA leads | Usage-based (CI minutes saved + quality score) |

---

> **The bottom line: Three adjacencies. Three capabilities that are structurally impossible without the Causal Substrate. Primitives requires convention mining and compliance surface mapping that only a five-signal graph can produce — and that no RAG system can replicate because vector similarity cannot enforce hierarchical rules. Floor Control requires blast radius computation and Primitives — it collapses without both, which is why every "AI agent in Jira" announcement is a dispatch pipe, not an orchestrator. Surgical CI requires entity-level impact analysis, business justification matching, and cross-service graph traversal — capabilities that no file-level tool, package-level tool, or reactive review graph can replicate. Sourcegraph's search graph cannot compute blast radius. Greptile's review graph cannot select tests proactively. Launchable's ML predictions cannot match deterministic graph traversal. A competitor who attempts any of these without a causal substrate will produce a visibly inferior product. We can afford to wait until the foundation is unshakable — because when we launch, the difference will be self-evident.**
