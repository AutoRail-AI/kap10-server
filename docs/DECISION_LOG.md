# AppealGen AI - Decision Log

> **Purpose**: Track all architectural, technical, and design decisions made during development. Each decision should be documented with context, alternatives considered, and rationale.

**Last Updated**: December 2025

---

## How to Use This Document

When making a significant decision, add an entry with:
1. **Date**: When the decision was made
2. **Category**: Architecture, Technology, Design, Process, etc.
3. **Decision**: What was decided
4. **Context**: Why this decision needed to be made
5. **Alternatives**: What other options were considered
6. **Rationale**: Why this option was chosen
7. **Consequences**: Expected impact (positive and negative)
8. **Status**: Proposed, Accepted, Deprecated, Superseded

---

## Decision Categories

- **ARCH**: Architecture decisions
- **TECH**: Technology/library choices
- **DATA**: Database/data model decisions
- **SEC**: Security decisions
- **UI**: User interface decisions
- **API**: API design decisions
- **PROC**: Process/workflow decisions

---

## Decisions

### DEC-001: Framework Selection

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | TECH |
| **Status** | Accepted |

**Decision**: Use Next.js 16 with App Router as the primary framework.

**Context**: Need a modern React framework that supports server-side rendering, API routes, and has good TypeScript support.

**Alternatives Considered**:
1. **Remix** - Good for traditional web apps, but smaller ecosystem
2. **Vite + React** - Fast dev experience, but requires separate backend
3. **SvelteKit** - Excellent performance, but team unfamiliar with Svelte

**Rationale**:
- Already configured in boilerplate
- Native support for React 19 and Server Components
- Built-in API routes eliminate need for separate backend
- Large ecosystem and community support
- Turbopack for fast development builds

**Consequences**:
- (+) Unified frontend/backend codebase
- (+) Easy deployment to Vercel
- (+) Strong TypeScript integration
- (-) Learning curve for App Router patterns
- (-) Some libraries not yet compatible with React 19

---

### DEC-002: Database Selection

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | DATA |
| **Status** | Accepted |

**Decision**: Use MongoDB (with MongoDB Atlas for hosting).

**Context**: Need a database that can handle document-like appeal data with flexible schemas.

**Alternatives Considered**:
1. **PostgreSQL** - Better for complex queries, ACID compliance
2. **Supabase** - PostgreSQL with auth, but adds dependency
3. **Firebase Firestore** - Easy setup, but vendor lock-in

**Rationale**:
- Document structure fits appeal data well (nested objects, variable fields)
- Flexible schema allows iterating quickly on data models
- MongoDB Atlas provides easy scaling and management
- Good driver support for Node.js/TypeScript
- TTL indexes for automatic appeal expiration

**Consequences**:
- (+) Schema flexibility during early development
- (+) Easy to store appeal documents with nested structure
- (+) Built-in expiration with TTL indexes
- (-) No built-in relations (must handle manually)
- (-) Less suited for complex reporting queries

---

### DEC-003: Authentication Provider

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | SEC |
| **Status** | Accepted |

**Decision**: Use Better Auth for authentication.

**Context**: Need authentication that supports email/password, social login, and integrates with MongoDB.

**Alternatives Considered**:
1. **NextAuth.js (Auth.js)** - More mature, but complex configuration
2. **Clerk** - Best UX, but expensive at scale
3. **Auth0** - Enterprise-grade, but complex setup
4. **Custom JWT** - Full control, but security risks

**Rationale**:
- Simple API, minimal configuration
- Native MongoDB adapter
- Built-in session management
- Type-safe with TypeScript
- Open source, no vendor lock-in

**Consequences**:
- (+) Quick setup and integration
- (+) Type-safe session handling
- (+) Works well with MongoDB
- (-) Smaller community than NextAuth
- (-) Fewer third-party integrations

---

### DEC-004: PII/PHI Masking Strategy

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | SEC |
| **Status** | Accepted |

**Decision**: Implement multi-stage PII/PHI masking using regex patterns with maskdata library.

**Context**: Must protect patient data for HIPAA compliance. Need to mask PII before processing or storing.

**Alternatives Considered**:
1. **pii-filter only** - Limited patterns, less customizable
2. **octocode-data-masker** - Good detection, but npm install issues
3. **Custom regex only** - Full control, but maintenance burden
4. **Third-party API** - Better accuracy, but latency and cost

**Rationale**:
- Custom regex patterns optimized for healthcare data
- maskdata library for structured data masking
- Client-side preview + server-side processing
- No external API dependencies (speed, cost, privacy)
- Can enhance patterns over time

**Consequences**:
- (+) No external dependencies
- (+) Fast, synchronous processing
- (+) Full control over masking rules
- (-) May miss some PII patterns initially
- (-) Requires ongoing pattern maintenance

---

### DEC-005: UI Component Library

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | UI |
| **Status** | Accepted |

**Decision**: Use shadcn/ui built on Radix UI primitives.

**Context**: Need accessible, customizable UI components that match brand.

**Alternatives Considered**:
1. **Chakra UI** - Good DX, but opinionated styling
2. **Material UI** - Comprehensive, but heavy and Google-styled
3. **Ant Design** - Enterprise-ready, but large bundle
4. **Headless UI** - Minimal, requires more styling work

**Rationale**:
- Components are copied to project (not imported)
- Built on accessible Radix primitives
- Tailwind CSS integration
- Easy to customize and brand
- Growing community adoption

**Consequences**:
- (+) Full control over component code
- (+) Accessible by default
- (+) Consistent with existing Tailwind setup
- (-) Manual updates needed for component fixes
- (-) Initial setup requires adding each component

---

### DEC-006: State Management

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | ARCH |
| **Status** | Accepted |

**Decision**: Use React Context + hooks for state, with Zustand for complex global state.

**Context**: Need state management for auth state, form state, and UI state.

**Alternatives Considered**:
1. **Redux Toolkit** - Powerful, but boilerplate-heavy
2. **Zustand only** - Simple, but might be overkill for simple state
3. **Jotai** - Atomic state, but different paradigm
4. **React Query** - Great for server state, not for UI state

**Rationale**:
- React Context sufficient for auth and theme
- Custom hooks for data fetching (can migrate to React Query later)
- Zustand if complex client state needed
- Server Components reduce client state needs

**Consequences**:
- (+) Minimal dependencies
- (+) Familiar patterns for React developers
- (+) Easy to refactor if needs change
- (-) Must manually handle caching/revalidation
- (-) May need React Query for complex data fetching

---

### DEC-007: API Design Pattern

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | API |
| **Status** | Accepted |

**Decision**: Use Next.js API Routes with REST-style endpoints.

**Context**: Need API layer for appeal generation, user management, and data access.

**Alternatives Considered**:
1. **tRPC** - Type-safe, but learning curve
2. **GraphQL** - Flexible queries, but complexity
3. **Server Actions** - Simpler, but less control
4. **Separate Express backend** - More control, but separate deployment

**Rationale**:
- REST is well understood
- Next.js API routes are simple to implement
- Easy to document and test
- Can migrate to tRPC later if type safety needed
- Server Actions for simple form submissions

**Consequences**:
- (+) Simple, familiar pattern
- (+) Easy to test with Postman/curl
- (+) No additional dependencies
- (-) Must manually ensure type safety
- (-) More boilerplate than tRPC

---

### DEC-008: Appeal Generation Architecture

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | ARCH |
| **Status** | Accepted |

**Decision**: Separate LLM/RAG backend service, called from Next.js API routes.

**Context**: Appeal generation requires LLM integration with payer policy RAG.

**Alternatives Considered**:
1. **Direct OpenAI API calls** - Simple, but no RAG
2. **LangChain in Next.js** - Integrated, but heavy
3. **Vercel AI SDK** - Good streaming, but limited RAG
4. **Separate Python backend** - Full ML ecosystem access

**Rationale**:
- Separation of concerns (UI vs ML)
- LLM backend can use Python ML ecosystem
- Easier to scale independently
- Can swap LLM providers without frontend changes
- MVP can use placeholder responses

**Consequences**:
- (+) Independent scaling
- (+) Use best tools for each job
- (+) Can iterate on LLM separately
- (-) Additional service to deploy
- (-) Network latency between services

---

### DEC-009: File Structure Pattern

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | ARCH |
| **Status** | Accepted |

**Decision**: Feature-based organization with shared lib directory.

**Context**: Need clear structure as codebase grows.

**Alternatives Considered**:
1. **Flat structure** - Simple, but doesn't scale
2. **Domain-driven** - Good for large teams, but overhead
3. **Type-based** (all components together) - Traditional, but hard to navigate

**Rationale**:
- Features are colocated (appeal components near appeal hooks)
- Shared code in lib/ is discoverable
- Matches Next.js App Router conventions
- Easy to find related code

**Consequences**:
- (+) Related code is together
- (+) Easy to delete features
- (+) Clear import paths
- (-) May have some duplication
- (-) Requires discipline to maintain

---

### DEC-010: Testing Strategy

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | PROC |
| **Status** | Accepted |

**Decision**: Vitest for unit/integration tests, Playwright for E2E, Storybook for component testing.

**Context**: Need comprehensive testing that's fast and maintainable.

**Alternatives Considered**:
1. **Jest only** - Popular, but slower than Vitest
2. **Cypress** - Good E2E, but slower than Playwright
3. **Testing Library only** - Good for units, no E2E

**Rationale**:
- Vitest is fast and compatible with Vite
- Already configured in boilerplate
- Playwright is faster and more reliable than Cypress
- Storybook enables visual component testing

**Consequences**:
- (+) Fast test execution
- (+) Comprehensive coverage options
- (+) Visual testing with Storybook
- (-) Multiple testing tools to learn
- (-) Must maintain test configuration

---

## Decision Template

Copy this template for new decisions:

```markdown
### DEC-XXX: [Title]

| Field | Value |
|-------|-------|
| **Date** | [Date] |
| **Category** | [ARCH/TECH/DATA/SEC/UI/API/PROC] |
| **Status** | [Proposed/Accepted/Deprecated/Superseded] |

**Decision**: [What was decided]

**Context**: [Why this decision needed to be made]

**Alternatives Considered**:
1. **[Option 1]** - [Pros/cons]
2. **[Option 2]** - [Pros/cons]

**Rationale**: [Why this option was chosen]

**Consequences**:
- (+) [Positive consequence]
- (-) [Negative consequence]
```

---

## Pending Decisions

List decisions that need to be made:

1. **Email provider** - Resend vs SendGrid vs Postmark
2. **PDF generation** - Client-side vs server-side
3. **Analytics** - PostHog vs Mixpanel vs Plausible
4. **Error monitoring** - Sentry vs LogRocket vs custom
5. **Rate limiting implementation** - In-memory vs Redis

---

## Superseded Decisions

List decisions that have been replaced:

| Original | Superseded By | Date |
|----------|---------------|------|
| - | - | - |
