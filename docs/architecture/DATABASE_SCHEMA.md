# Database Schema Overview

Unerr uses a **four-store architecture**. This document provides a unified reference across all databases.

## Stores at a Glance

| Store | Tech | Role | Schema Source |
|---|---|---|---|
| **Relational** | Supabase (PostgreSQL) | Auth, app data, billing, vector embeddings | [`supabase/migrations/`](../../supabase/migrations/), [`prisma/schema.prisma`](../../prisma/schema.prisma) |
| **Graph** | ArangoDB | Knowledge graph (files, functions, relationships) | [`ARANGODB_SCHEMA.md`](./ARANGODB_SCHEMA.md) |
| **Workflow** | Temporal | Job orchestration | N/A (runtime state) |
| **Cache** | Redis | Hot cache, rate limits, MCP sessions | N/A (ephemeral) |

## PostgreSQL Schema Layout

PostgreSQL uses two schemas within a single Supabase project:

### `public` schema — Better Auth + App Support

Managed by Better Auth and raw SQL migrations. **Not managed by Prisma.**

**Better Auth tables** (camelCase columns):
- `user` — Core user with `tier` field
- `session` — Sessions with `activeOrganizationId` for org plugin
- `account` — OAuth/credential accounts
- `verification` — Email verification, OAuth state
- `organization` — Better Auth organizations (NOT GitHub orgs)
- `member` — Org membership
- `invitation` — Org invitations

**App support tables** (snake_case columns):
- `subscriptions` — Stripe subscription tracking
- `activities` — User/org activity feed
- `audit_logs` — Security audit trail
- `onboarding` — User onboarding progress
- `costs` — LLM token cost tracking
- `usage` — API/feature usage metering
- `feature_flags` — Feature flag definitions
- `api_keys` — Legacy API keys (public schema)
- `notifications` — User notifications
- `search_index` — Full-text search index
- `webhooks` — Outbound webhook configs
- `templates` — Prompt/workflow templates
- `rate_limits` — Rate limit counters
- `agent_conversations` — Agent chat history

### `unerr` schema — Core App Data

Managed by **Prisma** (ORM) and Supabase migrations (raw SQL). All models use `@@schema("unerr")`.

**Enums:**

| Enum | Values |
|---|---|
| `RepoStatus` | `pending`, `indexing`, `embedding`, `ready`, `error`, `embed_failed`, `deleting`, `justifying`, `justify_failed` |
| `RepoProvider` | `github`, `local_cli` |
| `DeletionLogStatus` | `pending`, `in_progress`, `completed`, `failed` |
| `SnapshotStatus` | `generating`, `available`, `failed` |
| `PipelineRunStatus` | `running`, `completed`, `failed`, `cancelled` |
| `PipelineTriggerType` | `initial`, `retry`, `reindex`, `webhook` |

**Tables:**

| Table | Purpose | Key Relations |
|---|---|---|
| `repos` | Connected repositories | FK to many child tables |
| `github_installations` | GitHub App installations per org | — |
| `deletion_logs` | Async deletion tracking | — |
| `api_keys` | MCP API keys (org or repo-scoped) | FK → `repos` |
| `workspaces` | Shadow workspace overlays | — |
| `entity_embeddings` | Semantic code embeddings (pgvector 768d) | FK → `repos` |
| `justification_embeddings` | Business justification embeddings (pgvector 768d) | FK → `repos` |
| `graph_snapshot_meta` | Local-first graph export metadata | — |
| `pr_reviews` | PR review results | FK → `repos` |
| `pr_review_comments` | Individual PR review comments | FK → `pr_reviews` |
| `active_vector_versions` | Blue/green embedding version tracking | FK → `repos` |
| `ledger_snapshots` | Prompt ledger file snapshots | FK → `repos` |
| `rule_embeddings` | Anti-pattern rule embeddings (pgvector 768d) | — |
| `pipeline_runs` | Pipeline run history & per-step tracking | FK → `repos` |

**Vector indexes** (HNSW, cosine distance):
- `entity_embeddings.embedding` — m=16, ef_construction=64
- `justification_embeddings.embedding` — m=16, ef_construction=64

**Storage buckets** (Supabase Storage):
- `graph-snapshots` — Msgpack graph exports (100 MB limit)
- `cli_uploads` — CLI file uploads (500 MB limit)

## Tenant Isolation

All data is tenant-scoped by `organization_id` (PostgreSQL) or `org_id` (ArangoDB):

- **PostgreSQL**: Every `unerr.*` table has an `organization_id` or `org_id` column. Queries always filter by org.
- **ArangoDB**: Every collection has a `(org_id, repo_id)` persistent index. All AQL queries filter by `org_id`.
- **Redis**: Keys are prefixed with org/repo context.

## Key Relationships

```
organization (public.organization)
  └── member (public.member)
  └── github_installations (unerr.github_installations)
  └── repos (unerr.repos)
        ├── api_keys (unerr.api_keys)
        ├── entity_embeddings (unerr.entity_embeddings)
        ├── justification_embeddings (unerr.justification_embeddings)
        ├── pr_reviews (unerr.pr_reviews)
        │     └── pr_review_comments (unerr.pr_review_comments)
        ├── ledger_snapshots (unerr.ledger_snapshots)
        ├── pipeline_runs (unerr.pipeline_runs)
        └── active_vector_versions (unerr.active_vector_versions)
```

## Migration Files

| Path | Description |
|---|---|
| `supabase/migrations/00001_public_schema.sql` | Better Auth + app support tables in `public` |
| `supabase/migrations/00002_unerr_schema.sql` | All `unerr` schema tables, enums, indexes, storage |
| `supabase/migrations/00003_pipeline_runs.sql` | Pipeline run tracking table |
| `supabase/migrations/00004_context_documents.sql` | Context seeding column on `repos` table |

Migrations are applied by `scripts/migrate.ts` (custom runner), not by Prisma. Prisma is used only as an ORM (`prisma generate`); there is no `prisma/migrations/` directory.

## ArangoDB

See [ARANGODB_SCHEMA.md](./ARANGODB_SCHEMA.md) for the complete graph database schema including all 22 document collections, 7 edge collections, and index definitions.
