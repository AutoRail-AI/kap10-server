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
| **Feature Flags** | Supabase | A/B testing and gradual rollouts |
| **Admin Dashboard** | Custom | Platform administration and monitoring |
| **Audit Logging** | Supabase | Compliance-ready activity logging |
| **Webhooks** | Supabase | Event delivery system |
| **Onboarding** | Supabase | Step-by-step user onboarding |
| **Rate Limiting** | Supabase | API protection and abuse prevention |
| **Error Tracking** | Sentry | Production error monitoring |
| **API Keys** | Supabase | User API keys for integrations |
| **Usage Tracking** | Supabase | Track API calls and enforce quotas |
| **Notifications** | Supabase | In-app and email notifications |
| **Activity Feed** | Supabase | Real-time activity streams |
| **Search** | Supabase | Full-text search across platform |
| **Cost Tracking** | Supabase | Track AI API costs per user/org |
| **Templates** | Supabase | Shareable prompts and workflows |
| **Database** | Supabase (PostgreSQL) | Unified database for everything |
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
- Supabase project
- pnpm (via Corepack)
- Docker (optional, for Redis)

### Installation

```bash
# 1. Enable Corepack for pnpm
corepack enable

# 2. Clone and install dependencies
git clone <your-repo-url>
cd nextjs_fullstack_boilerplate
pnpm install

# 3. Configure environment
cp .env.example .env.local
# Edit .env.local with your Supabase URL, Key and Better Auth secret

# 4. Initialize Database
# Run the migration script to set up schema (or use Supabase Dashboard)
pnpm migrate

# 5. Start development server
pnpm dev
```

**That's it!** Your app is running at http://localhost:3000

### With Docker

```bash
# Copy environment file
cp .env.example .env.local
# Edit .env.local with your Supabase secrets

# Start all services (app + worker + redis)
docker compose up
```

---

## Environment Variables

Create `.env.local` with these variables:

> **Note**: Most features are optional. Only configure what you need.

### Required

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Better Auth
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
│   │   ├── api-keys/       # API keys management
│   │   ├── auth/           # Better Auth endpoints
│   │   ├── billing/        # Billing API
│   │   ├── notifications/  # Notifications API
│   │   ├── activity/       # Activity feed API
│   │   ├── search/         # Search API
│   │   ├── usage/          # Usage tracking API
│   │   ├── cost/           # Cost tracking API
│   │   ├── templates/      # Templates API
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
│   ├── auth/               # Better Auth configuration (Supabase adapter)
│   ├── billing/            # Stripe billing
│   ├── config/             # Configuration (roles)
│   ├── db/                 # Database connections
│   │   ├── supabase.ts     # Supabase client (Server)
│   │   ├── supabase-browser.ts # Supabase client (Browser)
│   │   └── types.ts        # Database types
│   ├── features/           # Feature flags
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
├── supabase/
│   └── migrations/         # SQL Migrations
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
pnpm migrate          # Run database migrations
```

---

## Database Setup

This boilerplate uses **Supabase (PostgreSQL)** for all data storage.

### Schema Management

1. **Application Tables**: Managed via SQL migrations in `supabase/migrations/`
2. **Auth Tables**: Managed automatically by Better Auth using the PostgreSQL adapter

### Migrations

To apply the schema to your Supabase project:

```bash
pnpm migrate
```

This will run the SQL migrations to create all necessary application tables (activities, onboarding, subscriptions, etc.).

### Type Generation

Database types in `lib/db/types.ts` are automatically generated and aligned with your Supabase schema.

---

## Authentication

Better Auth is pre-configured with:
- Email/password authentication
- Google OAuth (optional)
- Email verification
- Session management
- Supabase / PostgreSQL Adapter

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

---

## Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Better Auth Docs](https://better-auth.com/docs)
- [Next.js Docs](https://nextjs.org/docs)
- [Tailwind CSS v4](https://tailwindcss.com/docs)

---

## License

MIT
