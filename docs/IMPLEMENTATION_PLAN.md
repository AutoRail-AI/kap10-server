# AppealGen AI - Implementation Plan

> **Purpose**: Step-by-step guide for implementing AppealGen AI's ChatGPT-like conversational interface. Designed to be followed by AI assistants (Claude, Cursor) or human developers.

**Last Updated**: December 2025
**Version**: 2.0 - Conversational Interface

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Design Philosophy](#2-design-philosophy)
3. [Current State](#3-current-state)
4. [Target Architecture](#4-target-architecture)
5. [Implementation Phases](#5-implementation-phases)
6. [Phase 1: Foundation](#6-phase-1-foundation)
7. [Phase 2: Chat Interface](#7-phase-2-chat-interface)
8. [Phase 3: Authentication & Onboarding](#8-phase-3-authentication--onboarding)
9. [Phase 4: Provider & Document Management](#9-phase-4-provider--document-management)
10. [Phase 5: Premium Features](#10-phase-5-premium-features)
11. [Testing Strategy](#11-testing-strategy)
12. [Deployment](#12-deployment)

---

## 1. Project Overview

### What We're Building

AppealGen AI is a **ChatGPT-like conversational interface** for generating medical denial appeals:
- **Conversational UX**: Chat-based interaction for generating appeals
- **Simple Onboarding**: Quick login (email, Google, or anonymous trial)
- **Iterative Refinement**: Users can refine appeals through conversation
- **Document Management**: Upload and manage payer policy documents
- **Customization**: Personalize letterhead, tone, and formatting
- **Version Control**: Track changes to provider documentation over time

### Key User Experience (Like ChatGPT)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ┌──────────┐                                                       │
│  │ + New    │  AppealGen AI                          [User Avatar]  │
│  │  Chat    │                                                       │
│  ├──────────┤  ┌─────────────────────────────────────────────────┐  │
│  │          │  │                                                 │  │
│  │ Today    │  │  👋 Welcome! I'll help you generate a medical   │  │
│  │ ├─ UHC   │  │  denial appeal. Just paste your denial letter   │  │
│  │ │  CO-50 │  │  and clinical notes, and I'll create a          │  │
│  │ └─ Aetna │  │  citation-backed appeal for you.                │  │
│  │                                                               │  │
│  │ Yesterday│  │  💡 You can also:                               │  │
│  │ ├─ Cigna │  │  • Upload provider policy documents             │  │
│  │ └─ ...   │  │  • Customize your letterhead                    │  │
│  │          │  │  • Adjust tone and formatting                   │  │
│  │          │  │                                                 │  │
│  │ Settings │  └─────────────────────────────────────────────────┘  │
│  │ Docs     │                                                       │
│  │ Help     │  ┌─────────────────────────────────────────────────┐  │
│  └──────────┘  │ Paste denial info or type a message...    [📎]  │  │
│                └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Value Proposition

| Manual Process | With AppealGen |
|---------------|----------------|
| 45-60 minutes per appeal | ~60 seconds |
| 70% abandonment rate | 50%+ overturn rate |
| No policy citations | Precise policy citations |
| Generic templates | Payer-specific arguments |
| Static knowledge | Updatable provider docs |

### Tech Stack Summary

| Layer | Technology | Why |
|-------|------------|-----|
| Framework | Next.js 16 (App Router) | SSR, streaming, React 19 |
| Language | TypeScript (strict) | Type safety, better DX |
| Styling | Tailwind CSS v4 | Already configured |
| Components | shadcn/ui + Radix UI | Accessible, customizable |
| Auth | Better Auth | Simple, OAuth support, MongoDB |
| Database | MongoDB | Document structure, conversations |
| Real-time | Server-Sent Events | Streaming responses |
| File Storage | S3/Cloudflare R2 | Document uploads |
| Vector DB | Pinecone/Chroma | RAG for policy docs |
| PII Masking | Custom + maskdata | Healthcare compliance |
| Testing | Vitest + Playwright | Already configured |

---

## 2. Design Philosophy

### ChatGPT-Inspired Principles

1. **Conversation-First**: Everything happens through natural conversation
2. **Progressive Disclosure**: Start simple, reveal complexity as needed
3. **Instant Value**: Users can generate appeals without account creation
4. **Iterative Refinement**: "Make it more formal", "Add more citations"
5. **Context Awareness**: AI remembers conversation history
6. **Easy Customization**: Settings accessible but not required

### User Journey

```
Anonymous User                    Registered User
     │                                  │
     ▼                                  ▼
┌──────────────┐                 ┌──────────────┐
│ Land on site │                 │    Login     │
│ (no signup)  │                 │ (1-click)    │
└──────┬───────┘                 └──────┬───────┘
       │                                │
       ▼                                ▼
┌──────────────┐                 ┌──────────────┐
│  Start chat  │                 │ See history  │
│  Generate    │                 │ Continue     │
│  appeal      │                 │ chats        │
└──────┬───────┘                 └──────┬───────┘
       │                                │
       ▼                                ▼
┌──────────────┐                 ┌──────────────┐
│ Prompt to    │                 │ Manage docs  │
│ save/signup  │                 │ Customize    │
└──────────────┘                 │ settings     │
                                 └──────────────┘
```

### Feature Tiers

| Feature | Anonymous | Free | Premium | Enterprise |
|---------|-----------|------|---------|------------|
| Generate appeals | 3/day | 10/month | Unlimited | Unlimited |
| Conversation history | Session only | 30 days | Forever | Forever |
| Default providers | ✅ | ✅ | ✅ | ✅ |
| Upload custom docs | ❌ | ❌ | ✅ | ✅ |
| Custom letterhead | ❌ | ❌ | ✅ | ✅ |
| API access | ❌ | ❌ | ❌ | ✅ |
| Team sharing | ❌ | ❌ | ❌ | ✅ |

---

## 3. Current State

### What Already Exists

```
appealgen-ai/
├── app/
│   ├── layout.tsx          # Root layout (exists)
│   ├── page.tsx            # Home page (exists)
│   └── api/health/route.ts # Health check (exists)
├── components/
│   ├── Button/             # Button component (exists)
│   └── Tooltip/            # Tooltip component (exists)
├── styles/
│   └── tailwind.css        # Global styles (exists)
├── brand/                  # Brand guidelines (exists)
├── public/
│   ├── logos/              # Logo assets (exists)
│   └── icons/              # Icon assets (exists)
├── e2e/                    # Playwright tests (exists)
├── .storybook/             # Storybook config (exists)
└── [config files]          # All configured
```

### What Needs to Be Built (Chat Interface)

```
appealgen-ai/
├── app/
│   ├── (auth)/             # Auth pages (simple)
│   │   ├── login/
│   │   └── register/
│   ├── (chat)/             # Main chat interface
│   │   ├── layout.tsx      # Chat layout with sidebar
│   │   ├── page.tsx        # New chat / home
│   │   └── c/[id]/page.tsx # Specific conversation
│   ├── (settings)/         # User settings
│   │   ├── settings/
│   │   ├── documents/      # Provider doc management
│   │   └── letterhead/
│   └── api/
│       ├── auth/           # Better Auth routes
│       ├── chat/           # Chat/conversation API
│       │   ├── route.ts    # Create conversation
│       │   ├── [id]/       # Conversation operations
│       │   └── stream/     # SSE streaming
│       ├── documents/      # Document upload/manage
│       └── providers/      # Provider management
├── components/
│   ├── ui/                 # shadcn components
│   ├── chat/               # Chat components
│   │   ├── chat-container.tsx
│   │   ├── chat-input.tsx
│   │   ├── chat-message.tsx
│   │   ├── chat-sidebar.tsx
│   │   ├── conversation-list.tsx
│   │   └── streaming-message.tsx
│   ├── documents/          # Document management
│   └── settings/           # Settings components
├── lib/
│   ├── auth/               # Authentication
│   ├── db/                 # MongoDB + models
│   ├── chat/               # Chat service
│   ├── masking/            # PII/PHI masking
│   ├── rag/                # RAG for documents
│   └── streaming/          # SSE utilities
├── hooks/
│   ├── use-chat.ts         # Chat state management
│   ├── use-conversation.ts
│   ├── use-streaming.ts
│   └── use-documents.ts
└── types/
    ├── chat.ts             # Chat/conversation types
    ├── document.ts         # Document types
    └── ...
```

---

## 4. Target Architecture

### System Architecture (ChatGPT-Style)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT (Next.js)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐  ┌─────────────────────────────────────────────┐  │
│  │   Sidebar    │  │              Chat Container                 │  │
│  │              │  │  ┌───────────────────────────────────────┐  │  │
│  │ + New Chat   │  │  │         Message History               │  │  │
│  │              │  │  │  [User]: Paste denial...              │  │  │
│  │ Conversations│  │  │  [AI]: I'll analyze this...           │  │  │
│  │ ├─ Today     │  │  │  [AI]: Here's your appeal: ...        │  │  │
│  │ │  └─ UHC    │  │  │                                       │  │  │
│  │ └─ Yesterday │  │  └───────────────────────────────────────┘  │  │
│  │              │  │  ┌───────────────────────────────────────┐  │  │
│  │ ─────────────│  │  │  Chat Input + Actions                 │  │  │
│  │ Documents    │  │  │  [Type message...] [📎] [⚙️] [Send]   │  │  │
│  │ Settings     │  │  └───────────────────────────────────────┘  │  │
│  └──────────────┘  └─────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          API LAYER                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  /api/chat/stream     ──► SSE streaming responses                   │
│  /api/chat/[id]       ──► Conversation CRUD                         │
│  /api/documents       ──► Upload/manage policy docs                 │
│  /api/auth/*          ──► Better Auth (login, register, OAuth)      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        SERVICE LAYER                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │ Chat Service│  │ RAG Service │  │Masking Svc  │  │ Doc Svc   │  │
│  │             │  │             │  │             │  │           │  │
│  │ - Messages  │  │ - Embed     │  │ - PII/PHI   │  │ - Upload  │  │
│  │ - Context   │  │ - Search    │  │ - Validate  │  │ - Parse   │  │
│  │ - Stream    │  │ - Retrieve  │  │ - Mask      │  │ - Index   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA LAYER                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  MongoDB                          │  Vector DB (Pinecone/Chroma)    │
│  ┌─────────────────────────────┐  │  ┌─────────────────────────┐   │
│  │ users                       │  │  │ policy_embeddings       │   │
│  │ conversations               │  │  │ - provider_id           │   │
│  │ messages                    │  │  │ - chunk_text            │   │
│  │ documents (metadata)        │  │  │ - embedding             │   │
│  │ providers                   │  │  │ - metadata              │   │
│  └─────────────────────────────┘  │  └─────────────────────────┘   │
│                                   │                                 │
│  File Storage (S3/R2)             │  LLM Backend                    │
│  ┌─────────────────────────────┐  │  ┌─────────────────────────┐   │
│  │ /documents/{user}/{file}    │  │  │ OpenAI / Claude API     │   │
│  │ - Original PDFs             │  │  │ - Appeal generation     │   │
│  │ - Processed text            │  │  │ - Policy matching       │   │
│  └─────────────────────────────┘  │  └─────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Models

```typescript
// Conversation - A chat thread
interface Conversation {
  _id: ObjectId
  userId?: ObjectId           // null for anonymous
  sessionId: string           // For anonymous users
  title: string               // Auto-generated from first message
  provider?: ObjectId         // Detected/selected provider
  status: 'active' | 'archived'
  createdAt: Date
  updatedAt: Date
  expiresAt?: Date            // TTL for anonymous/free users
}

// Message - Individual messages in conversation
interface Message {
  _id: ObjectId
  conversationId: ObjectId
  role: 'user' | 'assistant' | 'system'
  content: string
  metadata?: {
    masked?: boolean          // Was PII masked?
    maskingStats?: object     // Masking details
    appealGenerated?: boolean // Was this an appeal?
    citations?: string[]      // Policy citations used
    attachments?: string[]    // File references
  }
  createdAt: Date
}

// Document - Uploaded policy documents
interface Document {
  _id: ObjectId
  userId: ObjectId
  providerId: ObjectId
  name: string
  version: string             // e.g., "2025-Q1"
  fileUrl: string             // S3/R2 URL
  status: 'processing' | 'ready' | 'error'
  metadata: {
    pageCount: number
    uploadedAt: Date
    processedAt?: Date
    chunkCount?: number       // Number of vector chunks
  }
  isActive: boolean           // Current version?
  createdAt: Date
  updatedAt: Date
}

// Provider - Insurance provider info
interface Provider {
  _id: ObjectId
  name: string
  code: string                // UHC, AETNA, etc.
  isDefault: boolean          // System-provided
  userId?: ObjectId           // null for system providers
  documentIds: ObjectId[]     // Associated policy docs
  createdAt: Date
  updatedAt: Date
}
```

### Directory Structure (Final)

```
appealgen-ai/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   ├── register/page.tsx
│   │   └── layout.tsx
│   ├── (chat)/
│   │   ├── layout.tsx            # Sidebar + main area
│   │   ├── page.tsx              # New chat / welcome
│   │   └── c/
│   │       └── [id]/page.tsx     # Conversation view
│   ├── (settings)/
│   │   ├── layout.tsx
│   │   ├── settings/page.tsx     # User settings
│   │   ├── documents/
│   │   │   ├── page.tsx          # Document list
│   │   │   └── upload/page.tsx   # Upload new doc
│   │   └── letterhead/page.tsx   # Letterhead config
│   ├── api/
│   │   ├── auth/[...all]/route.ts
│   │   ├── chat/
│   │   │   ├── route.ts          # POST create conversation
│   │   │   ├── [id]/
│   │   │   │   ├── route.ts      # GET, DELETE conversation
│   │   │   │   └── messages/route.ts  # GET, POST messages
│   │   │   └── stream/route.ts   # POST - SSE streaming
│   │   ├── documents/
│   │   │   ├── route.ts          # GET list, POST upload
│   │   │   └── [id]/route.ts     # GET, DELETE document
│   │   ├── providers/route.ts
│   │   └── health/route.ts
│   ├── layout.tsx
│   ├── page.tsx                  # Redirect to /chat or login
│   └── globals.css
├── components/
│   ├── ui/                       # shadcn/ui components
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── textarea.tsx
│   │   ├── scroll-area.tsx
│   │   ├── avatar.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── dialog.tsx
│   │   ├── sheet.tsx             # Mobile sidebar
│   │   ├── skeleton.tsx
│   │   ├── toast.tsx
│   │   └── ...
│   ├── chat/
│   │   ├── chat-layout.tsx       # Main chat layout
│   │   ├── chat-sidebar.tsx      # Left sidebar
│   │   ├── conversation-list.tsx # List of conversations
│   │   ├── chat-container.tsx    # Message area + input
│   │   ├── chat-messages.tsx     # Message list
│   │   ├── chat-message.tsx      # Single message bubble
│   │   ├── chat-input.tsx        # Input with actions
│   │   ├── streaming-text.tsx    # Streaming response
│   │   ├── welcome-screen.tsx    # New chat welcome
│   │   ├── provider-badge.tsx    # Show detected provider
│   │   └── masking-notice.tsx    # PII masking indicator
│   ├── documents/
│   │   ├── document-list.tsx
│   │   ├── document-card.tsx
│   │   ├── upload-dialog.tsx
│   │   └── version-selector.tsx
│   ├── settings/
│   │   ├── settings-nav.tsx
│   │   ├── profile-form.tsx
│   │   └── letterhead-editor.tsx
│   ├── auth/
│   │   ├── login-form.tsx
│   │   ├── register-form.tsx
│   │   └── oauth-buttons.tsx
│   └── shared/
│       ├── logo.tsx
│       ├── user-menu.tsx
│       ├── loading.tsx
│       └── error-boundary.tsx
├── lib/
│   ├── auth/
│   │   ├── auth.ts               # Better Auth config
│   │   └── client.ts             # Client-side auth
│   ├── db/
│   │   ├── mongodb.ts            # Connection
│   │   └── collections.ts        # Collection helpers
│   ├── chat/
│   │   ├── chat-service.ts       # Chat logic
│   │   ├── context-builder.ts    # Build LLM context
│   │   └── stream-handler.ts     # SSE handling
│   ├── masking/
│   │   ├── masking-service.ts
│   │   └── patterns.ts
│   ├── rag/
│   │   ├── embeddings.ts         # Generate embeddings
│   │   ├── vector-store.ts       # Pinecone/Chroma client
│   │   └── retriever.ts          # Retrieve relevant docs
│   ├── documents/
│   │   ├── document-service.ts   # Upload, process
│   │   ├── pdf-parser.ts         # Extract text from PDF
│   │   └── chunker.ts            # Split into chunks
│   ├── llm/
│   │   ├── client.ts             # LLM API client
│   │   ├── prompts.ts            # System prompts
│   │   └── appeal-generator.ts   # Appeal generation logic
│   └── utils/
│       ├── cn.ts
│       ├── constants.ts
│       └── format.ts
├── hooks/
│   ├── use-chat.ts               # Chat state
│   ├── use-conversations.ts      # Conversation list
│   ├── use-streaming.ts          # SSE hook
│   ├── use-documents.ts          # Document management
│   └── use-auth.ts               # Auth state
├── types/
│   ├── chat.ts
│   ├── document.ts
│   ├── provider.ts
│   └── database.ts
├── middleware.ts
└── [config files]
```

---

## 5. Implementation Phases

### Phase Overview

| Phase | Focus | Deliverables |
|-------|-------|--------------|
| 1 | Foundation | Dependencies, shadcn, MongoDB, basic structure |
| 2 | Chat Interface | Chat UI, streaming, conversation management |
| 3 | Auth & Onboarding | Simple login, OAuth, anonymous usage |
| 4 | Document Management | Upload, process, version provider docs |
| 5 | Premium Features | Letterhead, advanced customization, teams |

### Implementation Priority

```
HIGH PRIORITY (MVP)
├── Chat Interface              ← Core UX (like ChatGPT)
├── Streaming Responses         ← Real-time feedback
├── PII/PHI Masking             ← Healthcare compliance
├── Conversation History        ← User retention
└── Anonymous Usage             ← Low friction onboarding

MEDIUM PRIORITY (Growth)
├── Document Upload             ← Custom provider policies
├── OAuth Login                 ← Easy onboarding
├── Custom Letterhead           ← Premium feature
├── Analytics Dashboard         ← User insights
└── Provider Request System     ← Expansion

LOW PRIORITY (Enterprise)
├── Team Collaboration          ← Enterprise sales
├── API Access                  ← Integration
├── White Label                 ← Enterprise customization
└── Advanced Analytics          ← Data insights
```

---

## 6. Phase 1: Foundation

> **Goal**: Set up project infrastructure, database, UI components, and chat-ready structure

### Step 1.1: Install Dependencies

**File to modify**: `package.json`

```bash
# Run these commands in order:

# 1. Database
pnpm add mongodb

# 2. Authentication
pnpm add better-auth

# 3. AI/LLM Integration (for streaming)
pnpm add ai openai @ai-sdk/openai

# 4. PII/PHI masking
pnpm add maskdata

# 5. Form handling
pnpm add react-hook-form @hookform/resolvers

# 6. State management
pnpm add zustand

# 7. Date utilities
pnpm add date-fns

# 8. Icons
pnpm add lucide-react

# 9. File upload (for documents)
pnpm add uploadthing @uploadthing/react

# 10. PDF parsing (for policy documents)
pnpm add pdf-parse

# 11. Markdown rendering (for chat messages)
pnpm add react-markdown remark-gfm
```

**Decision Point**: Log in [DECISION_LOG.md](./DECISION_LOG.md) - Section: Dependencies

---

### Step 1.2: Initialize shadcn/ui

```bash
# Initialize shadcn/ui
pnpm dlx shadcn@latest init

# When prompted, select:
# - Style: Default
# - Base color: Slate (or match brand - Blue)
# - CSS variables: Yes
# - tailwind.config location: (default)
# - components location: components/ui
# - utils location: lib/utils
```

**Add required components for chat interface**:

```bash
# Core UI components
pnpm dlx shadcn@latest add button
pnpm dlx shadcn@latest add input
pnpm dlx shadcn@latest add textarea

# Chat-specific components
pnpm dlx shadcn@latest add scroll-area      # For chat message scrolling
pnpm dlx shadcn@latest add avatar           # User/AI avatars
pnpm dlx shadcn@latest add sheet            # Mobile sidebar
pnpm dlx shadcn@latest add skeleton         # Loading states

# Navigation & Layout
pnpm dlx shadcn@latest add dropdown-menu    # User menu
pnpm dlx shadcn@latest add dialog           # Modals
pnpm dlx shadcn@latest add separator        # Dividers
pnpm dlx shadcn@latest add tooltip          # Hints

# Feedback
pnpm dlx shadcn@latest add toast            # Notifications
pnpm dlx shadcn@latest add alert            # Warnings

# Forms (settings, upload)
pnpm dlx shadcn@latest add form
pnpm dlx shadcn@latest add label
pnpm dlx shadcn@latest add select
pnpm dlx shadcn@latest add card
pnpm dlx shadcn@latest add badge
pnpm dlx shadcn@latest add progress         # Upload progress
```

**Track in**: [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md) - Phase 1

---

### Step 1.3: Create Lib Directory Structure

**Create these files in order**:

#### 1.3.1: Utility Functions

**File**: `lib/utils/cn.ts`
```typescript
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

#### 1.3.2: Constants

**File**: `lib/utils/constants.ts`
```typescript
export const APP_NAME = "AppealGen AI"
export const APP_DESCRIPTION = "AI-Powered Medical Denial Appeal Generator"

export const TIERS = {
  FREE: "free",
  PREMIUM: "premium",
  ENTERPRISE: "enterprise",
} as const

export const TIER_LIMITS = {
  [TIERS.FREE]: {
    appealsPerMonth: 5,
    historyDays: 0,
    customLetterhead: false,
    customProviders: false,
  },
  [TIERS.PREMIUM]: {
    appealsPerMonth: 50,
    historyDays: 180,
    customLetterhead: true,
    customProviders: true,
  },
  [TIERS.ENTERPRISE]: {
    appealsPerMonth: Infinity,
    historyDays: Infinity,
    customLetterhead: true,
    customProviders: true,
  },
} as const

export const DEFAULT_PROVIDERS = [
  { code: "UHC", name: "UnitedHealthcare" },
  { code: "ANTHEM", name: "Anthem Blue Cross" },
  { code: "AETNA", name: "Aetna" },
  { code: "CIGNA", name: "Cigna" },
  { code: "HUMANA", name: "Humana" },
] as const

export const DENIAL_TYPES = {
  CO_50: { code: "CO-50", name: "Medical Necessity", phase: 1 },
  CO_11: { code: "CO-11", name: "Diagnosis Mismatch", phase: 2 },
  CO_197: { code: "CO-197", name: "Prior Authorization", phase: 2 },
  CO_97: { code: "CO-97", name: "Bundled Services", phase: 2 },
  CO_96: { code: "CO-96", name: "Non-Covered", phase: 3 },
} as const
```

---

### Step 1.4: Setup MongoDB Connection

#### 1.4.1: Environment Variables

**File**: `.env.local` (create this file, DO NOT commit)
```bash
# Database
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/appealgen?retryWrites=true&w=majority

# Better Auth
BETTER_AUTH_SECRET=your-secret-key-min-32-chars
BETTER_AUTH_URL=http://localhost:3000

# LLM Backend (placeholder for now)
LLM_API_URL=http://localhost:8000
LLM_API_KEY=your-llm-api-key
```

**File**: `.env.example` (commit this as reference)
```bash
# Database
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/appealgen

# Better Auth
BETTER_AUTH_SECRET=
BETTER_AUTH_URL=http://localhost:3000

# LLM Backend
LLM_API_URL=
LLM_API_KEY=
```

#### 1.4.2: Update env.mjs

**File**: `env.mjs` (update existing)
```typescript
import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  server: {
    ANALYZE: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    MONGODB_URI: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    LLM_API_URL: z.string().url().optional(),
    LLM_API_KEY: z.string().optional(),
  },
  client: {
    // Public env vars go here
  },
  runtimeEnv: {
    ANALYZE: process.env.ANALYZE,
    MONGODB_URI: process.env.MONGODB_URI,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    LLM_API_URL: process.env.LLM_API_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
  },
})
```

#### 1.4.3: MongoDB Client

**File**: `lib/db/mongodb.ts`
```typescript
import { MongoClient, Db } from "mongodb"
import { env } from "@/env.mjs"

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined
}

let client: MongoClient
let clientPromise: Promise<MongoClient>

if (process.env.NODE_ENV === "development") {
  // In development, use a global variable to preserve connection across hot reloads
  if (!global._mongoClientPromise) {
    client = new MongoClient(env.MONGODB_URI)
    global._mongoClientPromise = client.connect()
  }
  clientPromise = global._mongoClientPromise
} else {
  // In production, don't use a global variable
  client = new MongoClient(env.MONGODB_URI)
  clientPromise = client.connect()
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise
  return client.db("appealgen")
}

export async function getCollection<T>(name: string) {
  const db = await getDb()
  return db.collection<T>(name)
}

export default clientPromise
```

---

### Step 1.5: Create Type Definitions

**File**: `types/database.ts`
```typescript
import { ObjectId } from "mongodb"

// User Types
export interface User {
  _id: ObjectId
  email: string
  name: string
  emailVerified: boolean
  tier: "free" | "premium" | "enterprise"
  createdAt: Date
  updatedAt: Date
  customSettings?: {
    letterhead?: Letterhead
    defaultProviders?: string[]
  }
  usage: {
    appealsGenerated: number
    lastAppealDate?: Date
    monthlyCount: number
    resetDate: Date
  }
}

export interface Letterhead {
  logo?: string
  organizationName: string
  address?: string
  phone?: string
  email?: string
  fax?: string
}

// Provider Types
export interface Provider {
  _id: ObjectId
  name: string
  code: string
  category: "insurance" | "medicare" | "medicaid" | "other"
  isActive: boolean
  isDefault: boolean
  requirements: {
    appealDeadlineDays: number
    requiredFields: string[]
    preferredFormat: string
    submissionMethods: string[]
  }
  rulesetIds: ObjectId[]
  createdAt: Date
  updatedAt: Date
}

// Appeal Types
export interface Appeal {
  _id: ObjectId
  userId?: ObjectId
  sessionId: string
  originalInput: {
    patientInfo: string
    clinicalInfo: string
    denialReason: string
    additionalContext?: string
  }
  providerId: ObjectId
  rulesetId?: ObjectId
  generatedAppeal: {
    content: string
    letterheadApplied: boolean
    format: "text" | "pdf"
    url?: string
  }
  maskingLog: {
    itemsMasked: number
    maskingMethod: string
    timestamp: Date
  }
  status: "draft" | "generated" | "downloaded" | "submitted"
  createdAt: Date
  updatedAt: Date
  expiresAt: Date
}

// RuleSet Types
export interface RuleSet {
  _id: ObjectId
  providerId: ObjectId
  name: string
  description: string
  version: string
  rules: {
    category: string
    criteria: RuleCriteria[]
    evidenceRequirements: string[]
    templateStructure: object
  }
  isDefault: boolean
  isCustom: boolean
  createdBy?: ObjectId
  createdAt: Date
  updatedAt: Date
}

export interface RuleCriteria {
  requirement: string
  evidence: string[]
}
```

**File**: `types/appeal.ts`
```typescript
export interface AppealInput {
  patientInfo: string
  clinicalInfo: string
  denialReason: string
  additionalContext?: string
  providerId: string
  rulesetId?: string
}

export interface AppealOutput {
  success: boolean
  appealId: string
  content: string
  maskingStats: {
    itemsMasked: number
    processingTime: number
  }
  remaining?: number
}

export interface MaskingResult {
  masked: {
    patientInfo: string
    clinicalInfo: string
    denialReason: string
    additionalContext?: string
  }
  maskingLog: {
    itemsMasked: number
    maskingMethod: string
    processingTimeMs: number
    timestamp: Date
  }
}
```

---

### Step 1.6: Create Database Seed Script

**File**: `lib/db/seed.ts`
```typescript
import { getCollection } from "./mongodb"
import { DEFAULT_PROVIDERS } from "@/lib/utils/constants"

export async function seedProviders() {
  const providers = await getCollection("providers")

  // Check if already seeded
  const count = await providers.countDocuments()
  if (count > 0) {
    console.log("Providers already seeded")
    return
  }

  const defaultProviders = DEFAULT_PROVIDERS.map((p) => ({
    name: p.name,
    code: p.code,
    category: "insurance" as const,
    isActive: true,
    isDefault: true,
    requirements: {
      appealDeadlineDays: 180,
      requiredFields: [
        "patient_name",
        "member_id",
        "date_of_service",
        "provider_name",
        "diagnosis_codes",
        "procedure_codes",
      ],
      preferredFormat: "pdf",
      submissionMethods: ["fax", "portal", "mail"],
    },
    rulesetIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }))

  await providers.insertMany(defaultProviders)
  console.log(`Seeded ${defaultProviders.length} providers`)
}

// Run this script with: npx ts-node lib/db/seed.ts
if (require.main === module) {
  seedProviders()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
```

---

### Phase 1 Checklist

Track completion in [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md)

- [ ] Step 1.1: Install dependencies
- [ ] Step 1.2: Initialize shadcn/ui and add components
- [ ] Step 1.3: Create lib directory structure
- [ ] Step 1.4: Setup MongoDB connection
- [ ] Step 1.5: Create type definitions
- [ ] Step 1.6: Create database seed script
- [ ] Test: MongoDB connection works
- [ ] Test: shadcn components render correctly

---

## 6. Phase 2: Core Features

> **Goal**: Build the appeal generation form, PII masking, and output display

### Step 2.1: Create PII/PHI Masking Service

**File**: `lib/masking/patterns.ts`
```typescript
// Regex patterns for PII/PHI detection
export const PII_PATTERNS = {
  // Social Security Number
  SSN: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,

  // Phone numbers (various formats)
  PHONE: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,

  // Email addresses
  EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,

  // Dates (various formats) - potential DOB
  DATE: /\b(?:0?[1-9]|1[0-2])[-\/](?:0?[1-9]|[12]\d|3[01])[-\/](?:19|20)\d{2}\b/g,

  // Medical Record Numbers (common patterns)
  MRN: /\b(?:MRN|Medical Record|Record #|Patient ID)[:\s]*[\w-]+\b/gi,

  // Member/Policy IDs
  MEMBER_ID: /\b(?:Member ID|Policy #|ID #|Subscriber)[:\s]*[\w-]+\b/gi,

  // Names (after common identifiers)
  PATIENT_NAME: /\b(?:Patient|Name|Member)[:\s]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g,

  // Addresses
  ADDRESS: /\d+\s+[\w\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Circle|Cir)[.,]?\s*(?:Apt|Suite|Unit|#)?\s*\d*[,\s]+[A-Za-z\s]+[,\s]+[A-Z]{2}\s+\d{5}(?:-\d{4})?/gi,

  // Credit Card Numbers
  CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,

  // ZIP Codes (standalone)
  ZIP: /\b\d{5}(?:-\d{4})?\b/g,

  // Account Numbers
  ACCOUNT: /\b(?:Account|Acct)[:\s#]*\d+\b/gi,
}

export const PHI_PATTERNS = {
  // Diagnosis codes
  ICD10: /\b[A-TV-Z]\d{2}(?:\.[A-Z0-9]{1,4})?\b/g,

  // Procedure codes
  CPT: /\b\d{5}(?:[A-Z])?\b/g,

  // Dates of service
  DOS: /\b(?:DOS|Date of Service)[:\s]*\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/gi,

  // Provider NPI
  NPI: /\b(?:NPI)[:\s]*\d{10}\b/gi,

  // Facility/Provider names
  PROVIDER: /\b(?:Dr\.|Doctor|MD|DO|NP|PA)[:\s]*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g,
}

export type PatternType = keyof typeof PII_PATTERNS | keyof typeof PHI_PATTERNS
```

**File**: `lib/masking/masking-service.ts`
```typescript
import { maskString } from "maskdata"
import { PII_PATTERNS, PHI_PATTERNS } from "./patterns"
import type { MaskingResult } from "@/types/appeal"

interface MaskingOptions {
  maskWith?: string
  preserveLength?: boolean
  logDetections?: boolean
}

export class MaskingService {
  private defaultOptions: MaskingOptions = {
    maskWith: "***",
    preserveLength: false,
    logDetections: true,
  }

  /**
   * Mask a single text string
   */
  maskText(text: string, options?: MaskingOptions): { masked: string; count: number } {
    const opts = { ...this.defaultOptions, ...options }
    let masked = text
    let totalCount = 0

    // Apply PII patterns
    Object.entries(PII_PATTERNS).forEach(([type, pattern]) => {
      const matches = masked.match(pattern)
      if (matches) {
        totalCount += matches.length
        masked = masked.replace(pattern, opts.maskWith!)
      }
    })

    // Apply PHI patterns
    Object.entries(PHI_PATTERNS).forEach(([type, pattern]) => {
      const matches = masked.match(pattern)
      if (matches) {
        totalCount += matches.length
        masked = masked.replace(pattern, `[${type}]`) // Preserve type for clinical context
      }
    })

    return { masked, count: totalCount }
  }

  /**
   * Mask appeal input data
   */
  async maskAppealInput(input: {
    patientInfo: string
    clinicalInfo: string
    denialReason: string
    additionalContext?: string
  }): Promise<MaskingResult> {
    const startTime = Date.now()
    let totalMasked = 0

    // Mask patient info (most sensitive)
    const patientResult = this.maskText(input.patientInfo)
    totalMasked += patientResult.count

    // Mask clinical info (preserve some medical context)
    const clinicalResult = this.maskText(input.clinicalInfo, {
      maskWith: "[REDACTED]",
    })
    totalMasked += clinicalResult.count

    // Mask denial reason (usually less sensitive)
    const denialResult = this.maskText(input.denialReason)
    totalMasked += denialResult.count

    // Mask additional context if provided
    let additionalMasked: string | undefined
    if (input.additionalContext) {
      const additionalResult = this.maskText(input.additionalContext)
      additionalMasked = additionalResult.masked
      totalMasked += additionalResult.count
    }

    return {
      masked: {
        patientInfo: patientResult.masked,
        clinicalInfo: clinicalResult.masked,
        denialReason: denialResult.masked,
        additionalContext: additionalMasked,
      },
      maskingLog: {
        itemsMasked: totalMasked,
        maskingMethod: "multi-pattern",
        processingTimeMs: Date.now() - startTime,
        timestamp: new Date(),
      },
    }
  }

  /**
   * Validate that masking was effective
   */
  validateMasking(text: string): { isClean: boolean; warnings: string[] } {
    const warnings: string[] = []

    // Check for remaining PII patterns
    Object.entries(PII_PATTERNS).forEach(([type, pattern]) => {
      if (pattern.test(text)) {
        warnings.push(`Potential ${type} still detected`)
      }
    })

    return {
      isClean: warnings.length === 0,
      warnings,
    }
  }

  /**
   * Preview masking without fully processing (for UI indicator)
   */
  previewMasking(text: string): { detectedCount: number; types: string[] } {
    const types: string[] = []
    let count = 0

    Object.entries({ ...PII_PATTERNS, ...PHI_PATTERNS }).forEach(([type, pattern]) => {
      const matches = text.match(pattern)
      if (matches) {
        types.push(type)
        count += matches.length
      }
    })

    return { detectedCount: count, types }
  }
}

// Export singleton instance
export const maskingService = new MaskingService()
```

---

### Step 2.2: Create Zod Validation Schemas

**File**: `lib/validation/appeal.ts`
```typescript
import { z } from "zod"

export const appealInputSchema = z.object({
  patientInfo: z
    .string()
    .min(10, "Please provide patient information (minimum 10 characters)")
    .max(5000, "Patient information too long (maximum 5000 characters)"),

  clinicalInfo: z
    .string()
    .min(20, "Please provide clinical information (minimum 20 characters)")
    .max(10000, "Clinical information too long (maximum 10000 characters)"),

  denialReason: z
    .string()
    .min(10, "Please provide the denial reason (minimum 10 characters)")
    .max(3000, "Denial reason too long (maximum 3000 characters)"),

  additionalContext: z
    .string()
    .max(3000, "Additional context too long (maximum 3000 characters)")
    .optional(),

  providerId: z
    .string()
    .min(1, "Please select an insurance provider"),

  rulesetId: z
    .string()
    .optional(),
})

export type AppealInputSchema = z.infer<typeof appealInputSchema>

export const appealGenerateResponseSchema = z.object({
  success: z.boolean(),
  appealId: z.string(),
  content: z.string(),
  maskingStats: z.object({
    itemsMasked: z.number(),
    processingTime: z.number(),
  }),
  remaining: z.number().optional(),
})
```

---

### Step 2.3: Create Appeal Form Component

**File**: `components/appeal/appeal-input.tsx`
```typescript
"use client"

import { useState, useEffect, useCallback } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Shield, AlertCircle, Loader2, FileText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

import { MaskingIndicator } from "./masking-indicator"
import { appealInputSchema, type AppealInputSchema } from "@/lib/validation/appeal"
import { useMasking } from "@/hooks/use-masking"
import { useProviders } from "@/hooks/use-providers"

interface AppealInputProps {
  onSuccess?: (result: any) => void
  onError?: (error: Error) => void
}

export function AppealInput({ onSuccess, onError }: AppealInputProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { providers, isLoading: providersLoading } = useProviders()
  const { preview, previewText } = useMasking()

  const form = useForm<AppealInputSchema>({
    resolver: zodResolver(appealInputSchema),
    defaultValues: {
      patientInfo: "",
      clinicalInfo: "",
      denialReason: "",
      additionalContext: "",
      providerId: "",
    },
  })

  // Watch form values for masking preview
  const watchedValues = form.watch()

  useEffect(() => {
    const text = [
      watchedValues.patientInfo,
      watchedValues.clinicalInfo,
      watchedValues.additionalContext,
    ]
      .filter(Boolean)
      .join(" ")

    previewText(text)
  }, [watchedValues.patientInfo, watchedValues.clinicalInfo, watchedValues.additionalContext])

  const onSubmit = async (data: AppealInputSchema) => {
    setIsSubmitting(true)

    try {
      const response = await fetch("/api/appeals/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error("Failed to generate appeal")
      }

      const result = await response.json()
      onSuccess?.(result)
    } catch (error) {
      onError?.(error as Error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-6 w-6" />
          Generate Appeal Letter
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Masking Status Banner */}
            <MaskingIndicator preview={preview} />

            {/* Patient Information */}
            <FormField
              control={form.control}
              name="patientInfo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Patient Information</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Paste patient demographics, insurance info, member ID, etc. (will be automatically masked)"
                      rows={4}
                      className="font-mono text-sm"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Include relevant patient identifiers. All PII will be automatically masked.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Clinical Information */}
            <FormField
              control={form.control}
              name="clinicalInfo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Clinical Information</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Paste medical history, diagnosis, treatment details, clinical notes..."
                      rows={6}
                      className="font-mono text-sm"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Provide relevant clinical documentation to support the appeal.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Denial Reason */}
            <FormField
              control={form.control}
              name="denialReason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Denial Reason</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Paste the denial letter or reason for denial from the insurance company..."
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Copy the denial reason exactly as stated in the EOB or denial letter.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Provider Selection */}
            <FormField
              control={form.control}
              name="providerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Insurance Provider</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select insurance provider..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {providersLoading ? (
                        <SelectItem value="loading" disabled>
                          Loading providers...
                        </SelectItem>
                      ) : (
                        providers.map((provider) => (
                          <SelectItem key={provider._id} value={provider._id}>
                            {provider.name} ({provider.code})
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Select the insurance company that issued the denial.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Additional Context (Optional) */}
            <FormField
              control={form.control}
              name="additionalContext"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Additional Context (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Any additional information that might help with the appeal..."
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Submit Button */}
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating Appeal...
                </>
              ) : (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  Generate Appeal Letter
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
```

**File**: `components/appeal/masking-indicator.tsx`
```typescript
"use client"

import { Shield, CheckCircle, AlertTriangle } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"

interface MaskingIndicatorProps {
  preview: {
    detectedCount: number
    types: string[]
  } | null
}

export function MaskingIndicator({ preview }: MaskingIndicatorProps) {
  if (!preview) {
    return (
      <Alert className="bg-gray-50 border-gray-200">
        <Shield className="h-4 w-4" />
        <AlertDescription>
          Start typing to see PII/PHI detection status
        </AlertDescription>
      </Alert>
    )
  }

  if (preview.detectedCount === 0) {
    return (
      <Alert className="bg-green-50 border-green-200">
        <CheckCircle className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-green-800">
          No sensitive information detected in current input
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert className="bg-blue-50 border-blue-200">
      <Shield className="h-4 w-4 text-blue-600" />
      <AlertDescription className="text-blue-800">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            <strong>{preview.detectedCount}</strong> sensitive item(s) detected and will be masked:
          </span>
          {preview.types.slice(0, 5).map((type) => (
            <Badge key={type} variant="secondary" className="text-xs">
              {type}
            </Badge>
          ))}
          {preview.types.length > 5 && (
            <Badge variant="outline" className="text-xs">
              +{preview.types.length - 5} more
            </Badge>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}
```

---

### Step 2.4: Create Custom Hooks

**File**: `hooks/use-masking.ts`
```typescript
"use client"

import { useState, useCallback, useRef } from "react"
import debounce from "lodash/debounce"

interface MaskingPreview {
  detectedCount: number
  types: string[]
}

export function useMasking() {
  const [preview, setPreview] = useState<MaskingPreview | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  // Debounced preview function
  const debouncedPreview = useRef(
    debounce(async (text: string) => {
      if (!text || text.length < 5) {
        setPreview(null)
        return
      }

      setIsProcessing(true)
      try {
        // Client-side preview (quick check)
        const response = await fetch("/api/masking/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        })

        if (response.ok) {
          const data = await response.json()
          setPreview(data)
        }
      } catch (error) {
        console.error("Masking preview error:", error)
      } finally {
        setIsProcessing(false)
      }
    }, 500)
  ).current

  const previewText = useCallback((text: string) => {
    debouncedPreview(text)
  }, [debouncedPreview])

  return {
    preview,
    isProcessing,
    previewText,
  }
}
```

**File**: `hooks/use-providers.ts`
```typescript
"use client"

import { useState, useEffect } from "react"
import type { Provider } from "@/types/database"

export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const response = await fetch("/api/providers")
        if (!response.ok) {
          throw new Error("Failed to fetch providers")
        }
        const data = await response.json()
        setProviders(data)
      } catch (err) {
        setError(err as Error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchProviders()
  }, [])

  return { providers, isLoading, error }
}
```

---

### Step 2.5: Create API Routes

**File**: `app/api/providers/route.ts`
```typescript
import { NextRequest, NextResponse } from "next/server"
import { getCollection } from "@/lib/db/mongodb"
import type { Provider } from "@/types/database"

export async function GET(req: NextRequest) {
  try {
    const providers = await getCollection<Provider>("providers")

    const allProviders = await providers
      .find({ isActive: true })
      .sort({ name: 1 })
      .toArray()

    return NextResponse.json(allProviders)
  } catch (error) {
    console.error("Error fetching providers:", error)
    return NextResponse.json(
      { error: "Failed to fetch providers" },
      { status: 500 }
    )
  }
}
```

**File**: `app/api/masking/preview/route.ts`
```typescript
import { NextRequest, NextResponse } from "next/server"
import { maskingService } from "@/lib/masking/masking-service"

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json()

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
      )
    }

    const preview = maskingService.previewMasking(text)

    return NextResponse.json(preview)
  } catch (error) {
    console.error("Masking preview error:", error)
    return NextResponse.json(
      { error: "Failed to preview masking" },
      { status: 500 }
    )
  }
}
```

**File**: `app/api/appeals/generate/route.ts`
```typescript
import { NextRequest, NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getCollection } from "@/lib/db/mongodb"
import { maskingService } from "@/lib/masking/masking-service"
import { appealInputSchema } from "@/lib/validation/appeal"
import type { Appeal, Provider } from "@/types/database"

// Generate unique session ID for anonymous users
function generateSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

export async function POST(req: NextRequest) {
  try {
    // Parse and validate input
    const body = await req.json()
    const validationResult = appealInputSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const input = validationResult.data

    // Step 1: Mask PII/PHI
    const { masked, maskingLog } = await maskingService.maskAppealInput({
      patientInfo: input.patientInfo,
      clinicalInfo: input.clinicalInfo,
      denialReason: input.denialReason,
      additionalContext: input.additionalContext,
    })

    // Step 2: Get provider
    const providers = await getCollection<Provider>("providers")
    const provider = await providers.findOne({
      _id: new ObjectId(input.providerId),
    })

    if (!provider) {
      return NextResponse.json(
        { error: "Provider not found" },
        { status: 404 }
      )
    }

    // Step 3: Generate appeal (placeholder - integrate with your LLM backend)
    const appealContent = await generateAppealContent({
      masked,
      provider,
      denialReason: input.denialReason,
    })

    // Step 4: Save to database
    const appeals = await getCollection<Appeal>("appeals")
    const appeal = await appeals.insertOne({
      userId: undefined, // Will be set when auth is implemented
      sessionId: req.cookies.get("session_id")?.value ?? generateSessionId(),
      originalInput: masked,
      providerId: provider._id,
      rulesetId: input.rulesetId ? new ObjectId(input.rulesetId) : undefined,
      generatedAppeal: {
        content: appealContent,
        letterheadApplied: false,
        format: "text",
      },
      maskingLog: {
        itemsMasked: maskingLog.itemsMasked,
        maskingMethod: maskingLog.maskingMethod,
        timestamp: maskingLog.timestamp,
      },
      status: "generated",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    } as any)

    return NextResponse.json({
      success: true,
      appealId: appeal.insertedId.toString(),
      content: appealContent,
      maskingStats: {
        itemsMasked: maskingLog.itemsMasked,
        processingTime: maskingLog.processingTimeMs,
      },
    })
  } catch (error) {
    console.error("Appeal generation error:", error)
    return NextResponse.json(
      { error: "Failed to generate appeal" },
      { status: 500 }
    )
  }
}

// Placeholder function - replace with actual LLM integration
async function generateAppealContent(params: {
  masked: any
  provider: Provider
  denialReason: string
}): Promise<string> {
  // TODO: Integrate with your LLM backend
  // For now, return a template response

  const template = `
APPEAL LETTER

Date: ${new Date().toLocaleDateString()}

To: ${params.provider.name} Appeals Department

RE: Appeal of Claim Denial

Dear Appeals Department,

I am writing to appeal the denial of coverage for the medical services described below. The denial reason stated was: "${params.denialReason}"

CLINICAL JUSTIFICATION:

Based on the clinical documentation provided, this treatment/service meets the medical necessity criteria as outlined in ${params.provider.name}'s coverage policies.

[Clinical arguments would be generated here based on the masked clinical info and provider-specific policies]

SUPPORTING EVIDENCE:

The patient's condition and treatment history demonstrate clear medical necessity for the requested services. The clinical notes indicate:

${params.masked.clinicalInfo}

CONCLUSION:

For the reasons stated above, I respectfully request that you overturn the denial and approve coverage for the services in question.

Please contact me if you require any additional information.

Sincerely,
[Provider/Biller Name]
[Contact Information]

---
Generated by AppealGen AI
This letter contains masked PHI for privacy compliance.
  `.trim()

  return template
}
```

---

### Phase 2 Checklist

Track completion in [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md)

- [ ] Step 2.1: Create PII/PHI masking service
- [ ] Step 2.2: Create Zod validation schemas
- [ ] Step 2.3: Create appeal form component
- [ ] Step 2.4: Create custom hooks
- [ ] Step 2.5: Create API routes
- [ ] Test: Masking patterns detect common PII
- [ ] Test: Form validation works correctly
- [ ] Test: API routes return expected responses
- [ ] Test: Appeal generation flow end-to-end

---

## 7. Phase 3: Authentication & User Management

> **Goal**: Implement Better Auth for user registration, login, and session management

### Step 3.1: Setup Better Auth

**File**: `lib/auth/auth.ts`
```typescript
import { betterAuth } from "better-auth"
import { mongodbAdapter } from "better-auth/adapters/mongodb"
import clientPromise from "@/lib/db/mongodb"
import { env } from "@/env.mjs"

export const auth = betterAuth({
  database: mongodbAdapter(clientPromise),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false, // Set to true in production
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update every 24 hours
  },

  user: {
    additionalFields: {
      tier: {
        type: "string",
        defaultValue: "free",
      },
    },
  },
})

export type Session = typeof auth.$Infer.Session
```

**File**: `lib/auth/client.ts`
```typescript
import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient()

export const { useSession, signIn, signUp, signOut } = authClient
```

**File**: `app/api/auth/[...all]/route.ts`
```typescript
import { auth } from "@/lib/auth/auth"
import { toNextJsHandler } from "better-auth/next-js"

export const { GET, POST } = toNextJsHandler(auth)
```

---

### Step 3.2: Create Auth Pages

**File**: `app/(auth)/layout.tsx`
```typescript
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        {children}
      </div>
    </div>
  )
}
```

**File**: `app/(auth)/login/page.tsx`
```typescript
import { LoginForm } from "@/components/forms/login-form"
import Link from "next/link"

export default function LoginPage() {
  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900">
          Sign in to AppealGen
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Or{" "}
          <Link href="/register" className="text-blue-600 hover:text-blue-500">
            create a new account
          </Link>
        </p>
      </div>
      <LoginForm />
    </div>
  )
}
```

**File**: `app/(auth)/register/page.tsx`
```typescript
import { RegisterForm } from "@/components/forms/register-form"
import Link from "next/link"

export default function RegisterPage() {
  return (
    <div>
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900">
          Create your account
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Already have an account?{" "}
          <Link href="/login" className="text-blue-600 hover:text-blue-500">
            Sign in
          </Link>
        </p>
      </div>
      <RegisterForm />
    </div>
  )
}
```

---

### Step 3.3: Create Auth Form Components

**File**: `components/forms/login-form.tsx`
```typescript
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { signIn } from "@/lib/auth/client"

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
})

type LoginFormValues = z.infer<typeof loginSchema>

export function LoginForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  const onSubmit = async (data: LoginFormValues) => {
    setIsLoading(true)
    setError(null)

    try {
      await signIn.email({
        email: data.email,
        password: data.password,
      })
      router.push("/dashboard")
    } catch (err) {
      setError("Invalid email or password")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder="••••••••"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Signing in...
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </Form>
  )
}
```

**File**: `components/forms/register-form.tsx`
```typescript
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { signUp } from "@/lib/auth/client"

const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
})

type RegisterFormValues = z.infer<typeof registerSchema>

export function RegisterForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  })

  const onSubmit = async (data: RegisterFormValues) => {
    setIsLoading(true)
    setError(null)

    try {
      await signUp.email({
        email: data.email,
        password: data.password,
        name: data.name,
      })
      router.push("/dashboard")
    } catch (err) {
      setError("Registration failed. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full Name</FormLabel>
              <FormControl>
                <Input placeholder="John Doe" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder="••••••••"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm Password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  placeholder="••••••••"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating account...
            </>
          ) : (
            "Create account"
          )}
        </Button>
      </form>
    </Form>
  )
}
```

---

### Step 3.4: Create Middleware

**File**: `middleware.ts`
```typescript
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Routes that require authentication
const protectedRoutes = ["/dashboard", "/settings", "/letterhead", "/appeals"]

// Routes that should redirect to dashboard if authenticated
const authRoutes = ["/login", "/register"]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Check for session token (Better Auth stores this as a cookie)
  const sessionToken = request.cookies.get("better-auth.session_token")
  const isAuthenticated = !!sessionToken

  // Redirect authenticated users away from auth pages
  if (isAuthenticated && authRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  // Redirect unauthenticated users to login
  if (!isAuthenticated && protectedRoutes.some((route) => pathname.startsWith(route))) {
    const loginUrl = new URL("/login", request.url)
    loginUrl.searchParams.set("callbackUrl", pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/letterhead/:path*",
    "/appeals/:path*",
    "/login",
    "/register",
  ],
}
```

---

### Phase 3 Checklist

- [ ] Step 3.1: Setup Better Auth configuration
- [ ] Step 3.2: Create auth pages (login, register)
- [ ] Step 3.3: Create auth form components
- [ ] Step 3.4: Create middleware for route protection
- [ ] Test: User registration flow
- [ ] Test: User login flow
- [ ] Test: Session persistence
- [ ] Test: Protected route access

---

## 8-11. Remaining Phases

See [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md) for detailed tracking of:
- Phase 4: Premium Features (Letterhead, History, Analytics)
- Phase 5: Enterprise & Scale (Teams, API, Advanced)
- Phase 6: Testing & QA
- Phase 7: Deployment

---

## Quick Reference

### File Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | kebab-case | `appeal-input.tsx` |
| Pages | page.tsx in folder | `app/dashboard/page.tsx` |
| API Routes | route.ts | `app/api/appeals/route.ts` |
| Hooks | use-*.ts | `hooks/use-auth.ts` |
| Types | *.ts | `types/appeal.ts` |
| Utilities | kebab-case | `lib/utils/cn.ts` |

### Common Commands

```bash
# Development
pnpm dev                    # Start dev server
pnpm build                  # Production build
pnpm lint                   # Run linter
pnpm test                   # Run tests

# Database
pnpm db:seed               # Seed database (add to package.json)

# shadcn
pnpm dlx shadcn@latest add [component]

# Type checking
pnpm tsc --noEmit
```

### Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `BETTER_AUTH_SECRET` | Yes | Auth secret (min 32 chars) |
| `BETTER_AUTH_URL` | Yes | App URL |
| `LLM_API_URL` | No | LLM backend URL |
| `LLM_API_KEY` | No | LLM API key |

---

## Related Documents

- [DECISION_LOG.md](./DECISION_LOG.md) - All architectural and technical decisions
- [PROGRESS_TRACKER.md](./PROGRESS_TRACKER.md) - Implementation progress tracking
- [../README.md](../README.md) - Project overview
- [../CLAUDE.md](../CLAUDE.md) - AI assistant guide
