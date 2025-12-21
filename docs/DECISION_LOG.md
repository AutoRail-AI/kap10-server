# AppealGen AI - Decision Log

> **Purpose**: Track all architectural, technical, and design decisions made during development. Each decision should be documented with context, alternatives considered, and rationale.

**Last Updated**: December 19, 2025

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

### DEC-011: ChatGPT-like Conversational Interface

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | ARCH |
| **Status** | Accepted |

**Decision**: Pivot from form-based UI to a ChatGPT-like conversational interface for appeal generation.

**Context**: The original design used a traditional form-based approach where users fill out structured fields. User feedback indicated a desire for a more intuitive, conversational experience similar to ChatGPT, with simple login, easy customization options, and the ability to manage provider documentation versions.

**Alternatives Considered**:
1. **Form-based wizard** - Step-by-step guided form (original design)
2. **Hybrid approach** - Forms for structured data, chat for refinement
3. **Full conversational UI** - ChatGPT-style interface throughout

**Rationale**:
- Lower friction onboarding (can start immediately, login later)
- Iterative refinement through conversation feels more natural
- Users can ask follow-up questions and get clarifications
- Better handles ambiguous or incomplete information
- Familiar UX pattern (ChatGPT has trained users)
- Supports streaming responses for better perceived performance
- Allows easy customization through conversation

**Consequences**:
- (+) More intuitive user experience
- (+) Lower barrier to entry (anonymous use supported)
- (+) Natural iterative refinement of appeals
- (+) Better handling of complex cases through dialogue
- (+) Users can upload and discuss documents in context
- (-) Requires streaming infrastructure (SSE, Vercel AI SDK)
- (-) More complex state management (conversations, messages)
- (-) Need to handle conversation context window limits
- (-) More complex PII masking (must work with conversational flow)

---

### DEC-012: Document Management with Versioning

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | DATA |
| **Status** | Accepted |

**Decision**: Implement user-uploadable provider policy documents with version tracking.

**Context**: Payer policies change quarterly. Users need to upload newer versions of provider documentation and have the system use the correct version for appeals.

**Alternatives Considered**:
1. **Admin-only documents** - Only admins maintain policy database
2. **User uploads, no versioning** - Simple upload, replace old
3. **User uploads with versioning** - Track document versions

**Rationale**:
- Users often have access to latest policy documents
- Version tracking enables audit trail for appeals
- Can mark specific versions as "active" for use
- Supports regulatory compliance requirements
- Enables comparison between policy versions

**Consequences**:
- (+) Users always have access to latest policies
- (+) Audit trail for which policy version was used
- (+) Supports regulatory compliance
- (+) Reduces admin burden for policy updates
- (-) Requires file storage infrastructure (S3/R2)
- (-) Need document processing pipeline (PDF parsing, chunking)
- (-) Must handle duplicate/invalid uploads
- (-) Storage costs scale with user base

---

### DEC-013: Tiered Feature Access Model

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | ARCH |
| **Status** | Accepted |

**Decision**: Implement four-tier feature access: Anonymous, Free, Premium, and Enterprise.

**Context**: Need to balance low-friction onboarding with monetization. Anonymous users can try the product immediately, while paid tiers unlock additional features.

**Alternatives Considered**:
1. **Free-only** - All features free (no revenue)
2. **Paid-only** - Require payment upfront (high friction)
3. **Freemium** - Basic free, premium paid
4. **Tiered freemium** - Multiple tiers with progressive features

**Rationale**:
- Anonymous tier reduces friction to zero for first use
- Free tier encourages registration for history/saving
- Premium tier provides value for power users
- Enterprise tier addresses team/compliance needs
- Progressive disclosure of value drives conversions

**Feature Breakdown**:
| Feature | Anonymous | Free | Premium | Enterprise |
|---------|-----------|------|---------|------------|
| Basic appeals | ✅ (3/day) | ✅ (10/day) | ✅ Unlimited | ✅ Unlimited |
| Save history | ❌ | ✅ (30 days) | ✅ Forever | ✅ Forever |
| Custom letterhead | ❌ | ❌ | ✅ | ✅ |
| Document upload | ❌ | ❌ | ✅ | ✅ |
| Team features | ❌ | ❌ | ❌ | ✅ |
| API access | ❌ | ❌ | ❌ | ✅ |

**Consequences**:
- (+) Zero-friction trial experience
- (+) Clear upgrade path
- (+) Revenue potential from premium/enterprise
- (+) Supports various user segments
- (-) Must track usage limits per tier
- (-) More complex authorization logic
- (-) Anonymous sessions need cleanup (TTL)

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

### DEC-014: Email Provider

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | TECH |
| **Status** | Accepted |

**Decision**: Use Resend for transactional email.

**Context**: Need email provider for auth emails, notifications, and appeal delivery.

**Alternatives Considered**:
1. **SendGrid** - Mature, feature-rich, but complex pricing
2. **Postmark** - Excellent deliverability, but higher cost
3. **Resend** - Modern DX, simple pricing, React Email support

**Rationale**:
- Excellent developer experience with modern API
- Native React Email support for templating
- Simple, predictable pricing
- Fast setup with minimal configuration
- Good deliverability rates
- TypeScript-first SDK

**Consequences**:
- (+) Quick integration with React Email templates
- (+) Simple API, minimal boilerplate
- (+) Good free tier for development
- (-) Newer service, smaller ecosystem
- (-) Fewer advanced features than SendGrid

---

### DEC-015: PDF Generation Strategy

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | TECH |
| **Status** | Accepted |

**Decision**: Hybrid PDF generation - client-side for quick edits/preview, server-side for professional output.

**Context**: Appeals need PDF export. Users and LLM agents need ability to quickly edit content, but final output may require professional formatting with letterhead, signatures, etc.

**Alternatives Considered**:
1. **Server-side only (Puppeteer)** - Full control, but slow for iterative editing
2. **Client-side only (@react-pdf/renderer)** - Fast, but limited formatting
3. **Hybrid approach** - Best of both worlds

**Rationale**:
- Client-side for rapid iteration and live preview
- Server-side for professional output with complex formatting
- Markdown as intermediate format for LLM editability
- Use case determines which method

**Implementation**:
```
USE CASES:

1. Quick Edit & Preview (Client-side)
   User/LLM edits markdown → Live preview → Quick PDF export
   Tools: react-markdown, @react-pdf/renderer

2. Professional Output (Server-side)
   Final content → Server renders with letterhead/branding → Polished PDF
   Tools: Puppeteer, pdf-lib, or Gotenberg

3. Batch Processing (Server-side)
   Multiple appeals → Queue → Server generates → Download/Email
   Tools: Bull queue + Puppeteer
```

**When to Use Each**:
| Use Case | Method | Why |
|----------|--------|-----|
| Drafting/editing | Client | Instant feedback |
| LLM refinement | Client | No server roundtrip |
| Preview | Client | Real-time rendering |
| With letterhead | Server | Complex layout control |
| With signatures | Server | Security, positioning |
| Batch export | Server | Offload from client |
| Email attachment | Server | Generate on backend |

**Consequences**:
- (+) Instant editing with client-side preview
- (+) Professional output with server-side rendering
- (+) LLM agents can easily modify markdown content
- (+) Letterhead/branding support via server
- (+) Batch processing capability
- (-) Two codepaths to maintain
- (-) Server costs for complex PDFs
- (-) Need to sync styling between client/server

---

### DEC-016: Analytics Platform

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | TECH |
| **Status** | Accepted |

**Decision**: Use PostHog for product analytics.

**Context**: Need analytics to understand user behavior, feature usage, and conversion funnels.

**Alternatives Considered**:
1. **Mixpanel** - Powerful, but expensive at scale
2. **Plausible** - Privacy-focused, but limited features
3. **PostHog** - Open-source, self-hostable, feature-rich

**Rationale**:
- Open-source with generous free tier
- Can self-host for HIPAA compliance if needed
- Session recordings for UX debugging
- Feature flags built-in
- Funnels, retention, and cohort analysis
- No cookie banners needed (cookieless option)

**Consequences**:
- (+) Comprehensive analytics suite
- (+) Self-hosting option for compliance
- (+) Feature flags included (no separate tool)
- (+) Session replay for debugging
- (-) Self-hosting adds infrastructure complexity
- (-) Learning curve for advanced features

---

### DEC-017: Error Monitoring

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | TECH |
| **Status** | Accepted |

**Decision**: Use Sentry for error monitoring and performance tracking.

**Context**: Need visibility into production errors, crashes, and performance issues.

**Alternatives Considered**:
1. **LogRocket** - Good session replay, but expensive
2. **Custom logging** - Full control, but significant build effort
3. **Sentry** - Industry standard, comprehensive features

**Rationale**:
- Industry standard for error tracking
- Excellent Next.js integration
- Source maps support for readable stack traces
- Performance monitoring included
- Release tracking and deployment correlation
- Generous free tier

**Consequences**:
- (+) Quick setup with official Next.js SDK
- (+) Detailed error context and breadcrumbs
- (+) Performance monitoring included
- (+) Slack/Discord integrations
- (-) Can be noisy without proper filtering
- (-) PII scrubbing required for HIPAA

---

### DEC-018: Rate Limiting Implementation

| Field | Value |
|-------|-------|
| **Date** | December 2025 |
| **Category** | ARCH |
| **Status** | Accepted |

**Decision**: Use Redis for distributed rate limiting.

**Context**: Need rate limiting for API endpoints, especially appeal generation (tier-based limits).

**Alternatives Considered**:
1. **In-memory** - Simple, but doesn't work with multiple instances
2. **Database-based** - Persistent, but slow for high-frequency checks
3. **Redis** - Fast, distributed, purpose-built for this

**Rationale**:
- Works across multiple server instances (Vercel serverless)
- Sub-millisecond response times
- Built-in TTL for automatic cleanup
- Can use Upstash Redis for serverless-friendly hosting
- Sliding window algorithm support
- Also useful for session storage and caching

**Implementation**:
```typescript
// Using Upstash Redis + @upstash/ratelimit
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '1 d'), // 10 per day
})
```

**Consequences**:
- (+) Scales with serverless architecture
- (+) Accurate limits across all instances
- (+) Fast performance
- (+) Upstash has generous free tier
- (-) Additional service dependency
- (-) Network latency for each check (mitigated by Upstash edge)

---

### DEC-019: Email Verification Implementation

| Field | Value |
|-------|-------|
| **Date** | December 19, 2025 |
| **Category** | SEC |
| **Status** | Accepted |

**Decision**: Require email verification for all email/password signups using Better Auth's built-in verification flow with Resend.

**Context**: Need to ensure email addresses are valid and owned by users for account security and communication.

**Alternatives Considered**:
1. **No verification** - Simplest, but allows fake emails
2. **Optional verification** - User choice, but security risk
3. **Required verification** - Mandatory before account activation

**Rationale**:
- Prevents fake/spam accounts
- Ensures email communication reaches users
- Better Auth has built-in support
- Resend provides reliable email delivery
- Industry standard security practice

**Implementation Details**:
- `requireEmailVerification: true` in Better Auth config
- `autoSignInAfterVerification: true` for smooth UX
- Branded HTML email template with 10XR styling
- 24-hour link expiration
- Verification page at `/verify-email`

**Consequences**:
- (+) Higher quality user accounts
- (+) Valid email addresses for notifications
- (+) Reduced spam/bot registrations
- (-) Additional friction in signup flow
- (-) Dependent on email delivery (can check spam)

---

### DEC-020: MongoDB Connection Strategy for Build Time

| Field | Value |
|-------|-------|
| **Date** | December 19, 2025 |
| **Category** | ARCH |
| **Status** | Accepted |

**Decision**: Use lazy MongoDB connection with fallback for build-time safety.

**Context**: Better Auth requires database adapter at module initialization, but environment variables may not be available during Next.js build process.

**Alternatives Considered**:
1. **Fail at build** - Require env vars during build (blocks CI/CD)
2. **Mock adapter** - Use in-memory mock during build
3. **Lazy fallback** - Return dummy client when env not set

**Rationale**:
- Allows build to succeed without database credentials
- Runtime connections work normally when env vars are present
- Warning logged when MONGODB_URI is not set
- Safe because auth routes only execute at runtime

**Implementation**:
- `getMongoDbSync()` function checks for MONGODB_URI
- Returns dummy client if not set (with console warning)
- Real connection used at runtime when env vars available

**Consequences**:
- (+) Build succeeds in CI/CD without secrets
- (+) Development works without immediate DB setup
- (+) Clear warning when auth won't work
- (-) Potential confusion if env vars forgotten
- (-) Slight runtime overhead for connection check

---

### DEC-021: Provider-Agnostic LLM Client

| Field | Value |
|-------|-------|
| **Date** | December 19, 2025 |
| **Category** | TECH |
| **Status** | Accepted |

**Decision**: Build a provider-agnostic LLM client that supports any OpenAI-compatible API endpoint.

**Context**: User wanted to use a custom self-hosted model rather than being locked to OpenAI.

**Alternatives Considered**:
1. **OpenAI-only** - Simple, but vendor lock-in
2. **Multiple provider SDKs** - Flexible, but complex maintenance
3. **Provider-agnostic via OpenAI-compatible API** - Works with any compatible endpoint

**Rationale**:
- AI SDK's `createOpenAI` supports custom baseURL
- Most LLM providers offer OpenAI-compatible APIs (Ollama, vLLM, LM Studio, etc.)
- Single codebase supports all providers
- Configuration via environment variables (LLM_API_URL, LLM_API_KEY, LLM_MODEL)
- Can switch providers without code changes

**Implementation**:
- `lib/llm/client.ts` - Configurable LLM provider
- Default: OpenAI API, but customizable via env vars
- Exports: `getLLMModel()`, `isLLMConfigured()`

**Consequences**:
- (+) No vendor lock-in
- (+) Supports self-hosted models
- (+) Easy to switch providers
- (+) Single configuration point
- (-) Must ensure API compatibility
- (-) Some provider-specific features unavailable

---

### DEC-022: Streaming Implementation with AI SDK

| Field | Value |
|-------|-------|
| **Date** | December 19, 2025 |
| **Category** | TECH |
| **Status** | Accepted |

**Decision**: Use Vercel AI SDK's `streamText()` with `toTextStreamResponse()` for streaming LLM responses.

**Context**: Need real-time streaming for ChatGPT-like experience.

**Alternatives Considered**:
1. **Server-Sent Events (manual)** - Full control, but boilerplate
2. **WebSockets** - Bidirectional, but overkill for this use case
3. **AI SDK streamText** - Purpose-built, well-tested

**Rationale**:
- AI SDK handles streaming complexity
- Built-in support for abort signals
- `onFinish` callback for post-stream actions (save to DB)
- Works with standard fetch on client side
- Maintains compatibility with provider-agnostic approach

**Implementation**:
- Server: `streamText()` with `toTextStreamResponse()`
- Client: ReadableStream reader with TextDecoder
- Zustand store for streaming state management

**Consequences**:
- (+) Clean streaming implementation
- (+) Handles edge cases (abort, errors)
- (+) Easy to save messages after stream completes
- (-) Dependent on AI SDK version
- (-) Different stream formats between methods

---

### DEC-023: Anonymous User Session Management

| Field | Value |
|-------|-------|
| **Date** | December 19, 2025 |
| **Category** | ARCH |
| **Status** | Accepted |

**Decision**: Use localStorage session IDs for anonymous users to enable conversation persistence without login.

**Context**: Per feature tiers, anonymous users should be able to use the app with limited features (3 appeals/day, session-only history).

**Alternatives Considered**:
1. **No anonymous access** - Require login for everything
2. **Cookie-based sessions** - Server-controlled, but more complex
3. **localStorage session ID** - Client-controlled, simple

**Rationale**:
- Zero friction for first-time users
- Session ID generated on first visit (crypto.randomUUID)
- Persisted in localStorage for session continuity
- Conversations linked by sessionId when no userId
- Can be upgraded to userId after registration

**Implementation**:
- `lib/chat/session.ts` - Session ID management
- `components/providers/chat-provider.tsx` - Initialize session on mount
- API routes check userId first, fallback to sessionId

**Consequences**:
- (+) Zero-friction anonymous access
- (+) Conversation persistence within browser session
- (+) Easy upgrade path to registered account
- (-) Lost if localStorage cleared
- (-) Not portable across devices

---

### DEC-024: PII Masking Deferral

| Field | Value |
|-------|-------|
| **Date** | December 19, 2025 |
| **Category** | SEC |
| **Status** | Accepted |

**Decision**: Defer PII/PHI masking implementation to a later phase.

**Context**: User requested to defer PII masking to focus on core chat functionality first.

**Rationale**:
- Core chat functionality more critical for MVP
- Masking can be added as a layer later
- Users can manually redact sensitive information initially
- Allows faster iteration on UX

**Consequences**:
- (+) Faster time to usable MVP
- (+) Can iterate on chat UX without masking complexity
- (-) Security/compliance not addressed initially
- (-) Must implement before production use with real patient data

---

### DEC-025: File Upload with Uploadthing

| Field | Value |
|-------|-------|
| **Date** | December 19, 2025 |
| **Category** | TECH |
| **Status** | Accepted |

**Decision**: Use Uploadthing for document file uploads with authentication middleware.

**Context**: Need secure file upload infrastructure for policy documents (PDF, DOC, DOCX, TXT).

**Alternatives Considered**:
1. **AWS S3 Direct** - Full control, but complex setup and CORS configuration
2. **Cloudflare R2** - Cheaper, but requires more custom code
3. **Uploadthing** - Simple API, built-in auth middleware, good Next.js integration
4. **Vercel Blob** - Simple, but limited features

**Rationale**:
- Purpose-built for Next.js with excellent TypeScript support
- Built-in authentication middleware integrates with Better Auth
- Handles file validation, size limits, and type checking
- Automatic file organization and URL generation
- Generous free tier for development
- Simple API with `createUploadthing()` helper

**Implementation**:
- `lib/uploadthing/core.ts` - File router with auth middleware
- `app/api/uploadthing/route.ts` - API route handler
- `components/documents/upload-dialog.tsx` - Client-side upload UI
- Support for PDF (16MB), DOC, DOCX, TXT files
- Auth middleware validates user session before upload

**Consequences**:
- (+) Quick setup with minimal configuration
- (+) Built-in auth middleware for secure uploads
- (+) Handles all upload complexity (chunking, retry, progress)
- (+) Good integration with shadcn/ui components
- (-) Third-party dependency for file storage
- (-) Storage costs at scale

---

### DEC-026: Document Versioning Strategy

| Field | Value |
|-------|-------|
| **Date** | December 19, 2025 |
| **Category** | DATA |
| **Status** | Accepted |

**Decision**: Implement document versioning with "active version" flag per document.

**Context**: Payer policies change quarterly. Users need to track multiple versions and select which to use for appeals.

**Alternatives Considered**:
1. **Replace on upload** - Simple, but loses history
2. **Separate documents** - Track as independent docs, but complex to relate
3. **Version field + active flag** - Track versions, mark one as active

**Rationale**:
- `version` field tracks document version (e.g., "1.0", "2.1")
- `isActive` boolean indicates which version is used for appeals
- `setActiveVersion` API endpoint to switch active document
- Supports audit trail showing which policy version was cited
- Document list groups by name, shows version history

**Implementation**:
- `lib/types/document.ts` - DocumentItem with version, isActive fields
- `lib/documents/document-service.ts` - getDocumentVersions, setActiveVersion
- `components/documents/document-card.tsx` - Shows "Active" badge
- Only one document per provider can be active at a time

**Consequences**:
- (+) Full version history maintained
- (+) Easy to switch between versions
- (+) Supports compliance requirements
- (+) Clear audit trail for appeals
- (-) Storage grows with each version
- (-) UI must handle version selection clearly

---

### DEC-027: Dashboard Statistics Architecture

| Field | Value |
|-------|-------|
| **Date** | December 19, 2025 |
| **Category** | ARCH |
| **Status** | Accepted |

**Decision**: Aggregate dashboard statistics from multiple collections in a single API call.

**Context**: Dashboard needs to display stats from appeals, conversations, documents, and user data.

**Alternatives Considered**:
1. **Multiple API calls** - Separate endpoints for each stat type
2. **Single aggregation** - One endpoint fetches all stats
3. **Real-time subscriptions** - WebSocket updates for live data

**Rationale**:
- Single API call reduces latency and network requests
- Dashboard data doesn't need real-time updates (refresh button available)
- MongoDB aggregation pipeline handles complex queries efficiently
- Parallel Promise.all() for concurrent collection queries

**Implementation**:
- `getDashboardData()` calls: getDashboardStats, getUsageHistory, getRecentAppeals, getRecentConversations
- All queries run in parallel with Promise.all()
- Usage history uses MongoDB aggregation for monthly grouping

**Consequences**:
- (+) Single network request for all dashboard data
- (+) Fast parallel query execution
- (+) Consistent data snapshot
- (-) All-or-nothing failure (one query fails, entire request fails)
- (-) May fetch more data than needed for partial updates

---

### DEC-028: Premium Features Route Organization

| Field | Value |
|-------|-------|
| **Date** | December 19, 2025 |
| **Category** | ARCH |
| **Status** | Accepted |

**Decision**: Organize premium features into two route groups: (dashboard) for analytics/history and (settings) for configuration.

**Context**: Need clear organization for letterhead, dashboard, and history pages.

**Alternatives Considered**:
1. **Single route group** - All under /settings or /dashboard
2. **Feature-based** - /letterhead, /dashboard, /history as top-level routes
3. **Split groups** - (dashboard) for viewing, (settings) for configuration

**Rationale**:
- Logical separation: dashboards are for viewing data, settings are for configuration
- Each route group can have its own layout
- Navigation makes more sense with this split
- Protected by middleware (all require authentication)

**Implementation**:
- `app/(dashboard)/` - Dashboard home, history pages
- `app/(settings)/` - Documents, letterhead pages
- Each group has navigation header with quick links

**Consequences**:
- (+) Clear mental model for users
- (+) Separate layouts for different contexts
- (+) Easy to add more pages to each group
- (-) Users need to navigate between route groups
- (-) Two navigation patterns to maintain

---

## Pending Decisions

All pending decisions have been resolved.

---

## Superseded Decisions

List decisions that have been replaced:

| Original | Superseded By | Date |
|----------|---------------|------|
| - | - | - |
