# unerr: Adjacent Opportunities — Platform Expansions That Emerge When the Substrate Matures

> **What this document is:** A strategic inventory of high-conviction adjacent opportunities that are structurally impossible without a mature, battle-tested Causal Substrate. Each opportunity is validated against real developer sentiment, maps to specific community pain, and exists as a natural extrusion of graph intelligence we already compute. These are not features we should rush to build — they are inevitabilities we will execute when the core is proven and the market signal is undeniable.
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

### The Fintech Spark

The founder's background is in fintech — specifically, robo-advisory systems. In finance, you cannot let a probabilistic AI guess a trade. The consequences are measured in millions of dollars, regulatory fines, and destroyed trust. So the industry solved this decades ago: you build **deterministic signal pipelines** around the probabilistic engine.

A robo-advisor doesn't let the AI free-associate about which stocks to buy. It feeds the AI hard, pre-computed signals — moving averages, volatility indices, order book depth, risk tolerance scores, regulatory constraints — and the AI operates *within* those signals. The probability space collapses. The output becomes deterministic *enough* to be trustworthy.

The insight that sparked unerr: **What if we applied the same architecture to coding agents?**

Instead of letting the AI guess at your codebase, we compute the hard signals first — the dependency graph (the "market data"), the architectural gravity scores (the "asset importance"), the temporal co-change patterns (the "trend lines"), the business justifications (the "fundamental analysis"), the domain boundaries (the "sector classification") — and feed those signals directly into the agent. The agent stops extrapolating from global training data and starts operating on local, verified truth.

We brought fintech-level determinism to software generation. That's how we built **unerr**.

### Why This Narrative Works

This origin story is technically accurate, community-aligned, and strategically sharp:

- **Technically accurate:** LLMs *are* next-token prediction engines. They *are* inherently probabilistic. You cannot make a neural network natively deterministic, but you *can* build a deterministic system around it by collapsing the probability space with pre-computed signals. This is mathematically sound — it's the same principle behind constrained decoding, guided generation, and retrieval-augmented generation.

- **Community-aligned:** The absolute biggest developer complaint about AI tools is flakiness. *"It worked yesterday, but today it completely hallucinated a different file structure."* Developers live in a world of strict rules, compilers, and binary logic. They fundamentally distrust probabilistic tools for mission-critical work. The word "determinism" is the ultimate developer dog-whistle — it signals that we understand their world.

- **The fintech halo effect:** Developers respect fintech because they know it operates in a "zero-tolerance for error" environment. *"I come from fintech, where an AI hallucination costs millions of dollars"* instantly borrows trust. It proves we understand the stakes of enterprise software. It's not an analogy — it's a direct architectural transplant.

- **The name connection:** *unerr* — unerring, to make no mistakes — perfectly encapsulates the shift from probability to determinism. The story flows logically: Problem (Probabilistic AI) → Inspiration (Fintech Signal Bots) → Solution (Deterministic Code Signals) → Product (unerr).

### The Pitch (Sharpened for Delivery)

> "LLMs are probabilistic engines. They extrapolate based on what they've seen globally, which leads to hallucinations locally. From an LLM's standpoint, it isn't making a mistake — it just lacks the local constraints to make the right choice.
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

The adjacencies form a strict dependency chain:

```
Causal Substrate (Core)
    │
    ├─→ Primitives (requires: convention mining, entity profiles, rules engine)
    │       │
    │       ├─→ Floor Control (requires: Primitives + blast radius + entity profiles)
    │       │
    │       └─→ Pre-Flight Gatekeeper (requires: local graph snapshot + rules engine)
    │               │
    │               └─→ AI-Lens (requires: Prompt Ledger + convention adherence scoring)
    │
    ├─→ Surgical CI (requires: impact analysis + blast radius computation)
    │
    └─→ Vertical Guardrails (requires: mature rules engine + compliance surface map)
            │
            └─→ Cross-IDE Bridge (requires: all of the above to be agent-agnostic)
```

Each node in this tree is inert without its parent. A competitor who builds "reusable code blocks" without entity profiles and convention mining has built a template library. A competitor who builds "AI task routing" without blast radius computation has built a ticket dispatcher. The graph is what transforms commodity features into structural intelligence.

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

*Verified, reusable code blueprints that eliminate hallucinated boilerplate and reduce token costs by 80% — but only when backed by a live knowledge graph that knows which implementations are canonical and which are deprecated.*

### The Insight

LLMs are the best copy-cats in the world. When you ask an AI agent to "build a payment page," it invents one from scratch — hallucinating architecture, introducing inconsistencies, burning thousands of tokens on boilerplate it could have copied from a verified reference in milliseconds.

But if you *paste* a verified, battle-tested Stripe webhook handler into the prompt and say *"adapt this to use our Prisma schema,"* the LLM executes flawlessly in 500 tokens instead of 4,000. The quality goes up. The cost goes down. The consistency becomes automatic.

Most systems have ~80% of the same components — login, payments, notifications, error boundaries, data fetching patterns. What if these canonical implementations were automatically identified from your own codebase, validated against your team's conventions, and injected directly into the agent's context? Instead of generating from scratch, the agent *mutates* a known-good baseline. The LLM's role shifts from **Author** (slow, hallucination-prone) to **Editor** (fast, reliable).

This is the **shadcn philosophy applied to AI generation** — but for architectural patterns, not UI components. And unlike shadcn, the primitives aren't static templates from a registry. They are living artifacts extracted from *your* graph, validated against *your* conventions, and updated as *your* codebase evolves.

### The Problem

**"Reinvented Boilerplate"** — Every time an AI agent writes a login flow, a webhook handler, or a database transaction, it invents a slightly different version. After 6 months, the codebase has 8 auth implementations, each with different error handling, different retry logic, and different security postures. The AI didn't drift from a standard — there was never a standard to drift from.

### Market Validation & Developer Complaints

- **Estimated affected users: 15–25M+ developers using AI coding agents daily.** This is the #1 daily friction in AI-assisted development.
- **Reddit r/webdev (verbatim):** *"I'm so tired of Claude giving me five different ways to write a React form depending on its mood. I just want it to use React Hook Form the exact same way every time."*
- **Reddit r/ClaudeAI (verbatim):** *"I built a library of 17 'Agent Skills' to make coding agents actual Flutter experts"* — hundreds of upvotes, developers begging for more.
- **Reddit r/ClaudeCode (verbatim):** *"Claude Skills are just .cursorrules on steroids — we need a centralized registry so switching agents doesn't break everything."*
- **X/Twitter (verbatim):** *"Realizing it's not just Claude or Cursor. On a fresh repo, whoever goes first sets the mental model. Switching AI tools mid-build always breaks at the component level."*
- **HN (verbatim):** Discussions on *"reusable skills as markdown that get injected into agent prompts"* — praised as game-changer for reducing token waste and hallucinations.
- **Enterprise pain (verbatim from dev forums):** *"Claude just gave me standard OAuth again instead of our proprietary SSO + audit logging."* / *"AI agents ignore our internal auth mechanism and generate generic code — security blocks every PR."*
- **The workaround explosion (2026):** Developers are manually creating `.cursorrules`, `CLAUDE.md` files, "Skills" folders (Vercel Agent Skills, Claude Code Skills, Continue.dev blocks), and shadcn-style component libraries referenced in prompts. VoltAgent/awesome-agent-skills has 380+ community-contributed skills. The workaround *is* the product validation.
- **Positive sentiment: ~80–90%** in relevant threads — developers share homemade libraries excitedly and ask for better centralized solutions.

### Who Is Building This (and Where They Fall Short)

**No one has the full vision yet.** Pieces exist, but nothing combines graph-backed discovery + enterprise enforcement + automatic updates from live code.

| Player | What They Do | What's Missing |
|---|---|---|
| **Vercel Agent Skills** | Reusable "skills" with `references/` directories. Installable via CLI. Works across agents. | Framework-specific (React/Next.js). Not graph-backed. No enterprise enforcement or drift detection. Static — doesn't evolve with the codebase. |
| **Claude Code Skills / Continue.dev** | Markdown-based reusable blocks/prompts. Growing community registries. | Manual. No versioning. No validation against live code. Fragmented across agents. No way to know if a "skill" still matches the actual codebase. |
| **shadcn/ui + v0.dev** | Component copy-paste for UI consistency. | UI only. Nothing for backend architecture, auth, payment flows, data patterns. Static templates, not live extractions. |
| **Internal "Golden Path" tools (Stripe, Netflix)** | Curated component libraries + Backstage catalogs. | Manual curation. No AI integration. No graph-backed validation. Requires a dedicated platform team to maintain. |

**The structural gap:** Every existing solution is a static template library — hand-curated snapshots of code that immediately begin drifting from the actual codebase. No one ties reusable blocks to a **live codebase knowledge graph** with automatic "canonical vs. deprecated" classification, convention adherence scoring, and drift detection. Without entity profiles and convention mining (which require the Causal Substrate's five signals), you cannot *automatically* identify which implementation of auth is the canonical one. You can only ask a human to manually tag it — which is exactly what developers are already doing with `.cursorrules` files, and exactly why it doesn't scale.

### The unerr Solution

**unerr Primitives: Verified architectural building blocks, auto-discovered from your graph, injected into any agent via MCP.**

**How it works:**

1. **Auto-Discovery (requires Causal Substrate):** unerr's graph already knows every entity in your codebase — their architectural gravity, adherence to conventions, and business purpose. We surface the highest-adherence, highest-gravity implementations as Primitives — the canonical way your team builds auth, payments, error handling, data fetching. This is not template curation — it is graph traversal. The Primitive for "Stripe webhook handler" is the implementation with the highest convention adherence score, the most stable temporal signal (least churn), and the strongest domain classification. No human tags it. The graph identifies it.

2. **Smart Injection (requires entity profiles):** When a developer prompts the agent to "build a payment route," unerr intercepts via MCP. Because we know the Entity Profile of the existing codebase (Express + Prisma + Stripe), we inject the *right* Primitive — not a generic one from a global registry.

3. **Local Scaffolding (Zero Token Cost):** unerr copies the raw template files directly into the user's local directory. No tokens burned on boilerplate generation.

4. **Mutation Prompt:** unerr automatically prompts the agent: *"I have scaffolded a secure Stripe webhook in `/api/webhooks`. Read the attached Entity Profiles for our `Order` database model and mutate the webhook to update our database on success."*

5. **Enterprise Standards Mode (requires rules engine):** Platform engineering teams tag specific implementations as `[CANONICAL]` and deprecated versions as `[DEPRECATED]`. When the agent queries for context, unerr actively *filters out* deprecated code and returns only canonical references. The AI never sees the old, buggy `v1_Auth` — only the approved `v2_Auth`.

**The pitch:**

> *"Stop paying OpenAI to hallucinate boilerplate. unerr Primitives injects verified, enterprise-grade architecture directly into your repo, and uses your AI purely to wire it up to your unique business logic. 80% less token cost, 10x faster execution, zero architectural drift."*

### Why It Must Wait

Primitives are only as good as the graph that identifies them. If the Causal Substrate hasn't ingested enough repositories to reliably compute convention adherence, architectural gravity, and temporal stability — if the five signals are sparse or noisy — then auto-discovered Primitives will be wrong. They'll surface the *popular* implementation instead of the *canonical* one. They'll miss deprecated patterns. They'll inject stale code. This is worse than no Primitives at all, because it creates false confidence. We ship Primitives when the graph is dense and proven — when the convention mining has been validated across thousands of real-world codebases and the entity profiles are trusted by the teams that use them.

### The Anti-Roadmap: What to Avoid

**Do NOT build "Yet Another UI Component Library."** The UI problem is solved by shadcn/ui, v0.dev, and Tailwind UI. If we compete on buttons and cards, we drown in a sea of generic design tools. Focus exclusively on **Logical and Architectural Primitives** — backend services, complex state management, third-party API integrations (Stripe, Twilio, SendGrid), database transaction patterns, auth flows. Developers don't need help centering a `div`; they need help ensuring their database doesn't lock up during a concurrent payment flow.

---

## Adjacency 2: Floor Control — The Human-AI Production Line

*A supervisory orchestration layer where automated AI agents execute production tasks and human engineers inspect, qualify, validate, and intervene — like a modern manufacturing floor where robots weld and humans certify.*

### The Insight

In modern manufacturing, robots don't run unsupervised. Every production line has a **Floor Control system** — a supervisory layer where automated cells (robots, CNC machines, assembly arms) execute repetitive, well-defined tasks while human operators monitor quality, inspect output, qualify results against specifications, and intervene when something goes off-tolerance. The human doesn't do the welding. The human certifies the weld.

Software engineering is entering the same era. AI agents are the robots — they execute fast, they don't tire, and they follow instructions precisely. But they lack judgment. They can't tell the difference between a routine webhook handler and a trust boundary that protects customer financial data. They don't know that modifying `validatePayment()` with 47 dependents is categorically different from adding a new utility function.

The current process — a tech lead sorting work via Jira tickets and distributing them to engineers — was designed for a world where all workers were human. It breaks completely when half the workers are AI agents with no architectural awareness, no blast radius intuition, and no concept of risk.

**Floor Control is the supervisory layer that sits between the tech lead's intent and the execution fleet (human + AI).** It understands the production specification (the codebase graph), calculates the tolerance envelope for each task (blast radius), routes certified tasks to automated cells (AI agents with Primitives), flags out-of-tolerance work for human inspection (critical paths), and tracks the entire production run to deployment.

### The Problem

**"AI Chaos at Scale"** — When 5 developers each use AI agents simultaneously, they generate thousands of lines of code, step on each other's toes, duplicate architecture, and create merge conflicts — because there is no central coordination. The tech lead can't keep up. Jira doesn't understand code. The agents don't understand each other. There is no floor supervisor.

### Market Validation & Developer Complaints

- **Estimated affected teams: 500K–1M+ engineering teams globally.** Every team with 3+ developers using AI agents faces this coordination problem.
- **Reddit r/programming (verbatim):** *"Jira is dead for AI teams. We need a dashboard where I describe the feature in plain English, it asks clarifying questions about our existing auth/payment layer, then auto-creates tickets and routes the simple ones to agents."*
- **Reddit r/SaaS (verbatim):** *"I spend more time managing Jira than coding. Give me a system that talks to me like a PM, understands the codebase, and assigns work to humans vs AI intelligently."*
- **Reddit r/ClaudeCode (verbatim):** *"Devin/Copilot Workspace can do tasks, but nothing ties it back to our internal standards or existing components. It always reinvents the wheel."*
- **X/Twitter (verbatim):** *"2026 reality: Tech leads should just describe the outcome. The system figures out what exists, creates tickets, and routes to human or agent. We're so close but no one has shipped the full loop."*
- **HN (verbatim):** "Show HN: Synlets" (ticket → AI → PR) got strong positive comments, but users immediately asked for *"deeper codebase awareness + human/AI routing + oversight."*
- **Enterprise feedback (verbatim):** *"I have 5 developers using Cursor. They are all generating thousands of lines of code simultaneously, stepping on each other's toes, and duplicating architecture because there is no central coordination."*
- **The coordination tax:** Engineering leaders report that AI agent adoption *increased* coordination overhead by 30–40% because there's no centralized "who is doing what" visibility. More agents = more chaos without orchestration.
- **Developer sentiment (2026):** Overall tone is *"we need this yesterday"* — not "maybe someday." Enterprise adoption is limited precisely because current tools are incremental add-ons to Jira, not purpose-built for Human-AI parity.

### Who Is Building This (and Where They Fall Short)

**No one has the full vision.** Everyone is building ticket dispatchers, not floor control systems.

| Player | What They Do | What's Missing |
|---|---|---|
| **Synlets** | Assign Jira/Asana tickets to AI, get PRs back. | Starts from *existing* tickets. No blast radius calculation. No risk-based routing. Just a dispatch pipe with no quality inspection. |
| **BridgeApp** | Hybrid human-AI workspace with tasks + agents. Integrates Jira/GitHub. | Not graph-aware. Can't compute blast radius. Can't distinguish a routine task from a critical-path modification. Routing is manual, not computed. |
| **GitHub Copilot Workspace** | Issue → AI plans → PR. Good for GitHub-centric teams. | 1-to-1 execution only. No multi-agent coordination. No architectural awareness. No risk triage. The "robot" works alone with no floor supervisor. |
| **Devin (Cognition AI)** | Autonomous worker for scoped tasks. Deep Jira/Linear integrations. | Devin is a **robot on the line**, not the **floor control system**. A human still has to write the ticket, assess the risk, and decide what goes to Devin vs. a senior engineer. |
| **Jira + Atlassian Rovo** | AI-powered task drafting and summarization. | Zero codebase awareness. Can't compute blast radius. Routing is manual. Doesn't understand code, only text. A project management tool pretending to be an engineering orchestrator. |

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

A premature Floor Control launch would be the most visible failure mode possible — a system that *claims* to intelligently route work but *actually* misroutes critical tasks to AI agents that break production. The trust damage would be catastrophic. We ship Floor Control last among the high-complexity adjacencies, when every component it depends on has been validated independently.

---

## Adjacency 3: Pre-Flight Gatekeeper — The Local Architectural Guardrail

*A blazing-fast pre-commit hook that blocks architectural violations on the developer's machine — before the code ever reaches a PR. Powered by the same graph intelligence that makes the core work, but running entirely offline.*

### The Insight

By the time bad code hits a pull request, the damage is done. The developer has moved on. The review queue is backed up. The cost of fixing is 5x higher than preventing. Every senior engineer on Hacker News says the same thing: *"Stop showing me violations in the PR — block them on the developer's machine."*

unerr already has the two ingredients needed: a Local-First graph snapshot (msgpack, runs in <5ms) and a Rules Engine. We just need to intercept the workflow *before* the commit. But here's the critical dependency: the graph snapshot is only useful if the graph it snapshots is accurate. And the rules engine is only useful if the rules it enforces are the right ones — mined from real conventions, not hand-written by a human who might be wrong.

### The Problem

**"Review Queue Overflow"** — AI agents generate code so fast that the PR review queue is permanently backed up. Senior engineers spend 20+ minutes reviewing each PR, only to find violations that should have been caught locally. The feedback loop is too slow for AI-speed development.

### Market Validation & Developer Complaints

- **Estimated affected users: 10–15M developers in teams with code review processes.**
- **HN (verbatim):** *"By the time the AI slop hits the PR, I'm already wasting 20 minutes reviewing it. I need this blocked on the developer's machine."*
- **Reddit r/ExperiencedDevs (verbatim):** *"Why PR-driven code reviews create more bottlenecks than quality — they create dependencies and context-switch overhead."*
- **The 18% larger PRs problem:** PRs are getting 18% larger with AI adoption. Incidents per PR are up 24%. Change failure rates are up 30%. The senior review bottleneck is collapsing.
- **Reddit r/programming (verbatim):** *"We need shift-left for architecture, not just security. Linters catch syntax. Nothing catches 'you just bypassed the repository pattern.'"*
- **The pre-commit gap:** ESLint catches formatting. Semgrep catches security patterns. Nothing catches *architectural* violations — "View layer calling Database directly," "auth logic in the billing module," "function with 47 dependents modified without impact review."

### Who Is Building This (and Where They Fall Short)

| Player | What They Do | What's Missing |
|---|---|---|
| **ESLint / Prettier** | Syntax and formatting enforcement. | Zero architectural awareness. Can't detect cross-module violations. Operates on AST of a single file, not the dependency graph. |
| **Semgrep** | Pattern-based security scanning. Fast, local. | Security only. No business context. No graph-backed impact analysis. Can detect "SQL injection" but not "bypassed repository pattern." |
| **SonarQube** | Code quality metrics (complexity, duplication). | Per-file analysis. Can't see cross-module dependencies. No codebase graph. Detects "complex function" but not "complex function with 47 dependents." |
| **Arnica / StepSecurity** | Security rules injected into agent prompts. | Security-focused only. Not architectural. Not local — runs in CI, not pre-commit. |

**The structural gap:** Architectural violation detection requires knowing the *relationships* between entities — which function calls which, which module depends on which, which convention governs which domain. This is a graph problem. Every existing tool operates on individual files or individual patterns. None of them have the dependency graph. None of them can compute blast radius. None of them know your conventions. Without the Causal Substrate, "architectural linting" is structurally impossible.

### The unerr Solution

**`unerr check` — A git pre-commit hook that blocks architectural violations in <500ms.**

- Diffs staged files against the local graph snapshot (msgpack, <5ms to load)
- Checks violations against the Rules Engine (both auto-mined and custom)
- Blocks commits that violate active architectural rules:
  - *"BLOCKED: `api/billing.ts` directly imports from `lib/db/`. Your project uses the Repository Pattern (14 files follow this convention). Route through `repositories/billing.ts` instead."*
  - *"WARNING: `validatePayment()` has 47 dependents (top 3% by architectural gravity). This change affects 3 API endpoints. Run `unerr impact` to see the full blast radius."*
- Runs entirely locally — no network calls, no cloud dependency, no latency

### Why It Must Wait

The Pre-Flight Gatekeeper is only as trustworthy as the graph snapshot it reads and the rules it enforces. If the convention mining hasn't been validated — if it identifies a *convention* that's actually just three developers' bad habit — the pre-commit hook will block correct code and approve incorrect code. False positives destroy developer trust in tools faster than any other failure mode. A pre-commit hook that blocks a valid commit even once gets `git commit --no-verify` permanently aliased in every developer's shell config.

We ship the Gatekeeper when convention mining has been battle-tested against enough real-world codebases that the rules it generates are trusted — not just plausible.

---

## Adjacency 4: AI-Lens — The Provenance Tracker

*An IDE extension that shows which code was AI-generated, what prompt produced it, and whether it follows team standards — like GitLens, but for AI attribution. Impossible without the Prompt Ledger that only the Causal Substrate maintains.*

### The Insight

A massive emerging concern in enterprise development: *"If a bug takes down production, I need to know if a human wrote that line or if Copilot hallucinated it."* Standard `git blame` shows the committer, not the authoring mechanism. There is no way to distinguish human-authored code from AI-generated code after the commit.

unerr already tracks every AI-assisted change via the Prompt Ledger — which model, which prompt, which diff, whether it followed patterns. We just need to surface this data where developers live: in the editor.

### The Problem

**"Provenance Blindness"** — Teams have no visibility into how much of their codebase is AI-generated, which prompts produced it, or whether it followed architectural standards. When an incident occurs, there's no way to trace back to the AI interaction that caused it.

### Market Validation & Developer Complaints

- **Estimated affected teams: 50K–100K+ organizations with 10+ developers using AI agents.**
- **Reddit r/ExperiencedDevs (verbatim):** *"We have 10 devs using Copilot and no idea how much of our codebase is actually AI-generated or what prompts created it. It's an auditing nightmare."*
- **HN (verbatim):** *"Comprehension debt: A ticking time bomb of LLM-generated code... An LLM is not capable of subtext or understanding intention."* — The untraceable code problem.
- **IBM 2025 Cost of a Data Breach Report:** 63% of breached organizations lacked AI governance policies. Shadow AI added $670,000 to breach costs.
- **GroweXX (2026):** Fewer than half of developers review AI-generated code before committing it. AI-generated code is now the cause of 1 in 5 breaches.
- **SOC2 / ISO 27001 auditors** are now asking: *"What code in your system was AI-generated, and what governance controls do you have?"* Most enterprises have no answer.
- **EU AI Act (August 2026):** Full enforcement for high-risk systems. Fines up to EUR 35M or 7% of global revenue. AI code provenance tracking will become a regulatory requirement.

### Who Is Building This (and Where They Fall Short)

| Player | What They Do | What's Missing |
|---|---|---|
| **GitLens** | Shows git blame, commit history, line-by-line authorship. | No AI attribution. Can't distinguish human vs. AI-generated code. Designed for a world where all code is human-authored. |
| **GitHub Advanced Security** | Vulnerability and secret scanning. | Scans for known CVEs, not AI provenance. Can't show which prompt produced a line. No convention adherence scoring. |
| **Snyk / Veracode** | Dependency and code vulnerability scanning. | No AI tracking. No prompt attribution. No architectural context. Detects "vulnerable dependency" but not "AI-hallucinated auth flow." |

**The structural gap:** AI provenance tracking requires capturing the *full context* of every AI interaction — the prompt, the model, the response, the convention rules that were (or weren't) active, and the diff that was committed. This is the Prompt Ledger. Building a Prompt Ledger requires deep integration with the codebase graph (to compute convention adherence at capture time) and the rules engine (to classify each generation as compliant or non-compliant). Without the Causal Substrate, you can build a "which lines were AI-generated" heatmap — but you cannot build a "which lines were AI-generated *and violated team conventions*" governance tool. The convention layer is what makes AI-Lens a compliance platform instead of a curiosity.

### The unerr Solution

**unerr AI-Lens: A lightweight IDE extension (VS Code, JetBrains) that surfaces AI provenance inline.**

- **Inline annotations:** Hover over a line to see: *"Generated by Claude 3.5 via Cursor. Prompt: 'Add retry logic to the webhook'. Convention adherence: PASS."*
- **AI heatmap:** Color-coded gutter showing density of AI-generated vs. human-written code per file. Red = high AI density with low convention adherence. Green = verified.
- **Prompt Ledger integration:** Click through to the full prompt history — which model, which context, which rules were active, what changed.
- **Audit export:** One-click export of AI provenance data for SOC2, ISO 27001, or EU AI Act compliance audits.

### Why It Must Wait

AI-Lens requires a mature Prompt Ledger — which means unerr must have been running in production, capturing AI interactions, scoring them against conventions, and storing the results, for *months* before the data is rich enough to surface meaningfully. A sparse Prompt Ledger produces a sparse AI-Lens — mostly empty files with occasional annotations. That's not a product; it's a proof of concept. We ship AI-Lens when the Prompt Ledger has enough density that the provenance data tells a real story about how a codebase evolved.

---

## Adjacency 5: Surgical CI — The Graph-Aware Test Optimizer

*Use the knowledge graph's blast radius to run only the tests that matter — cutting CI time by 80%. Deterministic test selection that no probabilistic approach can match.*

### The Insight

AI agents generate PRs fast. CI pipelines run slow. When an agent produces 15 PRs a day, the test suite becomes the bottleneck. A full test suite takes 30–60 minutes. Most of those tests are irrelevant to the specific change — but without knowing the blast radius, CI runs everything.

unerr's Impact Analysis already computes the exact blast radius of any code change via graph traversal. We know precisely which modules are affected. We can tell CI to run *only* the tests that cover those modules.

### The Problem

**"CI Gridlock"** — AI-speed code generation meets human-speed test suites. The pipeline backs up. Developers wait. Merge queues grow. The velocity gain from AI agents is eaten by CI wait times.

### Market Validation & Developer Complaints

- **Estimated affected teams: 200K–500K teams with CI/CD pipelines and AI agent adoption.**
- **Reddit r/DevOps (verbatim):** *"Our test suite takes 45 minutes to run. When an AI agent spits out 15 PRs a day, our CI/CD pipeline completely gridlocks."*
- **HN (verbatim):** *"The bottleneck has moved. Code generation is instant. Testing is glacial. We need to make testing as fast as generation."*
- **Industry data:** Average CI pipeline time increased 25% in 2025–2026 as AI-generated PR volume surged. Teams report 3–5x more PRs per developer per day.
- **The waste:** In a typical 45-minute test suite, 70–85% of tests are irrelevant to any given PR. Running everything is a brute-force approach that doesn't scale with AI-speed development.

### Who Is Building This (and Where They Fall Short)

| Player | What They Do | What's Missing |
|---|---|---|
| **Nx / Turborepo** | Monorepo-aware task runners. Only rebuild affected packages. | Package-level granularity. Can't identify affected *functions* or *test files* within a package. The graph stops at package boundaries. |
| **Launchable / BuildPulse** | ML-based test selection (predicting which tests will fail). | Probabilistic, not deterministic. No graph awareness. Accuracy degrades on novel changes. A guess, not a computation. |
| **Jest `--changedSince`** | Run tests for changed files only. | File-level granularity. Misses transitive dependencies. If you change a utility used by 30 files, it only tests the utility file. |

**The structural gap:** Precise test selection requires knowing the *transitive dependency closure* of every changed entity — not just which files changed, but which functions in those files changed, which other functions call those functions, and which test files cover that call chain. This is a graph traversal problem. Nx stops at package boundaries. Jest stops at file boundaries. ML-based tools guess. Only a full entity-level dependency graph can compute the exact blast radius and map it to the exact test files. Without the Causal Substrate, you get either coarse-grained selection (Nx) or probabilistic guessing (Launchable).

### The unerr Solution

**unerr Surgical CI: A GitHub Action / GitLab CI integration that uses the knowledge graph to select exactly the right tests.**

- Takes the PR diff → queries unerr API for blast radius → outputs a JSON list of affected modules and their associated test files
- DevOps teams configure their CI to run *only* the test suites associated with affected graph nodes
- Deterministic, not probabilistic — based on actual dependency traversal, not ML prediction
- Falls back to full suite for changes above a configurable blast radius threshold (safety net)

### Why It Must Wait

Surgical CI requires the dependency graph to be *complete* and *accurate* at the entity level. A missing edge in the graph means a missed test — and a missed test means a bug in production that was theoretically "covered." The blast radius computation must be proven reliable across diverse codebases, languages, and architectural patterns before we stake CI correctness on it. A false negative in test selection is worse than running the full suite, because it creates the illusion of safety. We ship Surgical CI when the graph's edge coverage is high enough that teams trust it with their CI pipeline — their last line of defense.

---

## Adjacency 6: Vertical Guardrails Packs — Domain-Specific Intelligence

*Pre-built rule packs for regulated industries — Fintech (PCI/SOX), Healthcare (HIPAA), and more. Only possible when the underlying rules engine is mature enough to enforce domain-specific constraints with zero false positives.*

### The Insight

Generic AI agents ignore industry-specific rules. An AI writing code for a fintech app doesn't know about PCI DSS. An AI writing for a healthcare app doesn't know about HIPAA. The developer doesn't either — they rely on security reviews that happen weeks later, if at all.

unerr's Rules Engine already supports custom rules. Extending it with pre-built, industry-specific rule packs turns unerr into a vertical compliance platform. But these rules must be precise — a false positive in a compliance rule is a blocked deployment, and a false negative is a regulatory violation.

### The Problem

**"Regulatory Roulette"** — AI agents generate code that technically works but silently violates industry regulations. The violation isn't discovered until an audit, a breach, or a failed compliance review — months after the code was written.

### Market Validation & Developer Complaints

- **Estimated affected organizations: 100K+ in regulated industries (finance, healthcare, government, defense).**
- **Reddit r/SaaS (verbatim):** *"AI coded my fintech app but ignored PCI rules — now rewriting for compliance."*
- **Enterprise CISO surveys:** "AI-generated code governance" is a top-5 emerging risk for 2025–2027.
- **45% of AI-generated code contains security flaws.** In regulated industries, a single flaw can trigger mandatory disclosure, fines, and customer notification.
- **Compliance Week (2026):** *"Six AI questions compliance officers must answer in 2026"* — AI code governance is a board-level reporting requirement.
- **The cost:** A HIPAA violation averages $1.5M. A PCI DSS non-compliance fine ranges from $5K–$100K per month. SOX violations carry criminal penalties.

### The unerr Solution

**unerr Vertical Guardrails: Pre-built rule packs importable into the Rules Engine with one click.**

- **Fintech Pack:** PCI DSS compliance rules (no plaintext card numbers, encryption at rest, audit logging for payment flows), SOX controls (segregation of duties, change management tracking), IAM privilege escalation detection.
- **Healthcare Pack:** HIPAA compliance rules (PII/PHI data flow tracking, encryption requirements, access logging), data residency enforcement, patient consent workflow validation.
- **Government / Defense Pack:** FedRAMP compliance patterns, NIST 800-53 controls, air-gapped operation verification, data classification enforcement.

Each pack includes:
- Pre-built rules that map to specific regulatory requirements
- Domain-specific health report templates (*"HIPAA Compliance Score: B+ — 2 PHI data flows lack encryption at rest"*)
- Audit-ready export formats for each regulatory framework

### Why It Must Wait

Vertical Guardrails are the highest-stakes rules in the system. A false negative means a regulatory violation. A false positive means a blocked deployment. The rules engine must be mature enough that teams trust it with compliance-critical enforcement — which means the core rules engine must have been validated extensively on general architectural rules (Adjacency 3: Pre-Flight Gatekeeper) before we layer domain-specific compliance rules on top. We do not ship Vertical Guardrails until the Gatekeeper has proven that the rules engine produces zero false positives in production. The regulatory environment demands perfection.

---

## Adjacency 7: Cross-IDE Bridge — Agent-Agnostic Context Sync

*Seamless knowledge graph context across every IDE and agent — VS Code, JetBrains, Cursor, Claude Code — without manual re-setup. The natural endpoint of a platform that treats agents as interchangeable execution engines.*

### The Insight

Developers don't use one tool. They use Cursor for AI-assisted coding, VS Code for debugging, JetBrains for refactoring. Each tool has its own context mechanism (`.cursorrules`, `CLAUDE.md`, IDE settings). Switching tools means losing all AI context and starting over.

unerr's MCP server is already agent-agnostic — any tool that speaks MCP gets the full knowledge graph. But the *rules and preferences* layer is fragmented. Cross-IDE Bridge unifies it — but only because every layer below it (Primitives, rules, entity profiles, Prompt Ledger) already exists and is agent-agnostic by design.

### The Problem

**"Context Whiplash"** — Switching IDEs or AI agents resets all context. The developer's `.cursorrules` don't transfer to Claude Code. The system prompt they spent an hour crafting is IDE-specific. Every tool switch is a cold start.

### Market Validation & Developer Complaints

- **Estimated affected users: 10–15M developers who use multiple IDEs or switch between AI agents.**
- **Reddit r/programming (verbatim):** *"Cursor is great but I switch to VS Code for debugging — losing all AI context mid-flow kills productivity."*
- **X/Twitter (verbatim):** *"Juggling separate configs for each agent is painful. No unified, versioned, graph-backed library yet."*
- **HN (verbatim):** *"The real lock-in isn't the IDE — it's the context you've built up. Switching from Cursor to Claude Code means re-teaching the AI everything about your project."*

### The unerr Solution

**unerr Cross-IDE Bridge: One context source, every tool.**

- unerr becomes the single source of truth for codebase context, rules, and conventions
- Any MCP-compatible agent (Cursor, Claude Code, Copilot, custom agents) gets identical context from the same graph
- Rules, Primitives, and entity profiles are IDE-agnostic — defined once in unerr, enforced everywhere
- One-click migration between tools: switch from Cursor to Claude Code with zero context loss

### Why It Must Wait

Cross-IDE Bridge is the *capstone*, not the foundation. It only matters when there is substantial context worth syncing — mature Primitives, validated rules, rich entity profiles, dense Prompt Ledger data. Launching Cross-IDE Bridge before these layers exist would sync... nothing. An empty bridge is not a product. We ship it when unerr has enough depth that losing context when switching tools is a *real, felt pain* — not a theoretical one. By that point, the bridge sells itself.

---

## The Sequencing: What We Build When

| Phase | Adjacency | Why This Sequence |
|---|---|---|
| **Now (Core)** | Causal Substrate + MCP | The foundation. Everything above is inert without this. |
| **Phase 2** | Primitives | First adjacency unlocked by convention mining. Immediate developer value. Strong PLG signal. Validates that the graph is accurate enough to auto-discover canonical implementations. |
| **Phase 2** | Pre-Flight Gatekeeper | Leverages existing local graph + rules. Small engineering surface. High virality. Validates that the rules engine produces trustworthy results. |
| **Phase 3** | AI-Lens | Requires mature Prompt Ledger with months of captured data. Enterprise sales accelerant. Validates provenance tracking. |
| **Phase 3** | Vertical Guardrails | Requires the rules engine to be proven by Gatekeeper. Enterprise deal-closer for regulated industries. |
| **Phase 3** | Surgical CI | Requires proven blast radius computation across diverse codebases. DevOps persona expansion. |
| **Phase 4** | Floor Control | Requires Primitives + mature graph + proven blast radius. Highest ACV but highest complexity. The last major adjacency — launched only when every component it depends on is battle-tested. |
| **Phase 4** | Cross-IDE Bridge | The capstone. Requires all prior layers to be worth syncing. Natural once MCP is the standard and unerr has depth. |

**Note the domino effect:** Phase 2 validates the graph (Primitives) and the rules engine (Gatekeeper). Phase 3 uses that validation to extend into compliance (Vertical Guardrails), provenance (AI-Lens), and CI (Surgical CI). Phase 4 composes *everything* into orchestration (Floor Control) and unification (Cross-IDE Bridge). Each phase proves the components that the next phase depends on. Skip a phase, and the next one collapses.

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
| **Primitives** | Reinvented boilerplate, inconsistency | Convention mining + entity profiles + rules engine | Individual devs → Team leads | Freemium + Enterprise Standards |
| **Floor Control** | AI chaos, coordination overhead | Blast radius + Primitives + entity profiles + architectural gravity | Tech leads, CTOs, PMs | Enterprise seats (highest ACV) |
| **Pre-Flight Gatekeeper** | Review queue overflow | Local graph snapshot + rules engine | Individual devs → Teams | Free (PLG) → Team tier |
| **AI-Lens** | AI provenance blindness | Prompt Ledger + convention adherence scoring | CISOs, compliance officers | Enterprise tier |
| **Surgical CI** | CI gridlock from AI-speed PRs | Impact analysis + blast radius computation (entity-level) | DevOps leads, platform engineers | Usage-based (CI minutes saved) |
| **Vertical Guardrails** | Regulatory violations | Mature rules engine + compliance surface map | Compliance teams, CISOs | Premium add-on per vertical |
| **Cross-IDE Bridge** | Context whiplash between tools | All prior layers (Primitives, rules, entity profiles, Prompt Ledger) | Multi-tool developers | Included in paid tier |

---

> **The bottom line: Every adjacency in this document is a natural crystallization of intelligence the Causal Substrate already computes. We don't build new technology for each expansion — we surface existing graph intelligence where the pain is loudest. But "already computes" is not the same as "ready to ship." Each adjacency requires the underlying signals to be dense, accurate, and battle-tested. A shallow graph produces shallow products. A noisy rules engine produces false positives. A sparse Prompt Ledger produces empty provenance. The adjacencies are not blocked by engineering effort — they are blocked by substrate maturity. When the graph is ready, they emerge. When it isn't, they fail. This is why competitors who build these features without a causal substrate will produce visibly inferior products — and why we can afford to wait until the foundation is unshakable.**
