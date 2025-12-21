# AppealGen AI

**The AI-Powered Medical Denial Appeal Agent**

Transform 45-minute manual appeals into 60-second AI-generated, citation-backed letters that win.

---

## The Problem

Medical claim denials are a $19 billion annual problem in the US healthcare system:

- **10-17%** of all claims are denied (up 77% since 2022)
- **45-60 minutes** to manually research and write a single appeal
- **70%** of difficult appeals are simply written off due to time constraints
- **1M+ medical billers** in small practices struggle daily with this burden

Medical Necessity denials (CO-50) are the hardest to fight—they require matching clinical notes against payer-specific policies buried in dense 20+ page PDFs.

## The Solution

AppealGen AI is a specialized "Robo-Lawyer" that instantly generates citation-backed appeal letters by matching clinical documentation against payer-specific policies.

### How It Works

1. **Input**: Paste the denial reason and anonymized clinical notes
2. **Process**: AI retrieves relevant payer policies via RAG and compares against clinical documentation
3. **Output**: Professional appeal letter with precise policy citations

### Example Output

> *"Pursuant to Aetna Policy #0451, coverage is mandated when the patient demonstrates functional impairment. As noted in the chart dated 3/15/2025, the patient cannot climb stairs, satisfying this requirement. Therefore, the denial is invalid under your own published guidelines."*

## Key Features

- **50%+ Overturn Rate**: AI-generated appeals with policy citations dramatically improve success
- **Citation-First Architecture**: Every claim links to actual payer policy PDFs
- **HIPAA Compliant**: Zero-retention data handling for patient privacy
- **Top 5 Payers Supported**: UnitedHealthcare, Anthem, Aetna, Cigna, Humana

## Target Denial Types

| Phase | Denial Code | Description | AppealGen Fit |
|-------|-------------|-------------|---------------|
| MVP | CO-50 | Medical Necessity | Core focus - 50%+ overturn rate |
| Phase 2 | CO-11 | Diagnosis doesn't justify procedure | Same architecture as CO-50 |
| Phase 2 | CO-197 | Prior Authorization Retro | Emergency/urgent care appeals |
| Phase 2 | CO-97 | Bundled services | Modifier justification letters |
| Phase 3 | CO-96 | Non-covered charge | Coverage exception arguments |

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **UI**: React 19, Tailwind CSS v4, Radix UI
- **AI/LLM**: GPT-4o / Claude Sonnet
- **RAG System**: Vector database of payer Clinical Policy Bulletins
- **Testing**: Vitest, Playwright, Storybook
- **Type Safety**: Strict TypeScript with ts-reset

## Getting Started

### Prerequisites

- Node.js >= 20.9.0
- pnpm (via Corepack)

### Installation

```bash
# Enable Corepack for pnpm
corepack enable

# Install dependencies
pnpm install

# Start development server
pnpm dev
```

### Available Commands

```bash
pnpm dev              # Start dev server with Turbopack
pnpm build            # Production build
pnpm test             # Run unit tests
pnpm e2e:headless     # Run E2E tests
pnpm storybook        # Component development
pnpm lint             # Code linting
```

## Market Opportunity

| Metric | Value |
|--------|-------|
| Total Addressable Market | $19B annually |
| Target Segment | Small practices (1-10 doctors) |
| Users | 1M+ medical billers |
| Current Denial Rate | 10-17% of all claims |
| Manual Appeal Time | 45-60 minutes |
| AppealGen Time | ~60 seconds |

## Product Roadmap

### Phase 1: MVP
- Medical Necessity (CO-50) appeals
- Top 5 payer policy database
- Core appeal generation engine
- ChatGPT-like conversational interface

### Phase 2: Growth
- CO-11 (Diagnosis Mismatch)
- CO-197 (Prior Auth Retro-Appeals)
- CO-97 (Bundling/Modifier)
- Document upload and versioning

### Phase 3: Enterprise
- Level of Care / Downcoding appeals
- Hospital system integrations
- Milliman/InterQual criteria support
- Team features and API access

### Phase 4: Advocacy
- Experimental/Investigational denials
- PubMed integration for research citations
- Patient advocacy features

## Brand

AppealGen AI brand assets are located in:
- `brand/` - Complete brand guidelines
- `public/logos/` - Logo variations for all backgrounds
- `public/icons/` - App icons and decorative elements

### Brand Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Cornflower Blue | `#568AFF` | Primary brand color |
| Green-Blue | `#0665BA` | Secondary / gradients |
| Rich Black | `#001320` | Text / dark backgrounds |

## Documentation

### Implementation Guides
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md) - Step-by-step development guide
- [Decision Log](docs/DECISION_LOG.md) - Architectural decisions and rationale
- [Progress Tracker](docs/PROGRESS_TRACKER.md) - Current status and next steps

### Brand Assets
- [Brand Guidelines](brand/brand.md) - Complete visual identity guide
- [Logo Documentation](public/logos/logo.md) - Logo usage guidelines
- [Icon Documentation](public/icons/icons.md) - Icon specifications

## License

Proprietary - All Rights Reserved

---

**AppealGen AI** - Fighting denied claims, one appeal at a time.
