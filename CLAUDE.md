# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Modern Next.js Boilerplate** - A production-ready Next.js starter with authentication, Supabase (PostgreSQL), background job processing, and modern tooling. Built with Next.js 16, React 19, and Tailwind CSS v4.

### What This Boilerplate Provides

| Feature | Technology | Description |
|---------|------------|-------------|
| **Authentication** | Better Auth | Email/password + Google OAuth with session management |
| **Database** | Supabase (PostgreSQL) | Type-safe operations with singleton client pattern |
| **Job Queues** | BullMQ + Redis | Reliable background job processing with retries |
| **UI Components** | shadcn/ui | Pre-built accessible components with Radix UI |
| **Styling** | Tailwind CSS v4 | Utility-first CSS with CVA variants |
| **File Uploads** | Uploadthing | Easy file upload handling |
| **Email** | Resend | Transactional email service |
| **Testing** | Vitest + Playwright | Unit, integration, and E2E testing |
| **Containerization** | Docker | Development environment with Redis |

### Tech Stack
- **Framework**: Next.js 16 (App Router), React 19
- **Styling**: Tailwind CSS v4, shadcn/ui, Radix UI
- **Auth**: Better Auth with PostgreSQL (pg Pool)
- **Database**: Supabase (PostgreSQL)
- **Job Queue**: BullMQ with Redis
- **Testing**: Vitest, Playwright, Storybook
- **Package Manager**: pnpm (via Corepack)

## Common Commands

```bash
# Development
pnpm dev              # Start dev server with Turbopack
pnpm build            # Production build
pnpm start            # Start production server
pnpm analyze          # Build with bundle analyzer

# Background Workers
pnpm worker           # Start background job workers

# Docker (includes Redis)
docker compose up     # Start all services (app + worker + redis)
docker compose up -d  # Start in detached mode

# Testing
pnpm test             # Run Vitest unit tests
pnpm test:watch       # Run tests in watch mode
pnpm test:coverage    # Run tests with coverage
pnpm e2e:headless     # Run Playwright E2E tests
pnpm e2e:ui           # Run Playwright with UI

# Code Quality
pnpm lint             # Run ESLint
pnpm lint:fix         # Run ESLint with auto-fix
pnpm prettier         # Check formatting
pnpm prettier:fix     # Fix formatting

# Storybook
pnpm storybook        # Start Storybook on port 6006
pnpm build-storybook  # Build static Storybook
```

## Architecture

### Directory Structure
```
app/                    # Next.js App Router
├── (auth)/             # Auth route group (login, register, verify-email)
├── api/                # API routes
│   ├── auth/           # Better Auth API
│   ├── health/         # Health check endpoint
│   └── uploadthing/    # File upload API
├── layout.tsx          # Root layout
└── page.tsx            # Home page

components/
├── auth/               # Auth components (login-form, register-form, oauth-buttons)
├── providers/          # React providers (auth-provider)
├── ui/                 # shadcn/ui components
├── Button/             # Example component with tests and stories
└── Tooltip/            # Example component

lib/
├── auth/               # Better Auth configuration
├── db/                 # Supabase client and type definitions
├── queue/              # BullMQ job queue system
│   ├── redis.ts        # Redis connection singleton
│   ├── types.ts        # Job type definitions
│   ├── queues.ts       # Queue definitions and helpers
│   ├── workers.ts      # Worker processors
│   └── index.ts        # Barrel export
├── types/              # TypeScript type definitions
├── uploadthing/        # Uploadthing configuration
└── utils/              # Utility functions

scripts/
└── worker.ts           # Background worker entry point

e2e/                    # Playwright end-to-end tests
brand/                  # Brand guidelines and assets
public/
├── logos/              # Logo variations (9 SVG files)
└── icons/              # App icons and patterns
```

### Key Patterns

**Component Structure**: Components are organized in folders with co-located files:
- `ComponentName.tsx` - Main component
- `ComponentName.test.tsx` - Vitest unit tests
- `ComponentName.stories.tsx` - Storybook stories

**Styling**: Uses Tailwind CSS v4 with:
- `class-variance-authority` (CVA) for component variants
- `tailwind-merge` for className merging

**Environment Variables**: Managed via T3 Env (`env.mjs`) with Zod validation. Add new env vars there with schema definitions.

**Health Checks**: Available at `/healthz`, `/health`, `/ping`, or `/api/health` (all route to the same endpoint).

### Authentication

Better Auth is pre-configured with:
- Email/password authentication
- Google OAuth (optional)
- Email verification via Resend
- PostgreSQL session storage (via Supabase)

Protected routes are configured in `proxy.ts`. Add routes to `protectedRoutes` array.

### Database

This boilerplate uses **Supabase (PostgreSQL)** for all data storage:

- **Server client**: `lib/db/supabase.ts` — singleton Supabase client with service role key
- **Browser client**: `lib/db/supabase-browser.ts` — browser-side client using `@supabase/ssr`
- **Type definitions**: `lib/db/types.ts` — full TypeScript Database type with Row/Insert/Update generics
- **Migrations**: `supabase/migrations/` — SQL migration files for schema management

Better Auth connects directly via `pg` Pool to the same Supabase PostgreSQL database.

### Background Job Processing

BullMQ + Redis for reliable background job processing. Pre-configured queues:

| Queue | Purpose | Concurrency |
|-------|---------|-------------|
| `email` | Email sending | 5 workers |
| `processing` | Long-running tasks | 3 workers |
| `webhooks` | External HTTP calls | 10 workers |

**Adding a job to a queue:**
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
  payload: { /* your data */ },
})

// Queue a webhook
await queueWebhook({
  url: "https://api.example.com/webhook",
  method: "POST",
  body: { event: "user.created" },
})
```

**Running workers:**
```bash
# Development (separate terminal)
pnpm worker

# With Docker (automatically runs worker service)
docker compose up
```

**Custom job types**: Add new job types in `lib/queue/types.ts` and processors in `lib/queue/workers.ts`.

### Testing
- Unit tests: Vitest with React Testing Library (files: `*.test.{ts,tsx}`)
- E2E tests: Playwright (in `e2e/` directory)
- Component testing: Storybook with test-runner

### TypeScript
Strict mode enabled with `noUncheckedIndexedAccess`. Uses ts-reset for enhanced type safety. Absolute imports configured from project root.

## Code Generation Rules

**⚠️ CRITICAL: Follow code generation rules to prevent build and lint errors.**

All mandatory code patterns and rules are documented in [RULESETS.md](RULESETS.md). Please reference that file when generating code to ensure compatibility with our tech stack and prevent known build issues.

The rules cover:
- Supabase query patterns
- Zod v4 validation syntax
- JSON parsing type assertions
- File extension requirements (JSX)
- Lazy initialization for env-dependent clients
- Error handling patterns
- And more...

**Always check [RULESETS.md](RULESETS.md) before generating code.**

---

## Docker Development

The docker-compose setup includes:
- **app**: Next.js development server with hot reloading
- **worker**: Background job processor
- **redis**: Redis server for job queues (persisted data)

```bash
# Start all services
docker compose up

# Start specific service
docker compose up app

# View logs
docker compose logs -f worker

# Stop all services
docker compose down
```

## Brand Assets

Full brand guidelines are in `brand/brand.md`. Key resources:

### Logos (`public/logos/`)
| Background | Full Logo | Icon Only |
|------------|-----------|-----------|
| Dark/Black | logo_1.svg, logo_2.svg | logo_7.svg |
| Light/White | logo_4.svg, logo_5.svg | logo_8.svg |
| Gradient | logo_3.svg, logo_6.svg | logo_9.svg |

### Icons (`public/icons/`)
- `app.svg` - Primary app icon (561x561px, rounded square)
- `app_black_bg.svg` - App icon on black canvas (1080x1080px, for social media)
- `background_icon.svg` - Decorative X pattern for backgrounds (use at 20-30% opacity)

### Brand Colors
| Color | Hex | Usage |
|-------|-----|-------|
| Cornflower Blue | `#568AFF` | Primary brand, buttons, links |
| Green-Blue | `#0665BA` | Secondary, gradient endpoints |
| Rich Black | `#001320` | Text, dark backgrounds |
| Gradient | `#559EFF` → `#0065BA` | Premium elements, CTAs |

### Typography
- **Poppins Semi Bold (600)** - Headlines, navigation, buttons
- **Poppins Regular (400)** - Body text, descriptions
- **Sofia Sans Extra Condensed** - Accent labels only (use sparingly)

## Getting Started

### Local Development
```bash
# 1. Copy environment file
cp .env.example .env.local

# 2. Fill in required values (Supabase URL/keys, Better Auth secret)

# 3. Install dependencies
pnpm install

# 4. Start Redis (if running workers locally)
docker run -d -p 6379:6379 redis:7-alpine

# 5. Start dev server
pnpm dev

# 6. (Optional) Start workers in another terminal
pnpm worker
```

### Docker Development
```bash
# 1. Copy environment file
cp .env.example .env.local

# 2. Fill in required values

# 3. Start all services
docker compose up
```

## API Routes

| Route | Description |
|-------|-------------|
| `GET /api/health` | Health check endpoint |
| `/api/auth/*` | Better Auth endpoints |
| `/api/uploadthing` | File upload endpoint |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SECRET_KEY` | Yes | Supabase service role key |
| `SUPABASE_DB_URL` | Yes | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Yes | Auth secret (32+ chars) |
| `BETTER_AUTH_URL` | Yes | App URL for auth |
| `REDIS_URL` | No | Redis URL (default: localhost:6379) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth secret |
| `RESEND_API_KEY` | No | Resend email API key |
| `EMAIL_FROM` | No | From email address |
| `UPLOADTHING_TOKEN` | No | Uploadthing API token |
| `NEXT_PUBLIC_APP_URL` | No | Public app URL |

## Additional Documentation

- [README.md](README.md) - **Complete setup and usage guide** - Installation, configuration, and how to use all features
- [ARCHITECTURE.md](ARCHITECTURE.md) - **Architecture documentation** - Database architecture, multi-tenancy, AI agents, billing, analytics, and system design
- [AGENTS.md](AGENTS.md) - **Cursor AI guidance** - Similar documentation for Cursor AI
- [GEMINI.md](GEMINI.md) - **Gemini/Antigravity guidance** - Similar documentation for Gemini AI
- [brand/brand.md](brand/brand.md) - Complete brand guidelines and assets
