# Phase 8 — Usage-Based Billing & Limits (Langfuse-Powered): Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"I can see exactly what my AI usage costs, manage my subscription, and buy more credits when I hit my limit. Langfuse tracks every LLM call — that's what I pay for. No mysterious 'usage units,' just real dollar costs."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 8
>
> **Prerequisites:** [Phase 7 — PR Review Integration](./PHASE_7_PR_REVIEW_INTEGRATION.md) (all LLM-consuming features from Phases 4-7 are operational); Langfuse tracing wired into all AI SDK calls (Phases 4-7); Stripe account configured
>
> **What this is NOT:** Phase 8 does not add new AI features — it meters, limits, and monetizes the features built in Phases 4-7. It does not gate structural graph queries (MCP reads, get_function, get_callers) — those are free and unlimited. It does not implement seat-based pricing for individual plans — LLM cost is the single billing dimension.
>
> **Delivery position:** Phase 8 ships after all LLM-consuming features are stable (Phases 4-7). It is the launch gate — no public GA without billing. See [dependency graph](./VERTICAL_SLICING_PLAN.md#phase-summary--dependencies).

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Canonical Terminology](#11-canonical-terminology)
  - [1.2 Core User Flows](#12-core-user-flows)
  - [1.3 System Logic & State Management](#13-system-logic--state-management)
  - [1.4 Reliability & Resilience](#14-reliability--resilience)
  - [1.5 Performance Considerations](#15-performance-considerations)
  - [1.6 Phase Bridge → Phase 9](#16-phase-bridge--phase-9)
- [Part 2: Implementation & Tracing Tracker](#part-2-implementation--tracing-tracker)
  - [2.1 Infrastructure Layer](#21-infrastructure-layer)
  - [2.2 Database & Schema Layer](#22-database--schema-layer)
  - [2.3 Ports & Adapters Layer](#23-ports--adapters-layer)
  - [2.4 Backend / API Layer](#24-backend--api-layer)
  - [2.5 Frontend / UI Layer](#25-frontend--ui-layer)
  - [2.6 Testing & Verification](#26-testing--verification)

---

# Part 1: Architectural Deep Dive

## 1.1 Canonical Terminology

| Canonical term | DB / TS field | NOT called |
|---|---|---|
| **Plan** | `Subscription.planId`: `"free"`, `"pro"`, `"max"`, `"teams_pro"`, `"teams_max"`, `"enterprise"` | "tier", "level", "package" |
| **Monthly LLM budget** | `Subscription.monthlyLlmBudget` (Float, USD) | "credits", "tokens", "allowance", "quota" |
| **Usage snapshot** | `UsageSnapshot` Prisma model; `totalCostUsd` from Langfuse Daily Metrics API | "meter reading", "billing record", "usage log" |
| **On-demand credit** | `OnDemandPurchase` Prisma model; one-time Stripe charge that increases available budget | "top-up", "add-on", "booster" (use "on-demand credit" in code, "top-up" acceptable in UI copy) |
| **Budget check** | Pre-flight function `checkBudget(orgId)` called before LLM operations | "rate limit", "quota check", "usage gate" |
| **Over-limit** | `Subscription.status = "over_limit"` — org has exceeded monthly budget + on-demand credits | "throttled", "suspended", "blocked" |
| **Billing period** | `Subscription.currentPeriodStart` to `currentPeriodEnd` (calendar month, Stripe-aligned) | "cycle", "term", "interval" |
| **Cost pool** | Team plans: all seats contribute budget to a shared pool; `monthlyLlmBudget = perSeatBudget × seats` | "shared wallet", "team balance" |
| **Metered overage** | Stripe usage-based billing for LLM cost exceeding the plan's included budget | "excess", "overage charge", "burst billing" |
| **Langfuse Daily Metrics** | `GET /api/public/metrics/daily` — Langfuse API returning per-day cost aggregations tagged by `orgId` | "usage API", "cost API", "analytics endpoint" |

---

## 1.2 Core User Flows

Phase 8 has seven actor journeys. Four are user-initiated (subscribe, view usage, buy credits, upgrade), two are system-initiated (nightly sync, pre-flight budget check), and one is external-initiated (Stripe webhook).

### Flow 1: New User — Free Plan Auto-Provisioning

**Actor:** Developer who just signed up (Phase 0 auth)
**Precondition:** User created via Better Auth; organization exists
**Outcome:** Free plan subscription created automatically; $0.50/month LLM budget active

```
Step  Actor Action                           System Action                                                      State Change
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────────────────────────
1     User signs up (email or OAuth)         Better Auth creates user + org in Supabase                         public.user, public.organization

2                                            Post-signup hook (or lazy on first dashboard load):                unerr.subscriptions row created
                                             → Create Subscription:
                                               planId: "free"
                                               monthlyLlmBudget: 0.50
                                               status: "active"
                                               currentPeriodStart: now()
                                               currentPeriodEnd: endOfMonth()
                                               stripeCustomerId: null (Free has no Stripe)
                                               stripeSubscriptionId: null

3     User sees dashboard                    Dashboard shows:                                                    None
                                             "Free plan · $0.00 / $0.50 LLM budget used"
                                             Cost bar at 0%
                                             "Upgrade to Pro" CTA
```

**Design decision — lazy vs eager provisioning:** Free plan subscriptions are created lazily (on first dashboard load or first MCP tool call, whichever comes first). This avoids creating Stripe customers for users who never return. The `checkBudget()` function handles the case where no subscription exists by treating it as a Free plan with $0.50 budget.

### Flow 2: Upgrade to Pro — Stripe Checkout

**Actor:** Developer on Free plan who wants more LLM budget
**Precondition:** Free plan active; user on billing page
**Outcome:** Stripe subscription created; Pro plan active; $5.00/month LLM budget

```
Step  Actor Action                           System Action                                                      State Change
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────────────────────────
1     User clicks "Upgrade to Pro"           POST /api/billing/checkout                                          None
      on billing page                        → Create Stripe Checkout Session:
                                               mode: "subscription"
                                               price: STRIPE_PRICE_ID_PRO ($10/mo)
                                               metadata: { orgId, planId: "pro" }
                                               success_url: /billing?upgraded=true
                                               cancel_url: /billing

2     User redirected to Stripe              Stripe Checkout hosted page                                        None
      → enters payment details               → User completes payment

3     Stripe sends webhook                   POST /api/billing/webhook                                          unerr.subscriptions updated:
      checkout.session.completed             → Verify webhook signature                                          planId: "pro"
                                             → Extract orgId from metadata                                       monthlyLlmBudget: 5.00
                                             → Create/update Subscription:                                       stripeCustomerId: cus_xxx
                                               planId: "pro"                                                     stripeSubscriptionId: sub_xxx
                                               monthlyLlmBudget: 5.00                                           status: "active"
                                               stripeCustomerId: session.customer
                                               stripeSubscriptionId: session.subscription
                                               status: "active"
                                               currentPeriodStart/End from Stripe

4     User redirected back to /billing       Dashboard shows:                                                    None
                                             "Pro plan · $0.00 / $5.00 LLM budget used"
                                             Cost bar at 0%
                                             On-demand top-up option visible
```

**Proration:** Stripe handles mid-cycle upgrades automatically. If a user upgrades from Free to Pro on the 15th, Stripe prorates the charge for the remaining days. The `monthlyLlmBudget` is set to the full Pro amount immediately — no proration on the LLM budget side (user gets the full $5.00 from the upgrade moment).

### Flow 3: Budget Exhaustion — On-Demand Credit Purchase

**Actor:** Pro user who has used $5.00 of LLM budget this month
**Precondition:** `checkBudget()` detects org is at or over limit
**Outcome:** User purchases $5 on-demand credit; budget increased; operations resume

```
Step  Actor Action                           System Action                                                      State Change
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────────────────────────
1     Agent calls MCP tool that              MCP server → checkBudget(orgId):                                   None
      requires LLM (e.g. justify_entity)     → Fetch latest UsageSnapshot
                                             → totalCostUsd ($5.12) > budget ($5.00)
                                             → Live Langfuse check confirms: $5.12
                                             → Return 429 with JSON-RPC error:
                                               "Monthly LLM budget reached ($5.12 / $5.00).
                                                Buy more at https://app.unerr.dev/billing
                                                or upgrade your plan."

2     User visits /billing                   Dashboard shows:                                                    None
                                             ⚠ "You've used $5.12 / $5.00 LLM budget"
                                             Cost bar at 102% (red)
                                             ┌──────────────────┐  ┌──────────────────┐
                                             │  Buy $5 credit   │  │  Upgrade to Max  │
                                             └──────────────────┘  └──────────────────┘

3     User clicks "Buy $5 credit"            POST /api/billing/top-up                                           None
                                             → Create Stripe Payment Intent:
                                               amount: 500 (cents)
                                               metadata: { orgId, creditUsd: 5.00 }
                                             → Return client_secret for Stripe Elements

4     User confirms payment                  Stripe processes payment                                            None
      (card on file or new card)

5     Stripe sends webhook                   POST /api/billing/webhook                                          unerr.on_demand_purchases:
      payment_intent.succeeded               → Verify webhook signature                                          new row created
                                             → Create OnDemandPurchase:                                          creditUsd: 5.00
                                               creditUsd: 5.00                                                   periodStart/End aligned
                                               periodStart: subscription.currentPeriodStart                      to current billing period
                                               periodEnd: subscription.currentPeriodEnd
                                             → If org was over_limit:
                                               Clear over_limit status                                          subscription.status: "active"
                                               (new budget = $5.00 plan + $5.00 on-demand = $10.00)

6     Agent retries MCP tool call            checkBudget(orgId):                                                 None
                                             → totalCostUsd ($5.12) < new budget ($10.00)
                                             → Allowed ✓
                                             → LLM operation proceeds
```

**Instant unlock:** On-demand credit purchases take effect the moment Stripe's webhook arrives (typically <5 seconds after payment). No manual intervention needed. The `checkBudget()` function sums `plan.monthlyLlmBudget + SUM(on_demand_purchases.creditUsd)` for the current billing period.

### Flow 4: Nightly Billing Sync — `syncBillingWorkflow`

**Actor:** System (Temporal cron workflow)
**Precondition:** At least one org with active subscription; Langfuse has recorded LLM usage
**Outcome:** Usage snapshots written to Prisma; over-limit orgs flagged; Stripe overage reported

```
Step  System Action                                                                State Change
────  ──────────────────────────────────────────────────────────────────────────    ──────────────────────────────
1     Temporal cron trigger: daily at 00:05 UTC                                    Workflow started
      Workflow ID: sync-billing-{date}

2     Activity: getAllActiveOrgs (light-llm-queue)                                 None (read-only)
      → Prisma: SELECT org_id FROM subscriptions WHERE status IN ('active', 'over_limit')
      → Return: list of org IDs with active subscriptions

3     For each org (batched, 10 concurrent):

3a    Activity: getLangfuseCost (light-llm-queue)                                  None (read-only)
      → GET /api/public/metrics/daily
        ?tags=[orgId]
        &fromTimestamp={currentPeriodStart}
        &toTimestamp={now}
      → Sum totalCost across all days in the period
      → Return: { orgId, totalCostUsd }

3b    Activity: writeUsageSnapshot (light-llm-queue)                               unerr.usage_snapshots:
      → INSERT UsageSnapshot:                                                      new row created
        organizationId: orgId
        totalCostUsd: cost from 3a
        snapshotAt: now()

3c    Activity: checkAndEnforceLimits (light-llm-queue)                            unerr.subscriptions:
      → Fetch plan for org                                                         status may change
      → Calculate budget: plan.monthlyLlmBudget + SUM(on_demand_purchases)
      → If totalCostUsd > budget AND status != "over_limit":
          Set subscription.status = "over_limit"
          (MCP tool calls will return 429 until budget restored)
      → If totalCostUsd <= budget AND status == "over_limit":
          Set subscription.status = "active"
          (org was over_limit but bought credits or new period started)

3d    Activity: reportStripeOverage (light-llm-queue)                              Stripe metered usage
      → If totalCostUsd > plan.monthlyLlmBudget:                                  record updated
          overage = totalCostUsd - plan.monthlyLlmBudget
          Stripe.subscriptionItems.createUsageRecord(
            subscription_item: stripeItemId,
            quantity: ceil(overage * 100),  // cents
            action: "set"
          )
      → Stripe will invoice the overage at end of billing cycle

4     Workflow completes                                                            Workflow marked complete
      → Log: "Synced billing for {N} orgs. {M} over limit."
```

**Batch processing:** The workflow processes orgs 10 at a time to avoid overwhelming the Langfuse API. Each org's activities run sequentially (getLangfuseCost → writeSnapshot → checkLimits → reportOverage), but multiple orgs process concurrently within each batch.

### Flow 5: Pre-Flight Budget Check (Real-Time)

**Actor:** System (MCP server, inline with tool call processing)
**Precondition:** Agent calls an LLM-consuming MCP tool
**Outcome:** Tool call proceeds if budget available; 429 if budget exhausted

```
Step  System Action                                                      Latency
────  ───────────────────────────────────────────────────────────────     ──────────
1     MCP server receives tool call (e.g., justify_entity)               —

2     Classify tool: is this an LLM-consuming operation?                 ~0.1ms
      → Budget-gated tools: justify_entity, generate_health_report,
        llm_synthesize_rules, review_pr (Phase 7),
        any tool that calls AI SDK
      → Non-gated tools: get_function, get_callers, search_code,
        sync_local_diff, get_project_stats, etc.
      → If non-gated: skip budget check, proceed immediately

3     Fast path: check cached budget status                              ~1ms
      → Redis: GET budget-status:{orgId}
      → If "ok" (cached within last 60s): proceed to tool execution
      → If "over_limit": return 429 immediately
      → If cache miss: continue to step 4

4     Warm path: check latest UsageSnapshot                              ~5ms
      → Prisma: SELECT totalCostUsd FROM usage_snapshots
        WHERE organization_id = orgId
        ORDER BY snapshot_at DESC LIMIT 1
      → Fetch plan: SELECT monthlyLlmBudget FROM subscriptions
        WHERE organization_id = orgId
      → Calculate budget: plan.monthlyLlmBudget + SUM(on_demand credits)
      → If totalCostUsd < budget * 0.9: cache "ok" in Redis (60s TTL),
        proceed to tool execution
      → If totalCostUsd >= budget * 0.9: continue to step 5 (near limit)

5     Slow path: live Langfuse check (near-limit orgs only)              ~200ms
      → GET /api/public/metrics/daily for orgId, current period
      → Sum totalCost
      → If liveCost >= budget: return 429 with budget exceeded message
      → If liveCost < budget: cache "ok" in Redis (30s TTL — shorter
        because near limit), proceed to tool execution

6     Tool execution proceeds                                             (tool latency)
```

**Three-tier check ensures speed without stale data:**

| Tier | When used | Latency | Freshness |
|---|---|---|---|
| **Redis cache** | >90% of checks (budget well under limit) | ~1ms | 60s stale (acceptable — nightly sync catches drift) |
| **Prisma snapshot** | Cache miss or first check after sync | ~5ms | Up to 24h stale (nightly sync) |
| **Live Langfuse** | Org is within 10% of budget limit | ~200ms | Real-time (seconds) |

**Why not always check Langfuse live?** The Langfuse API has rate limits and adds ~200ms latency. For orgs well under budget (the common case), a cached "ok" from the nightly snapshot is sufficient. Only orgs approaching their limit need real-time precision.

### Flow 6: Team Plan — Shared Cost Pool

**Actor:** Team admin managing a Teams Pro subscription
**Precondition:** Team org with 5 seats on Teams Pro ($8/seat/mo)
**Outcome:** All team members share a pooled LLM budget of $20 ($4/seat × 5 seats)

```
Step  Actor Action                           System Action                                                      State Change
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────────────────────────
1     Admin creates team org                 Better Auth org created                                             public.organization
      (Phase 0 org setup)

2     Admin upgrades to Teams Pro            Stripe Checkout → subscription created                              unerr.subscriptions:
      with 5 seats                           → planId: "teams_pro"                                                seats: 5
                                             → seats: 5                                                           monthlyLlmBudget: 20.00
                                             → monthlyLlmBudget: 4.00 * 5 = 20.00                                (4.00 × 5)

3     Admin invites team members             Better Auth org invitation flow                                     public.member rows created
      (Phase 0 org management)

4     Any team member uses LLM tools         checkBudget(orgId):                                                 None
                                             → All members' usage aggregated under orgId
                                               in Langfuse (traces tagged with orgId)
                                             → Budget check is against the pooled $20.00
                                             → Individual member usage visible in admin dashboard

5     Admin views usage dashboard            GET /api/billing/usage?orgId=...                                    None
                                             → Langfuse metrics broken down by userId tag:
                                               "Alice: $6.20, Bob: $4.10, Carol: $2.80..."
                                             → Total: $13.10 / $20.00 pool
```

**Seat changes:** When the admin adds or removes seats:
- **Add seat:** Stripe prorates. `monthlyLlmBudget` increases immediately by `perSeatBudget`.
- **Remove seat:** Stripe prorates. `monthlyLlmBudget` decreases. If the new budget is less than current usage, org goes over_limit until next period or on-demand purchase.

### Flow 7: Stripe Webhook — Subscription Lifecycle Events

**Actor:** Stripe (external system)
**Precondition:** User has an active Stripe subscription
**Outcome:** Subscription status kept in sync with Stripe

```
Stripe Event                        System Action                                    State Change
───────────────────────────────    ──────────────────────────────────────────────    ─────────────────────────
invoice.paid                       → Subscription period renewed                     currentPeriodStart/End updated
                                   → Reset on-demand credits for new period          on_demand_purchases from
                                     (old period credits don't carry over)           old period inactive
                                   → Clear over_limit if previously set              status: "active"

invoice.payment_failed             → Payment failed — Stripe will retry              status: "past_due"
                                   → Log warning, email admin (via Phase 7 email)
                                   → LLM tools still work for grace period (3 days)

customer.subscription.deleted      → User canceled subscription                      status: "canceled"
                                   → Downgrade to Free plan:                         planId: "free"
                                     monthlyLlmBudget: 0.50                          monthlyLlmBudget: 0.50
                                   → Existing repos preserved (data not deleted)

customer.subscription.updated      → Seat count or plan changed                      seats, monthlyLlmBudget
                                   → Recalculate monthlyLlmBudget                    updated
                                   → For teams: seats × perSeatBudget

payment_intent.succeeded           → On-demand credit purchase                       on_demand_purchases row
                                   → (handled in Flow 3 above)                       created
```

---

## 1.3 System Logic & State Management

### Billing Data Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Langfuse (source of truth for LLM cost)                                 │
│                                                                          │
│  Every AI SDK call → OpenTelemetry → LangfuseSpanProcessor              │
│  Tags: orgId, repoId, userId, model, toolName                           │
│  Records: tokens (input/output), model, cost (USD), timestamp           │
│                                                                          │
│  API: GET /api/public/metrics/daily                                      │
│    → { data: [{ date, totalCost, totalTokens, model, ... }] }           │
│                                                                          │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ nightly sync (Temporal)
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Supabase PostgreSQL (unerr schema)                                      │
│                                                                          │
│  subscriptions           → Plan, budget, Stripe IDs, status              │
│  usage_snapshots         → Nightly cost snapshots from Langfuse          │
│  on_demand_purchases     → One-time credit purchases                     │
│                                                                          │
└──────────────────────────┬───────────────────────────────────────────────┘
                           │ pre-flight check + usage queries
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Redis (cache layer)                                                      │
│                                                                          │
│  budget-status:{orgId}   → "ok" or "over_limit" (60s TTL)               │
│  budget-cost:{orgId}     → cached totalCostUsd (60s TTL)                 │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
                           │ subscription management
                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Stripe (payment processor)                                               │
│                                                                          │
│  Customer → Subscription → Metered usage item                            │
│  Payment Intents for on-demand credits                                   │
│  Webhooks for lifecycle events                                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Plan Definitions (Static Configuration)

Plans are defined as a static configuration object — no database table. Plan changes require a code deploy, which is intentional (plan pricing is a business decision, not a runtime config).

```
Plan: free
  monthlyLlmBudget: 0.50
  features: { indexing: "manual", justifications: "basic", patterns: "view_only", prReview: false }
  stripePriceId: null (no Stripe for Free)

Plan: pro
  monthlyLlmBudget: 5.00
  priceUsd: 10.00
  features: { indexing: "auto", justifications: "full", patterns: "auto_detect_custom", prReview: true }
  stripePriceId: env.STRIPE_PRICE_ID_PRO

Plan: max
  monthlyLlmBudget: 25.00
  priceUsd: 50.00
  features: { indexing: "auto", justifications: "full", patterns: "auto_detect_custom", prReview: true, priorityQueue: true }
  stripePriceId: env.STRIPE_PRICE_ID_MAX
  hidden: true (feature flag: SHOW_MAX_PLAN)

Plan: teams_pro
  perSeatBudget: 4.00
  perSeatPrice: 8.00
  minSeats: 3
  features: { ...pro, adminDashboard: true, perMemberUsage: true }
  stripePriceId: env.STRIPE_PRICE_ID_TEAMS_PRO

Plan: teams_max
  perSeatBudget: 20.00
  perSeatPrice: 40.00
  minSeats: 3
  features: { ...max, adminDashboard: true, perMemberUsage: true, sso: "saml_oidc" }
  stripePriceId: env.STRIPE_PRICE_ID_TEAMS_MAX

Plan: enterprise
  (contact sales — no self-serve)
```

### Subscription State Machine

```
             ┌──────────────────────────────────────────────────────────┐
             │                                                          │
signup ──► active ──────────► over_limit ─────────► active              │
             │                    │                    ▲                │
             │                    │                    │                │
             │                    │              buy on-demand          │
             │                    │              or new period          │
             │                    │                                     │
             │                    └──────────► canceled                 │
             │                                    ▲                    │
             │ payment_failed                     │                    │
             └──────────► past_due ───────────────┘                    │
                              │        (3-day grace, then cancel)       │
                              │                                        │
                              └──► active (Stripe retry succeeds)      │
                                                                       │
             cancel ──────────────────────────────────────────────────┘
                              → downgrade to Free plan
```

| Status | LLM tools | Graph tools | Dashboard | Webhooks queued? |
|---|---|---|---|---|
| `active` | Allowed | Allowed | Full access | Processed immediately |
| `over_limit` | **429** (blocked) | Allowed | Full + upgrade/top-up CTA | **Queued** (processed when budget restored) |
| `past_due` | Allowed (3-day grace) | Allowed | Warning banner + update payment CTA | Processed |
| `canceled` | Free plan limits | Allowed | Downgrade notice | Processed (at Free tier limits) |

**Critical: graph tools are NEVER budget-gated.** `get_function`, `get_callers`, `search_code`, `sync_local_diff`, and all other structural MCP tools do not consume LLM tokens and are always allowed regardless of billing status. Only tools that invoke the AI SDK (justify_entity, generate_health_report, llm_synthesize_rules, review_pr) are gated.

### Budget Calculation

```
Available budget for org:
  plan.monthlyLlmBudget
  + SUM(on_demand_purchases.creditUsd
        WHERE periodStart <= now() AND periodEnd >= now())
  = total_budget

Current usage:
  Latest UsageSnapshot.totalCostUsd
  (or live Langfuse check if near limit)
  = current_cost

Remaining:
  total_budget - current_cost = remaining_budget

Over limit when:
  current_cost >= total_budget
```

### Langfuse Tagging Requirements

For billing to work, every AI SDK call across Phases 4-7 must be tagged consistently:

```
AI SDK call (Vercel AI SDK):
  experimental_telemetry: {
    isEnabled: true,
    functionId: "justify_entity" | "synthesize_rules" | "review_pr" | ...,
    metadata: {
      orgId: ctx.orgId,          // REQUIRED — billing dimension
      repoId: ctx.repoId,        // for per-repo breakdown
      userId: ctx.userId,        // for per-member breakdown (teams)
      phase: "4" | "6" | "7",    // source phase
    }
  }
```

Langfuse receives these via OpenTelemetry spans and makes them queryable via the Daily Metrics API with tag filtering.

### What Gets Budget-Gated vs What's Free

| Operation | Budget-gated? | Rationale |
|---|---|---|
| `justify_entity` (Phase 4) | **Yes** | Calls LLM (gpt-4o-mini or gpt-4o) |
| `generate_health_report` (Phase 4) | **Yes** | Calls LLM for aggregation |
| `llm_synthesize_rules` (Phase 6) | **Yes** | LLM synthesizes rules from patterns |
| `review_pr` (Phase 7) | **Yes** | LLM analyzes impact (though most review is deterministic Semgrep) |
| `get_function`, `get_callers`, etc. | **No** | Pure graph query — no LLM, no cost |
| `search_code` | **No** | Keyword search — no LLM |
| `semantic_search` (Phase 3) | **No** | Uses pre-computed embeddings, not live LLM |
| `sync_local_diff` | **No** | Graph write — no LLM |
| `get_rules`, `check_rules` (Phase 6) | **No** | Deterministic Semgrep/ast-grep — no LLM |
| `get_project_stats` | **No** | ArangoDB aggregation — no LLM |
| Indexing (`indexRepoWorkflow`) | **No** | SCIP/Semgrep are deterministic; embedding (Phase 3) uses pre-built models, not paid LLM API |

### Rate Limiting by Plan

Phase 8 extends the existing Redis-backed rate limiter to be plan-aware:

| Plan | MCP tool calls / minute | LLM tool calls / minute | Concurrent workflows |
|---|---|---|---|
| Free | 30 | 5 | 1 |
| Pro | 120 | 30 | 3 |
| Max | 300 | 60 | 10 |
| Teams Pro | 120/seat | 30/seat | 3/seat |
| Teams Max | 300/seat | 60/seat | 10/seat |
| Enterprise | Custom | Custom | Custom |

The existing `checkRateLimit()` function in `lib/mcp/security/rate-limiter.ts` currently reads limits from env vars (flat `MCP_RATE_LIMIT_MAX=60`). Phase 8 replaces this with a plan-aware lookup:

```
1. Identify org's plan from Subscription (cached in Redis, 5-min TTL)
2. Look up plan's rate limits from static plan config
3. Call existing checkRateLimit() with plan-specific limits
```

---

## 1.4 Reliability & Resilience

### Failure Scenario Matrix

| # | Failure | Detection | Recovery | User Impact |
|---|---------|-----------|----------|-------------|
| 1 | **Langfuse API unreachable during nightly sync** | HTTP timeout (10s) on Daily Metrics API call | Temporal activity retries 3x with exponential backoff (5s, 15s, 45s). If all retries fail, workflow marks org as "sync_failed" and continues to next org. Next nightly run retries. | Usage snapshot not updated. Pre-flight check uses stale snapshot (up to 48h old). No false positives — budget check errs on the side of allowing (stale data shows lower cost than reality). |
| 2 | **Langfuse API returns incorrect cost data** | No automated detection (Langfuse is source of truth) | Manual investigation. Compare Langfuse dashboard vs unerr usage snapshots. If discrepancy found, admin can manually adjust via `/api/billing/admin/adjust`. | User may be over- or under-billed. Mitigated by transparency — users can verify in Langfuse dashboard. |
| 3 | **Stripe webhook delivery failure** | Stripe retries webhooks with exponential backoff for up to 3 days | Idempotent webhook handler — reprocessing the same event is safe (subscription upsert, not insert). Stripe dashboard shows failed webhook deliveries for manual inspection. | Subscription status may be stale for up to a few hours (Stripe retries quickly). Worst case: user paid but subscription not updated — manual fix via admin API or Stripe dashboard. |
| 4 | **Stripe webhook signature verification failure** | `stripe.webhooks.constructEvent()` throws | Return 400 to Stripe. Stripe retries. Log the event for investigation (possible configuration error or attack). | Same as #3. |
| 5 | **Double-processing of Stripe webhook** | Same event ID processed twice | Webhook handler checks event ID against a processed-events set in Redis (24h TTL). If already processed, return 200 immediately. | None — idempotent. |
| 6 | **Pre-flight budget check — Redis cache miss + Prisma timeout** | Prisma query timeout (5s) | Fall back to allowing the tool call. Log warning: `"Budget check degraded — allowing tool call for orgId"`. Set Redis cache to "unknown" (30s TTL) to prevent repeated Prisma timeouts. | Tool call proceeds without budget verification. Risk: org may slightly exceed budget. Mitigated by nightly sync catching overages. |
| 7 | **Pre-flight budget check — Langfuse live check timeout (near-limit org)** | HTTP timeout (5s) on Langfuse API | Fall back to the Prisma snapshot value. If snapshot shows over budget: return 429. If snapshot shows under budget: allow (err on the side of allowing). | Near-limit org may exceed budget by a small margin until nightly sync catches it. Acceptable trade-off for latency. |
| 8 | **User on Free plan — no Stripe customer** | `stripeCustomerId` is null | Budget check works without Stripe — uses Prisma subscription record only. On-demand purchase creates a Stripe customer lazily. | None — Free plan works entirely without Stripe. |
| 9 | **Nightly sync takes too long (>1000 orgs)** | Workflow duration exceeds 30 minutes | Batch size is configurable (default: 10 concurrent orgs). For large deployments, increase batch size or run sync more frequently (every 6 hours instead of nightly). | Some orgs may have stale snapshots for a few extra hours. No functional impact. |
| 10 | **On-demand purchase — payment fails** | Stripe returns payment error | Stripe Elements shows error to user in the UI. No OnDemandPurchase record created. Org remains over_limit. User can retry with different payment method. | Org stays over_limit until payment succeeds or new billing period starts. |
| 11 | **Billing period rollover — on-demand credits from previous period** | `currentPeriodStart` changes on `invoice.paid` webhook | On-demand credits are scoped to `periodStart`/`periodEnd`. Query filters by current period only. Old credits naturally expire. | Clean — no carryover confusion. |
| 12 | **Webhook queue for over-limit orgs** | GitHub webhook or PR review trigger arrives while org is over_limit | Webhooks that trigger LLM operations (PR review) are queued in a Temporal "pending" state. When org returns to active (via credit purchase or period reset), pending workflows resume. Non-LLM webhooks (push → indexing) proceed normally. | PR reviews delayed until budget restored. Indexing (no LLM) continues. Agent is informed via 429 response. |

### Idempotency Guarantees

| Operation | Idempotent? | Strategy |
|---|---|---|
| Stripe webhook processing | Yes | Redis set of processed event IDs (24h TTL) |
| UsageSnapshot write | Yes | Upsert by `(orgId, DATE(snapshotAt))` — one snapshot per org per day |
| On-demand credit creation | Yes | Deduplicate by `stripePaymentId` (unique constraint) |
| Subscription upsert | Yes | Upsert by `organizationId` (unique constraint) |
| Budget status cache | Yes | Redis SET with TTL — last write wins |

---

## 1.5 Performance Considerations

### Latency Budgets

| Operation | Target | Expected | Notes |
|---|---|---|---|
| Pre-flight budget check (cached "ok") | <2ms | ~1ms | Redis GET — hot path for >90% of checks |
| Pre-flight budget check (Prisma snapshot) | <10ms | ~5ms | Single indexed query — cache miss path |
| Pre-flight budget check (live Langfuse) | <300ms | ~200ms | Only for near-limit orgs (<10% of checks) |
| Nightly sync per org | <5s | ~2s | Langfuse API call + Prisma write + Redis cache update |
| Nightly sync total (100 orgs) | <5min | ~2min | 10 concurrent org batches |
| Stripe Checkout redirect | <2s | ~1s | Stripe-hosted — not under our control |
| On-demand credit unlock | <10s | ~5s | Stripe payment → webhook → DB write → Redis invalidate |
| Usage dashboard load | <500ms | ~300ms | Prisma query for snapshots + cached plan info |

### Budget Check Overhead on MCP Tool Calls

The budget check adds latency only to LLM-consuming tools:

| Tool type | Without Phase 8 | With Phase 8 (cached) | With Phase 8 (near-limit) |
|---|---|---|---|
| Graph tools (get_function) | ~300ms (cloud) / ~3ms (local) | Same (no check) | Same (no check) |
| LLM tools (justify_entity) | ~2000ms | ~2001ms (+1ms cache check) | ~2200ms (+200ms live check) |

The 1ms overhead on the hot path is negligible compared to LLM latency (~2s). The 200ms live Langfuse check is rare (only near-limit orgs) and still negligible compared to the LLM call itself.

### Langfuse API Rate Limits

Langfuse's Daily Metrics API has rate limits (exact limits depend on plan — typically 100 req/min on the paid plan). The nightly sync must stay within these limits:

| Scenario | Orgs | API calls/sync | Rate | Within Langfuse limit? |
|---|---|---|---|---|
| Early stage | 10-50 | 10-50 | 1 call/org | Yes (well under 100/min) |
| Growth | 100-500 | 100-500 | Batched 10/s | Yes (needs ~50s) |
| Scale | 1000+ | 1000+ | Batched 10/s | Borderline — may need pagination or caching |

**Mitigation for scale:** At >500 orgs, the sync workflow switches to a paginated approach — processing orgs in batches of 50, with a 5-second pause between batches. This stays within Langfuse rate limits while completing the full sync within 10 minutes.

### Stripe Webhook Latency

Stripe webhooks arrive within 1-5 seconds of the event. The webhook handler must respond within 30 seconds (Stripe's timeout). Our handler is fast:

1. Signature verification: ~1ms
2. Event ID dedup check (Redis): ~1ms
3. Prisma upsert: ~10ms
4. Redis cache invalidation: ~1ms
5. Total: ~15ms — well within Stripe's 30s timeout

---

## 1.6 Phase Bridge → Phase 9

Phase 8 is designed so that Phase 9 (Code Snippet Library) requires **zero refactoring** of the billing infrastructure — only integration.

### What Phase 9 inherits from Phase 8

| Phase 8 artifact | Phase 9 usage | Change type |
|---|---|---|
| **Plan feature flags** (`features.snippets`) | Gate snippet library access by plan (community: all, team: Teams+, auto-extract: Pro+) | Additive — add `snippets` key to plan feature config |
| **Budget check** (`checkBudget()`) | Snippet embedding uses LLM (for semantic search) — budget-gated | Reuse — same check function, new tool name in gated list |
| **Usage dashboard** (per-repo, per-model breakdown) | Snippet operations appear as a cost line item in Langfuse | Automatic — Langfuse traces tagged with `phase: "9"` |
| **Rate limiter** (plan-aware) | Snippet search and creation rate-limited by plan | Reuse — same rate limiter, new tool names |
| **Stripe subscription** | No changes — existing subscription model handles feature gating | Reuse |

### What Phase 8 must NOT do (to avoid Phase 9 rework)

1. **Do not hardcode the list of budget-gated tools.** Use a declarative config (set of tool names) so Phase 9 can add `embed_snippet` to the gated set without modifying the budget check logic.
2. **Do not hardcode plan feature flags.** Use a dictionary of feature keys (`{ indexing, justifications, patterns, prReview, snippets, ... }`) so Phase 9 can add `snippets` without modifying the plan definition structure.
3. **Do not couple the usage dashboard to specific phases.** The dashboard queries Langfuse by orgId — any phase that tags its LLM calls with orgId automatically appears in the usage breakdown. Phase 9's snippet embedding calls appear without dashboard changes.
4. **Do not assume individual-only billing.** The team cost pool model is already in place. Phase 9's snippet operations contribute to the team pool like any other LLM call.

### Post-Launch Billing Evolution

Phase 8 is the launch gate. After GA:

- **Phase 9 integration:** Snippet embedding and semantic search operations tagged in Langfuse, budget-gated, feature-flagged by plan.
- **Enterprise tier activation:** When enterprise customers appear, enable custom budgets, SSO, and dedicated infrastructure via the enterprise plan config (already coded but unused).
- **Max plan visibility:** When enough Pro users exist, flip the `SHOW_MAX_PLAN` feature flag to surface the Max tier in the pricing UI.
- **Usage-based pricing refinement:** As usage patterns emerge, adjust plan budgets and pricing based on real Langfuse cost data. No code changes — plan config is a static object, deployment-gated.

---

# Part 2: Implementation & Tracing Tracker

## 2.1 Infrastructure Layer

- [ ] **P8-INFRA-01: Add Stripe env vars to `env.mjs`** — M
  - New variables:
    - `STRIPE_SECRET_KEY` (required for billing — `z.string().optional()` with lazy init guard)
    - `STRIPE_PUBLISHABLE_KEY` (required for client-side Stripe Elements)
    - `STRIPE_WEBHOOK_SECRET` (required for webhook signature verification)
    - `STRIPE_PRICE_ID_PRO` (Stripe Price ID for Pro plan subscription)
    - `STRIPE_PRICE_ID_MAX` (Stripe Price ID for Max plan subscription)
    - `STRIPE_PRICE_ID_TEAMS_PRO` (Stripe Price ID for Teams Pro)
    - `STRIPE_PRICE_ID_TEAMS_MAX` (Stripe Price ID for Teams Max)
    - `STRIPE_API_VERSION` (default: `"2025-02-24.acacia"` per CLAUDE.md)
    - `SHOW_MAX_PLAN` (boolean feature flag, default: `false`)
  - All Stripe vars optional (billing disabled when absent — app works without Stripe for dev/test)
  - Langfuse vars already exist in `env.mjs` — no changes needed
  - **Test:** `pnpm build` succeeds without Stripe vars. With Stripe vars set, app starts normally.
  - **Depends on:** Nothing
  - **Files:** `env.mjs`, `.env.example`
  - Notes: _____

- [ ] **P8-INFRA-02: Add `stripe` npm package** — S
  - Add `stripe` to `package.json` dependencies
  - Use lazy initialization pattern (same as other infra clients):
    ```
    let instance: Stripe | null = null
    function getStripe(): Stripe {
      if (!instance) instance = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2025-02-24.acacia" })
      return instance
    }
    ```
  - Export via Proxy pattern for lazy init (consistent with Supabase, Redis, ArangoDB clients)
  - **Test:** `require('stripe')` succeeds. Lazy init does not connect until first use.
  - **Depends on:** P8-INFRA-01
  - **Files:** `lib/billing/stripe-client.ts` (new), `package.json`
  - Notes: _____

- [ ] **P8-INFRA-03: Wire Langfuse OpenTelemetry integration for AI SDK calls** — L
  - Ensure all Vercel AI SDK calls across Phases 4-7 use `experimental_telemetry`:
    ```
    experimental_telemetry: {
      isEnabled: true,
      functionId: "<tool_name>",
      metadata: { orgId, repoId, userId, phase: "<N>" }
    }
  - Configure `@langfuse/vercel` or `@langfuse/otel` span processor
  - Verify traces appear in Langfuse with correct tags
  - **Test:** Call an AI SDK function → trace appears in Langfuse with orgId tag. Query `GET /api/public/metrics/daily?tags=[orgId]` → returns cost data.
  - **Depends on:** Phase 4+ LLM calls exist
  - **Files:** `lib/mcp/tracing.ts` (major rewrite), possibly `lib/temporal/activities/` files that call AI SDK
  - **Acceptance:** All AI SDK calls tagged in Langfuse. Daily Metrics API returns per-org cost.
  - Notes: _____

---

## 2.2 Database & Schema Layer

- [ ] **P8-DB-01: Create `Subscription` Prisma model** — M
  - Model in `unerr` schema:
    - `id` (UUID, PK)
    - `organizationId` (String, unique — one subscription per org)
    - `planId` (String: `"free"`, `"pro"`, `"max"`, `"teams_pro"`, `"teams_max"`, `"enterprise"`)
    - `stripeCustomerId` (String?, nullable for Free plan)
    - `stripeSubscriptionId` (String?, nullable for Free plan)
    - `stripeItemId` (String?, metered usage item ID)
    - `seats` (Int, default: 1)
    - `monthlyLlmBudget` (Float, default: 0.50, USD)
    - `status` (String: `"active"`, `"past_due"`, `"canceled"`, `"over_limit"`)
    - `currentPeriodStart` (DateTime)
    - `currentPeriodEnd` (DateTime)
    - `createdAt`, `updatedAt`
  - `@@schema("unerr")`, `@@map("subscriptions")`
  - Unique constraint on `organizationId`
  - **Test:** `pnpm migrate` succeeds. CRUD operations work. Unique constraint on orgId enforced.
  - **Depends on:** Nothing
  - **Files:** `prisma/schema.prisma`, new SQL migration in `supabase/migrations/`
  - Notes: _____

- [ ] **P8-DB-02: Create `UsageSnapshot` Prisma model** — S
  - Model in `unerr` schema:
    - `id` (UUID, PK)
    - `organizationId` (String)
    - `totalCostUsd` (Float — from Langfuse Daily Metrics API)
    - `snapshotAt` (DateTime)
    - `createdAt` (DateTime)
  - Compound index on `(organizationId, snapshotAt)` for fast lookups
  - `@@schema("unerr")`, `@@map("usage_snapshots")`
  - **Test:** Insert snapshot → query by orgId + date range → correct results.
  - **Depends on:** Nothing
  - **Files:** `prisma/schema.prisma`, new SQL migration in `supabase/migrations/`
  - Notes: _____

- [ ] **P8-DB-03: Create `OnDemandPurchase` Prisma model** — S
  - Model in `unerr` schema:
    - `id` (UUID, PK)
    - `organizationId` (String)
    - `creditUsd` (Float — e.g., 5.00)
    - `amountCents` (Int — Stripe amount in cents, e.g., 500)
    - `stripePaymentId` (String?, unique — for idempotency)
    - `periodStart` (DateTime — scoped to billing period)
    - `periodEnd` (DateTime)
    - `createdAt` (DateTime)
  - Compound index on `(organizationId, periodStart)`
  - Unique constraint on `stripePaymentId` (prevents double-processing)
  - `@@schema("unerr")`, `@@map("on_demand_purchases")`
  - **Test:** Insert purchase → query by orgId + period → correct sum. Duplicate stripePaymentId → rejected.
  - **Depends on:** Nothing
  - **Files:** `prisma/schema.prisma`, new SQL migration in `supabase/migrations/`
  - Notes: _____

---

## 2.3 Ports & Adapters Layer

- [ ] **P8-ADAPT-01: Implement `StripePayments` adapter** — L
  - Replace all `NotImplementedError` stubs with real Stripe API calls:
    - `createCheckoutSession(orgId, planId)` → `stripe.checkout.sessions.create()`
    - `createSubscription(orgId, planId)` → handled via Checkout Session (not direct API)
    - `cancelSubscription(subscriptionId)` → `stripe.subscriptions.cancel()`
    - `reportUsage(orgId, amount, description)` → `stripe.subscriptionItems.createUsageRecord()`
    - `createOnDemandCharge(orgId, amountUsd)` → `stripe.paymentIntents.create()`
  - Uses lazy-initialized Stripe client from P8-INFRA-02
  - Falls back gracefully when Stripe vars not configured (returns descriptive error, doesn't crash)
  - **Test:** Mock Stripe SDK → `createCheckoutSession` returns URL. `reportUsage` creates usage record. `cancelSubscription` cancels. `createOnDemandCharge` returns client secret.
  - **Depends on:** P8-INFRA-02
  - **Files:** `lib/adapters/stripe-payments.ts` (rewrite)
  - **Acceptance:** All 5 IBillingProvider methods functional with Stripe. No NotImplementedError remains.
  - Notes: _____

- [ ] **P8-ADAPT-02: Implement Langfuse cost retrieval in `LangfuseObservability`** — M
  - Replace stub `getOrgLLMCost()` with real Langfuse Daily Metrics API call:
    ```
    GET /api/public/metrics/daily
      ?tags=[orgId]
      &fromTimestamp={from}
      &toTimestamp={to}
    → Sum day.totalCost across response
    ```
  - Replace stub `getCostBreakdown()` with per-model and per-repo aggregation
  - Replace stub `getModelUsage()` with per-model token counts
  - Uses `@langfuse/client` SDK or direct HTTP (depending on SDK availability)
  - **Test:** Mock Langfuse API → `getOrgLLMCost("org_123", periodStart, now)` returns summed cost. `getCostBreakdown("org_123")` returns per-model breakdown.
  - **Depends on:** P8-INFRA-03
  - **Files:** `lib/adapters/langfuse-observability.ts` (rewrite stubs)
  - **Acceptance:** Real Langfuse API calls. Cost data matches Langfuse dashboard.
  - Notes: _____

- [ ] **P8-ADAPT-03: Extend `IRelationalStore` with billing methods** — M
  - Add methods to `lib/ports/relational-store.ts`:
    - `getSubscription(orgId: string): Promise<Subscription | null>`
    - `upsertSubscription(data: SubscriptionUpsert): Promise<Subscription>`
    - `writeUsageSnapshot(data: UsageSnapshotCreate): Promise<void>`
    - `getLatestUsageSnapshot(orgId: string): Promise<UsageSnapshot | null>`
    - `getOnDemandBalance(orgId: string, periodStart: Date, periodEnd: Date): Promise<number>`
    - `createOnDemandPurchase(data: OnDemandPurchaseCreate): Promise<void>`
    - `markOrgOverLimit(orgId: string): Promise<void>`
    - `clearOrgOverLimit(orgId: string): Promise<void>`
  - Implement in `PrismaRelationalStore`
  - Implement in `FakeRelationalStore` (in-memory maps)
  - **Test:** `upsertSubscription` creates on first call, updates on second. `getOnDemandBalance` sums credits for current period only. `markOrgOverLimit` sets status to "over_limit".
  - **Depends on:** P8-DB-01, P8-DB-02, P8-DB-03
  - **Files:** `lib/ports/relational-store.ts` (modified), `lib/adapters/prisma-relational-store.ts` (modified), `lib/di/fakes.ts` (modified)
  - Notes: _____

- [ ] **P8-ADAPT-04: Extend rate limiter to be plan-aware** — M
  - Modify `lib/mcp/security/rate-limiter.ts`:
    - Accept `planId` parameter (or look up from cached subscription)
    - Map plan to rate limit config: `{ free: 30/min, pro: 120/min, max: 300/min, ... }`
    - Separate limits for LLM tools vs general tools
  - Cache plan lookup in Redis (5-min TTL) to avoid Prisma query per request
  - **Test:** Free plan → 31st request in 60s rejected. Pro plan → 121st request rejected. Plan upgrade mid-session → new limits apply after cache expiry.
  - **Depends on:** P8-DB-01, existing rate limiter
  - **Files:** `lib/mcp/security/rate-limiter.ts` (modified)
  - Notes: _____

---

## 2.4 Backend / API Layer

### Billing Domain Logic

- [ ] **P8-API-01: Create plan definitions module** — M
  - Static configuration of all plan tiers: Free, Pro, Max, Teams Pro, Teams Max, Enterprise
  - Each plan defines: `monthlyLlmBudget`, `priceUsd`, `perSeatBudget` (teams), `stripePriceId`, `features` dict, `rateLimits`, `hidden` flag
  - Feature flags dictionary: `{ indexing, justifications, patterns, prReview, priorityQueue, adminDashboard, perMemberUsage, sso }`
  - Helper functions:
    - `getPlan(planId): PlanConfig`
    - `getAvailablePlans(options?): PlanConfig[]` — respects `SHOW_MAX_PLAN` feature flag
    - `isFeatureEnabled(planId, featureKey): boolean`
    - `calculateTeamBudget(planId, seats): number`
  - **Test:** `getPlan("pro")` returns correct config. `getAvailablePlans()` excludes Max when flag off. `calculateTeamBudget("teams_pro", 5)` returns 20.00.
  - **Depends on:** Nothing
  - **Files:** `lib/billing/plans.ts` (new)
  - Notes: _____

- [ ] **P8-API-02: Create budget enforcement module** — L
  - `checkBudget(orgId, container): Promise<void>` — throws `BudgetExceeded` if over limit
  - Three-tier check: Redis cache → Prisma snapshot → live Langfuse
  - Only called for LLM-consuming tools (configurable set)
  - `BudgetExceeded` error includes: `{ orgId, currentCost, budget, upgradeUrl }`
  - `isBudgetGatedTool(toolName): boolean` — checks against static set of LLM tool names
  - Cache management:
    - `budget-status:{orgId}` → `"ok"` or `"over_limit"` (60s TTL for well-under-budget, 30s for near-limit)
    - `budget-cost:{orgId}` → cached totalCostUsd
  - **Test:** Org under budget → allowed. Org over budget → BudgetExceeded thrown. Cached "ok" → no Prisma query. Near-limit → live Langfuse check. Langfuse timeout → fall back to snapshot.
  - **Depends on:** P8-ADAPT-02, P8-ADAPT-03
  - **Files:** `lib/billing/enforce.ts` (new)
  - **Acceptance:** Three-tier check works. Budget-gated tools blocked when over limit. Non-gated tools always pass.
  - Notes: _____

- [ ] **P8-API-03: Create on-demand credit purchase logic** — M
  - `purchaseCredits(orgId, amountUsd, container): Promise<{ clientSecret: string }>`
  - Creates Stripe Payment Intent with metadata `{ orgId, creditUsd, periodStart, periodEnd }`
  - Returns `clientSecret` for Stripe Elements frontend
  - On success (webhook): creates `OnDemandPurchase` record, clears `over_limit` status
  - Credit amounts: $5, $10, $25 (fixed options in UI)
  - **Test:** Purchase $5 → Payment Intent created with correct amount. Webhook → OnDemandPurchase created. Budget recalculated: plan budget + $5 credit.
  - **Depends on:** P8-ADAPT-01, P8-ADAPT-03
  - **Files:** `lib/billing/on-demand.ts` (new)
  - Notes: _____

- [ ] **P8-API-04: Create usage aggregation module** — M
  - Functions for the usage dashboard:
    - `getUsageSummary(orgId): { totalCostUsd, budget, remaining, percentUsed, plan }`
    - `getCostBreakdownByRepo(orgId, from, to): { repoId, repoName, cost }[]` — from Langfuse tags
    - `getCostBreakdownByModel(orgId, from, to): { model, cost, tokens }[]` — from Langfuse
    - `getCostTimeline(orgId, from, to): { date, cost }[]` — daily cost for charts
    - `getPerMemberUsage(orgId, from, to): { userId, userName, cost }[]` — for teams admin
  - All functions use `IObservability.getCostBreakdown()` and Langfuse Daily Metrics API
  - **Test:** With mock Langfuse data → breakdown returns correct per-repo and per-model splits. Timeline returns daily data points.
  - **Depends on:** P8-ADAPT-02
  - **Files:** `lib/usage/dashboard.ts` (new), `lib/usage/breakdown.ts` (new)
  - Notes: _____

### API Routes

- [ ] **P8-API-05: Create `GET /api/billing` route** — M
  - Returns current plan + usage summary for authenticated user's org
  - Response: `{ plan: PlanConfig, subscription: Subscription, usage: UsageSummary, availablePlans: PlanConfig[] }`
  - Auth: Better Auth session
  - **Test:** Authenticated → returns plan info. Unauthenticated → 401. Free plan → shows upgrade options. Pro plan → shows current usage.
  - **Depends on:** P8-API-01, P8-API-04, P8-ADAPT-03
  - **Files:** `app/api/billing/route.ts` (new)
  - Notes: _____

- [ ] **P8-API-06: Create `POST /api/billing/checkout` route** — M
  - Creates a Stripe Checkout session for plan upgrade
  - Input: `{ planId: string, seats?: number }` (seats for team plans)
  - Validates: planId exists, seats >= minSeats for team plans
  - Returns: `{ url: string }` (Stripe Checkout URL)
  - Auth: Better Auth session (org admin/owner only)
  - **Test:** Valid planId → Checkout URL returned. Invalid planId → 400. Free user upgrading to Pro → correct Stripe Price ID. Team plan with 5 seats → correct quantity.
  - **Depends on:** P8-ADAPT-01, P8-API-01
  - **Files:** `app/api/billing/checkout/route.ts` (new)
  - Notes: _____

- [ ] **P8-API-07: Create `POST /api/billing/webhook` route** — L
  - Stripe webhook handler for subscription lifecycle events
  - Verifies webhook signature using `STRIPE_WEBHOOK_SECRET`
  - Handles events:
    - `checkout.session.completed` → create/update Subscription
    - `invoice.paid` → renew period, clear over_limit, reset on-demand credits
    - `invoice.payment_failed` → set status to past_due
    - `customer.subscription.deleted` → downgrade to Free
    - `customer.subscription.updated` → update seats/plan
    - `payment_intent.succeeded` → create OnDemandPurchase, clear over_limit
  - Idempotent: checks processed event IDs in Redis (24h TTL)
  - Returns 200 for all handled events (Stripe expects quick 2xx)
  - **Test:** `checkout.session.completed` → Subscription created. `invoice.paid` → period renewed. `payment_intent.succeeded` → OnDemandPurchase created. Duplicate event → 200 (no double-processing). Invalid signature → 400.
  - **Depends on:** P8-ADAPT-01, P8-ADAPT-03, P8-INFRA-01
  - **Files:** `app/api/billing/webhook/route.ts` (new)
  - **Acceptance:** All 6 event types handled. Idempotent. Signature verified. Responds within 5s.
  - Notes: _____

- [ ] **P8-API-08: Create `POST /api/billing/top-up` route** — M
  - Creates a Stripe Payment Intent for on-demand credit purchase
  - Input: `{ amountUsd: 5 | 10 | 25 }`
  - Returns: `{ clientSecret: string }` for Stripe Elements
  - Auth: Better Auth session (any org member on paid plan — Free cannot top up)
  - **Test:** Pro user → Payment Intent created. Free user → 403. Invalid amount → 400.
  - **Depends on:** P8-API-03, P8-ADAPT-01
  - **Files:** `app/api/billing/top-up/route.ts` (new)
  - Notes: _____

- [ ] **P8-API-09: Create `GET /api/billing/usage` route** — M
  - Returns detailed usage breakdown for the current billing period
  - Response: `{ timeline: DailyCost[], byRepo: RepoCost[], byModel: ModelCost[], byMember?: MemberCost[] }`
  - `byMember` only returned for team plans (admin only)
  - Auth: Better Auth session
  - **Test:** Returns correct breakdown. Team admin sees per-member data. Non-admin on team → no per-member data. Period filter works correctly.
  - **Depends on:** P8-API-04
  - **Files:** `app/api/billing/usage/route.ts` (new)
  - Notes: _____

### Temporal Workflows

- [ ] **P8-API-10: Create `syncBillingWorkflow` Temporal workflow** — L
  - Workflow ID: `sync-billing-{date}` (one per day, idempotent)
  - Queue: `light-llm-queue`
  - Schedule: Temporal cron `"5 0 * * *"` (daily 00:05 UTC)
  - Steps:
    1. Fetch all active orgs
    2. For each org (batched, 10 concurrent):
       a. `getLangfuseCost` activity → total cost from Langfuse Daily Metrics API
       b. `writeUsageSnapshot` activity → Prisma insert
       c. `checkAndEnforceLimits` activity → compare cost vs budget, set/clear over_limit
       d. `reportStripeOverage` activity → report metered usage to Stripe (if applicable)
    3. Log summary: orgs synced, orgs over limit
  - On activity failure: retry 3x with backoff, then skip org and continue
  - **Test:** Temporal workflow replay test with mock activities. Correct activity order. Failed org skipped, others continue. Cron schedule registered.
  - **Depends on:** P8-API-11, P8-API-12
  - **Files:** `lib/temporal/workflows/sync-billing.ts` (new)
  - **Acceptance:** Workflow runs nightly. All orgs synced. Over-limit correctly flagged.
  - Notes: _____

- [ ] **P8-API-11: Create billing sync activities** — L
  - Activities (all on `light-llm-queue`):
    - `getAllActiveOrgs()` → Prisma query
    - `getLangfuseCost({ orgId, from, to })` → Langfuse Daily Metrics API
    - `writeUsageSnapshot({ orgId, totalCostUsd })` → Prisma upsert
    - `checkAndEnforceLimits({ orgId })` → budget calculation + status update
    - `reportStripeOverage({ orgId, overageUsd })` → Stripe metered usage record
  - Each activity is independently retryable
  - Heartbeat on `getLangfuseCost` (reports orgId being processed)
  - **Test:** `getLangfuseCost` with mock Langfuse → returns summed cost. `writeUsageSnapshot` → row created. `checkAndEnforceLimits` → status updated correctly. `reportStripeOverage` → Stripe usage record created.
  - **Depends on:** P8-ADAPT-01, P8-ADAPT-02, P8-ADAPT-03
  - **Files:** `lib/temporal/activities/billing.ts` (new)
  - Notes: _____

- [ ] **P8-API-12: Inject `checkBudget()` into MCP server tool dispatch** — M
  - Modify `lib/mcp/server.ts` (or `lib/mcp/transport.ts`):
    - After rate limit check, before `dispatchToolCall()`
    - Call `isBudgetGatedTool(toolName)` — if true, call `checkBudget(ctx.orgId, container)`
    - If `BudgetExceeded` thrown: return JSON-RPC error with 429 semantics:
      ```
      { jsonrpc: "2.0", id, error: {
          code: -32000,
          message: "Monthly LLM budget reached ($X.XX / $Y.YY). Buy more at https://app.unerr.dev/billing or upgrade your plan.",
          data: { orgId, currentCost, budget, upgradeUrl }
      }}
      ```
  - Non-gated tools bypass entirely (no latency impact)
  - **Test:** LLM tool with budget available → proceeds. LLM tool with budget exceeded → 429. Non-LLM tool → always proceeds regardless of budget. Budget check failure → tool proceeds (fail-open).
  - **Depends on:** P8-API-02
  - **Files:** `lib/mcp/server.ts` (modified) or `lib/mcp/transport.ts` (modified)
  - **Acceptance:** Budget enforcement active. 429 returned with actionable message. Non-LLM tools unaffected.
  - Notes: _____

- [ ] **P8-API-13: Create Free plan auto-provisioning** — S
  - On first dashboard load or first MCP tool call:
    - Check if org has a Subscription record
    - If not: create Free plan subscription with $0.50 budget
    - `currentPeriodStart`: start of current calendar month
    - `currentPeriodEnd`: end of current calendar month
  - Idempotent: if subscription exists, skip
  - **Test:** New org → Free plan created on first dashboard load. Existing subscription → no change. Multiple concurrent requests → only one subscription created (unique constraint).
  - **Depends on:** P8-DB-01
  - **Files:** `lib/billing/plans.ts` (add provisioning function), or middleware-level hook
  - Notes: _____

---

## 2.5 Frontend / UI Layer

- [ ] **P8-UI-01: Create billing page at `/billing`** — L
  - Layout: Plan selector + current usage bar + on-demand purchase
  - Sections:
    - **Current plan card:** Plan name, monthly LLM budget, price, feature list
    - **Usage bar:** visual progress bar showing `$X.XX / $Y.YY used` with percentage fill (green < 75%, yellow 75-90%, red > 90%)
    - **Plan comparison:** cards for Free, Pro, (Max if flag on), Teams Pro, Teams Max
    - **Upgrade button:** redirects to Stripe Checkout
    - **On-demand purchase section:** visible when usage > 75%. Cards for $5, $10, $25 credit amounts. Uses Stripe Elements for inline payment.
  - Data source: `GET /api/billing`
  - Design: Follow golden page pattern from CLAUDE.md. `glass-card` for plan cards. `bg-rail-fade` for active plan badge.
  - **Test:** Free plan → shows upgrade options. Pro plan → shows usage bar + top-up. Over-limit → red bar + prominent top-up CTA. Max plan hidden when flag off.
  - **Depends on:** P8-API-05, P8-API-06, P8-API-08
  - **Files:** `app/(dashboard)/billing/page.tsx` (new)
  - Notes: _____

- [ ] **P8-UI-02: Create usage dashboard page at `/usage`** — L
  - Layout: Cost timeline chart + breakdown tables
  - Sections:
    - **Daily cost chart:** line chart showing cost per day for current billing period
    - **Per-repo breakdown:** table with repo name, cost, percentage of total
    - **Per-model breakdown:** table with model name (gpt-4o-mini, gpt-4o), tokens, cost
    - **Per-member breakdown:** (teams only, admin view) table with member name, cost
  - Data source: `GET /api/billing/usage`
  - Chart library: use a lightweight chart component (or CSS-only bars for MVP)
  - **Test:** Data renders correctly. Period selector works. Team admin sees member breakdown. Non-admin → no member breakdown.
  - **Depends on:** P8-API-09
  - **Files:** `app/(dashboard)/usage/page.tsx` (new)
  - Notes: _____

- [ ] **P8-UI-03: Add "Billing" and "Usage" links to dashboard nav** — S
  - Add to `components/dashboard/dashboard-nav.tsx`:
    - "Billing" link → `/billing` (icon: `CreditCard` from Lucide, `h-4 w-4`)
    - "Usage" link → `/usage` (icon: `BarChart3` from Lucide, `h-4 w-4`)
  - Position: after existing nav items, before settings
  - **Test:** Links render. Navigation works. Active state highlights correctly.
  - **Depends on:** P8-UI-01, P8-UI-02
  - **Files:** `components/dashboard/dashboard-nav.tsx` (modified)
  - Notes: _____

- [ ] **P8-UI-04: Add budget warning banner to dashboard layout** — M
  - When org is near limit (>75% of budget) or over limit:
    - **Near limit (75-99%):** Yellow banner at top of dashboard: `"You've used 85% of your monthly LLM budget. Consider buying more credits."` with link to /billing
    - **Over limit:** Red banner: `"Monthly LLM budget reached. AI features are paused. Buy credits to continue."` with "Buy Credits" button
  - Fetches budget status from `GET /api/billing` (cached in client state)
  - Dismissible per session (but re-appears if status changes)
  - **Test:** Under 75% → no banner. At 85% → yellow banner. Over limit → red banner. Dismiss → hidden until status changes.
  - **Depends on:** P8-API-05
  - **Files:** `app/(dashboard)/layout.tsx` (modified), `components/dashboard/budget-banner.tsx` (new)
  - Notes: _____

- [ ] **P8-UI-05: Add usage summary to repo detail page** — S
  - Show per-repo LLM cost on the repo detail page:
    - `"$2.35 LLM cost this month"` (from Langfuse per-repo breakdown)
  - Only visible on paid plans (Free plan doesn't show per-repo cost)
  - **Test:** Pro plan repo → shows cost. Free plan → not shown. Cost matches Langfuse data.
  - **Depends on:** P8-API-04
  - **Files:** `app/(dashboard)/repos/[repoId]/page.tsx` (modified)
  - Notes: _____

---

## 2.6 Testing & Verification

### Unit Tests

- [ ] **P8-TEST-01: Plan definitions tests** — S
  - `getPlan("free")` → correct budget ($0.50)
  - `getPlan("pro")` → correct budget ($5.00), price ($10.00)
  - `calculateTeamBudget("teams_pro", 5)` → $20.00
  - `getAvailablePlans()` with `SHOW_MAX_PLAN=false` → Max excluded
  - `getAvailablePlans()` with `SHOW_MAX_PLAN=true` → Max included
  - `isFeatureEnabled("free", "prReview")` → false
  - `isFeatureEnabled("pro", "prReview")` → true
  - **Depends on:** P8-API-01
  - **Files:** `lib/billing/__tests__/plans.test.ts`
  - Notes: _____

- [ ] **P8-TEST-02: Budget enforcement tests** — L
  - Org with $2.00 used / $5.00 budget → cached "ok", no Prisma query
  - Org with $4.60 used / $5.00 budget → near limit, live Langfuse check
  - Org with $5.12 used / $5.00 budget → BudgetExceeded thrown
  - Org with $5.12 used / $5.00 + $5.00 on-demand → allowed ($10.00 total budget)
  - Non-gated tool (get_function) → always allowed, no budget check
  - Redis cache miss → falls back to Prisma
  - Prisma timeout → falls back to "allow" (fail-open)
  - Langfuse timeout → falls back to snapshot
  - **Depends on:** P8-API-02
  - **Files:** `lib/billing/__tests__/enforce.test.ts`
  - Notes: _____

- [ ] **P8-TEST-03: On-demand credit tests** — M
  - Purchase $5 credit → OnDemandPurchase created with correct period
  - Purchase clears over_limit status
  - Credits scoped to current period — old period credits not included in balance
  - Duplicate stripePaymentId → rejected (unique constraint)
  - **Depends on:** P8-API-03
  - **Files:** `lib/billing/__tests__/on-demand.test.ts`
  - Notes: _____

- [ ] **P8-TEST-04: Stripe webhook handler tests** — L
  - `checkout.session.completed` → Subscription created with correct plan
  - `invoice.paid` → period renewed, on-demand credits reset
  - `invoice.payment_failed` → status set to past_due
  - `customer.subscription.deleted` → downgrade to Free
  - `customer.subscription.updated` → seats/budget updated
  - `payment_intent.succeeded` → OnDemandPurchase created
  - Duplicate event ID → 200 returned, no double-processing
  - Invalid signature → 400
  - Unknown event type → 200 (ignore gracefully)
  - **Depends on:** P8-API-07
  - **Files:** `app/api/billing/__tests__/webhook.test.ts`
  - Notes: _____

- [ ] **P8-TEST-05: Usage aggregation tests** — M
  - `getUsageSummary` returns correct percentUsed
  - `getCostBreakdownByRepo` returns per-repo costs
  - `getCostBreakdownByModel` returns per-model costs
  - `getCostTimeline` returns daily data points
  - `getPerMemberUsage` returns per-member costs (teams only)
  - Empty data → zeroed summary, no errors
  - **Depends on:** P8-API-04
  - **Files:** `lib/usage/__tests__/dashboard.test.ts`
  - Notes: _____

- [ ] **P8-TEST-06: Rate limiter plan-awareness tests** — S
  - Free plan → 30 calls/min limit
  - Pro plan → 120 calls/min limit
  - Plan upgrade → new limit applied after cache expiry
  - Unknown plan → falls back to Free limits
  - **Depends on:** P8-ADAPT-04
  - **Files:** `lib/mcp/security/__tests__/rate-limiter.test.ts` (extended)
  - Notes: _____

### Integration Tests

- [ ] **P8-TEST-07: Billing sync workflow integration test** — L
  - End-to-end: mock Langfuse API with cost data → run `syncBillingWorkflow` → verify UsageSnapshot created → verify over-limit flagged → verify Stripe overage reported
  - Requires: Langfuse API mock, Prisma test DB, Stripe mock
  - **Depends on:** P8-API-10, P8-API-11
  - **Files:** `lib/temporal/workflows/__tests__/sync-billing.integration.test.ts`
  - Notes: _____

- [ ] **P8-TEST-08: Budget check in MCP pipeline integration test** — M
  - Send MCP tool call for `justify_entity` with budget available → proceeds
  - Send same tool call with budget exceeded → 429 returned with correct message
  - Send `get_function` (non-gated) with budget exceeded → proceeds normally
  - **Depends on:** P8-API-12
  - **Files:** `lib/mcp/__tests__/budget-enforcement.integration.test.ts`
  - Notes: _____

### E2E Tests

- [ ] **P8-TEST-09: Free user upgrade flow E2E** — L
  - Free user → navigates to /billing → sees plan comparison → clicks "Upgrade to Pro" → Stripe Checkout (test mode) → returns to /billing → Pro plan active → usage bar visible
  - **Depends on:** P8-UI-01, P8-API-06, P8-API-07
  - **Files:** `e2e/billing-upgrade.spec.ts`
  - Notes: _____

- [ ] **P8-TEST-10: Budget exhaustion and top-up flow E2E** — L
  - Pro user → usage approaches limit → yellow banner appears → usage exceeds limit → red banner + 429 on LLM tool → user visits /billing → buys $5 credit → credit applied → LLM tools work again
  - **Depends on:** P8-UI-01, P8-UI-04, P8-API-08
  - **Files:** `e2e/billing-topup.spec.ts`
  - Notes: _____

- [ ] **P8-TEST-11: Usage dashboard E2E** — M
  - User navigates to /usage → sees daily cost chart → sees per-repo breakdown → sees per-model breakdown → data matches expected values
  - **Depends on:** P8-UI-02, P8-API-09
  - **Files:** `e2e/usage-dashboard.spec.ts`
  - Notes: _____

### Manual Verification

- [ ] **P8-TEST-12: Manual Stripe integration verification** — L
  - Create Stripe test account with test products/prices
  - Complete full upgrade flow: Free → Pro via Stripe Checkout (test mode)
  - Verify webhook delivery and subscription creation
  - Purchase on-demand credits via Stripe Elements
  - Verify Langfuse cost data flows to usage dashboard
  - Simulate budget exhaustion → verify 429 on LLM tools
  - Verify metered overage reported to Stripe
  - **Depends on:** All P8 items
  - Notes: _____

---

## Dependency Graph

```
P8-INFRA-01 (Stripe env vars) ── P8-INFRA-02 (stripe package)
P8-INFRA-03 (Langfuse OTel) ─── independent

P8-DB-01 (Subscription model) ─┐
P8-DB-02 (UsageSnapshot model) ├── P8-ADAPT-03 (IRelationalStore billing methods)
P8-DB-03 (OnDemandPurchase)  ──┘

P8-INFRA-02 ── P8-ADAPT-01 (StripePayments adapter)
P8-INFRA-03 ── P8-ADAPT-02 (Langfuse cost retrieval)
P8-ADAPT-03 ── P8-ADAPT-04 (plan-aware rate limiter)

P8-API-01 (plan definitions) ─── independent
P8-ADAPT-02 + P8-ADAPT-03 ── P8-API-02 (budget enforcement)
P8-ADAPT-01 + P8-ADAPT-03 ── P8-API-03 (on-demand credits)
P8-ADAPT-02 ── P8-API-04 (usage aggregation)
P8-API-01 + P8-API-04 + P8-ADAPT-03 ── P8-API-05 (GET /api/billing)
P8-ADAPT-01 + P8-API-01 ── P8-API-06 (POST /api/billing/checkout)
P8-ADAPT-01 + P8-ADAPT-03 ── P8-API-07 (POST /api/billing/webhook)
P8-API-03 ── P8-API-08 (POST /api/billing/top-up)
P8-API-04 ── P8-API-09 (GET /api/billing/usage)
P8-API-11 ── P8-API-10 (syncBillingWorkflow)
P8-ADAPT-01..03 ── P8-API-11 (billing activities)
P8-API-02 ── P8-API-12 (budget check in MCP)
P8-DB-01 ── P8-API-13 (Free plan provisioning)

P8-API-05..08 ── P8-UI-01 (billing page)
P8-API-09 ── P8-UI-02 (usage dashboard)
P8-UI-01 + P8-UI-02 ── P8-UI-03 (nav links)
P8-API-05 ── P8-UI-04 (budget banner)
P8-API-04 ── P8-UI-05 (repo usage)

All above ── P8-TEST-01..12
```

**Recommended implementation order:**

1. **Infrastructure** (P8-INFRA-01..03) — Stripe package, env vars, Langfuse OTel wiring
2. **Database** (P8-DB-01..03) — Prisma models, migration
3. **Plan definitions** (P8-API-01) — Static plan config (no external deps)
4. **Adapters** (P8-ADAPT-01..04) — Stripe payments, Langfuse cost retrieval, IRelationalStore billing methods, plan-aware rate limiter
5. **Core billing logic** (P8-API-02..04) — Budget enforcement, on-demand credits, usage aggregation
6. **API routes** (P8-API-05..09) — Billing CRUD, checkout, webhook, top-up, usage
7. **Temporal** (P8-API-10..11) — Sync workflow, billing activities
8. **MCP integration** (P8-API-12) — Budget check injection
9. **Auto-provisioning** (P8-API-13) — Free plan creation
10. **Frontend** (P8-UI-01..05) — Billing page, usage dashboard, nav links, budget banner, repo usage
11. **Testing** (P8-TEST-01..12) — Unit, integration, E2E, manual

---

## New Files Summary

```
lib/billing/
  plans.ts                       ← Plan definitions, feature flags, budget calculations
  enforce.ts                     ← Pre-flight budget check (3-tier: Redis → Prisma → Langfuse)
  on-demand.ts                   ← On-demand credit purchase flow
  stripe-client.ts               ← Lazy-initialized Stripe SDK client
lib/usage/
  dashboard.ts                   ← Usage summary aggregation
  breakdown.ts                   ← Per-repo, per-model, per-member cost breakdown
lib/temporal/workflows/
  sync-billing.ts                ← Nightly syncBillingWorkflow
lib/temporal/activities/
  billing.ts                     ← getLangfuseCost, writeUsageSnapshot, reportStripeOverage
app/api/billing/
  route.ts                       ← GET current plan + usage
  checkout/route.ts              ← POST create Stripe Checkout session
  webhook/route.ts               ← POST Stripe webhook handler
  top-up/route.ts                ← POST buy on-demand credits
  usage/route.ts                 ← GET detailed usage breakdown
app/(dashboard)/
  billing/page.tsx               ← Plan selector + cost bar + on-demand purchase
  usage/page.tsx                 ← Detailed cost breakdown (charts + tables)
components/dashboard/
  budget-banner.tsx              ← Near-limit / over-limit warning banner
```

### Modified Files

```
lib/mcp/tracing.ts               ← Langfuse OTel span processor integration
lib/mcp/server.ts                ← Budget check injection before LLM tool dispatch
lib/mcp/security/rate-limiter.ts ← Plan-aware rate limits
lib/adapters/stripe-payments.ts  ← Real Stripe API calls (replace stubs)
lib/adapters/langfuse-observability.ts ← Real Langfuse API calls (replace stubs)
lib/ports/relational-store.ts    ← Billing methods added to port
lib/adapters/prisma-relational-store.ts ← Billing methods implemented
lib/di/fakes.ts                  ← FakeRelationalStore billing methods
components/dashboard/dashboard-nav.tsx ← Billing + Usage nav links
app/(dashboard)/layout.tsx       ← Budget warning banner
app/(dashboard)/repos/[repoId]/page.tsx ← Per-repo cost summary
prisma/schema.prisma             ← Subscription, UsageSnapshot, OnDemandPurchase models
env.mjs                          ← STRIPE_* variables, SHOW_MAX_PLAN flag
.env.example                     ← Document Phase 8 variables
package.json                     ← stripe dependency
```

---

## Revision Log

| Date | Author | Change |
|------|--------|--------|
| 2026-02-21 | — | Initial document created. 3 INFRA, 3 DB, 4 ADAPT, 13 API, 5 UI, 12 TEST items. Total: **40 tracker items.** |
