# AppealGen AI - Implementation Plan

> **Purpose**: High-level implementation guide for AppealGen AI's ChatGPT-like conversational interface.

**Last Updated**: December 19, 2025
**Version**: 2.1 - Condensed

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Implementation Phases](#3-implementation-phases)
4. [Phase 1: Foundation](#4-phase-1-foundation---complete) - COMPLETE
5. [Phase 2: Chat Interface](#5-phase-2-chat-interface---complete) - COMPLETE
6. [Phase 3: Authentication](#6-phase-3-authentication---complete) - COMPLETE
7. [Phase 4: Document Management](#7-phase-4-document-management---complete) - COMPLETE
8. [Phase 5: Premium Features](#8-phase-5-premium-features---complete) - COMPLETE

---

## 1. Project Overview

### What We're Building

AppealGen AI is a **ChatGPT-like conversational interface** for generating medical denial appeals:
- **Conversational UX**: Chat-based interaction for generating appeals
- **Simple Onboarding**: Quick login (email, Google, or anonymous trial)
- **Iterative Refinement**: Users can refine appeals through conversation
- **Document Management**: Upload and manage payer policy documents
- **Customization**: Personalize letterhead, tone, and formatting

### Key Value Proposition

| Manual Process | With AppealGen |
|---------------|----------------|
| 45-60 minutes per appeal | ~60 seconds |
| 70% abandonment rate | 50%+ overturn rate |
| No policy citations | Precise policy citations |
| Generic templates | Payer-specific arguments |

### Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| Components | shadcn/ui + Radix UI |
| Auth | Better Auth |
| Database | MongoDB |
| Email | Resend |
| Real-time | Server-Sent Events |
| File Storage | S3/Cloudflare R2 |
| PII Masking | Custom + maskdata |

### Feature Tiers

| Feature | Anonymous | Free | Premium | Enterprise |
|---------|-----------|------|---------|------------|
| Generate appeals | 3/day | 10/month | Unlimited | Unlimited |
| Conversation history | Session only | 30 days | Forever | Forever |
| Upload custom docs | No | No | Yes | Yes |
| Custom letterhead | No | No | Yes | Yes |
| API access | No | No | No | Yes |

---

## 2. Architecture

### Directory Structure

```
app/
├── (auth)/                    # Auth pages (login, register, verify-email)
├── (chat)/                    # Main chat interface
│   ├── layout.tsx             # Sidebar + main area
│   ├── page.tsx               # New chat / welcome
│   └── c/[id]/page.tsx        # Conversation view
├── (settings)/                # User settings
│   ├── documents/             # Document management
│   └── letterhead/            # Letterhead config
└── api/
    ├── auth/[...all]/         # Better Auth routes
    ├── chat/                  # Chat/conversation API
    ├── documents/             # Document upload/manage
    └── providers/             # Provider management

components/
├── ui/                        # shadcn/ui components
├── chat/                      # Chat components
├── auth/                      # Auth components
├── documents/                 # Document components
└── settings/                  # Settings components

lib/
├── auth/                      # Authentication config
├── db/                        # MongoDB + models
├── chat/                      # Chat service
├── masking/                   # PII/PHI masking
├── rag/                       # RAG for documents
└── utils/                     # Utilities

hooks/                         # React hooks
types/                         # TypeScript types
```

### Data Models

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| users | User accounts | email, tier, customSettings |
| conversations | Chat threads | userId, title, provider |
| messages | Chat messages | conversationId, role, content |
| documents | Uploaded policies | userId, providerId, version |
| providers | Insurance providers | name, code, isDefault |

---

## 3. Implementation Phases

| Phase | Status | Focus |
|-------|--------|-------|
| 1 | COMPLETE | Foundation (dependencies, shadcn, MongoDB) |
| 2 | COMPLETE | Chat Interface (UI, streaming, conversations) |
| 3 | COMPLETE | Authentication (Better Auth, OAuth, email verification) |
| 4 | COMPLETE | Document Management (upload, process, version) |
| 5 | COMPLETE | Premium Features (letterhead, dashboard, history) |

---

## 4. Phase 1: Foundation - COMPLETE

### Completed Items

1. **Dependencies Installed**
   - mongodb, better-auth, ai, openai, @ai-sdk/openai
   - maskdata, react-hook-form, zustand, date-fns
   - lucide-react, uploadthing, pdf-parse, react-markdown

2. **shadcn/ui Components Added**
   - 22 components including button, input, textarea, card, dialog, etc.
   - Location: `components/ui/`

3. **MongoDB Setup**
   - Connection helper: `lib/db/mongodb.ts`
   - Seed script: `lib/db/seed.ts`
   - Collections: users, providers, appeals, conversations, messages

4. **Type Definitions**
   - Database types: `lib/types/database.ts`
   - Appeal types: `lib/types/appeal.ts`
   - Chat types: `lib/types/chat.ts`

5. **Environment Configuration**
   - Updated: `env.mjs`
   - Created: `.env.example`

---

## 5. Phase 2: Chat Interface - COMPLETE

### Completed Items

1. **Chat Components (8 total)**
   - `chat-layout.tsx` - Main layout with desktop sidebar + mobile Sheet
   - `chat-sidebar.tsx` - Left sidebar with new chat button
   - `conversation-list.tsx` - History list with rename/delete
   - `chat-container.tsx` - Message area wrapper
   - `chat-messages.tsx` - Scrollable message list with auto-scroll
   - `chat-message.tsx` - Single message bubble with copy button
   - `chat-input.tsx` - Auto-resize textarea + send/stop buttons
   - `welcome-screen.tsx` - New chat welcome with suggestion cards

2. **API Routes**
   - `GET/POST /api/chat` - List/create conversations
   - `GET/PATCH/DELETE /api/chat/[id]` - Single conversation CRUD
   - `POST /api/chat/stream` - Streaming AI responses

3. **Services**
   - `lib/chat/chat-service.ts` - MongoDB operations for conversations/messages
   - `lib/chat/session.ts` - Session ID management for anonymous users
   - `lib/llm/client.ts` - Provider-agnostic LLM client (OpenAI-compatible)
   - `lib/llm/prompts.ts` - System prompts for appeal generation

4. **Hooks**
   - `hooks/use-chat.ts` - Chat state, streaming, message sending
   - `hooks/use-conversations.ts` - Conversation list CRUD

5. **State Management**
   - `lib/stores/chat-store.ts` - Zustand store for chat state
   - `components/providers/chat-provider.tsx` - Session initialization

6. **Pages**
   - `app/(chat)/layout.tsx` - Route group layout
   - `app/(chat)/page.tsx` - New chat (welcome screen)
   - `app/(chat)/c/[id]/page.tsx` - Existing conversation
   - `app/page.tsx` - Redirects to /chat

### Required Environment Variables

```
LLM_API_URL=https://api.openai.com/v1 (or custom endpoint)
LLM_API_KEY=your-api-key
LLM_MODEL=gpt-4o (or custom model)
```

### PII Masking (Deferred)

> **Note**: PII masking deferred to later phase per user decision.

---

## 6. Phase 3: Authentication - COMPLETE

### Completed Items

1. **Better Auth Server Configuration**
   - Location: `lib/auth/auth.ts`
   - MongoDB adapter with build-time safe fallback
   - Email/password with verification required
   - Google OAuth integration
   - Session management (7-day expiry, 24h refresh)
   - Rate limiting (10 requests per 60 seconds)

2. **Better Auth Client**
   - Location: `lib/auth/client.ts`
   - Exports: signIn, signUp, signOut, useSession

3. **Auth API Route**
   - Location: `app/api/auth/[...all]/route.ts`
   - Handles all Better Auth endpoints

4. **Auth Pages**
   - Login: `app/(auth)/login/page.tsx`
   - Register: `app/(auth)/register/page.tsx`
   - Verify Email: `app/(auth)/verify-email/page.tsx`
   - Layout: `app/(auth)/layout.tsx`

5. **Auth Components**
   - Login form: `components/auth/login-form.tsx`
   - Register form: `components/auth/register-form.tsx`
   - OAuth buttons: `components/auth/oauth-buttons.tsx`
   - Auth provider: `components/providers/auth-provider.tsx`

6. **Email Verification**
   - Provider: Resend
   - Branded HTML email template with 10XR styling
   - Auto sign-in after verification

7. **Route Protection**
   - Middleware: `middleware.ts`
   - Protected routes: /dashboard, /settings, /documents, /history

### Required Environment Variables

```
MONGODB_URI=mongodb+srv://...
BETTER_AUTH_SECRET=your-32-char-secret
BETTER_AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
RESEND_API_KEY=your-resend-api-key
EMAIL_FROM=noreply@yourdomain.com
```

---

## 7. Phase 4: Document Management - COMPLETE

### Completed Items

1. **Document Types**
   - `lib/types/document.ts` - Frontend document types (DocumentItem, DocumentListItem)
   - `lib/types/database.ts` - Updated Document interface with fileKey, fileType, fileSize

2. **Document Service**
   - `lib/documents/document-service.ts` - MongoDB CRUD operations
   - Functions: createDocument, getDocumentList, getDocument, updateDocumentStatus, updateDocument, deleteDocument, getDocumentVersions, setActiveVersion
   - `lib/documents/index.ts` - Barrel export

3. **File Upload Infrastructure**
   - `lib/uploadthing/core.ts` - File router with auth middleware
   - `app/api/uploadthing/route.ts` - Uploadthing API handler
   - Support for PDF (16MB), DOC, DOCX, TXT files
   - Auth middleware validates user session before upload

4. **API Routes**
   - `GET/POST /api/documents` - List/create documents
   - `GET/PATCH/DELETE /api/documents/[id]` - Single document CRUD

5. **UI Components (4 total)**
   - `document-card.tsx` - Card with status badges, dropdown menu, delete dialog
   - `document-list.tsx` - Grid layout with loading/empty states
   - `upload-dialog.tsx` - Upload modal with react-dropzone
   - `components/documents/index.ts` - Barrel export

6. **Hooks**
   - `hooks/use-documents.ts` - Document CRUD, loading states, error handling

7. **Pages**
   - `app/(settings)/documents/page.tsx` - Document management page
   - `app/(settings)/layout.tsx` - Settings route group layout

### Required Environment Variables

```
UPLOADTHING_TOKEN=your-uploadthing-token
```

### RAG Pipeline (Deferred)

> **Note**: RAG pipeline (embeddings, vector store, retriever) deferred to later enhancement phase.

| Component | Location | Purpose |
|-----------|----------|---------|
| embeddings | `lib/rag/` | Generate embeddings |
| vector-store | `lib/rag/` | Pinecone/Chroma client |
| retriever | `lib/rag/` | Retrieve relevant docs |

---

## 8. Phase 5: Premium Features - COMPLETE

### Completed Items

1. **Letterhead Types & Service**
   - `lib/types/letterhead.ts` - Frontend letterhead types
   - `lib/types/dashboard.ts` - Dashboard and appeal history types
   - `lib/letterhead/letterhead-service.ts` - MongoDB CRUD for letterhead
   - `lib/dashboard/dashboard-service.ts` - Stats aggregation, appeal history

2. **API Routes**
   - `GET/PUT/DELETE /api/letterhead` - Letterhead settings CRUD
   - `POST/DELETE /api/letterhead/logo` - Logo upload/remove
   - `GET /api/dashboard` - Dashboard stats and recent activity
   - `GET /api/appeals` - Paginated appeal history
   - `GET/PATCH /api/appeals/[id]` - Single appeal operations

3. **Hooks**
   - `hooks/use-letterhead.ts` - Letterhead CRUD with logo upload
   - `hooks/use-dashboard.ts` - Dashboard data fetching
   - `hooks/use-appeals.ts` - Paginated appeal history with filters

4. **Letterhead Components**
   - `letterhead-form.tsx` - Organization details form
   - `logo-upload.tsx` - Drag-and-drop logo upload
   - `letterhead-preview.tsx` - Live letterhead preview

5. **Dashboard Components**
   - `stats-cards.tsx` - Stats overview cards
   - `recent-appeals.tsx` - Recent appeals list
   - `recent-conversations.tsx` - Recent conversations list
   - `usage-chart.tsx` - Monthly usage bar chart

6. **History Components**
   - `appeal-filters.tsx` - Search and status filters
   - `appeal-table.tsx` - Paginated table with actions

7. **Pages**
   - `app/(dashboard)/layout.tsx` - Dashboard route group layout
   - `app/(dashboard)/dashboard/page.tsx` - Main dashboard
   - `app/(dashboard)/history/page.tsx` - Appeal history list
   - `app/(dashboard)/history/[id]/page.tsx` - Appeal detail view
   - `app/(settings)/letterhead/page.tsx` - Letterhead settings

### Enterprise Features (Future)

| Item | Description |
|------|-------------|
| Team management | Invite, roles, permissions |
| Shared documents | Team-level policy docs |
| API access | REST API with key management |

---

## Related Documents

- [Progress Tracker](./PROGRESS_TRACKER.md) - Detailed implementation status
- [Decision Log](./DECISION_LOG.md) - Architectural decisions
- [Brand Guidelines](../brand/brand.md) - 10XR branding

---

## Notes

- See PROGRESS_TRACKER.md for detailed status of each component
- See DECISION_LOG.md for rationale behind technical choices
- No timelines - using AI-accelerated development with Claude/Cursor
