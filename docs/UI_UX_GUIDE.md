# UI/UX Reference Guide
## Complete Design System & Implementation Standards

**Version:** 3.0  
**Status:** Authoritative Reference  
**Target Quality:** Enterprise SaaS (Stripe, Linear, Atlassian, Notion)  
**Last Updated:** January 2025  
**Component Library:** Shadcn UI (438+ components available)

---

## Executive Summary

This document serves as the **single source of truth** for all UI/UX decisions, design system standards, and component usage across the **entire Screen Agent Platform**. It applies to all features including:

- **Dashboard** - Overview and high-level metrics
- **Screen Agents** - Agent creation, management, and detail views
- **Knowledge** - Knowledge source management and extraction
- **Analytics** - Analytics dashboards and reporting
- **Teams** - Team management (organization mode)
- **Settings** - Profile, authentication, preferences, organization settings
- **Billing** - Billing management and subscriptions
- **All other features** - Consistent patterns across the application

It consolidates:
- Enterprise UX transformation guidelines
- Visual design system specifications
- Component patterns and usage for all features
- Feature-specific examples and patterns
- Shadcn UI component references
- Quality standards and validation checklists

**Component Library:** Built with **Shadcn UI** - 438+ components available via MCP server. All components are copy-paste ready and customizable.

**Reference Standards:**
- Stripe Dashboard (clean, minimal, high information density)
- Linear (fast, predictable, delightful micro-interactions)
- Atlassian (comprehensive, scalable, enterprise-ready)
- Notion (flexible, powerful, approachable)

---

## Table of Contents

1. [Foundation & Architecture](#part-i-foundation--architecture)
2. [Design System](#part-ii-design-system)
3. [Shadcn UI Components](#part-iii-shadcn-ui-components)
4. [Component Patterns](#part-iv-component-patterns)
5. [Feature-Specific Patterns](#part-v-feature-specific-patterns)
   - Dashboard
   - Screen Agents
   - Knowledge
   - Analytics
   - Teams
   - Settings
   - Billing
6. [Quality Standards](#part-vi-quality-standards)
7. [Reference Checklists](#part-vii-reference-checklists)

---

## Part I: Foundation & Architecture

### 1.1 Account Model & Tenant Behavior

**Principle:** Every signup creates a **tenant-based account**. There is **no concept of a "personal account"** in product language, UX, or user-facing code.

#### Internal Operating Modes

The system supports two **internal-only** tenant operating modes (never surfaced in UI):

**1. Normal Mode (Default)**
- Simplified tenant experience
- Members, roles, and settings
- No teams or team-scoped features
- Navigation: Dashboard, Screen Agents, Analytics, Settings

**2. Organization Mode (Advanced)**
- Full enterprise-ready experience
- All Normal Mode features + Teams
- Organization-level analytics and billing
- Navigation: Dashboard, Screen Agents, Analytics, Billing, Teams, Settings

#### Critical UX Rules

**Never Surface Mode Terminology:**
- ❌ Never say "personal mode" or "organization mode" in UI
- ❌ Never say "personal account" or "personal workspace"
- ✅ Use "Settings", "Members", "Your Account"
- ✅ Use "Enable Teams" or "Upgrade to Organization"

**Feature Gating:**
- Teams features must be **completely hidden** in Normal mode
- UI must dynamically adapt based on tenant mode
- Transition is explicit and confirmed

---

### 1.2 Authorization & Role System

**Tenant-Level Roles (Apply to All Tenants):**

| Role | Authority | Capabilities |
|------|-----------|-------------|
| `owner` | Ultimate authority | Tenant configuration, member management, billing, deletion |
| `admin` | Operational admin | Member management (except owner), settings (except billing), resource management |
| `member` | Standard contributor | Create/manage assigned resources, view tenant resources |
| `viewer` | Read-only participant | View resources and analytics only |

**Team-Level Roles (Organization Mode Only):**
- `team_admin` - Team-scoped administration
- `team_member` - Team-scoped contributor

---

### 1.3 Settings Architecture

**User-Level Settings:**
```
/settings
├── Profile (name, email, avatar)
├── Authentication (password, OAuth)
└── Preferences (theme, language, notifications)
```

**Tenant-Level Settings:**
```
/settings/tenant
├── Members (list, invitations, roles)
├── General (name, slug, logo)
└── API Keys
```

**Organization-Only Settings:**
```
/settings/organization
├── Teams
├── Billing
├── Security
└── Advanced
```

---

## Part II: Design System

### 2.1 Typography Hierarchy & Legibility

**Core Principle:** We do not mute primary content text. All primary content must be clearly legible and use high-contrast colors.

#### Typography Scale

| Element | Size | Weight | Color | Usage |
|---------|------|--------|-------|-------|
| **Page Title** | `text-lg` (18px) | `font-semibold` (600) | `text-foreground` | Main page headings (one per page) |
| **Page Description** | `text-sm` (14px) | `font-normal` (400) | `text-foreground` | Page descriptions with `mt-0.5` |
| **Section Header** | `text-sm` (14px) | `font-semibold` (600) | `text-foreground` | Major sections (e.g., "Authentication") |
| **Body Text** | `text-sm` (14px) or `text-xs` (12px) | `font-normal` (400) | `text-foreground` | Primary content, descriptions |
| **Form Label** | `text-xs` (12px) | `font-normal` (400) | `text-muted-foreground` | Field labels (appropriate use case) |
| **Helper Text** | `text-xs` (12px) | `font-normal` (400) | `text-foreground` | Helper text, captions (NOT muted) |

#### Typography Legibility Rules

**MANDATORY:**
- All primary content (body text, titles, headings, descriptions, table content, navigation) must use `text-foreground` for maximum legibility
- Buttons must use `text-foreground` or high-contrast variants for clear visibility

**Muted Text Usage (Allowed Only For):**
- ✅ Form labels (`text-muted-foreground`)
- ✅ Placeholder text
- ✅ Disabled states
- ✅ Metadata labels (e.g., "Created", "Last Updated")

**Forbidden Use Cases:**
- ❌ Body text
- ❌ Page titles
- ❌ Section headings
- ❌ Table content
- ❌ Navigation labels
- ❌ Primary descriptions
- ❌ Error messages
- ❌ Empty state text
- ❌ Button text

#### Examples

✅ **Correct Usage:**
```tsx
// Page title and description
<h1 className="text-lg font-semibold">Settings</h1>
<p className="mt-0.5 text-sm text-foreground">Manage your tenant settings</p>

// Section header
<h3 className="text-sm font-semibold">Authentication</h3>

// Form label (muted is OK)
<Label className="text-xs text-muted-foreground">Username</Label>

// Body text (NOT muted)
<p className="text-sm text-foreground">This is primary content.</p>

// Button (high contrast)
<Button className="text-foreground">Submit</Button>
```

❌ **Incorrect Usage:**
```tsx
// ❌ WRONG - Muted page description
<p className="text-sm text-muted-foreground">Manage your settings</p>

// ❌ WRONG - Muted body text
<p className="text-sm text-muted-foreground">This is primary content.</p>

// ❌ WRONG - Muted button text
<Button className="text-muted-foreground">Submit</Button>
```

---

### 2.2 Spacing Scale

#### Container Spacing
- Page container: `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8`
- Section spacing: `space-y-6` (24px)
- Card padding: `pt-6` (never full padding - use `CardContent` with `pt-6`)

#### Component Spacing
- Form fields: `space-y-4` (16px) or `space-y-2` (8px)
- Button groups: `gap-2` (8px) or `gap-1` (4px)
- List items: `space-y-1` (4px)
- Card content: `space-y-4` (16px) or `space-y-3` (12px)

#### Micro Spacing
- Icon + text: `gap-2` (8px)
- Inline elements: `gap-1` (4px)
- Tight grouping: `gap-0.5` (2px)

---

### 2.3 Color System

#### Semantic Colors

| Color | Usage | Hex Value |
|-------|-------|-----------|
| **Primary** | Brand blue, buttons, links | `#568AFF` |
| **Success** | Positive actions, success states | Green |
| **Warning** | Warnings, caution | Amber |
| **Error** | Errors, destructive actions | Red |
| **Muted** | Form labels, placeholders, metadata ONLY | Gray |
| **Foreground** | All primary content (high contrast) | Theme variable |

#### Background Hierarchy
- Base: `bg-background` (white/black)
- Card: `bg-muted/30` (subtle background, not white)
- Muted: `bg-muted` (subtle background)
- Accent: `bg-accent` (interactive states)

---

### 2.4 Component Patterns

#### Cards
- Background: `bg-muted/30` (not white)
- Padding: `pt-6` via `CardContent` (never full padding)
- Structure: Prefer `Card` + `CardContent` over `CardHeader` + `CardContent`
- Headers: Inline with `text-sm font-semibold` instead of `CardTitle`
- No heavy borders or shadows

**Shadcn Component:** `@shadcn/card`

#### Buttons
- Primary: Solid background, high contrast (`size="sm"` for app)
- Secondary: Outlined variant (`size="sm"`)
- Destructive: Red variant for dangerous actions
- Sizes: `sm` (default in app), `default`, `lg` (only for empty states)
- Loading: Use `Spinner` from `@shadcn/spinner`, not `Loader2`

**Shadcn Component:** `@shadcn/button`

#### Forms
- Label: `text-xs text-muted-foreground`
- Input: `h-9` height (never default or `h-10`)
- Textarea: `text-sm` with proper rows
- Error: Red border + error message below
- Help text: `text-xs text-foreground` (NOT muted)

**Shadcn Components:** `@shadcn/input`, `@shadcn/label`, `@shadcn/textarea`

#### Tables
- Header: `font-semibold text-sm`
- Row: `border-b` (subtle separation)
- Hover: `hover:bg-muted/50`
- Pagination: Always required for list views

**Shadcn Components:** `@shadcn/table`, `@shadcn/pagination`

---

## Part III: Shadcn UI Components

### 3.1 Available Components (438+ Components)

**Access Methods:**
- **MCP Server:** Use `mcp_presenter-agent-ui-shadcn_*` tools to explore, view, and get examples
- **CLI:** `pnpm dlx shadcn@latest add [component-name]`
- **Registry:** [ui.shadcn.com](https://ui.shadcn.com)

### 3.2 Core Components Used

#### Layout & Navigation
- `@shadcn/card` - Card containers (use `bg-muted/30`, `CardContent` with `pt-6`)
- `@shadcn/separator` - Section dividers
- `@shadcn/sidebar` - Application sidebar
- `@shadcn/breadcrumb` - Navigation breadcrumbs
- `@shadcn/tabs` - Tabbed content sections

#### Forms & Inputs
- `@shadcn/input` - Text inputs (`h-9` height)
- `@shadcn/textarea` - Multi-line text (`text-sm`)
- `@shadcn/label` - Form labels (`text-xs text-muted-foreground`)
- `@shadcn/select` - Dropdown selects
- `@shadcn/checkbox` - Checkboxes
- `@shadcn/radio-group` - Radio button groups
- `@shadcn/switch` - Toggle switches
- `@shadcn/accordion` - Collapsible sections

#### Feedback & Status
- `@shadcn/alert` - Alert messages
- `@shadcn/badge` - Status badges
- `@shadcn/spinner` - Loading indicators (preferred over `Loader2`)
- `@shadcn/skeleton` - Skeleton loaders
- `@shadcn/progress` - Progress bars
- `@shadcn/toast` - Toast notifications (via Sonner)

#### Data Display
- `@shadcn/table` - Data tables
- `@shadcn/pagination` - Pagination controls
- `@shadcn/empty` - Empty states
- `@shadcn/avatar` - User avatars

#### Overlays & Dialogs
- `@shadcn/dialog` - Modal dialogs
- `@shadcn/drawer` - Mobile drawer dialogs
- `@shadcn/sheet` - Slide-over panels
- `@shadcn/dropdown-menu` - Dropdown menus
- `@shadcn/popover` - Popover overlays
- `@shadcn/tooltip` - Tooltips

#### Advanced Components
- `@shadcn/command` - Command palette
- `@shadcn/calendar` - Date picker calendar
- `@shadcn/chart` - Charts (Recharts-based)
- `@shadcn/carousel` - Image carousels
- `@shadcn/form` - React Hook Form integration

### 3.3 Getting Shadcn Components

**View Component Details:**
```typescript
// Use MCP tool to view component
mcp_presenter-agent-ui-shadcn_view_items_in_registries({
  items: ["@shadcn/button", "@shadcn/card"]
})
```

**Get Usage Examples:**
```typescript
// Get examples and demos
mcp_presenter-agent-ui-shadcn_get_item_examples_from_registries({
  registries: ["@shadcn"],
  query: "button-demo"
})
```

**Install Component:**
```bash
# Via CLI
pnpm dlx shadcn@latest add button

# Get add command via MCP
mcp_presenter-agent-ui-shadcn_get_add_command_for_items({
  items: ["@shadcn/button", "@shadcn/card"]
})
```

**Search Components:**
```typescript
// Search by name or description
mcp_presenter-agent-ui-shadcn_search_items_in_registries({
  registries: ["@shadcn"],
  query: "form input"
})
```

### 3.4 Component Usage Guidelines

**Always:**
- ✅ Use Shadcn components for consistency
- ✅ Follow component patterns from examples
- ✅ Customize via className, not by modifying source
- ✅ Use `size="sm"` for buttons in application context
- ✅ Use `h-9` for inputs

**Never:**
- ❌ Modify Shadcn component source files directly
- ❌ Use `Loader2` from lucide-react (use `Spinner` instead)
- ❌ Create custom components that duplicate Shadcn functionality
- ❌ Use oversized typography (`text-xl` or larger for titles)

---

## Part IV: Component Patterns

### 4.1 Page Layout Templates

#### Standard Page Template

```tsx
<div className="space-y-6">
  {/* Page Header */}
  <div className="space-y-0.5">
    <h1 className="text-lg font-semibold">Page Title</h1>
    <p className="mt-0.5 text-sm text-foreground">Page description</p>
  </div>
  
  {/* Page content */}
  <div className="space-y-6">
    {/* Content sections */}
  </div>
</div>
```

#### List Page Template

```tsx
<div className="space-y-6">
  {/* Page Header with Actions */}
  <div className="flex items-center justify-between">
    <div className="space-y-0.5">
      <h1 className="text-lg font-semibold">Resource List</h1>
      <p className="mt-0.5 text-sm text-foreground">Manage your resources</p>
    </div>
    <Button size="sm">
      <Plus className="mr-2 h-3.5 w-3.5" />
      Create Resource
    </Button>
  </div>
  
  {/* Table with Pagination */}
  <Card className="bg-muted/30">
    <CardContent className="pt-6">
      <Table>
        {/* Table content */}
      </Table>
      <Pagination />
    </CardContent>
  </Card>
</div>
```

#### Detail Page Template

```tsx
<div className="space-y-6">
  {/* Page Header */}
  <div className="space-y-0.5">
    <h1 className="text-lg font-semibold">Resource Detail</h1>
    <p className="mt-0.5 text-sm text-foreground">View and manage resource</p>
  </div>
  
  {/* Tabs */}
  <Tabs defaultValue="overview">
    <TabsList>
      <TabsTrigger value="overview">Overview</TabsTrigger>
      <TabsTrigger value="settings">Settings</TabsTrigger>
    </TabsList>
    
    <TabsContent value="overview" className="space-y-4">
      {/* Overview content */}
    </TabsContent>
  </Tabs>
</div>
```

**Shadcn Components:** `@shadcn/card`, `@shadcn/table`, `@shadcn/pagination`, `@shadcn/tabs`, `@shadcn/button`

---

### 4.2 Empty States

**Pattern:**
```tsx
<Card className="bg-muted/30">
  <CardContent className="pt-6">
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <Globe className="h-12 w-12 text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle className="text-2xl font-semibold">
          No resources yet
        </EmptyTitle>
        <EmptyDescription className="text-sm text-foreground">
          Create your first resource to get started
        </EmptyDescription>
      </EmptyHeader>
      <Button size="lg">
        <Plus className="mr-2 h-4 w-4" />
        Create Resource
      </Button>
    </Empty>
  </CardContent>
</Card>
```

**Guidelines:**
- Calm, instructional (no marketing copy)
- Icon (64x64px max, muted color)
- Title: `text-2xl font-semibold` (only exception to typography rules)
- Description: `text-sm text-foreground`
- CTA: `size="lg"` button (only exception to button sizing)

**Shadcn Component:** `@shadcn/empty`

---

### 4.3 Loading States

**Patterns:**
```tsx
// Page-level skeleton
<Skeleton className="h-8 w-48 mb-2" />
<Skeleton className="h-4 w-96 mb-6" />
<Skeleton className="h-32 w-full" />

// Button loading
<Button disabled size="sm">
  <Spinner className="mr-2 h-3.5 w-3.5" />
  Creating...
</Button>

// Component loading
<Card className="bg-muted/30">
  <CardContent className="pt-6">
    <div className="space-y-4">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  </CardContent>
</Card>
```

**Guidelines:**
- Use `Spinner` from `@shadcn/spinner` (not `Loader2`)
- Match skeleton structure to final content
- Show loading immediately (no delay)
- Provide context ("Loading agents...", "Fetching data...")

**Shadcn Components:** `@shadcn/skeleton`, `@shadcn/spinner`

---

### 4.4 Error States

**Patterns:**
```tsx
// Page-level error
<Alert variant="destructive" className="py-2">
  <AlertCircle className="h-4 w-4" />
  <AlertDescription className="text-xs">
    <div className="space-y-1">
      <p className="font-medium">Failed to load resources</p>
      <p>{error}</p>
      <Button variant="outline" size="sm" onClick={retry}>
        Retry
      </Button>
    </div>
  </AlertDescription>
</Alert>

// Inline form error
<Input className="h-9 border-destructive" />
<p className="text-xs text-destructive">{error}</p>
```

**Guidelines:**
- Always provide retry mechanism
- Clear, actionable error messages
- Use `Alert` component for page-level errors
- Use inline text for form errors

**Shadcn Components:** `@shadcn/alert`

---

### 4.5 Form Patterns

**Standard Form Structure:**
```tsx
<form className="space-y-4">
  {/* Section Header */}
  <div className="space-y-0.5">
    <h3 className="text-sm font-semibold">Section Title</h3>
    <p className="text-xs text-foreground opacity-85">
      Section description
    </p>
  </div>

  {/* Form Fields */}
  <div className="space-y-1.5">
    <Label htmlFor="field" className="text-xs text-muted-foreground">
      Field Label
    </Label>
    <Input
      id="field"
      className="h-9"
      placeholder="Placeholder text"
    />
    <p className="text-xs text-foreground opacity-85">
      Helper text (NOT muted)
    </p>
  </div>

  {/* Separator */}
  <Separator />

  {/* Submit Button */}
  <div className="flex justify-end gap-2">
    <Button type="button" variant="outline" size="sm">
      Cancel
    </Button>
    <Button type="submit" size="sm">
      Save
    </Button>
  </div>
</form>
```

**Guidelines:**
- Section spacing: `space-y-4`
- Field spacing: `space-y-1.5` or `space-y-2`
- Labels: `text-xs text-muted-foreground`
- Inputs: `h-9` height
- Help text: `text-xs text-foreground opacity-85` (NOT muted)

**Shadcn Components:** `@shadcn/form`, `@shadcn/input`, `@shadcn/label`, `@shadcn/separator`

---

## Part V: Feature-Specific Patterns

This section provides patterns and requirements for each major feature in the application. These patterns apply consistently across all features while allowing for feature-specific adaptations.

### 5.1 Universal List/Table Patterns

**Applies to:** Screen Agents, Knowledge, Teams, Members, and all resource lists

#### Layout Requirements
- ✅ **Table view** (not cards) for scalable data
- ✅ **Pagination mandatory** (default 25 items per page)
- ✅ **Fixed header row** with sortable columns (where applicable)
- ✅ **Row click** navigates to detail page (primary action)
- ✅ **Actions menu** (dropdown, not prominent buttons)

#### Visual Standards
- High scanability (consistent row height `py-2`)
- No visual noise (minimal icons, subtle colors)
- Professional spacing (`space-y-1` for list items)
- Status badges with clear visual hierarchy

#### Standard Columns
- Name/Title (primary identifier)
- Status (badge with appropriate state)
- Metadata (dates, counts, relevant info)
- Actions (dropdown menu)

**Shadcn Components:** `@shadcn/table`, `@shadcn/pagination`, `@shadcn/dropdown-menu`, `@shadcn/badge`

---

### 5.2 Universal Detail Page Patterns

**Applies to:** Screen Agents, Knowledge, Teams, and all resource detail pages

#### Structure Requirements
- ✅ **Tab-based navigation** (single-level only)
- ✅ **No nested navigation** (flat structure)
- ✅ **No card wrappers** (content blends into page)
- ✅ **Clear status visibility** in Overview tab

#### Standard Tabs
- **Overview:** Status, metrics, summary, key information
- **Settings/Configuration:** Resource-specific settings and options
- **Activity/History:** Timeline of events, changes, or sync history
- **Content/Details:** Feature-specific content (tables, lists, details)

#### Visual Standards
- Page title: `text-lg font-semibold`
- Section headers: `text-sm font-semibold`
- No card borders (removed `border rounded-lg`)
- Table-first design for data display

**Shadcn Components:** `@shadcn/tabs`, `@shadcn/table`, `@shadcn/badge`, `@shadcn/progress`

---

### 5.3 Dashboard

**Purpose:** High-level overview with clear next actions (NOT deep analytics)

**Layout:**
- Metric cards with `bg-muted/30` background
- Quick action buttons (`size="sm"`)
- Summary statistics with `text-2xl font-semibold` for values
- Empty state using `Empty` component with `size="lg"` CTA button

**Content:**
- High-level metrics only (total agents, active sessions, etc.)
- Primary CTAs (create agent, invite members)
- Quick navigation links to detailed views
- No dense charts or historical drill-downs

**Guidelines:**
- Keep it fast and scannable
- Focus on "what's next" not "what happened"
- Use `Card` components for metric groups
- Empty states must be actionable

**Shadcn Components:** `@shadcn/card`, `@shadcn/button`, `@shadcn/empty`, `@shadcn/badge`

---

### 5.4 Screen Agents

**List View (`/screen-agents`):**
- Table view with pagination
- Columns: Name, Status, Visibility, Metrics (Presentations, Viewers)
- Row click navigates to detail
- Actions: Share, Edit, Delete (dropdown menu)

**Detail View (`/screen-agents/[id]`):**
- Tabs: Overview, Analytics, Sessions, Knowledge, Settings
- Overview: Metrics (Presentations, Viewers, Minutes, Avg Duration)
- Configuration visibility in Settings tab
- Status controls (Publish/Pause) with `Spinner` loading states

**Creation Form (`/screen-agents/new`):**
- Multi-step wizard with progress indicator
- Form sections separated with `Separator`
- All inputs `h-9`, labels `text-xs text-muted-foreground`
- Advanced options in `Accordion`

**Shadcn Components:** `@shadcn/table`, `@shadcn/pagination`, `@shadcn/tabs`, `@shadcn/card`, `@shadcn/progress`, `@shadcn/spinner`

---

### 5.5 Knowledge

**List View (`/knowledge`):**
- Table view with pagination (default 25 per page)
- Columns: Name, Source, Status, Last Sync, Pages, Actions
- Status badges with progress indicators for active syncs
- Row click navigates to detail

**Detail View (`/knowledge/[id]`):**
- Tabs: Overview, Configuration, Contents, Activity
- Contents in tables (not cards)
- Sync history timeline in Activity tab
- Clear failure details when sync fails

**Creation Form (`/knowledge/new`):**
1. Basic Information (Name, Description, Source Name)
2. Website Source (Website URL + Authentication)
3. Additional Assets (Files, Doc URLs, Video URLs)
4. Advanced Options (Accordion)

**Guidelines:**
- Website URL always required
- Authentication only for website (not assets)
- Asset list with type badges and remove buttons
- Progress visibility during sync

**Shadcn Components:** `@shadcn/table`, `@shadcn/pagination`, `@shadcn/tabs`, `@shadcn/badge`, `@shadcn/progress`, `@shadcn/separator`, `@shadcn/accordion`

---

### 5.6 Analytics

**Purpose:** Deep analytics, trends, and detailed reporting (separate from Dashboard)

**Layout:**
- Charts and detailed metrics
- Date range selectors
- Filterable data tables
- Export options (future)

**Components:**
- Metric cards with `bg-muted/30` and hover effects
- Tables with pagination
- Charts using `@shadcn/chart` (Recharts-based)
- Activity feeds with timestamps

**Guidelines:**
- Focus on deep insights, not quick overview
- Historical data and trends
- Detailed drill-downs
- Exportable reports (future)

**Shadcn Components:** `@shadcn/chart`, `@shadcn/table`, `@shadcn/card`, `@shadcn/pagination`, `@shadcn/select`

---

### 5.7 Teams (Organization Mode Only)

**List View (`/teams`):**
- Table view with pagination
- Columns: Name, Members, Created, Actions
- Empty state: Clear CTA to create first team
- Organization features required messaging (Normal mode)

**Detail View (Future):**
- Tabs: Overview, Members, Settings
- Member management interface
- Team-scoped resources

**Creation Form (Future):**
- Team name and description
- Initial member invitations
- Team settings

**Shadcn Components:** `@shadcn/table`, `@shadcn/pagination`, `@shadcn/empty`, `@shadcn/card`

---

### 5.8 Settings

**Layout:**
- Tabbed navigation (horizontal for personal, vertical for organization)
- Each section in `Card` with `bg-muted/30`
- Form sections with `space-y-4` spacing

**Personal Settings (`/settings`):**
- Profile: Name, email, avatar
- Authentication: Password, OAuth connections
- Preferences: Theme, language, notifications

**Organization Settings (`/settings/tenant` or `/settings/organization`):**
- General: Tenant name, slug, description
- Members: List, invitations, role management
- Billing: Payment methods, invoices, usage
- Security: Enterprise features (SSO, domain allowlist)

**Guidelines:**
- Inline editing where appropriate
- Modal dialogs for destructive actions
- Confirmation patterns for sensitive changes
- Toast notifications for success/error feedback

**Shadcn Components:** `@shadcn/tabs`, `@shadcn/card`, `@shadcn/input`, `@shadcn/select`, `@shadcn/switch`, `@shadcn/dialog`, `@shadcn/toast`

---

### 5.9 Billing (Organization Mode Only)

**Layout:**
- Balance display in `Card` with `bg-muted/30`
- Subscription cards with hover effects
- Usage metrics with progress indicators
- Payment methods management

**Components:**
- Balance card with credit card icon
- Auto-reload settings in `Card`
- Subscription plans with `border-primary ring-1 ring-primary/20` for popular plan
- Transaction history table

**Guidelines:**
- Clear balance visibility
- Prominent payment action buttons
- Usage meters with visual indicators
- Professional, trustworthy design

**Shadcn Components:** `@shadcn/card`, `@shadcn/button`, `@shadcn/table`, `@shadcn/progress`, `@shadcn/switch`

---

### 5.10 Form Patterns (Universal)

**Standard Form Structure:**
1. **Basic Information** (Name, Description - always first)
2. **Primary Configuration** (Main feature settings)
3. **Additional Options** (Optional features, integrations)
4. **Advanced Options** (Accordion with advanced settings)

**Section Organization:**
- Use `Separator` between major sections
- Section headers: `text-sm font-semibold`
- Section descriptions: `text-xs text-foreground opacity-85`

**Guidelines:**
- Most important fields first
- Progressive disclosure for advanced options
- Clear field grouping with visual separation
- Validation feedback inline below fields

**Shadcn Components:** `@shadcn/input`, `@shadcn/label`, `@shadcn/textarea`, `@shadcn/select`, `@shadcn/checkbox`, `@shadcn/switch`, `@shadcn/separator`, `@shadcn/accordion`

---

### 5.11 Universal Patterns Summary

**All List Views:**
- Table layout (not cards)
- Pagination required
- Row click for primary navigation
- Actions in dropdown menu
- Status badges with clear hierarchy

**All Detail Views:**
- Tab-based navigation (single-level)
- Overview tab with key metrics
- Settings/Configuration tab
- Activity/History tab when applicable
- No card wrappers on tabs

**All Forms:**
- Basic info first
- Primary configuration next
- Additional options after
- Advanced options in accordion
- Section separators between major groups

**All Empty States:**
- Use `Empty` component
- Clear, actionable messaging
- Primary CTA with `size="lg"` button
- No marketing copy or illustrations

**Shadcn Components Used:** All features use the same Shadcn component library for consistency

---

## Part VI: Quality Standards

### 6.1 Enterprise Quality Bar

**Visual Quality:**
- Subtle, calm, credible enterprise-grade aesthetics
- High information density (not spacious)
- Professional polish that signals reliability

**Interaction Design:**
- Predictable, consistent patterns
- Clear visual affordances (buttons look like buttons)
- Smooth micro-interactions

**Information Architecture:**
- Clear hierarchy, high signal-to-noise ratio
- Scalable to hundreds/thousands of items
- No visual noise or decoration

**Usability:**
- Long-session usability (8+ hour workdays)
- Accessible (WCAG AA contrast standards)
- Fast scanning and navigation

---

### 6.2 Anti-Patterns (Forbidden)

**Visual Anti-Patterns:**
- ❌ Oversized typography (`text-xl`, `text-2xl` for titles)
- ❌ Excessive whitespace or padding
- ❌ Marketing-style UI inside application
- ❌ White card backgrounds (`bg-background`)
- ❌ Heavy borders, shadows, or visual noise
- ❌ Muted primary content text

**Structural Anti-Patterns:**
- ❌ Card-based layouts for lists (use tables)
- ❌ Infinite scroll (use pagination)
- ❌ Nested navigation (single-level only)
- ❌ Mixing user-scoped and tenant-scoped settings

**Component Anti-Patterns:**
- ❌ Using `Loader2` (use `Spinner` instead)
- ❌ Creating custom components that duplicate Shadcn
- ❌ Modifying Shadcn component source files
- ❌ Using `CardHeader` when inline headers suffice

---

## Part VII: Reference Checklists

### 7.1 Page-Level Validation Checklist

**Before finalizing any page, validate:**

**Typography:**
- [ ] Page title uses `text-lg font-semibold` (not larger)
- [ ] Page description uses `text-sm text-foreground` with `mt-0.5`
- [ ] Section headers use `text-sm font-semibold`
- [ ] All primary text uses `text-foreground` (NOT muted)
- [ ] Muted text only for form labels, placeholders, metadata

**Layout:**
- [ ] Sections use `space-y-6` spacing
- [ ] Form fields use `space-y-4` or `space-y-2`
- [ ] Cards use `bg-muted/30` background
- [ ] Cards use `CardContent` with `pt-6` (not full padding)

**Components:**
- [ ] All buttons use `size="sm"` (except empty state CTAs)
- [ ] All inputs use `h-9` height
- [ ] All labels use `text-xs text-muted-foreground`
- [ ] Loading states use `Spinner` (not `Loader2`)
- [ ] Empty states use `Empty` component

**Shadcn Usage:**
- [ ] Using Shadcn components (not custom duplicates)
- [ ] Components customized via className (not source modification)
- [ ] Examples referenced from Shadcn registry

---

### 7.2 Component Usage Checklist

**When using any component:**

**Shadcn Components:**
- [ ] Component installed via CLI or MCP
- [ ] Usage matches Shadcn examples
- [ ] Customization via className only
- [ ] No source file modifications

**Typography:**
- [ ] Labels: `text-xs text-muted-foreground`
- [ ] Help text: `text-xs text-foreground` (NOT muted)
- [ ] Headers: `text-sm font-semibold`
- [ ] Body: `text-sm` or `text-xs` with `text-foreground`

**Spacing:**
- [ ] Form sections: `space-y-4`
- [ ] Button groups: `gap-2`
- [ ] Icon + text: `gap-2`

**Accessibility:**
- [ ] Proper label associations
- [ ] ARIA attributes where needed
- [ ] Keyboard navigation support
- [ ] Focus management

---

### 7.3 Feature-Specific Checklist

**All List Views (Screen Agents, Knowledge, Teams, Members):**
- [ ] Table view (not cards)
- [ ] Pagination implemented (default 25 per page)
- [ ] Row click navigates to detail
- [ ] Actions in dropdown menu
- [ ] Status badges with clear hierarchy
- [ ] Empty state with actionable CTA

**All Detail Views (Screen Agents, Knowledge, Teams):**
- [ ] Tab-based navigation (single-level)
- [ ] Overview tab with key metrics
- [ ] Settings/Configuration tab
- [ ] No card wrappers on tab content
- [ ] Clear status visibility
- [ ] History/Activity accessible when applicable

**All Creation Forms:**
- [ ] Form sections separated with `Separator`
- [ ] Basic information first
- [ ] Primary configuration next
- [ ] Advanced options in accordion
- [ ] Clear validation and error messages
- [ ] Loading states with `Spinner`

**Dashboard:**
- [ ] High-level metrics only (not deep analytics)
- [ ] Primary CTAs visible
- [ ] Empty state with `Empty` component
- [ ] Quick navigation links
- [ ] No dense charts or historical drill-downs

**Analytics:**
- [ ] Deep insights and trends
- [ ] Date range selectors
- [ ] Filterable data tables
- [ ] Charts using `@shadcn/chart`
- [ ] Detailed metrics and reporting

**Settings:**
- [ ] Tabbed navigation (horizontal/vertical)
- [ ] Each section in `Card` with `bg-muted/30`
- [ ] Form patterns with proper spacing
- [ ] Confirmation dialogs for destructive actions
- [ ] Toast notifications for feedback

---

## Appendix A: Shadcn Component Quick Reference

### Layout Components
- **Card:** `@shadcn/card` - Use `bg-muted/30`, `CardContent` with `pt-6`
- **Separator:** `@shadcn/separator` - Section dividers
- **Tabs:** `@shadcn/tabs` - Tabbed content sections

### Form Components
- **Input:** `@shadcn/input` - Always `h-9` height
- **Label:** `@shadcn/label` - Use `text-xs text-muted-foreground`
- **Textarea:** `@shadcn/textarea` - Use `text-sm`
- **Select:** `@shadcn/select` - Dropdown selects
- **Checkbox:** `@shadcn/checkbox` - Checkboxes
- **Radio Group:** `@shadcn/radio-group` - Radio buttons
- **Switch:** `@shadcn/switch` - Toggle switches
- **Accordion:** `@shadcn/accordion` - Collapsible sections

### Feedback Components
- **Alert:** `@shadcn/alert` - Error/success messages
- **Badge:** `@shadcn/badge` - Status indicators
- **Spinner:** `@shadcn/spinner` - Loading indicators (preferred)
- **Skeleton:** `@shadcn/skeleton` - Skeleton loaders
- **Progress:** `@shadcn/progress` - Progress bars
- **Toast:** `@shadcn/toast` - Toast notifications (Sonner)

### Data Display Components
- **Table:** `@shadcn/table` - Data tables
- **Pagination:** `@shadcn/pagination` - Pagination controls
- **Empty:** `@shadcn/empty` - Empty states
- **Avatar:** `@shadcn/avatar` - User avatars

### Interactive Components
- **Button:** `@shadcn/button` - Use `size="sm"` in app
- **Dialog:** `@shadcn/dialog` - Modal dialogs
- **Dropdown Menu:** `@shadcn/dropdown-menu` - Dropdown menus
- **Popover:** `@shadcn/popover` - Popover overlays
- **Tooltip:** `@shadcn/tooltip` - Tooltips

### Accessing Shadcn Components

**Via MCP (Recommended):**
```typescript
// View component details
mcp_presenter-agent-ui-shadcn_view_items_in_registries({
  items: ["@shadcn/button"]
})

// Get usage examples
mcp_presenter-agent-ui-shadcn_get_item_examples_from_registries({
  registries: ["@shadcn"],
  query: "button-demo"
})

// Get installation command
mcp_presenter-agent-ui-shadcn_get_add_command_for_items({
  items: ["@shadcn/button"]
})
```

**Via CLI:**
```bash
pnpm dlx shadcn@latest add button
```

**Registry URL:**
- Main Registry: https://ui.shadcn.com
- Component Docs: https://ui.shadcn.com/docs/components/[component-name]
- Examples: Available via MCP tools

---

## Appendix B: Brand Guidelines Reference

**Color Palette:**
- Primary: Cornflower Blue `#568AFF`
- Secondary: Green-Blue `#0665BA`
- Rich Black: `#001320` (for text)

**Typography:**
- Headlines: Poppins Semi Bold (600)
- Body: Poppins Regular (400)
- Accent: Sofia Sans Extra Condensed (sparingly)

**Full Guidelines:** See `brand/brand.md` for complete brand guidelines

---

## Appendix C: Quick Reference Commands

### Explore Shadcn Components
```typescript
// List all available components
mcp_presenter-agent-ui-shadcn_list_items_in_registries({
  registries: ["@shadcn"],
  limit: 50
})

// Search for components
mcp_presenter-agent-ui-shadcn_search_items_in_registries({
  registries: ["@shadcn"],
  query: "form input"
})

// View specific components
mcp_presenter-agent-ui-shadcn_view_items_in_registries({
  items: ["@shadcn/button", "@shadcn/card"]
})
```

### Get Component Examples
```typescript
// Get examples by query
mcp_presenter-agent-ui-shadcn_get_item_examples_from_registries({
  registries: ["@shadcn"],
  query: "button-demo"
})

// Get add command
mcp_presenter-agent-ui-shadcn_get_add_command_for_items({
  items: ["@shadcn/button"]
})
```

---

**Document Status:** ✅ Complete  
**Last Updated:** January 2025  
**Component Library:** Shadcn UI (438+ components)  
**Next Review:** Quarterly or when major design system changes occur
