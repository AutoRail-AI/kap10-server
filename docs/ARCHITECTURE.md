# Architecture

Complete architecture documentation for the Modern Next.js Boilerplate.

---

## Database Architecture

### Unified Approach: Supabase (PostgreSQL)

This boilerplate uses a unified database approach with Supabase (PostgreSQL) for all data storage needs, from authentication to application features.

```
┌─────────────────────────────────────────┐
│           Supabase Project              │
│             (PostgreSQL)                │
└─────────────────────────────────────────┘
                   │
                   │
           ┌───────▼───────┐
           │   pg Client   │
           │ (Connection)  │
           └───────┬───────┘
                   │
    ┌──────────────┴──────────────┐
    │                             │
┌───▼───┐                     ┌───▼───┐
│ Better│                     │  App  │
│ Auth  │                     │ Data  │
│Tables │                     │Tables │
└───┬───┘                     └───┬───┘
    │                             │
    │ - user                      │ - onboarding
    │ - session                   │ - subscriptions
    │ - account                   │ - activities
    │ - org                       │ - audit_logs
    │ - member                    │ - ...
```

### Why This Approach?

**Unified Stack:**
- Single source of truth (PostgreSQL)
- Strong consistency and relational data integrity
- Powerful SQL features (JOINs, Views, RLS)
- Excellent tooling and ecosystem

**Better Auth Integration:**
- Uses `pg` adapter to store auth data directly in Postgres
- Seamlessly integrates with application tables via foreign keys

**Supabase Client:**
- Type-safe query builder
- Auto-generated TypeScript types
- Realtime capabilities (optional)

---

## Multi-Tenancy Architecture

### Organization Plugin

Better Auth's Organization plugin provides:
- Organization creation and management
- Member invitations with email notifications
- Role-based access control (RBAC)
- Active organization context
- Team management (optional)

### Configuration

Configured in `lib/auth/auth.ts`:

```typescript
plugins: [
  organization({
    allowUserToCreateOrganization: true,
    organizationLimit: 5,
    membershipLimit: 100,
    creatorRole: "owner",
    async sendInvitationEmail(data) {
      // Email sending logic
    },
  }),
]
```

---

## Billing Architecture

### Stripe Integration

**Components**:
- `lib/billing/stripe.ts` - Stripe utilities
- `lib/models/billing.ts` - Subscription logic (Supabase)
- `app/api/billing/checkout/route.ts` - Checkout API
- `app/api/billing/portal/route.ts` - Portal API
- `app/api/webhooks/stripe/route.ts` - Webhook handler

### Flow

```
User → Checkout API → Stripe Checkout → Payment → Webhook → Update Subscription (Supabase)
```

### Subscription Table

Stored in Supabase `subscriptions` table:

```typescript
interface Subscription {
  id: string
  user_id: string
  organization_id?: string
  stripe_customer_id: string
  stripe_subscription_id: string
  status: "active" | "canceled" | "past_due" | "trialing"
  plan_id: "free" | "pro" | "enterprise"
  current_period_end: string
}
// See lib/db/types.ts for full definition
```

---

## Analytics Architecture

### PostHog Integration

**Components**:
- `lib/analytics/posthog.ts` - Server-side tracking
- `lib/analytics/client.ts` - Client-side tracking
- `components/providers/analytics-provider.tsx` - Provider wrapper

---

## Feature Flags Architecture

### System Overview

Feature flags are stored in the Supabase `feature_flags` table and checked at runtime:

```typescript
interface FeatureFlag {
  key: string
  name: string
  enabled: boolean
  rollout_percentage: number // 0-100
  target_users?: string[]
  target_organizations?: string[]
  environments: string[]
}
```

### Usage

```typescript
import { isFeatureEnabled } from "@/lib/features/flags"

const enabled = await isFeatureEnabled("new_dashboard", userId, organizationId)
if (enabled) {
  // Show feature
}
```

---

## Audit Logging Architecture

### System Overview

All actions are logged to Supabase `audit_logs` table:

```typescript
interface AuditLog {
  user_id?: string
  organization_id?: string
  action: "create" | "read" | "update" | "delete" | ...
  resource: string
  resource_id?: string
  metadata?: Json
  ip_address?: string
  user_agent?: string
  created_at: string
}
```

### Usage

```typescript
import { logAction } from "@/lib/audit/logger"

await logAction("update", "organization", {
  userId: session.user.id,
  organizationId: orgId,
  resourceId: orgId,
  metadata: { changes: "name updated" },
  ipAddress: req.ip,
  userAgent: req.headers.get("user-agent"),
})
```

---

## Webhooks Architecture

### System Overview

Webhooks are managed in Supabase `webhooks` table and delivered via job queue:

```typescript
interface Webhook {
  organization_id?: string
  url: string
  secret: string
  events: string[]
  enabled: boolean
  failure_count: number
}
```

---

## Onboarding Architecture

### Flow

```
New User → Onboarding Page → Step-by-Step → Complete → Redirect to App
```

### Steps

1. **Welcome** - Introduction
2. **Profile** - Complete profile information
3. **Organization** - Create or join organization
4. **Preferences** - Set preferences
5. **Complete** - Redirect to app
6. **Persistence** - State stored in Supabase `onboarding` table

### Usage

```typescript
import { getOnboarding, updateOnboardingStep } from "@/lib/onboarding/flow"

// Get current state
const onboarding = await getOnboarding(userId)

// Update step
await updateOnboardingStep(userId, "profile", { name: "John Doe" })
```

---

## Rate Limiting Architecture

### System Overview

Rate limiting uses Supabase `rate_limits` table:

```typescript
interface RateLimit {
  key: string // User ID, IP, or custom
  count: number
  reset_at: string
}
```

---

## AI Agent Architecture

### Overview

The AI agent system enables autonomous task execution with tool calling:

```
┌─────────────────┐
│   User Input    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Agent Runner   │
└────────┬────────┘
         │
         ├──► Tool Selection
         ├──► Task Planning
         ├──► Execution
         └──► Response
```

### Core Components

**Agent Runner** (`lib/ai/agent-runner.ts`):
- OpenAI API communication
- Tool execution
- Multi-step reasoning
- Error handling

**Pre-built Tools** (`lib/ai/tools/index.ts`):
- `query_database` - Query Supabase tables
- `send_email` - Send emails via Resend
- `web_search` - Search the web (placeholder)

### Usage

```typescript
// API Route
import { AgentRunner } from "@/lib/ai/agent-runner"
import { defaultTools } from "@/lib/ai/tools"

const agent = new AgentRunner({
  model: "gpt-4-turbo-preview",
  temperature: 0.7,
  tools: defaultTools,
  systemPrompt: "You are a helpful AI assistant.",
})

const result = await agent.run({
  messages,
  tools: defaultTools,
  metadata: { userId, organizationId },
})
```

---

## Platform Admin Architecture

### Access Control

Admin routes are protected by:
1. Authentication check (session required)
2. Role check (`platform_admin` role)
3. Permission check (`admin.view_analytics`)

### Features

- Platform statistics (users, organizations, subscriptions) via Supabase counts
- Recent activity (audit logs)
- User management
- Organization management
- System monitoring

---

## Job Queue Architecture

### BullMQ + Redis

Background job processing with:
- Reliable job execution
- Automatic retries
- Job prioritization
- Rate limiting

### Queues

- `email`: Email sending
- `processing`: Long-running tasks
- `webhooks`: External HTTP calls

---

## File Structure

### Key Directories

```
lib/
├── auth/               # Better Auth configuration
├── db/                 # Database connections
│   ├── supabase.ts     # Supabase client (Server)
│   ├── supabase-browser.ts # Supabase client (Browser)
│   └── types.ts        # Database types
├── ai/                 # AI agent framework
├── analytics/          # PostHog analytics
├── api-keys/           # API keys management
├── usage/              # Usage tracking and quotas
├── notifications/      # Notifications system
├── activity/           # Activity feed
├── search/             # Search engine
├── cost/               # Cost tracking
├── templates/          # Templates library
├── audit/              # Audit logging
├── billing/            # Stripe billing
├── config/             # Configuration (roles)
├── features/           # Feature flags
├── onboarding/         # Onboarding flow
├── queue/              # BullMQ queues and workers
├── rate-limit/         # Rate limiting
├── webhooks/           # Webhook system
└── utils/              # Utilities
```

### Data Flow

**Authentication Flow:**
```
User → Better Auth API → pg Adapter → Supabase (auth tables)
```

**Application Data Flow:**
```
User → API Route → Supabase Client → Supabase (app tables)
```

**AI Agent Flow:**
```
User → Agent API → AgentRunner → OpenAI → Tools → Supabase
```

**Billing Flow:**
```
User → Checkout → Stripe → Webhook → Update Subscription (Supabase)
```
