# ArangoDB Schema Reference

> Source of truth: [`lib/adapters/arango-graph-store.ts`](../../lib/adapters/arango-graph-store.ts)
> Database name: `unerr_db` (configurable via `ARANGODB_DATABASE` env var)

All collections are created by `bootstrapGraphSchema()` at startup. Every document collection has a tenant index on `(org_id, repo_id)`.

## Document Collections (22)

| Collection | Purpose | Extra Indexes |
|---|---|---|
| `repos` | Repository metadata mirror | tenant |
| `files` | File nodes in the knowledge graph | tenant, `(org_id, repo_id, file_path)` |
| `functions` | Function/method nodes | tenant, `(org_id, repo_id, file_path)`, fulltext on `name` |
| `classes` | Class/struct nodes | tenant, `(org_id, repo_id, file_path)`, fulltext on `name` |
| `interfaces` | Interface nodes | tenant, `(org_id, repo_id, file_path)`, fulltext on `name` |
| `variables` | Variable/type/enum nodes | tenant, `(org_id, repo_id, file_path)`, fulltext on `name` |
| `patterns` | Detected code patterns | tenant, `(org_id, repo_id, status, confidence)` |
| `rules` | Enforcement rules | tenant, `(org_id, scope, status)`, `(org_id, repo_id, status, priority)` |
| `snippets` | Code snippet library | tenant |
| `ledger` | Prompt ledger entries | tenant, `(org_id, repo_id, user_id, branch, timeline_branch, created_at)`, `(org_id, repo_id, branch, status)`, `(parent_id)` |
| `justifications` | Business justifications per entity | tenant, `(org_id, entity_id, valid_to)`, `(org_id, repo_id, feature_tag)` |
| `features_agg` | Feature aggregation rollups | tenant |
| `health_reports` | Repository health reports | tenant |
| `domain_ontologies` | Domain ontology definitions | tenant |
| `drift_scores` | Architecture drift scores | tenant |
| `adrs` | Architecture Decision Records | tenant |
| `token_usage_log` | LLM token usage tracking | tenant |
| `index_events` | Indexing event log. Optional fields: `run_id`, `trigger_type`, `started_at`, `status` for cross-referencing with PostgreSQL `pipeline_runs` | `(repo_id, org_id, created_at)`, TTL: 90 days on `created_at` |
| `ledger_summaries` | Prompt ledger summaries | tenant, `(org_id, repo_id, branch, created_at)`, `(commit_sha)` |
| `working_snapshots` | Working-state snapshots | tenant |
| `rule_health` | Rule health metrics | tenant, `(org_id, rule_id)` |
| `mined_patterns` | Auto-mined code patterns | tenant |
| `impact_reports` | Change impact analysis reports | tenant |

## Edge Collections (7)

| Collection | Connects | Purpose |
|---|---|---|
| `contains` | files → functions/classes/etc. | File containment hierarchy |
| `calls` | functions → functions | Function call graph |
| `imports` | files → files | Import/dependency graph |
| `extends` | classes → classes | Class inheritance |
| `implements` | classes → interfaces | Interface implementation |
| `rule_exceptions` | rules → entities | Rule exception overrides |
| `language_implementations` | interfaces → classes | Cross-language interface implementations |

All edge collections have a tenant index on `(org_id, repo_id)`.

Edge `_from`/`_to` fields use `collection/key` format (e.g., `files/abc123`, `functions/def456`).

## Entity Kind → Collection Mapping

The indexer emits **singular** entity kinds. ArangoDB collections are **plural**. Use `KIND_TO_COLLECTION`:

| Indexer Kind | Collection |
|---|---|
| `file`, `module`, `namespace`, `directory` | `files` |
| `function`, `method`, `decorator` | `functions` |
| `class`, `struct` | `classes` |
| `interface` | `interfaces` |
| `variable`, `type`, `enum` | `variables` |

## Index Details

### Tenant Index (all collections)
- Type: `persistent`
- Fields: `["org_id", "repo_id"]`

### File Path Index (entity collections only)
- Type: `persistent`
- Fields: `["org_id", "repo_id", "file_path"]`
- Collections: `files`, `functions`, `classes`, `interfaces`, `variables`

### Fulltext Indexes
- Type: `fulltext`
- Field: `name`, minLength: 2
- Collections: `functions`, `classes`, `interfaces`, `variables`

### TTL Index
- Collection: `index_events`
- Field: `created_at`
- Expiry: 90 days (7,776,000 seconds)

### Scope Index (Phase 13 — entity collections only)
- Type: `persistent`
- Fields: `["org_id", "repo_id", "scope"]`
- Collections: `files`, `functions`, `classes`, `interfaces`, `variables`
- Purpose: Fast filtering for branch/workspace-specific entity queries

## Document Shape

All documents include:
- `_key`: ArangoDB document key (used as entity ID)
- `org_id`: Organization tenant ID
- `repo_id`: Repository ID

Entity documents (`files`, `functions`, `classes`, `interfaces`, `variables`) additionally include:
- `name`: Entity name
- `file_path`: Source file path
- `start_line`: Starting line number (note: NOT `line`)
- `kind`: Entity kind (singular form)
- `content` / `signature`: Code content or signature
- `fan_in`: (optional) Number of inbound `calls` edges — pre-computed by `precomputeBlastRadius` activity
- `fan_out`: (optional) Number of outbound `calls` edges — pre-computed by `precomputeBlastRadius` activity
- `risk_level`: (optional) `"high"` (≥10), `"medium"` (≥5), or `"normal"` — pre-computed by `precomputeBlastRadius` activity

### Phase 13: Multi-Branch & Workspace Fields

Entity documents (`files`, `functions`, `classes`, `interfaces`, `variables`) gain two optional fields for multi-branch code intelligence (Phase 13):

| Field | Type | Default | Description |
|---|---|---|---|
| `scope` | `string` | `"primary"` | Identifies the branch/workspace variant: `"primary"` (default branch), `"branch:feature/auth"`, `"workspace:user-001"` |
| `commit_sha` | `string \| null` | `null` | The commit SHA from which this entity was extracted |

**Backward compatibility:** All existing entities have `scope = "primary"` (the default). Queries that don't filter by `scope` continue to work unchanged.

### Tombstone Documents

When an entity exists in the primary scope but has been deleted on a branch, a **tombstone document** is inserted:

| Field | Type | Description |
|---|---|---|
| `kind` | `"tombstone"` | Identifies this as a deletion marker |
| `original_key` | `string` | The `_key` of the entity in the primary scope |
| `scope` | `string` | The branch/workspace scope (e.g., `"branch:feature/auth"`) |
| `repo_id` | `string` | Repository ID |
| `org_id` | `string` | Organization ID |
| `commit_sha` | `string` | The commit SHA when the deletion was detected |

Tombstones prevent primary-scope entities from appearing in branch-aware queries.

Edge documents additionally include:
- `_from`: Source vertex (`collection/key` format)
- `_to`: Target vertex (`collection/key` format)

## Batch Operations

Bulk upserts use a batch size of 1000 documents per AQL query (`BATCH_SIZE` constant).
