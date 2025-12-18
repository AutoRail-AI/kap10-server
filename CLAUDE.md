# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AppealGen AI** is an AI-powered medical denial appeal generator that transforms 45-minute manual appeals into 60-second AI-generated, citation-backed letters. Built with Next.js 16, React 19, and Tailwind CSS v4.

### What This App Does
1. Takes denial information + clinical notes as input
2. Automatically masks all PII/PHI data for HIPAA compliance
3. Generates appeal letters using payer-specific policies via RAG
4. Outputs professional, downloadable appeal documents

### Tech Stack
- **Framework**: Next.js 16 (App Router), React 19
- **Styling**: Tailwind CSS v4, shadcn/ui, Radix UI
- **Auth**: Better Auth with MongoDB adapter
- **Database**: MongoDB
- **PII Masking**: Custom multi-pattern service
- **Testing**: Vitest, Playwright, Storybook
- **Package Manager**: pnpm (via Corepack)

## Common Commands

```bash
# Development
pnpm dev              # Start dev server with Turbopack
pnpm build            # Production build
pnpm start            # Start production server
pnpm analyze          # Build with bundle analyzer

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
- `app/` - Next.js App Router pages and API routes
- `components/` - Reusable React components (organized by component name with co-located tests and stories)
- `styles/` - Global Tailwind CSS styles
- `e2e/` - Playwright end-to-end tests
- `brand/` - Brand guidelines and assets
- `public/logos/` - Logo variations (9 SVG files)
- `public/icons/` - App icons and background patterns

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

### Testing
- Unit tests: Vitest with React Testing Library (files: `*.test.{ts,tsx}`)
- E2E tests: Playwright (in `e2e/` directory)
- Component testing: Storybook with test-runner

### TypeScript
Strict mode enabled with `noUncheckedIndexedAccess`. Uses ts-reset for enhanced type safety. Absolute imports configured from project root.

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

## Implementation Documentation

Detailed implementation guides are in the `docs/` folder:

### Key Documents
| Document | Purpose |
|----------|---------|
| [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Step-by-step implementation guide with code snippets |
| [DECISION_LOG.md](docs/DECISION_LOG.md) | Architectural and technical decisions with rationale |
| [PROGRESS_TRACKER.md](docs/PROGRESS_TRACKER.md) | Track what's built, status, and next steps |

### Implementation Phases
1. **Phase 1: Foundation** - Dependencies, shadcn/ui, MongoDB connection
2. **Phase 2: Core Features** - Appeal form, PII masking, output generation
3. **Phase 3: Auth & Users** - Better Auth, login/register, protected routes
4. **Phase 4: Premium** - Letterhead, appeal history, dashboard
5. **Phase 5: Enterprise** - Teams, API access, advanced analytics

### When Building Features
1. Check `PROGRESS_TRACKER.md` for current status
2. Follow steps in `IMPLEMENTATION_PLAN.md` for the relevant phase
3. Log any decisions in `DECISION_LOG.md`
4. Update `PROGRESS_TRACKER.md` when completing items

### Key Implementation Details

**Database Collections**:
- `users` - User accounts and profiles
- `providers` - Insurance payer information
- `appeals` - Generated appeals with TTL (30 days)
- `rulesets` - Payer-specific appeal rules

**PII/PHI Masking Patterns**:
- SSN, phone, email, dates
- Medical Record Numbers (MRN)
- Member IDs, NPI numbers
- Patient names, addresses
- ICD-10 and CPT codes

**API Routes**:
- `GET /api/providers` - List insurance providers
- `POST /api/masking/preview` - Preview masked content
- `POST /api/appeals/generate` - Generate appeal letter
- `GET /api/appeals/[id]` - Retrieve saved appeal
