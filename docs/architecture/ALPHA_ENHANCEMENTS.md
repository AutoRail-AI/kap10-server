# Alpha Wave Enhancements: From Pipeline to Intelligence Engine

> A senior architect's critique and redesign of the algorithmic depth roadmap.
> Written after auditing every implementation file, the product vision, and the competitive landscape.

---

## Part 1: Diagnosis — Where We Actually Are

### What's Working (and genuinely differentiated)

The justification pipeline is the real moat. No competitor does this:

1. **Topological-order LLM justification** — Bottom-up through the call graph so the LLM sees proven callee justifications before classifying callers. This is structurally correct and elegant.
2. **Bi-temporal justification storage** — Old justifications aren't deleted; they're superseded with `valid_to`. You can time-travel through a codebase's evolving understanding.
3. **Staleness cascading** — When a callee changes, its callers are re-justified. The `accumulatedChangedIds` pattern across topological levels is sound.
4. **Heuristic bypass** — Pure utilities skip LLM entirely (saves 20-40% of calls). This is the right instinct: don't waste expensive inference on trivially classifiable entities.
5. **Anti-pattern learning** — When a user reverts AI code, the system mines the revert for a rule and attaches warnings to similar entities. This is a genuine feedback loop that no competitor has.

### What's Broken (the honest truth)

**The call graph doesn't exist.** This is not an exaggeration. Let's trace the data:

- `scip-decoder.ts` creates `references` edges (line 83-113). Not `calls`.
- `tree-sitter.ts` creates `imports`, `extends`, `implements`, `member_of`. Not `calls`.
- `topological-sort.ts` line 43: `if (edge.kind !== "calls") continue`
- **Result: every entity lands on the same topological level.** The bottom-up justification — the core differentiator — degenerates into a flat batch.

This means:
- No real bottom-up propagation (all entities justified in parallel with no callee context)
- Impact analysis (`analyze_impact` MCP tool) returns nothing meaningful
- `get_callers` / `get_callees` MCP tools return empty results
- The health report's "god function" detection is based on `imports` edges, not actual call frequency

**The LLM sees the wrong code.** `prompt-builder.ts` caps function bodies at 3000 chars via `.slice(0, limit)`. A 500-line payment processing function shows the LLM its import statements and variable declarations — the setup code — not the Stripe-specific error handling and refund logic that IS the function's soul.

**Embeddings are order-dependent and lossy.** The pipeline runs: embed → ontology → justify. First-time embeddings have NO justification context (the `loadJustificationMap()` returns empty on first index). Only re-indexing benefits. And even then, `buildEmbeddableDocuments()` line 84 skips files, directories, modules, and namespaces entirely — the architectural containers that give code its structure.

**Centrality is degree counting.** `graph-context-builder.ts` normalizes `inbound + outbound edge count` and calls it "approximate betweenness centrality." It's degree centrality. `logger.info()` appears as the most architecturally critical entity in every codebase.

**Context propagation is frequency voting.** `context-propagator.ts` line 121-128: the parent gets the feature tag of whichever child tag appears most often. A `PaymentService` with 3 payment methods and 2 logging utilities gets tagged as "payment." Correct by luck, not by reasoning.

### What Competitors Do (and where we must be different)

| Tool | What It Captures | What It Misses |
|------|-----------------|----------------|
| **Cursor / Copilot** | Embedding similarity, file-level context window | No graph, no intent, no "why does this exist?" |
| **Sourcegraph Cody** | SCIP precise navigation, cross-file references | No business justification, no architectural understanding |
| **Claude Code** | On-demand file reading, powerful reasoning | No pre-built graph, limited by context window, starts fresh each session |
| **Aider** | Git-aware, tree-sitter repo map | Flat structure, no graph, no propagation |
| **Devin / OpenHands** | Full agent loop, file-level context | No semantic understanding, no conventions, no impact analysis |

**The gap we must own:** Every tool above treats code as text or syntax. None of them answer: *"What would break if I changed this, and why does it exist?"* That question requires a **complete call graph** (what would break) and **intent-aware justification** (why it exists). We have the architecture for both. We just haven't built the foundation (the call graph) that makes everything else work.

---

## Part 2: Architectural Principles

### Principle 1: Edges Are the Moat

Every downstream capability — PageRank, impact analysis, topological justification, community detection, staleness cascading — depends on **edge quality**. An entity with no edges is an island. A graph with only `imports` edges is a file dependency map, not a knowledge graph.

**Implication:** Alpha-1 (call graph) isn't just "the first wave." It's the load-bearing wall. Every week it slips, every downstream wave produces degraded results. The current plan treats it as 2 tasks. It should be treated as the singular critical path with no compromises.

### Principle 2: Convergence, Not Pipeline

The current mental model is a linear pipeline: parse → embed → ontology → justify → propagate → report. This creates ordering dependencies that shouldn't exist. Embeddings happen before justification. Ontology happens before justification. But embeddings should INCLUDE justification context, and ontology should be REFINED by justification results.

**Better model: independent signals that converge.**

```
                    ┌── Structural signal (graph position, PageRank, communities)
                    │
[Parse] → [Graph] ──┼── Intent signal (tests, docs, commits, entry points)
                    │
                    ├── Temporal signal (co-change, blame, drift)
                    │
                    └── Domain signal (ontology, conventions, rules)

                    ↓ converge

              [Unified Entity Profile]

                    ↓

              [Synthesis Embedding]
```

Each signal is independent. Each has its own confidence. The LLM synthesizes them into a unified justification. The embedding captures the synthesis, not just one signal.

### Principle 3: The Entity Profile Is the Product

What makes Unerr different is not the graph database, not the embeddings, not the MCP tools. It's the **entity profile** — the comprehensive understanding of a single function, class, or file that no other tool produces. The profile should be a first-class concept:

```typescript
interface EntityProfile {
  // Identity
  id: string
  kind: string
  name: string
  file_path: string

  // Structural signal
  callers: string[]            // who calls this
  callees: string[]            // what this calls
  centrality: number           // PageRank score
  community: string            // Louvain community ID
  blast_radius: number         // downstream impact count

  // Intent signal
  business_purpose: string     // WHY this exists
  feature_tag: string          // WHAT feature it belongs to
  taxonomy: string             // VERTICAL | HORIZONTAL | UTILITY
  test_coverage: string[]      // assertions that describe expected behavior

  // Temporal signal
  change_frequency: number     // how often this changes
  co_changes: string[]         // what changes WITH this
  last_modified: string        // when
  drift_score: number          // how much it's drifted from original intent

  // Quality signal
  confidence: number           // how certain we are about all the above
  confidence_breakdown: {      // per-signal confidence
    structural: number         // do we have good edge data?
    intent: number             // did the LLM produce a specific justification?
    temporal: number           // do we have enough git history?
  }
  architectural_pattern: string
  complexity: number
  is_dead_code: boolean
}
```

Every MCP tool returns some projection of this profile. The profile is what agents reason about. The profile is what gets embedded. The profile is the product.

### Principle 4: Don't Over-Engineer What Emerges Naturally

The deleted L-26 (hypergraph architecture) was correct to remove — the layers exist as separate stores. Similarly, L-27 doesn't need to be a research task — once you have PageRank scores and community labels, `assembleContext()` is a 50-line function that chains three queries. The waves should focus on producing the SIGNALS, not on the delivery format. Delivery is just query composition.

### Principle 5: Confidence Is Calibrated, Not Self-Reported

Current justification confidence is whatever the LLM says (0.0-1.0). An LLM saying "confidence: 0.95" means nothing without calibration. Real confidence should be computed from observable signals:

- Has test coverage? → +0.15 confidence
- Has doc comments? → +0.10
- Has >3 callers with justified context? → +0.10
- Entity name is descriptive (not `handle`, `process`, `do`)? → +0.05
- Commit messages mention business intent? → +0.10
- LLM self-reported confidence → weighted by historical accuracy of that model tier

This turns confidence from "LLM guessed 0.9" into "we have strong structural evidence, moderate intent evidence, and no temporal evidence — composite: 0.72."

---

## Part 3: Specific Wave Enhancements

### Alpha-1: Call Graph Completeness — THE CRITICAL PATH

**Current plan:** L-18 (execution graph edges + absorb L-01) + L-02 (cross-file tree-sitter calls).

**Problem:** L-18 is overloaded. It's simultaneously: (a) adding 4 new edge kinds, (b) wiring SCIP references as calls, (c) updating topological sort, (d) detecting event patterns. These are different problems with different verification criteria.

**Enhancement: Split L-18 into two focused tasks.**

**L-18a: Wire Existing References as Calls** (the 80/20 fix)
- SCIP `scip-decoder.ts` Pass 2 already creates `references` edges (lines 83-113).
- Reclassify these as `calls` edges where the reference is a function invocation (check if the referenced symbol is a function/method kind).
- This IMMEDIATELY gives us a call graph for SCIP-covered languages (TypeScript, Python, Go, Java).
- Update `topologicalSortEntityIds` to accept `calls` AND `references` edges (not just `calls`).
- **This is a 2-day task that unblocks every downstream wave.**

**L-18b: Event/Plugin Edge Detection** (the depth task)
- Add `emits`, `listens_to`, `implements` (wired), `mutates_state` edge kinds.
- Detect `.emit()`, `.on()`, `.addEventListener()` patterns.
- Wire `implements` from tree-sitter regex group 8 (currently ignored).
- Can run after L-18a without blocking other waves.

**Why this matters:** L-18a alone makes the topological sort work, makes impact analysis work, makes `get_callers`/`get_callees` return real data. L-18b adds depth for event-driven codebases but doesn't block the rest of the roadmap.

**L-02 stays as-is** — cross-file tree-sitter call edges are independently valuable.

---

### Alpha-2: Architectural Relevance — Add Confidence Calibration

**Current plan:** L-19 (PageRank) + L-23 (AST summarization).

**Enhancement: Add L-NEW-1: Computed Confidence Model.**

The current justification confidence is self-reported by the LLM. After Alpha-2, we have enough signals to compute REAL confidence:

```typescript
function computeConfidence(entity: EntityDoc, signals: {
  hasCallers: boolean
  hasCallees: boolean
  hasTests: boolean
  hasDocs: boolean
  hasDescriptiveName: boolean
  llmConfidence: number
  llmModelTier: "fast" | "standard" | "premium"
}): { composite: number, breakdown: Record<string, number> } {
  const structural = (signals.hasCallers ? 0.3 : 0) + (signals.hasCallees ? 0.2 : 0)  // 0-0.5
  const intent = (signals.hasDocs ? 0.2 : 0) + (signals.hasDescriptiveName ? 0.1 : 0)  // 0-0.3
  const llm = signals.llmConfidence * (signals.llmModelTier === "premium" ? 0.2 : 0.15)  // 0-0.2

  return {
    composite: structural + intent + llm,
    breakdown: { structural, intent, llm }
  }
}
```

**This is a ~50-line function.** But it transforms confidence from a meaningless LLM output into a calibrated signal that agents can actually trust. It also informs model routing: low structural confidence → spend more on premium LLM.

**L-23 enhancement: Don't just summarize — extract semantic anchors.**

Current L-23 plan: compress function bodies using structural tokens (`[ITERATES: items]`, `[TRY_CATCH: standard]`).

Better: extract **semantic anchors** — the lines that carry the most meaning:

1. **Decision points** — `if (payment.status === "failed")` tells you more than 20 lines of setup
2. **External calls** — `stripe.charges.create()` identifies the business integration
3. **State mutations** — `order.status = "completed"` reveals the side effect
4. **Error semantics** — `throw new InsufficientFundsError()` names the failure mode

These anchors should be tagged and preserved verbatim. Everything else gets structural tokens. The LLM then sees: "This function: validates payment card via Stripe, throws InsufficientFundsError on decline, mutates order.status to completed." That's the soul, in 3 lines.

---

### Alpha-3: Intent-Aware Justification — Unify the Intent Signal

**Current plan:** L-20 (hermeneutic propagation) + L-16 (test assertions) + L-17 (dead code exclusions).

**Enhancement: Reframe as "Intent Signal Extraction" — a unified concept.**

The current plan treats tests (L-16), dead code (L-17), and hermeneutic propagation (L-20) as separate tasks. But they're all answering the same question: **"Why does this code exist?"**

The intent signal has four sources:

| Source | Signal | Confidence |
|--------|--------|------------|
| **Tests** | `it("should reject expired payment methods")` → direct statement of expected behavior | High — written by humans to describe intent |
| **Entry points** | `POST /api/checkout` → this function serves the checkout flow | High — URL path is business intent |
| **Commit messages** | `"fix: handle partial refunds for multi-currency orders"` → the problem it solved | Medium — may be vague |
| **Naming conventions** | `validatePaymentCard` → the function name IS the intent | Medium — may be misleading |

L-20's hermeneutic propagation should propagate ALL of these signals, not just feature tags. After justification, an entity should have:

```typescript
intent: {
  from_tests: ["should reject expired payment methods", "should apply discount codes"],
  from_entry_points: ["POST /api/checkout", "POST /api/refund"],
  from_commits: ["handle partial refunds for multi-currency orders"],
  from_naming: "validates payment card details before charge",
  synthesized: "Validates payment card details as part of the checkout flow. Expected to reject expired cards and apply discount codes."
}
```

The LLM sees this synthesized intent when justifying callers. The propagation isn't just "push parent tag down" — it's "push the richest available intent signal down."

**L-17 simplification:** Once L-18b creates `listens_to` edges, most dead code false positives vanish automatically. L-17 only needs to handle the remaining cases: decorator-registered endpoints (`@Controller`), config exports, and plugin registrations. These are pattern-matchable without graph analysis.

---

### Alpha-4: Embedding & Ontology — Fix the Ordering Problem

**Current plan:** L-07 (kind-aware embeddings) + L-25 (semantic ontology).

**Critical enhancement: Two-pass embedding.**

The current pipeline embeds entities BEFORE justification. First-time embeddings have no justification context. This is architecturally wrong.

**Fix: Two embedding passes.**

1. **Pass 1 (structural embedding)** — Runs after indexing, before justification. Contains: entity name, kind, signature, file path, body (AST-summarized). Purpose: enable ontology discovery and initial search.

2. **Pass 2 (synthesis embedding)** — Runs after justification. Contains: everything from Pass 1 PLUS business_purpose, feature_tag, domain_concepts, intent signal. Purpose: enable intent-aware search.

This isn't two separate embedding columns (that's L-08's domain). It's re-running the same embedding with richer input. The `valid_to` pattern on embeddings already supports this — Pass 1 embeddings get superseded by Pass 2.

**L-25 enhancement: Ontology should classify, not just extract.**

Current ontology: extract terms by frequency → LLM refines. Output is a flat term list.

Better: the ontology should produce a **three-tier classification**:

```typescript
interface DomainOntology {
  domain_concepts: string[]       // "Invoice", "Payment", "Order" — business entities
  architectural_concepts: string[] // "Handler", "Controller", "Service" — structural patterns
  framework_concepts: string[]     // "Express", "Prisma", "Redis" — technology dependencies

  // The key insight: relationships between tiers
  domain_to_architecture: Record<string, string[]>
  // e.g., "Payment" → ["PaymentService", "PaymentController", "PaymentHandler"]
  // This tells the LLM: when you see "PaymentHandler", you're in the Payment domain
}
```

This classification feeds directly into justification prompts: "In this codebase, the Payment domain is implemented via PaymentService (domain logic), PaymentController (API layer), and PaymentHandler (event handling)." The LLM now has architectural context that turns generic classifications into specific ones.

---

### Alpha-5: Structural Search — Embed Position, Not Just Content

**Current plan:** L-22 (Graph-RAG embeddings) + L-21 (spectral partitioning).

**Enhancement: The "Structural Fingerprint" concept.**

L-22 proposes concatenating 1-hop neighborhood names into the embedding text. This is crude — it adds noise and doesn't capture the structural POSITION of an entity.

Better: compute a **structural fingerprint** per entity — a small vector that encodes graph position:

```
structural_fingerprint(entity) = [
  pagerank_score,           // how central
  community_id,             // which cluster
  depth_from_entry_point,   // how deep in the call stack
  fan_in / fan_out ratio,   // consumer vs. provider
  is_boundary_node,         // touches external dependency?
]
```

This 5-dimensional vector is concatenated with the text embedding (not replacing it). At query time, structural similarity AND semantic similarity are both considered. Two functions with identical code but different graph positions (one at the API boundary, one deep in domain logic) are correctly distinguished.

**L-21 should run BEFORE justification, not after.** Community membership is a powerful signal for the LLM. "This function is in the same community as PaymentService, CheckoutController, and StripeAdapter" tells the LLM exactly which domain it belongs to — before the LLM even reads the code. Move community detection from Alpha-5 to a pre-justification phase in Alpha-3 or Alpha-4.

---

### Alpha-6: Temporal Patterns — The Hidden Knowledge Layer

**Current plan:** L-24 (git co-change mining) + L-13 (rule synthesis).

**Enhancement: Temporal signals should feed INTO justification, not just produce rules.**

The current plan treats temporal analysis as producing `logically_coupled` edges and synthesized rules. But co-change data is an incredibly powerful intent signal:

- Files that always change together are logically coupled, even if they share no `calls` edges
- A function that changed in the same commit as a bug fix commit has a different intent than one that changed in a feature commit
- Commit message clusters reveal the PROJECTS that drove code changes

**L-24 enhancement: Produce `temporal_context` per entity.**

```typescript
interface TemporalContext {
  change_frequency: number          // changes per month
  co_change_partners: string[]      // entities that change with this one (top 5)
  recent_commit_intents: string[]   // classified commit messages: "bug fix", "feature", "refactor"
  author_concentration: number      // 1.0 = single author, 0.0 = many authors (bus factor proxy)
  age: number                       // days since creation
  stability: number                 // days since last change / age (1.0 = never changes)
}
```

This feeds into the justification prompt as another signal. An entity that's changed 47 times by 3 different authors in the last month is clearly important and actively maintained — the LLM should know this.

**L-13 should produce conventions from PATTERNS, not just justifications.** Current plan: analyze justification data for recurring patterns. Better: analyze the actual CODE for recurring patterns. If every API route in the codebase validates auth before processing, that's a convention discoverable from code structure alone — you don't need justifications to find it. Justifications confirm and NAME the convention; structural analysis discovers it.

---

### Alpha-7: Delivery — The Agent Experience Layer

**Current plan:** L-14 (MCP metadata) + L-09 (cosine staleness) + L-27 (context assembly).

**Enhancement: L-14 should deliver Entity Profiles, not raw justification fields.**

Instead of "attach justification metadata to search results," the enhancement is: every MCP tool returns an **Entity Profile** (the first-class concept from Principle 3). The profile is a pre-computed, cached artifact per entity that agents can reason about directly.

```json
{
  "name": "processPayment",
  "kind": "function",
  "file": "lib/payment/processor.ts:42",
  "purpose": "Orchestrates payment processing via Stripe, handles partial refunds",
  "feature": "payment_processing",
  "taxonomy": "VERTICAL",
  "confidence": { "composite": 0.87, "structural": 0.9, "intent": 0.85, "temporal": 0.7 },
  "centrality": 0.73,
  "community": "Payment Processing (23 entities)",
  "blast_radius": 14,
  "tests": ["should reject expired cards", "should handle partial refunds"],
  "co_changes_with": ["stripe-adapter.ts", "payment-validator.ts"],
  "callers": ["CheckoutController.submit", "RefundHandler.process"],
  "callees": ["StripeAdapter.charge", "PaymentValidator.validate", "OrderStore.update"]
}
```

This is what an AI agent needs to make a decision. Not raw database fields — a coherent profile that tells a story.

**L-09 enhancement: Semantic staleness, not just cosine similarity.**

Current plan: compare old vs new justification embeddings; skip cascade if similarity > 0.95.

Better: semantic staleness should consider WHAT changed, not just whether the embedding moved:

- Changed function signature → always cascade (contract change)
- Changed body but same signature → cascade only if semantic anchors changed
- Changed comments only → never cascade
- Changed test assertions → cascade (intent changed)

This is more intelligent than a single cosine threshold and prevents both false cascades (comment edits) and missed cascades (signature changes that happen to produce similar embeddings).

---

### Alpha-8: Parser Fidelity — Add Semantic Anchor Extraction

**Current plan:** L-03 (preserve kind) + L-04 (multi-line imports) + L-08 (dual embeddings).

**Enhancement: L-03 should also preserve `original_kind` in justification and embedding documents** — not just in ArangoDB. The kind distinction (method vs function, type alias vs variable) should flow through the entire pipeline:

- Justification prompts should say "Method of class PaymentService" not "Function"
- Embeddings should include `Method: processPayment` not `Function: processPayment`
- MCP tools should return the original kind

**L-08 (dual embeddings) should use the two-pass embedding from Alpha-4** instead of storing two separate columns. The structural-only embedding (Pass 1) IS the "code embedding" and the synthesis embedding (Pass 2) IS the "semantic embedding." No need for a separate `variant` column — use the bi-temporal pattern.

---

## Part 4: New Concepts to Introduce

### Concept 1: The Entity Profile Cache

Pre-compute entity profiles after each justification run. Store in Redis with 24-hour TTL. Every MCP tool reads from this cache instead of assembling data from 4 different stores at query time.

**Why:** Current MCP tools make 3-5 database calls per request (entity from ArangoDB, justification from ArangoDB, embeddings from pgvector, callers/callees from ArangoDB). A pre-computed profile is a single cache read.

**Effort:** ~4 hours. A `buildEntityProfile()` function + cache warm after justification.

### Concept 2: Signal-Aware Justification Prompts

Instead of building one giant prompt with everything, structure the prompt around signals:

```
STRUCTURAL SIGNAL:
- Callers: CheckoutController.submit, RefundHandler.process
- Callees: StripeAdapter.charge, PaymentValidator.validate
- Centrality: 0.73 (top 5% in this codebase)
- Community: Payment Processing cluster (23 entities)

INTENT SIGNAL:
- Tests: "should reject expired cards", "should handle partial refunds"
- Entry point: Called from POST /api/checkout
- Naming: "processPayment" suggests payment orchestration

TEMPORAL SIGNAL:
- Changed 12 times in last 90 days (active development)
- Co-changes with: stripe-adapter.ts (85% co-change rate)
- Last commit: "fix: handle partial refunds for multi-currency orders"

DOMAIN SIGNAL:
- Domain ontology: Payment, Checkout, Order, Refund
- Conventions: All payment functions validate currency before processing

Given these signals, classify this entity:
```

This is a better prompt than the current monolithic approach because:
1. Each signal is labeled and weighted by the LLM independently
2. Missing signals are explicit (empty section = low confidence for that dimension)
3. The LLM can reason about signal agreement/disagreement

### Concept 3: Incremental Profile Updates

Don't re-justify an entire repo when one function changes. Instead:

1. Re-extract the changed entity
2. Update its structural signal (callers/callees may have changed)
3. Update its temporal signal (new commit)
4. Re-run justification for JUST this entity with updated signals
5. Check if the new justification changes the entity's profile significantly
6. If yes: cascade to direct callers (1-hop only, not full re-justification)
7. If no: update the profile cache, done

This is the current incremental approach, but with the explicit signal framing it becomes cleaner: you know WHICH signal changed and can skip re-computing signals that didn't.

---

## Part 5: What to Cut or Simplify

### Simplify L-22 (Graph-RAG)

The current L-22 plan mentions Node2Vec and GraphSAGE. These are heavy ML approaches that require training. For a codebase graph of 1,000-50,000 entities, the structural fingerprint (5 dimensions: PageRank, community, depth, fan ratio, boundary) captures the same information without any training. Node2Vec adds complexity without proportional value at this graph scale.

**Simplified L-22:** Concatenate structural fingerprint + 1-hop neighbor names into embedding text. Drop Node2Vec.

### Simplify L-21 (Spectral Partitioning)

Louvain community detection already exists in `pattern-mining.ts`. The "spectral" part (Laplacian eigenvalues) adds theoretical elegance but Louvain is sufficient for feature discovery. The real task is moving Louvain from pattern-detection to pre-justification and feeding community membership into justification prompts.

**Simplified L-21:** Move Louvain to pre-justification. Feed community labels into prompts. Skip spectral analysis unless Louvain produces clearly wrong partitions.

### Defer L-08 (Dual Embeddings)

If we do two-pass embedding (Alpha-4 enhancement), we get structural + synthesis embeddings for free. L-08's explicit dual-variant approach is redundant. Defer to backlog.

---

## Part 6: How This Differentiates From Competitors

### The Competitive Landscape (What They Actually Do)

**Cursor:** Embeds files. Retrieves by similarity. The agent sees similar code but doesn't know WHY it exists or WHAT depends on it. Context window is the bottleneck.

**Sourcegraph Cody:** SCIP precise navigation. Can jump to definition, find references. But no business context — "here are 47 callers" with no ranking, no intent, no impact score.

**Claude Code:** Reads files on demand. Powerful reasoning but starts fresh each session. No pre-built graph, no conventions, no "what would break."

**GitHub Copilot Workspace:** Planning + execution. But planning is based on file-level context, not graph-level understanding. Can't identify hidden dependencies.

### What Unerr Does That Nobody Else Can (After Alpha Waves)

1. **"What would break?"** — Complete call graph + PageRank-weighted impact analysis. Not "here are 47 references" but "changing this affects 14 functions, 3 are critical (blast radius > 50), the highest-risk is CheckoutController.submit which has 8 downstream dependents."

2. **"Why does this exist?"** — Intent-aware justification with signal decomposition. Not "this is a function" but "this validates payment cards as part of the checkout flow, expected to reject expired cards (from test evidence), actively maintained (changed 12 times in 90 days), co-changes with stripe-adapter.ts (hidden coupling)."

3. **"What conventions should I follow?"** — Not a static .cursorrules file but live convention discovery: "In this codebase, all API route handlers validate authentication before processing. 3 handlers violate this convention. The convention was established by commit abc123 on 2025-01-15."

4. **"Is my change consistent with the codebase?"** — Community-aware consistency checking. "Your new function is in the Payment Processing community but doesn't follow the pattern used by the other 22 functions in this community (missing currency validation)."

5. **"What's the confidence of this analysis?"** — Calibrated, decomposed confidence. Not "0.9" but "high structural confidence (complete call graph), medium intent confidence (no tests), low temporal confidence (new code, no history)."

### The One-Sentence Differentiator

> Other tools tell agents what code LOOKS LIKE. Unerr tells agents what code MEANS, what it AFFECTS, and what CONVENTIONS it should follow — with calibrated confidence in each claim.

---

## Part 7: Revised Wave Dependencies

```
Alpha-1a (Wire Calls Edges) ← THE 80/20 FIX, unblocks everything
  │
  ├─► Alpha-1b (Event/Plugin Edges) ← depth, not blocking
  │
  └─► Alpha-2 (PageRank + AST Summarization + Confidence Model)
        │
        ├─► Alpha-3 (Intent Signal Extraction + Community Detection)
        │     │
        │     └─► Alpha-4 (Two-Pass Embedding + Ontology Classification)
        │           │
        │           ├─► Alpha-5 (Structural Fingerprint + Feature Discovery)
        │           │     │
        │           │     ├─► Alpha-6 (Temporal Context + Rule Synthesis)
        │           │     │
        │           │     └─► Alpha-7 (Entity Profile Cache + Smart Staleness)
        │           │
        │           └─► Alpha-8 (Parser Fidelity) ← independent
        │
        └─► [Entity Profile concept available from Alpha-2 onward]
```

### Critical Path

Alpha-1a → Alpha-2 → Alpha-3 → Alpha-4 → Alpha-5 → Alpha-7

This chain goes from "no call graph" to "agents receive entity profiles with calibrated confidence" in 6 focused waves.

---

## Part 8: Summary of All Enhancements

| # | Enhancement | Type | Wave | Effort |
|---|------------|------|------|--------|
| 1 | Split L-18 into L-18a (wire references→calls) and L-18b (event edges) | Restructure | Alpha-1 | — |
| 2 | Entity Profile as first-class concept | New concept | Cross-cutting | 4h cache layer |
| 3 | Computed confidence model (not LLM self-reported) | New task | Alpha-2 | 4h |
| 4 | Semantic anchor extraction in L-23 (not just structural tokens) | Enhancement | Alpha-2 | Included |
| 5 | Unified intent signal (tests + entry points + commits + naming) | Reframe | Alpha-3 | Included in L-20 |
| 6 | Move community detection to pre-justification | Restructure | Alpha-3/4 | 2h |
| 7 | Two-pass embedding (structural → synthesis) | New concept | Alpha-4 | 4h |
| 8 | Three-tier ontology classification | Enhancement | Alpha-4 | Included in L-25 |
| 9 | Structural fingerprint (5D vector) instead of Node2Vec | Simplify | Alpha-5 | Simpler |
| 10 | Temporal context per entity (not just edges) | Enhancement | Alpha-6 | Included in L-24 |
| 11 | Signal-aware justification prompts | Enhancement | Alpha-3 | 4h |
| 12 | Entity Profile cache (Redis, pre-computed) | New concept | Alpha-7 | 4h |
| 13 | Semantic staleness (what changed, not just embedding distance) | Enhancement | Alpha-7 | Included in L-09 |
| 14 | Defer L-08 (dual embeddings) — covered by two-pass | Cut | Alpha-8 | Saved time |

**Net effect:** Same 8 waves, same 19 core tasks, but each task produces more coherent output because the concepts (Entity Profile, Signal Convergence, Calibrated Confidence) provide a unifying framework. The algorithm goes from "a collection of improvements" to "an intelligence engine with a clear information architecture."

---

## Addendum: Refinements from Second Review Pass

Three additional enhancements identified during a second review pass, now incorporated into `INDEXING_PIPELINE.md`:

| # | Enhancement | Wave/Task | Rationale |
|---|------------|-----------|-----------|
| 15 | **Manifest/config scanning for infrastructure-level event edges** — parse `serverless.yml`, CDK constructs, `docker-compose.yml` service dependencies to discover Lambda triggers, queue subscriptions, and service-to-service connections invisible in application code | Alpha-1 / L-18b (sub-task 9) | Event-driven edges from `.emit()/.on()` regex only catch in-code patterns. Infrastructure-as-code definitions contain event connections (SQS → Lambda, pub/sub subscriptions) that are structurally invisible to tree-sitter. |
| 16 | **`refresh_context` MCP tool** — agents call this mid-session to trigger incremental profile cache refresh for files they've modified, without waiting for full re-index | Alpha-7 / L-14 (sub-task 6) | During agentic loops, the agent's own code changes make cached profiles stale. `refresh_context({ files: [...] })` re-hashes affected entities and updates profiles in cache, enabling multi-turn agent workflows where subsequent queries reflect the agent's modifications. |
| 17 | **Temporal window bounding for FP-Growth** — cap co-change analysis at 90 days / 500 commits for FP-Growth computation, with 1000-file itemset ceiling for large repos | Alpha-6 / L-24 (sub-tasks 1-2) | Prevents unbounded computation on repos with long histories. Full-year window for basic frequency stats; tighter bounds for association rule mining where O(2^n) itemset explosion is a risk. |
