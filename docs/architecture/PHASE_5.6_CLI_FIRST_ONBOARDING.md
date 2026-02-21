# Phase 5.6 — CLI-First Zero-Friction Onboarding

> **Phase Feature Statement:** _"I run `npx @autorail/kap10 connect` in my project, it opens a browser to authenticate, detects my repo, and auto-configures MCP for my IDE — zero copy-paste, zero dashboard clicks."_
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
  - [2.4 UI Changes](#24-ui-changes)
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

### 2.4 UI Changes

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

**Public path configuration:** `/api/cli` prefix added to `proxy.ts` public paths. The device-code and token endpoints must be unauthenticated (the CLI doesn't have credentials yet). The context endpoint uses API key auth validated inside the handler.

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

### API Routes (new)
| File | Change |
|------|--------|
| `app/api/cli/device-code/route.ts` | **New** — RFC 8628 device code generation |
| `app/api/cli/token/route.ts` | **New** — Token exchange + default key provisioning |
| `app/api/cli/context/route.ts` | **New** — Git remote → repo lookup |

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
| `packages/cli/src/commands/connect.ts` | **New** — Golden path command |
| `packages/cli/src/index.ts` | Register `connect` command |

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
