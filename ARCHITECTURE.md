# Architecture

Complete architecture documentation for the Modern Next.js Boilerplate.

---

## Database Architecture

### Hybrid Approach: Prisma + Mongoose

This boilerplate uses a hybrid database approach optimized for different use cases:

```
┌─────────────────────────────────────────┐
│         MongoDB Database                │
│      (Single Database Instance)          │
└─────────────────────────────────────────┘
           │                    │
           │                    │
    ┌──────▼──────┐      ┌──────▼──────┐
    │   Prisma    │      │  Mongoose   │
    │ (Better Auth)│      │  (App Data) │
    └──────┬──────┘      └──────┬──────┘
           │                    │
    ┌──────▼──────┐      ┌──────▼──────┐
    │ Better Auth │      │ AI Agents   │
    │   Tables    │      │  Features   │
    │             │      │  Custom     │
    │ - user      │      │  Models     │
    │ - session   │      │             │
    │ - account   │      │             │
    │ - org       │      │             │
    │ - member    │      │             │
    └─────────────┘      └─────────────┘
```

### Why This Approach?

**Prisma for Better Auth:**
- Schema generation via Better Auth CLI
- Type safety with auto-generated types
- Excellent Better Auth integration
- Automatic migrations

**Mongoose for App Features:**
- Rich schema validation and middleware
- Flexible document modeling
- Mature ecosystem with plugins
- Better for complex business logic

**Both use the same MongoDB database** with clear separation of concerns.

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

### Usage

#### Create Organization

```typescript
// Client-side
import { authClient } from "@/lib/auth/client"

const result = await authClient.organization.create({
  name: "My Company",
  slug: "my-company",
})

// Server-side
import { auth } from "@/lib/auth"
import { headers } from "next/headers"

const result = await auth.api.createOrganization({
  headers: await headers(),
  body: { name: "My Company", slug: "my-company" },
})
```

#### Get Active Organization

```typescript
// Client Component
"use client"
import { authClient } from "@/lib/auth/client"

export function OrgSwitcher() {
  const { data: organizations } = authClient.useListOrganizations()
  const { data: activeOrg } = authClient.useActiveOrganization()

  const handleSwitch = async (orgId: string | null) => {
    await authClient.organization.setActive({ organizationId: orgId })
    window.location.reload()
  }

  return (
    <Select value={activeOrg?.id || ""} onValueChange={handleSwitch}>
      {organizations?.map((org) => (
        <SelectItem key={org.id} value={org.id}>
          {org.name}
        </SelectItem>
      ))}
    </Select>
  )
}
```

#### Invite Members

```typescript
await authClient.organization.invite({
  email: "user@example.com",
  role: "member", // or "admin"
})
```

#### Check Permissions

```typescript
// Server-side
const hasPermission = await auth.api.hasPermission({
  headers: await headers(),
  body: {
    permissions: {
      aiAgent: ["read"],
      project: ["create"],
    },
  },
})
```

---

## Role Configuration System

### YAML-Based Configuration

Roles are defined in `config/roles.yaml` and loaded at runtime:

```yaml
roles:
  owner:
    name: "Owner"
    permissions:
      organization:
        - create
        - read
        - update
        - delete
        - manage_members
      project:
        - create
        - read
        - update
        - delete
    inherits: []
```

### Usage

```typescript
import { hasPermission, getRole } from "@/lib/config/roles"

// Check permission
const canDelete = hasPermission("owner", "project", "delete")

// Get role definition
const role = getRole("admin")
```

### Permission Checking

The system supports:
- Resource-based permissions (e.g., `project`, `organization`)
- Action-based permissions (e.g., `create`, `read`, `update`, `delete`)
- Wildcard permissions (`*` for all)
- Role inheritance

---

## Billing Architecture

### Stripe Integration

**Components**:
- `lib/billing/stripe.ts` - Stripe utilities
- `lib/models/billing.ts` - Subscription model
- `app/api/billing/checkout/route.ts` - Checkout API
- `app/api/billing/portal/route.ts` - Portal API
- `app/api/webhooks/stripe/route.ts` - Webhook handler

### Flow

```
User → Checkout API → Stripe Checkout → Payment → Webhook → Update Subscription
```

### Usage

```typescript
// Create checkout session
const response = await fetch("/api/billing/checkout", {
  method: "POST",
  body: JSON.stringify({ planId: "pro", organizationId: "org-123" }),
})
const { url } = await response.json()
window.location.href = url

// Open billing portal
const response = await fetch("/api/billing/portal", { method: "POST" })
const { url } = await response.json()
window.location.href = url
```

### Subscription Model

Stored in MongoDB via Mongoose:

```typescript
{
  userId: string
  organizationId?: string
  stripeCustomerId: string
  stripeSubscriptionId: string
  status: "active" | "canceled" | "past_due" | "trialing"
  planId: "free" | "pro" | "enterprise"
  currentPeriodEnd: Date
}
```

---

## Analytics Architecture

### PostHog Integration

**Components**:
- `lib/analytics/posthog.ts` - Server-side tracking
- `lib/analytics/client.ts` - Client-side tracking
- `components/providers/analytics-provider.tsx` - Provider wrapper

### Usage

```typescript
// Server-side
import { trackEvent, identifyUser } from "@/lib/analytics/posthog"

await identifyUser(userId, { email, name })
await trackEvent(userId, "feature_used", { feature: "ai_agent" })

// Client-side
import { trackEvent } from "@/lib/analytics/client"

trackEvent("button_clicked", { button: "subscribe" })
```

### Automatic Tracking

The `AnalyticsProvider` automatically:
- Identifies users on login
- Tracks page views
- Groups users by organization

---

## Feature Flags Architecture

### System Overview

Feature flags are stored in MongoDB and checked at runtime:

```typescript
interface IFeatureFlag {
  key: string
  name: string
  enabled: boolean
  rolloutPercentage: number // 0-100
  targetUsers?: string[]
  targetOrganizations?: string[]
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

### Rollout Strategy

1. **Target Lists**: Specific users/organizations
2. **Percentage Rollout**: Hash-based distribution
3. **Environment-Based**: Different flags per environment

---

## Audit Logging Architecture

### System Overview

All actions are logged to MongoDB:

```typescript
interface IAuditLog {
  userId?: string
  organizationId?: string
  action: "create" | "read" | "update" | "delete" | "login" | ...
  resource: string
  resourceId?: string
  metadata?: Record<string, any>
  ipAddress?: string
  userAgent?: string
  createdAt: Date
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

### Querying Logs

```typescript
import { getAuditLogs } from "@/lib/audit/logger"

const logs = await getAuditLogs({
  organizationId: "org-123",
  action: "delete",
  startDate: new Date("2024-01-01"),
  limit: 100,
})
```

---

## Webhooks Architecture

### System Overview

Webhooks are managed in MongoDB and delivered via job queue:

```typescript
interface IWebhook {
  organizationId?: string
  url: string
  secret: string
  events: WebhookEvent[]
  enabled: boolean
  failureCount: number
}
```

### Usage

```typescript
import { triggerWebhook } from "@/lib/webhooks/manager"

await triggerWebhook("user.created", {
  userId: user.id,
  email: user.email,
}, organizationId)
```

### Events

- `user.created`, `user.updated`
- `organization.created`, `organization.updated`
- `subscription.created`, `subscription.updated`, `subscription.cancelled`
- `payment.succeeded`, `payment.failed`

### Security

All webhooks use HMAC-SHA256 signature verification:

```typescript
import { verifyWebhookSignature } from "@/lib/webhooks/manager"

const isValid = verifyWebhookSignature(payload, signature, secret)
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

### Usage

```typescript
import { getOnboarding, updateOnboardingStep } from "@/lib/onboarding/flow"

// Get current state
const onboarding = await getOnboarding(userId)

// Update step
await updateOnboardingStep(userId, "profile", { name: "John Doe" })
```

### Auto-Redirect

Middleware automatically redirects incomplete users to `/onboarding`.

---

## Rate Limiting Architecture

### System Overview

Rate limiting uses MongoDB with TTL indexes for automatic cleanup:

```typescript
interface IRateLimit {
  key: string // User ID, IP, or custom
  count: number
  resetAt: Date
}
```

### Usage

```typescript
import { withRateLimit } from "@/lib/rate-limit/middleware"

export const POST = withRateLimit(
  async (req) => {
    // Your handler
  },
  {
    windowMs: 60000, // 1 minute
    maxRequests: 100,
    keyGenerator: async (req) => {
      // Custom key (default: user ID or IP)
      return session.user.id
    },
  }
)
```

### Headers

Rate limit information is included in response headers:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

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
- `query_database` - Query MongoDB collections
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

### Custom Tools

```typescript
// lib/ai/tools/custom.ts
import type { AgentTool } from "../types"

export const customTool: AgentTool = {
  name: "my_custom_tool",
  description: "Does something custom",
  parameters: {
    type: "object",
    properties: {
      input: { type: "string", description: "Input parameter" },
    },
    required: ["input"],
  },
  handler: async ({ input }) => {
    // Your custom logic
    return { result: `Processed: ${input}` }
  },
}
```

---

## Platform Admin Architecture

### Access Control

Admin routes are protected by:
1. Authentication check (session required)
2. Role check (`platform_admin` role)
3. Permission check (`admin.view_analytics`)

### Routes

- `/admin` - Admin dashboard
- `/api/admin` - Admin API

### Features

- Platform statistics (users, organizations, subscriptions)
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

| Queue | Purpose | Concurrency |
|-------|---------|-------------|
| `email` | Email sending | 5 workers |
| `processing` | Long-running tasks | 3 workers |
| `webhooks` | External HTTP calls | 10 workers |

### Adding Jobs

```typescript
import { queueEmail, queueProcessing, queueWebhook } from "@/lib/queue"

await queueEmail({ to, subject, body })
await queueProcessing({ userId, taskId, payload })
await queueWebhook({ url, method, body })
```

### Custom Queues

Add custom queues in `lib/queue/queues.ts`:

```typescript
export const myQueue = new Queue("my-queue", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  },
})
```

Add processors in `lib/queue/workers.ts`:

```typescript
new Worker("my-queue", async (job) => {
  // Process job
}, { connection: redis, concurrency: 5 })
```

---

## File Structure

### Key Directories

```
lib/
├── auth/               # Better Auth configuration
│   ├── auth.ts         # Server auth config (Prisma)
│   └── client.ts       # Client auth config
├── db/                 # Database connections
│   ├── prisma.ts       # Prisma client (Better Auth)
│   └── mongoose.ts     # Mongoose connection (App)
├── ai/                 # AI agent framework
│   ├── agent-runner.ts # Core agent engine
│   ├── types.ts        # Type definitions
│   └── tools/          # Pre-built tools
├── analytics/          # PostHog analytics
│   ├── posthog.ts      # Server-side
│   └── client.ts       # Client-side
├── api-keys/           # API keys management
├── usage/               # Usage tracking and quotas
├── notifications/       # Notifications system
├── activity/           # Activity feed
├── search/              # Search engine
├── cost/                # Cost tracking
├── templates/           # Templates library
├── audit/              # Audit logging
├── billing/            # Stripe billing
├── config/             # Configuration (roles)
├── features/           # Feature flags
├── models/             # Mongoose models
├── onboarding/         # Onboarding flow
├── queue/              # BullMQ queues and workers
├── rate-limit/         # Rate limiting
├── webhooks/           # Webhook system
└── utils/              # Utilities
```

### Data Flow

**Authentication Flow:**
```
User → Better Auth API → Prisma → MongoDB (auth tables)
```

**Application Data Flow:**
```
User → API Route → Mongoose → MongoDB (app collections)
```

**AI Agent Flow:**
```
User → Agent API → AgentRunner → OpenAI → Tools → Mongoose → MongoDB
```

**Billing Flow:**
```
User → Checkout → Stripe → Webhook → Update Subscription (Mongoose)
```

**Webhook Flow:**
```
Event → triggerWebhook → Queue Job → Deliver → Update Status
```

**API Key Flow:**
```
User → Create Key → Hash & Store → Verify on Request → Track Usage
```

**Usage Tracking Flow:**
```
Action → Track Usage → Check Quota → Allow/Deny → Update Stats
```

**Notification Flow:**
```
Event → Create Notification → Store → Send Email (optional) → User Reads
```

**Activity Flow:**
```
Action → Create Activity → Store → Query Feed → Display
```

**Search Flow:**
```
Document → Index → Store in SearchIndex → Query → Return Results
```

**Cost Tracking Flow:**
```
AI Request → Calculate Cost → Track → Aggregate → Report
```

---

## API Keys Architecture

### System Overview

API keys allow users to integrate with your platform programmatically:

```typescript
interface IApiKey {
  userId: string
  organizationId?: string
  name: string
  key: string // Hashed
  keyPrefix: string // For display
  scopes: string[]
  rateLimit?: { requests: number; windowMs: number }
  enabled: boolean
  expiresAt?: Date
}
```

### Usage

```typescript
import { createApiKey, verifyApiKey } from "@/lib/api-keys/manager"

// Create key
const { apiKey, plainKey } = await createApiKey(userId, "My Integration", {
  scopes: ["read", "write"],
})

// Verify key (in middleware)
const key = await verifyApiKey(request.headers.get("Authorization")?.replace("Bearer ", ""))
```

### Security

- Keys are hashed with SHA-256 before storage
- Only key prefix is returned after creation
- Keys can be scoped and rate-limited
- Expiration dates supported

---

## Usage Tracking Architecture

### System Overview

Track usage and enforce quotas per user/organization:

```typescript
interface IUsage {
  userId: string
  organizationId?: string
  type: "api_call" | "ai_request" | "storage" | "bandwidth" | "feature_usage"
  resource: string
  quantity: number
  cost?: number
  timestamp: Date
}
```

### Usage

```typescript
import { trackUsage, checkQuota } from "@/lib/usage/tracker"

// Track usage
await trackUsage({
  userId: "user-123",
  type: "api_call",
  resource: "ai.agent",
  quantity: 1,
})

// Check quota
const { allowed, remaining } = await checkQuota(userId, orgId, {
  limit: 1000,
  windowMs: 86400000, // 24 hours
  type: "api_call",
})
```

### Quota Enforcement

Quotas can be:
- Per-user or per-organization
- Time-window based (e.g., daily, monthly)
- Resource-specific or global
- Integrated with billing plans

---

## Notifications Architecture

### System Overview

In-app and email notifications:

```typescript
interface INotification {
  userId: string
  organizationId?: string
  type: "info" | "success" | "warning" | "error" | "invitation" | "mention"
  title: string
  message: string
  link?: string
  read: boolean
}
```

### Usage

```typescript
import { createNotification, getNotifications } from "@/lib/notifications/manager"

// Create notification
await createNotification({
  userId: "user-123",
  type: "info",
  title: "New feature",
  message: "Check it out!",
  sendEmail: true,
})

// Get notifications
const notifications = await getNotifications(userId, { unreadOnly: true })
```

### Features

- In-app notifications
- Optional email delivery
- Mark as read/unread
- Organization-scoped
- Real-time updates (via polling or WebSockets)

---

## Activity Feed Architecture

### System Overview

Real-time activity streams for organizations:

```typescript
interface IActivity {
  userId?: string
  organizationId: string
  type: ActivityType
  action: string
  resource: string
  resourceId?: string
  metadata?: Record<string, any>
}
```

### Usage

```typescript
import { createActivity, getActivityFeed } from "@/lib/activity/feed"

// Create activity
await createActivity({
  organizationId: "org-123",
  type: "project.created",
  action: "created a project",
  resource: "project",
  resourceId: "project-123",
})

// Get feed
const activities = await getActivityFeed("org-123", { limit: 50 })
```

### Features

- Organization-scoped activities
- User activity tracking
- Resource-specific filtering
- Pagination support
- Real-time updates

---

## Search Architecture

### System Overview

Full-text search using MongoDB text indexes:

```typescript
interface ISearchIndex {
  organizationId?: string
  resource: string
  resourceId: string
  title: string
  content: string
  tags?: string[]
}
```

### Usage

```typescript
import { indexDocument, search } from "@/lib/search/engine"

// Index document
await indexDocument({
  organizationId: "org-123",
  resource: "project",
  resourceId: "project-123",
  title: "My Project",
  content: "Description...",
  tags: ["ai", "automation"],
})

// Search
const results = await search("automation", {
  organizationId: "org-123",
  resource: "project",
})
```

### Features

- MongoDB text index for full-text search
- Fallback to regex search if index unavailable
- Tag-based filtering
- Resource-specific search
- Relevance scoring

---

## Cost Tracking Architecture

### System Overview

Track AI API costs per user/organization:

```typescript
interface ICost {
  userId: string
  organizationId?: string
  provider: string // "openai", "anthropic"
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cost: number // In cents
}
```

### Usage

```typescript
import { trackCost, getCostSummary } from "@/lib/cost/tracker"

// Track cost
await trackCost({
  userId: "user-123",
  provider: "openai",
  model: "gpt-4-turbo-preview",
  inputTokens: 1000,
  outputTokens: 500,
})

// Get summary
const summary = await getCostSummary({
  userId: "user-123",
  startDate: new Date("2024-01-01"),
})
```

### Pricing

Built-in pricing for:
- OpenAI (GPT-4, GPT-3.5, etc.)
- Anthropic (Claude models)
- Easily extensible for other providers

---

## Templates Architecture

### System Overview

Shareable templates for prompts, workflows, and agents:

```typescript
interface ITemplate {
  userId?: string
  organizationId?: string
  name: string
  type: "prompt" | "workflow" | "agent" | "form"
  content: Record<string, any>
  variables?: Array<{ name: string; description: string; required: boolean }>
  public: boolean
  featured: boolean
  usageCount: number
}
```

### Usage

```typescript
import { createTemplate, getTemplates } from "@/lib/templates/manager"

// Create template
await createTemplate({
  name: "Customer Support Agent",
  type: "agent",
  content: {
    systemPrompt: "You are a helpful agent...",
    tools: ["database", "email"],
  },
  public: true,
})

// Get templates
const templates = await getTemplates({
  type: "agent",
  publicOnly: true,
  featured: true,
})
```

### Features

- Multiple template types
- Variable substitution
- Public/private templates
- Featured templates
- Usage tracking
- Category and tag filtering

---

## Security Considerations

### Authentication

1. **Session Management**: Better Auth handles sessions securely
2. **Route Protection**: Use `middleware.ts` for protected routes
3. **API Security**: Always verify sessions in API routes

### Multi-Tenancy

1. **Organization Isolation**: Always verify organization membership
2. **Permission Checks**: Use `hasPermission` API before operations
3. **Data Scoping**: Filter queries by `organizationId`

### AI Agents

1. **Input Validation**: Validate all tool inputs
2. **Rate Limiting**: Implement rate limits for agent API
3. **Tool Access**: Restrict tools based on user permissions
4. **Audit Logging**: Log all agent interactions

### Billing

1. **Webhook Verification**: Always verify Stripe webhook signatures
2. **Subscription Validation**: Verify subscription status before access
3. **Payment Security**: Never store payment details

### Webhooks

1. **Signature Verification**: Always verify webhook signatures
2. **HTTPS Only**: Only accept webhooks over HTTPS
3. **Retry Logic**: Implement proper retry and backoff

---

## Performance Optimization

### Database

1. **Indexes**: Add indexes to frequently queried fields
2. **Connection Pooling**: Both Prisma and Mongoose handle this automatically
3. **Query Optimization**: Use Mongoose select() to limit fields

### Caching

1. **Session Cache**: Better Auth has built-in session caching
2. **Organization Cache**: Cache organization data in client state
3. **Redis**: Use Redis for application-level caching

### Job Queues

1. **Concurrency**: Adjust worker concurrency based on load
2. **Prioritization**: Use job priorities for important tasks
3. **Batching**: Batch similar jobs when possible

---

## Best Practices

### Code Organization

1. **Separation of Concerns**: Prisma for auth, Mongoose for app
2. **Model Organization**: Group related Mongoose models
3. **Tool Organization**: Keep tools focused and reusable

### Error Handling

1. **Try-Catch**: Always wrap async operations
2. **Error Types**: Use specific error types
3. **Logging**: Log errors with context

### Testing

1. **Unit Tests**: Test individual functions and components
2. **Integration Tests**: Test API routes and database operations
3. **E2E Tests**: Test complete user flows

---

## Resources

- [Better Auth Organization Docs](https://better-auth.com/docs/plugins/organization)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
- [Prisma MongoDB](https://www.prisma.io/docs/concepts/database-connectors/mongodb)
- [Mongoose Best Practices](https://mongoosejs.com/docs/guide.html)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Stripe Webhooks](https://stripe.com/docs/webhooks)
- [PostHog Docs](https://posthog.com/docs)
