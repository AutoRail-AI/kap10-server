# Modern Next.js Boilerplate

Production-ready Next.js starter for building full-stack SaaS applications. Includes authentication, multi-tenancy, AI agents, billing, analytics, and more.

---

## Features

| Feature | Technology | Description |
|---------|------------|-------------|
| **Authentication** | Better Auth | Email/password + Google OAuth with session management |
| **Multi-Tenancy** | Better Auth Organizations | Organization-based multi-tenancy with roles & permissions |
| **AI Agents** | OpenAI + Custom Framework | Modern AI agent workflows with tool calling |
| **Billing** | Stripe | Subscription management and payments |
| **Analytics** | PostHog | User analytics and event tracking |
| **Feature Flags** | Custom | A/B testing and gradual rollouts |
| **Admin Dashboard** | Custom | Platform administration and monitoring |
| **Audit Logging** | Custom | Compliance-ready activity logging |
| **Webhooks** | Custom | Event delivery system |
| **Onboarding** | Custom | Step-by-step user onboarding |
| **Rate Limiting** | Custom | API protection and abuse prevention |
| **Error Tracking** | Sentry | Production error monitoring |
| **API Keys** | Custom | User API keys for integrations |
| **Usage Tracking** | Custom | Track API calls and enforce quotas |
| **Notifications** | Custom | In-app and email notifications |
| **Activity Feed** | Custom | Real-time activity streams |
| **Search** | MongoDB Text Index | Full-text search across platform |
| **Cost Tracking** | Custom | Track AI API costs per user/org |
| **Templates** | Custom | Shareable prompts and workflows |
| **Database** | MongoDB | Hybrid: Prisma (auth) + Mongoose (app) |
| **Job Queues** | BullMQ + Redis | Reliable background job processing |
| **UI Components** | shadcn/ui | Pre-built accessible components |
| **Styling** | Tailwind CSS v4 | Utility-first CSS with CVA variants |
| **File Uploads** | Uploadthing | Easy file upload handling |
| **Email** | Resend | Transactional email service |
| **Testing** | Vitest + Playwright | Unit, integration, and E2E testing |
| **Containerization** | Docker | Development environment with Redis |

---

## Quick Start

### Prerequisites

- Node.js >= 20.9.0
- MongoDB database (Atlas recommended)
- pnpm (via Corepack)
- Docker (optional, for Redis)

### Installation

```bash
# 1. Enable Corepack for pnpm
corepack enable

# 2. Clone and install dependencies
git clone <your-repo-url>
cd modern-nextjs-boilerplate
pnpm install

# 3. Configure environment
cp .env.example .env.local
# Edit .env.local with your MongoDB URI and Better Auth secret

# 4. Generate Prisma schema for Better Auth
npx @better-auth/cli@latest generate
npx prisma generate

# 5. Start development server
pnpm dev
```

**That's it!** Your app is running at http://localhost:3000

### With Docker

```bash
# Copy environment file
cp .env.example .env.local
# Edit .env.local with your MongoDB URI and secrets

# Start all services (app + worker + redis)
docker compose up
```

---

## Environment Variables

Create `.env.local` with these variables:

> **Note**: Most features are optional. Only configure what you need.

### Required

```bash
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/database?retryWrites=true&w=majority
BETTER_AUTH_SECRET=your-32-character-secret-here
BETTER_AUTH_URL=http://localhost:3000
```

### Optional Features

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Email (Resend)
RESEND_API_KEY=re_xxxxx
EMAIL_FROM=noreply@yourdomain.com

# AI Agents
OPENAI_API_KEY=sk-xxxxx

# Organization Settings
ORGANIZATION_LIMIT=5
MEMBERSHIP_LIMIT=100

# File Uploads
UPLOADTHING_TOKEN=sk_live_xxxxx

# Redis (defaults to localhost:6379)
REDIS_URL=redis://localhost:6379

# Stripe Billing
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_FREE=price_...
STRIPE_PRICE_ID_PRO=price_...
STRIPE_PRICE_ID_ENTERPRISE=price_...

# PostHog Analytics
NEXT_PUBLIC_POSTHOG_KEY=ph_...
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com

# Sentry Error Tracking
SENTRY_DSN=https://...

# Public
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Project Structure

```
├── app/                    # Next.js App Router
│   ├── (admin)/admin/      # Admin dashboard (protected)
│   ├── (auth)/             # Auth pages (login, register, verify-email)
│   ├── api/                # API routes
│   │   ├── admin/          # Admin API
│   │   ├── ai/             # AI agent endpoints
│   │   ├── api-keys/        # API keys management
│   │   ├── auth/           # Better Auth endpoints
│   │   ├── billing/        # Billing API
│   │   ├── notifications/   # Notifications API
│   │   ├── activity/        # Activity feed API
│   │   ├── search/          # Search API
│   │   ├── usage/           # Usage tracking API
│   │   ├── cost/            # Cost tracking API
│   │   ├── templates/       # Templates API
│   │   ├── onboarding/     # Onboarding API
│   │   └── webhooks/       # Webhook handlers
│   ├── billing/            # Billing page
│   ├── onboarding/         # Onboarding page
│   └── page.tsx            # Home page
├── components/
│   ├── ai/                 # AI agent components
│   ├── auth/               # Auth components
│   ├── billing/            # Billing components
│   ├── onboarding/         # Onboarding components
│   ├── organizations/      # Organization components
│   ├── providers/          # React providers
│   └── ui/                 # shadcn/ui components
├── config/
│   └── roles.yaml          # Role configuration (YAML)
├── lib/
│   ├── ai/                 # AI agent framework
│   ├── analytics/          # PostHog analytics
│   ├── audit/              # Audit logging
│   ├── auth/               # Better Auth configuration
│   ├── billing/            # Stripe billing
│   ├── config/             # Configuration (roles)
│   ├── db/                 # Database connections
│   │   ├── prisma.ts       # Prisma client (Better Auth)
│   │   └── mongoose.ts     # Mongoose connection (App)
│   ├── features/           # Feature flags
│   ├── models/             # Mongoose models
│   ├── onboarding/         # Onboarding flow
│   ├── queue/              # BullMQ job queues
│   ├── rate-limit/         # Rate limiting
│   ├── webhooks/           # Webhook system
│   ├── api-keys/           # API keys management
│   ├── usage/              # Usage tracking
│   ├── notifications/      # Notifications system
│   ├── activity/           # Activity feed
│   ├── search/             # Search engine
│   ├── cost/               # Cost tracking
│   ├── templates/          # Templates library
│   └── utils/              # Utilities
├── prisma/
│   └── schema.prisma       # Prisma schema (auto-generated by Better Auth)
├── hooks/                  # React hooks
└── scripts/
    └── worker.ts           # Background worker
```

---

## Available Commands

```bash
# Development
pnpm dev              # Start dev server with Turbopack
pnpm build            # Production build
pnpm start            # Start production server
pnpm worker           # Start background job workers

# Testing
pnpm test             # Run unit tests
pnpm test:watch       # Watch mode
pnpm test:coverage    # Run with coverage
pnpm e2e:headless     # Run E2E tests
pnpm e2e:ui           # Run E2E tests with UI
pnpm storybook        # Start Storybook

# Code Quality
pnpm lint             # Run ESLint
pnpm lint:fix         # Auto-fix linting
pnpm prettier         # Check formatting
pnpm prettier:fix     # Fix formatting

# Database
npx @better-auth/cli@latest generate  # Generate Better Auth schema
npx prisma generate                   # Generate Prisma client
```

---

## Database Setup

This boilerplate uses a **hybrid database approach**:

### Prisma (Better Auth)

Prisma handles all authentication-related data. The schema is automatically generated:

```bash
# Generate Better Auth schema
npx @better-auth/cli@latest generate

# Generate Prisma client
npx prisma generate
```

**Usage**: Prisma is used automatically by Better Auth. You don't need to interact with it directly.

### Mongoose (Application Features)

Mongoose handles all application data (AI agents, custom features, etc.):

```typescript
// In API routes or server components
import { connectDB } from "@/lib/db/mongoose"
import { AgentConversation } from "@/lib/models"

export async function POST() {
  await connectDB() // Always connect first
  
  const conversation = await AgentConversation.create({
    userId: "user-123",
    messages: [{ role: "user", content: "Hello" }],
  })
  
  return Response.json(conversation)
}
```

**Creating Models**:

```typescript
// lib/models/example.ts
import mongoose, { Schema } from "mongoose"

export interface IExample extends mongoose.Document {
  name: string
  organizationId?: string
  createdAt: Date
  updatedAt: Date
}

const ExampleSchema = new Schema<IExample>(
  {
    name: { type: String, required: true },
    organizationId: { type: String, index: true },
  },
  { timestamps: true }
)

export const Example =
  mongoose.models.Example ||
  mongoose.model<IExample>("Example", ExampleSchema)
```

---

## Authentication

Better Auth is pre-configured with:
- Email/password authentication
- Google OAuth (optional)
- Email verification
- Session management

### Using Auth

**Server Component**:
```typescript
import { auth } from "@/lib/auth"
import { headers } from "next/headers"

export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")
  
  return <div>Hello {session.user.name}</div>
}
```

**Client Component**:
```typescript
"use client"
import { authClient } from "@/lib/auth/client"

export function Component() {
  const { data: session } = authClient.useSession()
  
  if (!session) return <div>Not logged in</div>
  return <div>Hello {session.user.name}</div>
}
```

### Protecting Routes

Edit `middleware.ts`:

```typescript
const protectedRoutes = [
  "/dashboard",
  "/settings",
  "/billing",
  "/admin",
]
```

---

## Multi-Tenancy (Organizations)

Organizations are already configured. See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed usage.

**Quick Example**:

```typescript
// Create organization
const org = await authClient.organization.create({
  name: "My Company",
  slug: "my-company",
})

// Get active organization
const { data: activeOrg } = authClient.useActiveOrganization()

// Invite member
await authClient.organization.invite({
  email: "user@example.com",
  role: "member",
})
```

---

## Billing & Subscriptions

Stripe integration is ready to use:

```typescript
// Create checkout session
const response = await fetch("/api/billing/checkout", {
  method: "POST",
  body: JSON.stringify({ planId: "pro" }),
})
const { url } = await response.json()
window.location.href = url

// Open billing portal
const response = await fetch("/api/billing/portal", {
  method: "POST",
})
const { url } = await response.json()
window.location.href = url
```

**Setup**:
1. Create Stripe account
2. Create products and prices
3. Add price IDs to `.env.local`
4. Set up webhook: `https://yourdomain.com/api/webhooks/stripe`

---

## Analytics (PostHog)

PostHog is integrated and tracks events automatically:

```typescript
// Server-side
import { trackEvent } from "@/lib/analytics/posthog"
await trackEvent(userId, "feature_used", { feature: "ai_agent" })

// Client-side
import { trackEvent } from "@/lib/analytics/client"
trackEvent("button_clicked", { button: "subscribe" })
```

**Setup**: Add `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` to `.env.local`

---

## Feature Flags

Check if a feature is enabled:

```typescript
import { isFeatureEnabled } from "@/lib/features/flags"

const enabled = await isFeatureEnabled("new_dashboard", userId, organizationId)
if (enabled) {
  // Show new feature
}
```

**Management**: Create flags via API or directly in MongoDB.

---

## Role Configuration

Roles are configured in `config/roles.yaml`:

```yaml
roles:
  admin:
    name: "Admin"
    permissions:
      project: ["create", "read", "update", "delete"]
```

Check permissions:

```typescript
import { hasPermission } from "@/lib/config/roles"

const canDelete = hasPermission("admin", "project", "delete")
```

---

## Background Job Processing

BullMQ + Redis for reliable background tasks:

```typescript
import { queueEmail, queueProcessing, queueWebhook } from "@/lib/queue"

// Queue an email
await queueEmail({
  to: "user@example.com",
  subject: "Welcome!",
  body: "<p>Thanks for signing up</p>",
})

// Queue a processing task
await queueProcessing({
  userId: "user-123",
  taskId: "task-456",
  payload: { data: "your-data" },
})

// Queue a webhook
await queueWebhook({
  url: "https://api.example.com/webhook",
  method: "POST",
  body: { event: "user.created" },
})
```

**Running Workers**:

```bash
# Local development (separate terminal)
pnpm worker

# With Docker (automatically included)
docker compose up
```

---

## Docker Services

The `docker-compose.yml` includes:

| Service | Port | Description |
|---------|------|-------------|
| `app` | 3000 | Next.js dev server |
| `worker` | - | Background job processor |
| `redis` | 6379 | Redis for job queues |

```bash
# Start all services
docker compose up

# Start in background
docker compose up -d

# View logs
docker compose logs -f worker

# Stop services
docker compose down
```

---

## Troubleshooting

### Prisma Client Not Generated

```bash
npx prisma generate
```

### Mongoose Connection Errors

1. Check `MONGODB_URI` is set correctly
2. Verify MongoDB is accessible
3. Check network/firewall settings

### Better Auth Schema Not Generated

```bash
npx @better-auth/cli@latest generate
```

### Type Errors

1. Regenerate Prisma client: `npx prisma generate`
2. Restart TypeScript server in your IDE
3. Check that imports are correct

---

## Next Steps

1. ✅ Set up environment variables
2. ✅ Generate Prisma schema
3. 📖 Read [ARCHITECTURE.md](ARCHITECTURE.md) for detailed architecture
4. 🚀 Start building your features!

---

## Resources

- [Better Auth Docs](https://better-auth.com/docs)
- [Prisma MongoDB Docs](https://www.prisma.io/docs/concepts/database-connectors/mongodb)
- [Mongoose Docs](https://mongoosejs.com/docs/)
- [Next.js Docs](https://nextjs.org/docs)
- [Tailwind CSS v4](https://tailwindcss.com/docs)

---

## License

MIT

---

**Modern Next.js Boilerplate** - Built for rapid development.
