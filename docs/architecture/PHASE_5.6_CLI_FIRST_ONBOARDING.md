# Phase 5.6 — CLI-First Zero-Friction Onboarding

> **Phase Feature Statement:** _"I run `npx @autorail/kap10` in my project, it authenticates me, detects my IDE, connects my GitHub repos, analyzes my code, and configures MCP — zero copy-paste, zero dashboard clicks."_
>
> **Prerequisites:** [Phase 2 — Hosted MCP Server](./PHASE_2_HOSTED_MCP_SERVER.md) (MCP tools, auth, API keys)
>
> **Supersedes:** The manual multi-step flow (dashboard → connect GitHub → select repo → generate API key → copy → paste into CLI → configure MCP config file).

---

## Table of Contents

- [1. Motivation](#1-motivation)
- [2. Architectural Changes](#2-architectural-changes)
  - [2.1 Org-Level API Keys](#21-org-level-api-keys)
  - [2.2 RFC 8628 Device Authorization Flow](#22-rfc-8628-device-authorization-flow)
  - [2.3 CLI Connect Command](#23-cli-connect-command)
  - [2.4 Magic Default Command (Setup Wizard)](#24-magic-default-command-setup-wizard)
  - [2.5 UI Changes](#25-ui-changes)
- [3. New Endpoints](#3-new-endpoints)
- [4. Database Changes](#4-database-changes)
- [5. Files Changed](#5-files-changed)
- [6. Security Considerations](#6-security-considerations)

---

## 1. Motivation

The previous onboarding required 6+ steps across two interfaces (browser dashboard and terminal). Users had to:

1. Sign up on web → connect GitHub → select repo → wait for indexing
2. Navigate to Connect to IDE → generate API key → copy key
3. Run `kap10 auth login --key <paste>` → manually edit MCP config

This creates friction especially for developers evaluating the product. The new flow:

```
$ npx @autorail/kap10 connect
→ Opens browser for one-click OAuth approval
→ Auto-detects git remote + IDE
→ Writes MCP config → done
```

---

## 2. Architectural Changes

### 2.1 Org-Level API Keys

**Before:** API keys were repo-scoped (`repoId` required). Each repo needed its own key.

**After:** API keys can be org-scoped (`repoId` optional). An org-level key grants access to **all repos** in the organization. A `isDefault` flag marks the auto-provisioned key.

| Field | Before | After |
|-------|--------|-------|
| `repoId` | `String` (required) | `String?` (optional) |
| `isDefault` | — | `Boolean` (default `false`) |
| `repo` relation | `Repo` (required) | `Repo?` (optional) |

The MCP auth middleware (`lib/mcp/auth.ts`) handles null `repoId` by setting `McpAuthContext.repoId = undefined`, which grants org-wide access. The `McpAuthContext` interface already had `repoId?: string` so downstream tool handlers need no changes.

**Default key auto-provisioning:** When a user first authenticates via the CLI device flow, the token endpoint checks for an existing default key. If none exists, it generates one (`generateApiKey()`) and returns the raw key to the CLI. This happens once per org.

### 2.2 RFC 8628 Device Authorization Flow

Implements the [RFC 8628 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628) — the same flow used by GitHub CLI (`gh auth login`).

```
┌──────────┐                          ┌──────────────┐                    ┌─────────┐
│   CLI    │                          │  kap10 Server │                    │ Browser │
└────┬─────┘                          └──────┬───────┘                    └────┬────┘
     │                                       │                                 │
     │  POST /api/cli/device-code            │                                 │
     ├──────────────────────────────────────>│                                 │
     │  { device_code, user_code,            │                                 │
     │    verification_uri }                 │                                 │
     │<──────────────────────────────────────┤                                 │
     │                                       │                                 │
     │  open(verification_uri?code=XXXX)     │                                 │
     ├───────────────────────────────────────────────────────────────────────>│
     │                                       │                                 │
     │                                       │    GET /cli/authorize?code=XXXX │
     │                                       │<────────────────────────────────┤
     │                                       │    Show code + "Authorize CLI"  │
     │                                       ├────────────────────────────────>│
     │                                       │                                 │
     │                                       │    Click "Authorize CLI"        │
     │                                       │<────────────────────────────────┤
     │                                       │    Update Redis: approved       │
     │                                       │                                 │
     │  POST /api/cli/token (polling)        │                                 │
     ├──────────────────────────────────────>│                                 │
     │  { access_token, org_id, org_name }   │                                 │
     │<──────────────────────────────────────┤                                 │
     │                                       │                                 │
     │  Save to ~/.kap10/credentials.json    │                                 │
     │                                       │                                 │
```

**State management:** Device flow state lives entirely in Redis with 10-minute TTL:
- `cli:device:{device_code}` → `{ userCode, status, userId?, orgId?, orgName? }`
- `cli:usercode:{user_code}` → `device_code` (reverse lookup for the authorize page)

**User code format:** 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no ambiguous I/O/0/1), formatted as `XXXX-XXXX`.

### 2.3 CLI Connect Command

The `kap10 connect` command is the "golden path" — a single command that handles everything:

```
kap10 connect [--server <url>] [--key <apiKey>] [--ide <type>]
```

**Steps:**
1. **Auth check** — If no credentials in `~/.kap10/credentials.json`, runs device auth flow inline
2. **Git detection** — Parses `git remote get-url origin` and `git branch --show-current`
3. **Repo lookup** — Calls `GET /api/cli/context?remote=<url>` to check if repo is on kap10
4. **IDE config** — Detects IDE (`.cursor/` or `.vscode/` directories) and writes MCP config:
   - **Cursor**: Writes/merges `.cursor/mcp.json`
   - **VS Code**: Writes/merges `.vscode/settings.json`
   - **Claude Code**: Prints `claude mcp add` command
5. **Done** — Prints summary

**Credentials stored at:** `~/.kap10/credentials.json` (mode `0o600`):
```json
{
  "serverUrl": "https://app.kap10.dev",
  "apiKey": "kap10_sk_...",
  "orgId": "...",
  "orgName": "..."
}
```

### 2.4 Magic Default Command (Setup Wizard)

Running `npx @autorail/kap10` with no subcommand now launches a full interactive setup wizard. This replaces the previous behavior (showing help text) with the onboarding golden path.

```
$ npx @autorail/kap10

  kap10  Code intelligence for AI agents

  ● Authenticating...
    ✓ Authenticated as Jaswanth's Organization

  ● Detecting coding agent...
    ✓ Detected Cursor

  ● Detecting repository...
    ✓ GitHub repo: jaswanth/kap10-server (main)

  ● Checking kap10...
    This repo isn't on kap10 yet.

  ● GitHub connection...
    ? Install kap10 GitHub App to connect your repos? › (Y/n)
    Opening browser to install kap10 GitHub App...
    Waiting for GitHub App installation... ⠋
    ✓ GitHub App installed for jaswanth

  ● Repository setup...
    ? Select repos to analyze:
    ❯ ◉ jaswanth/kap10-server (TypeScript, private)
      ○ jaswanth/other-repo (Python)
    ✓ Added 1 repo(s) — indexing started

  ● Analyzing repository...
    ⠋ Indexing... 72%
    ✓ Analysis complete — 150 files, 1,234 functions, 89 classes

  ● Configuring Cursor...
    ✓ Written: .cursor/mcp.json
    ✓ Installed git hooks

  ✓ Ready! Your AI agent now has access to your codebase graph.

    Logs: .kap10/logs/setup-2026-02-23.log
```

**Nine-step flow:**

| Step | What | Smart behavior |
|------|------|----------------|
| 1. Auth | Device code flow or API key | Skip if already authenticated |
| 2. IDE detect | Auto-detect or interactive prompt | Checks env vars, process ancestry, directory markers |
| 3. Git detect | Parse remote, classify host | Distinguishes GitHub/GitLab/Bitbucket/other |
| 4. Repo check | Look up on kap10 | Skip to MCP config if already indexed |
| 5a. GitHub flow | Install app → select repos → trigger indexing | Only for github.com repos |
| 5b. Local flow | Init → upload zip → trigger indexing | For non-GitHub or no-remote repos |
| 6. Poll indexing | Progress spinner with status | Exponential backoff polling |
| 7. MCP config | Write IDE-specific config files | Cursor, VS Code, Windsurf, Claude Code |
| 8. Git hooks | Install post-checkout/post-merge | Append-safe, non-blocking |
| 9. Done | Summary + log path | All details in `.kap10/logs/` |

**IDE detection priority chain:**

1. `CURSOR_TRACE_ID` env → Cursor
2. `CLAUDE_CODE` env or process ancestry → Claude Code
3. `TERM_PROGRAM=vscode` with Cursor paths → Cursor
4. `.cursor/` directory → Cursor
5. `.windsurf/` directory → Windsurf
6. `TERM_PROGRAM=vscode` → VS Code
7. `.vscode/` directory → VS Code
8. Interactive prompt with `prompts` library (Cursor, Claude Code, VS Code, Windsurf)

**GitHub App installation from CLI:**

The CLI initiates a browser-based GitHub App install that doesn't require a web session:

1. CLI calls `POST /api/cli/github/install` with API key auth
2. Server creates a state token with `cliPollToken` in Redis
3. CLI opens browser to `https://github.com/apps/kap10-dev/installations/new?state=xxx`
4. User installs GitHub App on GitHub
5. GitHub redirects to `/api/github/callback` which processes the installation
6. Callback detects `cliPollToken` in state → signals completion via Redis
7. CLI polls `GET /api/cli/github/install/poll?token=xxx` and detects completion

The callback supports both web (session auth) and CLI (state-token auth) flows. For CLI flows, the orgId is trusted from the state token (which was created by an authenticated API key request).

**Logging:** All API calls and responses are logged to `.kap10/logs/setup-{date}.log`. On any error, the CLI prints the log path for debugging.

**Options:** `npx @autorail/kap10 [--server <url>] [--key <apiKey>] [--ide <type>]`

**Existing `connect` command preserved:** `kap10 connect` still works as before for users who prefer the explicit subcommand.

### 2.5 UI Changes

The Connect to IDE page (`/repos/{id}/connect`) now has:

1. **Primary CTA**: `npx @autorail/kap10 connect` command in a highlighted card
2. **Collapsible "Manual setup"**: The existing 4-client picker (Cursor/Claude Code/VS Code/CI) with API key management, behind an accordion

This preserves the full manual path for users who prefer copy-paste while steering new users toward the CLI.

---

## 3. New Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/cli/device-code` | None (public) | Generate device_code + user_code pair |
| `POST` | `/api/cli/token` | None (public) | Poll for approval, exchange for API key |
| `GET` | `/api/cli/context` | API key (Bearer) | Look up repo by git remote URL |
| `GET` | `/cli/authorize` | Session (cookie) | Browser page to approve CLI auth |
| `GET` | `/api/cli/github/installations` | API key (Bearer) | List GitHub App installations for the org |
| `POST` | `/api/cli/github/install` | API key (Bearer) | Initiate GitHub App installation (returns install URL + poll token) |
| `GET` | `/api/cli/github/install/poll` | API key (Bearer) | Poll GitHub App installation status |
| `GET` | `/api/cli/github/repos` | API key (Bearer) | List available GitHub repos from installations |
| `POST` | `/api/cli/repos` | API key (Bearer) | Add repos and trigger indexing workflows |
| `GET` | `/api/cli/repos/[repoId]/status` | API key (Bearer) | Poll repo indexing status and progress |

**Public path configuration:** `/api/cli` prefix added to `proxy.ts` public paths. The device-code and token endpoints must be unauthenticated (the CLI doesn't have credentials yet). All other CLI endpoints use API key auth validated inside their handlers via `authenticateMcpRequest`.

---

## 4. Database Changes

**Migration:** `supabase/migrations/20260223000000_org_level_api_keys.sql`

```sql
ALTER TABLE kap10.api_keys ALTER COLUMN repo_id DROP NOT NULL;
ALTER TABLE kap10.api_keys ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT false;
```

**Prisma schema change:** `repoId String?`, `isDefault Boolean @default(false)`, `repo Repo?`

---

## 5. Files Changed

### Database & Schema
| File | Change |
|------|--------|
| `prisma/schema.prisma` | `repoId` optional, `isDefault` field, `repo` optional |
| `supabase/migrations/20260223000000_org_level_api_keys.sql` | Migration |

### Ports & Adapters
| File | Change |
|------|--------|
| `lib/ports/relational-store.ts` | `ApiKeyRecord.repoId: string \| null`, `isDefault`, `getDefaultApiKey()` |
| `lib/adapters/prisma-relational-store.ts` | Implementation of new interface |
| `lib/di/fakes.ts` | In-memory store matches new interface |
| `lib/mcp/auth.ts` | Handle null `repoId` → `undefined` in auth context |

### API Routes (new + modified)
| File | Change |
|------|--------|
| `app/api/cli/device-code/route.ts` | **New** — RFC 8628 device code generation |
| `app/api/cli/token/route.ts` | **New** — Token exchange + default key provisioning |
| `app/api/cli/context/route.ts` | **New** — Git remote → repo lookup |
| `app/api/cli/github/installations/route.ts` | **New** — List GitHub installations (API key auth) |
| `app/api/cli/github/install/route.ts` | **New** — Initiate GitHub App install from CLI |
| `app/api/cli/github/install/poll/route.ts` | **New** — Poll GitHub App installation status |
| `app/api/cli/github/repos/route.ts` | **New** — List available GitHub repos (API key auth) |
| `app/api/cli/repos/route.ts` | **New** — Add repos + trigger indexing (API key auth) |
| `app/api/cli/repos/[repoId]/status/route.ts` | **New** — Poll indexing status |
| `app/api/github/callback/route.ts` | **Modified** — Dual-mode: web (session) + CLI (state-token) flows |

### UI (new + modified)
| File | Change |
|------|--------|
| `app/(dashboard)/cli/authorize/page.tsx` | **New** — Browser authorization page |
| `app/(dashboard)/cli/authorize/cli-authorize-form.tsx` | **New** — Client-side authorize form |
| `app/(dashboard)/cli/authorize/actions.ts` | **New** — Server action to approve device |
| `components/repo/connect-ide.tsx` | CLI-first primary CTA, manual setup in accordion |
| `app/(dashboard)/settings/api-keys/api-keys-settings.tsx` | `repoId` type updated to `string \| null` |
| `app/(dashboard)/settings/api-keys/page.tsx` | Shows "All repositories" for org-level keys |

### CLI
| File | Change |
|------|--------|
| `packages/cli/src/commands/auth.ts` | Rewritten with device auth flow |
| `packages/cli/src/commands/connect.ts` | **New** — Golden path command (explicit subcommand) |
| `packages/cli/src/commands/setup.ts` | **New** — Magic default command (full onboarding wizard) |
| `packages/cli/src/utils/ui.ts` | **New** — Branded terminal output (colors, sections, spinners) |
| `packages/cli/src/utils/log.ts` | **New** — File logger to `.kap10/logs/` |
| `packages/cli/src/utils/detect.ts` | **New** — Git host + IDE detection (auto-detect + prompt) |
| `packages/cli/src/index.ts` | Default action → `runSetup()`, register all commands |
| `packages/cli/package.json` | Added `picocolors`, `ora`, `prompts` dependencies |

### Infrastructure
| File | Change |
|------|--------|
| `proxy.ts` | `/api/cli` added to public paths |
| `app/api/api-keys/route.ts` | `repoId` optional in POST |

---

## 6. Security Considerations

- **Device codes** expire after 10 minutes (Redis TTL). Single-use — deleted after successful exchange.
- **User codes** use an unambiguous character set (no I/O/0/1) to prevent typos.
- **API key auth** on `/api/cli/context` prevents unauthorized repo enumeration.
- **Default API key** is returned in the raw form exactly once (during device flow token exchange). After that, only the prefix is stored in the database.
- **Credentials file** at `~/.kap10/credentials.json` is created with mode `0o600` (owner-only read/write).
- **No secrets in proxy bypass** — the public paths (`/api/cli/*`) only expose the device flow endpoints. The authorize page (`/cli/authorize`) remains session-protected behind the proxy.

---

## 7. Advanced Architectural Enhancements

### 7.1 Decentralized AST Extraction (Local MapReduce)

**Problem:** For local repositories not on GitHub, the CLI currently zips the code and uploads it to Supabase for the heavy Temporal workers to parse (Phase 5.5's `kap10 push`). For a 2 GB enterprise monorepo, this upload takes forever and introduces major security concerns — proprietary source code leaves the developer's machine.

**Solution:** Move the `heavy-compute-rust` binary (from Phase ∞) directly into the CLI package. When a user runs `kap10 connect`, the CLI parses the AST, extracts the entity graph, and hashes entities *locally on the developer's machine*. Only a lightweight JSON payload of the graph topology (entity metadata, edges, hashes — no source code text) is sent to the cloud.

```
Local MapReduce Pipeline:

kap10 connect (or kap10 push --local-parse)
  │
  ▼
CLI binary (kap10-parse-local, Rust or WASM):
  1. Scan workspace (git ls-files or fs walk)
  2. Detect languages (extension map)
  3. For each file:
     a) Parse AST via tree-sitter (bundled grammars)
     b) Extract entities: functions, classes, methods, interfaces
     c) Compute entityHash (SHA-256, NUL-joined)
     d) Extract call/import edges
  4. Build graph topology JSON:
     { entities: [{ key, kind, name, filePath, startLine, endLine, signature }],
       edges: [{ fromKey, toKey, kind }],
       fileHashes: { path: sha256 } }
     NOTE: No entity `body` field — source code text stays local
  │
  ▼
CLI uploads JSON (typically 1-5 MB) to POST /api/cli/graph-upload
  │
  ▼
Server writes entities + edges to ArangoDB (same as indexing pipeline)
Server triggers embedding workflow for entities (server-side only,
  uses entity names/signatures, NOT body text)
```

**What goes to the cloud vs what stays local:**

| Data | Sent to cloud? | Why |
|------|---------------|-----|
| Entity metadata (name, kind, file path, line numbers, signature) | Yes | Needed for graph queries, MCP tools, search |
| Entity body (source code text) | **No** | Privacy. Only sent if user explicitly opts in (`--include-bodies`) |
| Edge relationships (calls, imports, extends) | Yes | Needed for graph traversal, impact analysis |
| File hashes (content SHA) | Yes | Needed for incremental indexing (detect changes) |
| `.scip` index file | **No** | Parsed locally, only extracted metadata sent |
| Full file content | **No** | Never uploaded in local-parse mode |

**Binary distribution:** The Rust parse binary is cross-compiled for macOS (x86_64 + aarch64), Linux (x86_64 + aarch64), and Windows (x86_64). Distributed as an npm optional dependency or downloaded on first run (like `esbuild` or `turbo`).

**Fallback:** If the local Rust binary is unavailable (unsupported platform, download failure), the CLI falls back to the existing zip-upload path (Phase 5.5's `kap10 push`). The local-parse path is an optimization, never a gate.

### 7.2 Ephemeral Sandbox Mode

**Problem:** Developers want to test kap10 on a quick side-project, but doing so pollutes their org's permanent ArangoDB and pgvector databases with entities that will never be maintained.

**Solution:** Add an `--ephemeral` flag to `kap10 connect`. This provisions a temporary, isolated namespace with a strict 4-hour TTL.

```
kap10 connect --ephemeral
```

**Architecture:**

```
Ephemeral Namespace:
  ArangoDB: org_{orgId}_ephemeral_{uuid}/
    └── All standard collections (entities, edges, files, etc.)
    └── TTL: 4 hours from creation

  pgvector: kap10.entity_embeddings WHERE namespace = 'ephemeral_{uuid}'
    └── Filtered by namespace column (not separate table)
    └── Cleanup: DELETE WHERE namespace = 'ephemeral_{uuid}'

  Supabase: kap10.repos WHERE ephemeral = true AND ephemeral_expires_at < now()
    └── Auto-cleaned by cleanupWorkspacesWorkflow cron

  Redis: mcp:session:* WHERE namespace = 'ephemeral_{uuid}'
    └── Auto-expires via existing TTL
```

**Lifecycle:**

1. `kap10 connect --ephemeral` → Server creates repo with `ephemeral: true`, `ephemeral_expires_at: now() + 4h`
2. CLI indexes locally (using local-parse if available) or uploads zip
3. MCP connection established — all tools work normally within the ephemeral namespace
4. After 4 hours (or when CLI process is killed):
   a. Server triggers `deletionAuditWorkflow` (Temporal)
   b. Workflow deletes: ArangoDB org database, pgvector rows, Supabase repo record, Redis sessions
   c. Audit log entry written: `{ action: "ephemeral_cleanup", orgId, repoId, entityCount, timestamp }`
5. If user wants to keep: `kap10 promote` converts ephemeral → permanent (removes TTL, keeps data)

**Database changes:**
- `kap10.repos`: Add `ephemeral Boolean @default(false)`, `ephemeral_expires_at DateTime?`
- `cleanupWorkspacesWorkflow`: Extended to query `WHERE ephemeral = true AND ephemeral_expires_at < now()`

### 7.3 Self-Healing MCP Configuration

**Problem:** AI agents (Cursor, Claude Code) frequently overwrite, corrupt, or drop MCP config files (`.cursor/mcp.json`, `.vscode/settings.json`) during updates or user error, breaking the kap10 connection silently. Users experience "Why isn't the AI seeing my rules?" without realizing the config was damaged.

**Solution:** When the CLI establishes a connection, install a lightweight integrity watchdog that verifies the IDE's MCP config file and silently repairs it if the kap10 server entry is missing or corrupted.

**Implementation — Two complementary strategies:**

**Strategy A: Git Hook (post-checkout, post-merge)**

```
kap10 connect installs:
  .git/hooks/post-checkout  (or appends to existing)
  .git/hooks/post-merge     (or appends to existing)

Hook script (bash):
  #!/bin/sh
  # kap10 MCP config integrity check
  kap10 config verify --silent 2>/dev/null || true
```

`kap10 config verify --silent`:
1. Read `.cursor/mcp.json` (or `.vscode/settings.json` depending on detected IDE)
2. Check if kap10 server entry exists with correct URL and API key
3. If missing or corrupted:
   a. Re-inject kap10 server config (merge, don't overwrite other entries)
   b. Log: `"kap10: MCP config repaired (server entry was missing)"`
4. If correct: exit silently (zero output)

**Strategy B: Background Watchdog (optional, for `kap10 watch` mode)**

When `kap10 watch` is running (Phase 5.5), add a periodic config check:
1. Every 60 seconds, verify MCP config integrity
2. If damaged, repair silently and log
3. On repair, send a brief notification to the terminal: `"⚡ kap10: Repaired MCP config (was corrupted by IDE update)"`

**Config repair logic (merge, not overwrite):**

```
Repair Algorithm:

1. Read existing config file (e.g., .cursor/mcp.json)
2. Parse as JSON (if parse fails → treat as empty {})
3. Check for kap10 entry in mcpServers:
   Expected: { "mcpServers": { "kap10": { "url": "...", "headers": { ... } } } }
4. If kap10 entry missing OR url/headers incorrect:
   a. Preserve ALL other mcpServers entries unchanged
   b. Set/overwrite ONLY the "kap10" key with correct config
   c. Write back to file
5. If kap10 entry correct: do nothing
```

**Safety guarantees:**
- Never overwrites non-kap10 MCP server entries
- Never runs if `kap10 connect` was never run in this repo (checks `.kap10/config.json` exists)
- Git hooks are append-safe (check if hook already contains kap10 line before adding)
- Watchdog is opt-in (only active during `kap10 watch`)

### 7.4 Ephemeral "Dirty State" Overlay (Real-Time Uncommitted Context)

**Problem:** The local MCP server syncs via Git, but developers frequently ask the AI about code they are actively typing (unsaved or uncommitted files). If the agent queries the local proxy (Phase 10) or cloud ArangoDB, it gets the last committed state, leading to massive context collisions where the AI suggests changes to code that no longer exists.

**Solution:** Create an **In-Memory Overlay Graph** for uncommitted changes. When the IDE sends the current dirty buffer to kap10, run a hyper-fast, localized `ast-grep` pass just on those dirty lines. Instead of writing this to the database, project these changes as an "Overlay Mask" over the query router. When the agent asks "What does this function do?", the router prioritizes the dirty in-memory mask over the persistent database.

```
Dirty State Overlay Architecture:

Data Flow:
  IDE → (on keystroke debounce, 2s) → MCP tool: sync_dirty_buffer
    Input: { filePath, content, cursorLine?, language }

  MCP handler:
    1. Run lightweight ast-grep parse on the dirty content:
       - Extract entity signatures (function names, class names, parameters)
       - Extract import statements
       - Do NOT extract full body text (too expensive for real-time)
       - Timeout: 500ms per file (hard cap — never block agent)
    2. Store in Redis ephemeral overlay:
       Key: kap10:dirty:{sessionId}:{filePath}
       Value: {
         entities: [{ kind, name, signature, startLine, endLine }],
         imports: [{ module, symbols }],
         updatedAt: ISO timestamp
       }
       TTL: 30 seconds (auto-expires if IDE stops sending)
    3. Return: { overlayActive: true, entitiesDetected: N }

Query Resolution (Overlay-Aware):
  When any MCP tool queries entities (get_function, search_code, etc.):
    1. Query persistent store (ArangoDB) as normal → baseResults
    2. Check Redis for dirty overlay entries for this session:
       SCAN kap10:dirty:{sessionId}:*
    3. For each overlay entry:
       a) If overlay entity matches a baseResult by (kind + name + filePath):
          → REPLACE the base entity with the overlay version
          → Mark in response: _meta.source = "dirty_buffer"
       b) If overlay entity is NEW (no match in base):
          → ADD to results
          → Mark: _meta.source = "dirty_buffer"
       c) If base entity's file has a dirty overlay but entity is GONE:
          → Mark as potentially deleted: _meta.source = "dirty_buffer_deleted"
    4. Return merged results

  Priority chain: dirty_buffer > workspace_overlay > ArangoDB > pgvector

Storage:
  Redis only — never touches ArangoDB or pgvector for dirty state.
  Auto-cleanup via TTL (30s). If IDE disconnects, overlays expire silently.
  No persistence needed — dirty state is inherently ephemeral.

Edge Cases:
  - Multiple files dirty simultaneously: Each file has its own Redis key. Overlay merge
    handles multi-file queries correctly.
  - Syntax errors in dirty buffer: ast-grep parse may fail. On failure, store the
    file path as "dirty but unparseable" — MCP tools will warn the agent:
    "This file has unsaved changes that couldn't be parsed. Results may be stale."
  - Race condition (save → dirty → save): The 2s debounce + 30s TTL ensures
    dirty state never outlives the actual edit session. Saving triggers
    sync_local_diff (Phase 5.5) which updates the persistent store.
  - kap10 watch integration: If kap10 watch is running (Phase 5.5), it detects
    file saves and triggers sync_local_diff, which updates ArangoDB. The dirty
    overlay then expires naturally. No conflict.
```

**Configuration:**
- `DIRTY_OVERLAY_ENABLED` env var (default: `true`)
- `DIRTY_OVERLAY_TTL` env var (default: `30` — seconds before dirty entry expires)
- `DIRTY_OVERLAY_DEBOUNCE` env var (default: `2000` — ms debounce for IDE keystroke events)
- `DIRTY_OVERLAY_PARSE_TIMEOUT` env var (default: `500` — ms timeout for ast-grep on dirty buffer)

**Why Redis (not in-memory on the MCP server process):** The MCP server may be a stateless Vercel function or a multi-instance deployment behind a load balancer. Redis provides session-scoped ephemeral storage accessible by any server instance handling the agent's requests. The 30s TTL ensures zero long-term storage cost.

---

## 8. Implementation Tracker — Advanced Enhancements

### P5.6-ADV-01: Local AST Extraction Binary

- [x] **Status:** Partial — `--local-parse` flag declared in push.ts but is a dead option; Rust binary and download script not created (blocked by Phase ∞ RUST-07)
- **Description:** Package the Phase ∞ Rust `kap10-parse-rest` binary (or a subset) for distribution with the CLI. Cross-compile for macOS/Linux/Windows.
- **Binary scope:** tree-sitter parsing + entity extraction + hash computation. Does NOT include SCIP (SCIP requires language-specific indexer binaries installed separately). Does NOT include ArangoDB write (output goes to stdout JSON).
- **Files:**
  - `workers/heavy-compute-rust/src/bin/kap10-parse-local.rs` (new — CLI-specific entry point)
  - `packages/cli/scripts/download-binary.ts` (new — post-install binary download)
  - `packages/cli/src/commands/push.ts` (modify — add `--local-parse` flag)
- **Testing:** Binary produces correct entity graph JSON for TypeScript/Python/Go repos. Entity hashes match server-side computation. Binary runs on macOS ARM, macOS x86, Linux x86. Fallback to zip-upload works when binary unavailable.
- **Blocked by:** Phase ∞ RUST-07 (kap10-parse-rest binary)
- **Notes:** Can ship independently of Phase ∞ by extracting a minimal Rust crate that only does tree-sitter + hashing (no SCIP, no ArangoDB).

### P5.6-ADV-02: Graph-Only Upload Endpoint

- [x] **Status:** Complete
- **Description:** New API endpoint `POST /api/cli/graph-upload` that accepts the lightweight graph topology JSON (entities + edges, no source code bodies) from local-parse mode.
- **Input:** `{ repoId, entities: EntityDoc[], edges: EdgeDoc[], fileHashes: Record<string, string> }`
- **Handler:** Validates entity shapes, writes to ArangoDB via `IGraphStore.bulkUpsertEntities/Edges`, triggers embedding workflow (using entity names/signatures only).
- **Files:**
  - `app/api/cli/graph-upload/route.ts` (new)
- **Testing:** Upload succeeds. Entities written to ArangoDB. Embedding workflow triggered. Invalid shapes rejected with 400. Auth required (API key).
- **Blocked by:** P5.6-ADV-01

### P5.6-ADV-03: Ephemeral Sandbox Mode

- [x] **Status:** Partial — Prisma ephemeral fields exist, deletion-audit.ts has lifecycle functions, but: connect.ts missing --ephemeral flag, promote.ts not created, init/route.ts doesn't handle ephemeral, no separate ephemeral-cleanup.ts activity
- **Description:** Add `--ephemeral` flag to `kap10 connect`. Provisions temporary isolated namespace with 4-hour TTL.
- **Database changes:**
  - Add `ephemeral Boolean @default(false)` and `ephemeral_expires_at DateTime?` to `kap10.repos` Prisma model
  - Supabase migration for new columns
- **Server changes:**
  - `POST /api/cli/init`: Accept `ephemeral: true` → set TTL, create isolated ArangoDB namespace
  - `cleanupWorkspacesWorkflow`: Extended to delete expired ephemeral repos + their ArangoDB data + pgvector rows
  - `deletionAuditWorkflow`: New workflow that handles the full cleanup sequence with audit logging
- **CLI changes:**
  - `kap10 connect --ephemeral`: Sets ephemeral flag, shows TTL countdown in terminal
  - `kap10 promote`: New command to convert ephemeral → permanent
- **Files:**
  - `prisma/schema.prisma` (modify — add ephemeral fields)
  - `supabase/migrations/2026XXXX_ephemeral_repos.sql` (new)
  - `packages/cli/src/commands/connect.ts` (modify — add `--ephemeral` flag)
  - `packages/cli/src/commands/promote.ts` (new)
  - `lib/temporal/workflows/deletion-audit.ts` (new)
  - `lib/temporal/activities/ephemeral-cleanup.ts` (new)
  - `app/api/cli/init/route.ts` (modify — ephemeral handling)
- **Testing:** Ephemeral repo created with TTL. Cleanup runs after expiry. ArangoDB + pgvector + Supabase data deleted. Audit log written. `kap10 promote` removes ephemeral flag and TTL. Multiple ephemeral repos don't interfere.
- **Blocked by:** Nothing

### P5.6-ADV-04: Self-Healing MCP Configuration

- [x] **Status:** Partial — config-verify.ts exists with verify+repair+install-hooks subcommands, but: connect.ts doesn't auto-install git hooks, watch.ts missing 60s config check loop, config-healer.ts not extracted as standalone module
- **Description:** Install git hooks and optional background watchdog to detect and repair corrupted MCP config files.
- **Git hooks:**
  - `post-checkout` and `post-merge` hooks that run `kap10 config verify --silent`
  - Append-safe: check for existing kap10 line before adding
  - Non-blocking: failures are silent (`|| true`)
- **Config verify command:**
  - `kap10 config verify [--silent]`: Check MCP config integrity, repair if needed
  - Merge-safe: only modifies the `kap10` key in `mcpServers`, preserves all others
  - `--silent`: No output on success, brief log on repair
- **Watchdog integration:**
  - `kap10 watch` gains a 60-second config integrity check loop
  - On repair: terminal notification `"⚡ kap10: Repaired MCP config"`
- **Files:**
  - `packages/cli/src/commands/config.ts` (new — `kap10 config verify`)
  - `packages/cli/src/config-healer.ts` (new — repair logic: read, parse, merge, write)
  - `packages/cli/src/commands/connect.ts` (modify — install git hooks after MCP config write)
  - `packages/cli/src/commands/watch.ts` (modify — add config check loop)
- **Testing:** Missing kap10 entry → repaired. Corrupted JSON → repaired (other entries preserved). Correct config → no changes. Git hooks installed correctly. Hooks don't break existing hooks. Watchdog detects and repairs within 60s. Non-kap10 MCP servers never modified.
- **Blocked by:** Nothing

### P5.6-ADV-05: Dirty State Overlay (In-Memory Uncommitted Context)

- [x] **Status:** Partial — dirty-buffer.ts complete with sync_dirty_buffer tool + resolveEntityWithOverlay, registered in index.ts, env vars configured. Missing: lib/mcp/overlay/dirty-state.ts not extracted, search.ts/inspect.ts/graph.ts not wired with overlay-aware resolution
- **Description:** Implement real-time in-memory overlay for uncommitted/unsaved file changes using Redis ephemeral storage.
- **New MCP tool:** `sync_dirty_buffer` — accepts `{ filePath, content, cursorLine?, language }`, runs lightweight ast-grep parse (500ms timeout), stores entity signatures in Redis with 30s TTL.
- **Query integration:** All entity-querying MCP tools gain overlay-aware resolution: check Redis for dirty entries → merge with ArangoDB base results → mark `_meta.source = "dirty_buffer"` on overlay entities.
- **Priority chain:** dirty_buffer > workspace_overlay > ArangoDB > pgvector
- **IDE integration:** Cursor/VS Code extensions debounce keystrokes (2s) and call `sync_dirty_buffer` with current buffer content.
- **Files:**
  - `lib/mcp/tools/dirty-buffer.ts` (new — sync_dirty_buffer MCP tool)
  - `lib/mcp/overlay/dirty-state.ts` (new — Redis overlay read/write + merge logic)
  - `lib/mcp/tools/search.ts` (modify — overlay-aware query resolution)
  - `lib/mcp/tools/inspect.ts` (modify — overlay-aware entity lookup)
  - `lib/mcp/tools/graph.ts` (modify — overlay-aware graph traversal)
  - `lib/mcp/tools/index.ts` (modify — register sync_dirty_buffer)
- **Testing:** Dirty buffer stored in Redis with TTL. Overlay entities merged into query results. Overlay expires after 30s. Parse failure → graceful fallback (warning, not error). Multiple dirty files → correct merge. Save triggers sync_local_diff → overlay expires naturally.
- **Blocked by:** Phase 2 MCP tools, Phase 5.5 sync_local_diff

### P5.6-TEST-ADV-01: Local Parse Integration

- [x] **Status:** Not started — local-parse.test.ts not created
- **Test cases:**
  - Local parse produces entity graph JSON matching server-side extraction
  - Entity hashes are byte-identical between local Rust binary and server TypeScript
  - Graph-upload endpoint writes correct data to ArangoDB
  - Fallback to zip-upload when local binary unavailable
  - Large repo (10K files) completes local parse in <30s
- **Files:**
  - `packages/cli/src/__tests__/local-parse.test.ts` (new)
- **Blocked by:** P5.6-ADV-01, P5.6-ADV-02

### P5.6-TEST-ADV-02: Ephemeral Sandbox Lifecycle

- [x] **Status:** Not started — ephemeral.test.ts and deletion-audit.test.ts not created
- **Test cases:**
  - `--ephemeral` creates repo with TTL
  - MCP tools work within ephemeral namespace
  - Cleanup deletes all data after TTL
  - `kap10 promote` removes ephemeral flag
  - Audit log written on cleanup
  - Concurrent ephemeral repos don't interfere
- **Files:**
  - `packages/cli/src/__tests__/ephemeral.test.ts` (new)
  - `lib/temporal/workflows/__tests__/deletion-audit.test.ts` (new)
- **Blocked by:** P5.6-ADV-03

### P5.6-TEST-ADV-03: Dirty State Overlay

- [x] **Status:** Partial — dirty-buffer.test.ts exists (3 tests), but dirty-state.test.ts not created
- **Test cases:**
  - Dirty buffer → entities extracted and stored in Redis with 30s TTL
  - MCP `get_function` → returns dirty version instead of stale ArangoDB version
  - MCP `search_code` → dirty entities appear in results with `_meta.source = "dirty_buffer"`
  - TTL expiry → overlay removed, queries return to ArangoDB version
  - Parse failure on dirty buffer → warning returned, base results unaffected
  - Multiple dirty files → correct merge across all files
  - New entity in dirty buffer (not in ArangoDB) → included in results
  - Entity deleted in dirty buffer → marked `_meta.source = "dirty_buffer_deleted"`
  - File save → sync_local_diff updates ArangoDB, dirty overlay expires naturally
  - `DIRTY_OVERLAY_ENABLED=false` → sync_dirty_buffer returns no-op
- **Files:**
  - `lib/mcp/overlay/__tests__/dirty-state.test.ts` (new)
  - `lib/mcp/tools/__tests__/dirty-buffer.test.ts` (new)
- **Blocked by:** P5.6-ADV-05

### P5.6-TEST-ADV-04: Self-Healing Config

- [x] **Status:** Partial — config-healer.test.ts exists (2 tests) but only tests filesystem ops, doesn't test actual repairIdeConfig function or verify command
- **Test cases:**
  - Missing kap10 entry → repaired correctly
  - Corrupted MCP JSON → repaired, other servers preserved
  - Correct config → no modification (file unchanged)
  - Git hooks installed without breaking existing hooks
  - Watchdog detects corruption within 60s
  - Repair log emitted on fix
- **Files:**
  - `packages/cli/src/__tests__/config-healer.test.ts` (new)
- **Blocked by:** P5.6-ADV-04

---

## Revision Log

| Date | Author | Change |
|------|--------|--------|
| 2026-02-21 | — | Initial document created. CLI-First Zero-Friction Onboarding: Device Auth Flow, org-level API keys, `kap10 connect` golden path command, IDE auto-detection. |
| 2026-02-21 | — | Added Section 7 "Advanced Architectural Enhancements": Decentralized AST Extraction (local MapReduce), Ephemeral Sandbox Mode, Self-Healing MCP Configuration. Section 8 tracker: 4 implementation items (P5.6-ADV-01..04), 3 test items (P5.6-TEST-ADV-01..03). |
| 2026-02-21 | — | Added Dirty State Overlay (in-memory uncommitted context via Redis). New: P5.6-ADV-05 (dirty buffer MCP tool + overlay merge), P5.6-TEST-ADV-03 (dirty state tests), renumbered self-healing config test to P5.6-TEST-ADV-04. Total advanced tracker items: **10** (5 impl + 4 test + 1 renumbered). |
| 2026-02-23 | — | Magic default command: `npx @autorail/kap10` now runs full setup wizard (auth → IDE detect → GitHub flow → indexing → MCP config). Added 6 new CLI API endpoints for GitHub App install, repo listing, repo addition, and indexing status. Modified callback to support CLI-initiated GitHub installs. Added interactive IDE prompt, branded terminal output (picocolors, ora, prompts), and file logging to `.kap10/logs/`. |
