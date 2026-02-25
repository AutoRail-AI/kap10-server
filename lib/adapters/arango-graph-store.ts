/**
 * ArangoGraphStore — IGraphStore implementation using ArangoDB.
 * Phase 0: bootstrapGraphSchema + health; other methods implemented but unused until Phase 1+.
 * Phase 2: searchEntities, getImports, getProjectStats, workspace overlay.
 *
 * We use the arangojs driver (Node.js HTTP client), not ArangoDB's in-server JavaScript API.
 * The in-server API (require("@arangodb").db, Foxx, arangosh) runs inside arangod; it cannot
 * be used from Node.js. See: https://www.arangodb.com/docs/stable/appendix-javascript-api/
 *
 * arangojs is required() inside getDb/getDbAsync so the build never loads or connects to ArangoDB.
 */

import type { Database } from "arangojs"
import type { IGraphStore } from "@/lib/ports/graph-store"
import type {
  ADRDoc,
  BlueprintData,
  DomainOntologyDoc,
  DriftScoreDoc,
  EdgeDoc,
  EntityDoc,
  FeatureAggregation,
  FeatureDoc,
  HealthReportDoc,
  ImpactReportDoc,
  ImpactResult,
  ImportChain,
  IndexEventDoc,
  JustificationDoc,
  LedgerEntry,
  LedgerEntryStatus,
  LedgerSummary,
  LedgerTimelineQuery,
  MinedPatternDoc,
  PaginatedResult,
  PatternDoc,
  PatternFilter,
  ProjectStats,
  RuleDoc,
  RuleExceptionDoc,
  RuleFilter,
  RuleHealthDoc,
  SearchResult,
  SnippetDoc,
  SnippetFilter,
  SubgraphResult,
  TokenUsageEntry,
  TokenUsageSummary,
  WorkingSnapshot,
} from "@/lib/ports/types"
import { validateLedgerTransition } from "@/lib/ports/types"

const DOC_COLLECTIONS = [
  "repos",
  "files",
  "functions",
  "classes",
  "interfaces",
  "variables",
  "patterns",
  "rules",
  "snippets",
  "ledger",
  // Phase 4: Justification & Taxonomy
  "justifications",
  "features_agg",
  "health_reports",
  "domain_ontologies",
  "drift_scores",
  "adrs",
  "token_usage_log",
  // Phase 5: Incremental indexing
  "index_events",
  // Phase 5.5: Prompt Ledger
  "ledger_summaries",
  "working_snapshots",
  // Phase 6: Pattern Enforcement & Rules Engine
  "rule_health",
  "mined_patterns",
  "impact_reports",
] as const

const EDGE_COLLECTIONS = ["contains", "calls", "imports", "extends", "implements", "rule_exceptions", "language_implementations"] as const

const TENANT_INDEX_FIELDS = ["org_id", "repo_id"]
const FILE_PATH_INDEX_FIELDS = ["org_id", "repo_id", "file_path"]
const ENTITY_COLLECTIONS_FOR_FILE = ["functions", "classes", "interfaces", "variables"] as const
const ALL_ENTITY_COLLECTIONS = ["files", ...ENTITY_COLLECTIONS_FOR_FILE] as const
const BATCH_SIZE = 1000

/** Map singular entity kind (from indexer) → plural ArangoDB collection name. */
const KIND_TO_COLLECTION: Record<string, string> = {
  file: "files",
  function: "functions",
  method: "functions",
  class: "classes",
  interface: "interfaces",
  variable: "variables",
  type: "variables",
  enum: "variables",
  struct: "classes",
  module: "files",
  namespace: "files",
  decorator: "functions",
  directory: "files",
  // Plural forms (in case they're used directly)
  files: "files",
  functions: "functions",
  classes: "classes",
  interfaces: "interfaces",
  variables: "variables",
}

/**
 * Ensure a vertex handle has the `collection/key` format required by ArangoDB edges.
 * If the handle is already qualified (contains `/`), return as-is.
 * Otherwise, look up the entity's kind to determine the collection, or default to `functions/`.
 */
function qualifyVertexHandle(handle: string): string {
  if (handle.includes("/")) return handle
  // Bare key — default to functions (most common entity type)
  return `functions/${handle}`
}

function getConfig() {
  const url = process.env.ARANGODB_URL ?? "http://localhost:8529"
  const password = process.env.ARANGO_ROOT_PASSWORD ?? "changeme"
  const databaseName = process.env.ARANGODB_DATABASE ?? "unerr_db"
  return { url, password, databaseName }
}

let dbInstance: Database | null = null

async function getDbAsync(): Promise<Database> {
  if (!dbInstance) {
    const { Database: ArangoDatabase } = require("arangojs") as typeof import("arangojs")
    const { url, password, databaseName } = getConfig()
    const base = new ArangoDatabase({ url, auth: { username: "root", password } })
    try {
      await base.createDatabase(databaseName)
    } catch {
      // exists
    }
    dbInstance = base.database(databaseName)
  }
  return dbInstance
}

function getDb(): Database {
  if (!dbInstance) {
    const { Database: ArangoDatabase } = require("arangojs") as typeof import("arangojs")
    const { url, password, databaseName } = getConfig()
    const base = new ArangoDatabase({ url, auth: { username: "root", password } })
    dbInstance = base.database(databaseName)
  }
  return dbInstance
}

export class ArangoGraphStore implements IGraphStore {
  async bootstrapGraphSchema(): Promise<void> {
    try {
      const db = await getDbAsync()

      for (const name of DOC_COLLECTIONS) {
        const col = db.collection(name)
        try {
          await col.create()
        } catch {
          // exists
        }
        try {
          await col.ensureIndex({
            type: "persistent",
            fields: TENANT_INDEX_FIELDS,
            name: `idx_${name}_org_repo`,
          })
        } catch {
          // index exists
        }
        if (["files", "functions", "classes", "interfaces", "variables"].includes(name)) {
          try {
            await col.ensureIndex({
              type: "persistent",
              fields: FILE_PATH_INDEX_FIELDS,
              name: `idx_${name}_org_repo_file`,
            })
          } catch {
            // index exists
          }
        }
      }

      // Phase 2: Fulltext indexes for search_code tool
      for (const collName of ["functions", "classes", "interfaces", "variables"] as const) {
        const col = db.collection(collName)
        try {
          // ArangoDB fulltext indexes — type not in TS driver typings, cast required
          await (col as { ensureIndex(opts: unknown): Promise<unknown> }).ensureIndex({
            type: "fulltext",
            fields: ["name"],
            name: `idx_${collName}_fulltext_name`,
            minLength: 2,
          })
        } catch {
          // index exists
        }
      }

      // Phase 4: Justification-specific indexes
      try {
        const justCol = db.collection("justifications")
        await justCol.ensureIndex({
          type: "persistent",
          fields: ["org_id", "entity_id", "valid_to"],
          name: "idx_justifications_entity_valid",
        })
      } catch {
        // index exists
      }
      try {
        const justCol = db.collection("justifications")
        await justCol.ensureIndex({
          type: "persistent",
          fields: ["org_id", "repo_id", "feature_tag"],
          name: "idx_justifications_feature_tag",
        })
      } catch {
        // index exists
      }

      // Phase 5: index_events indexes
      try {
        const ieCol = db.collection("index_events")
        await ieCol.ensureIndex({
          type: "persistent",
          fields: ["repo_id", "org_id", "created_at"],
          name: "idx_index_events_repo_org_created",
        })
      } catch {
        // index exists
      }
      try {
        const ieCol = db.collection("index_events")
        await (ieCol as { ensureIndex(opts: unknown): Promise<unknown> }).ensureIndex({
          type: "ttl",
          fields: ["created_at"],
          expireAfter: 90 * 24 * 60 * 60, // 90 days
          name: "idx_index_events_ttl",
        })
      } catch {
        // index exists
      }

      // Phase 5.5: Ledger composite indexes
      try {
        const ledgerCol = db.collection("ledger")
        await ledgerCol.ensureIndex({
          type: "persistent",
          fields: ["org_id", "repo_id", "user_id", "branch", "timeline_branch", "created_at"],
          name: "idx_ledger_timeline",
        })
      } catch { /* index exists */ }
      try {
        const ledgerCol = db.collection("ledger")
        await ledgerCol.ensureIndex({
          type: "persistent",
          fields: ["org_id", "repo_id", "branch", "status"],
          name: "idx_ledger_status",
        })
      } catch { /* index exists */ }
      try {
        const ledgerCol = db.collection("ledger")
        await ledgerCol.ensureIndex({
          type: "persistent",
          fields: ["parent_id"],
          name: "idx_ledger_parent",
        })
      } catch { /* index exists */ }
      try {
        const lsCol = db.collection("ledger_summaries")
        await lsCol.ensureIndex({
          type: "persistent",
          fields: ["org_id", "repo_id", "branch", "created_at"],
          name: "idx_ledger_summaries_branch_created",
        })
      } catch { /* index exists */ }
      try {
        const lsCol = db.collection("ledger_summaries")
        await lsCol.ensureIndex({
          type: "persistent",
          fields: ["commit_sha"],
          name: "idx_ledger_summaries_commit",
        })
      } catch { /* index exists */ }

      // Phase 6: Rule/Pattern-specific indexes
      try {
        const rulesCol = db.collection("rules")
        await rulesCol.ensureIndex({
          type: "persistent",
          fields: ["org_id", "scope", "status"],
          name: "idx_rules_org_scope_status",
        })
      } catch { /* index exists */ }
      try {
        const rulesCol = db.collection("rules")
        await rulesCol.ensureIndex({
          type: "persistent",
          fields: ["org_id", "repo_id", "status", "priority"],
          name: "idx_rules_repo_status_priority",
        })
      } catch { /* index exists */ }
      try {
        const patternsCol = db.collection("patterns")
        await patternsCol.ensureIndex({
          type: "persistent",
          fields: ["org_id", "repo_id", "status", "confidence"],
          name: "idx_patterns_repo_status_confidence",
        })
      } catch { /* index exists */ }
      try {
        const rhCol = db.collection("rule_health")
        await rhCol.ensureIndex({
          type: "persistent",
          fields: ["org_id", "rule_id"],
          name: "idx_rule_health_org_rule",
        })
      } catch { /* index exists */ }

      for (const name of EDGE_COLLECTIONS) {
        const col = db.collection(name)
        try {
          await col.create({ type: 3 }) // edge collection
        } catch {
          // exists
        }
        try {
          await col.ensureIndex({
            type: "persistent",
            fields: TENANT_INDEX_FIELDS,
            name: `idx_${name}_org_repo`,
          })
        } catch {
          // index exists
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[ArangoGraphStore] bootstrapGraphSchema failed:", message)
      throw error
    }
  }

  async upsertEntity(_orgId: string, _entity: EntityDoc): Promise<void> {
    // Phase 1
    return Promise.resolve()
  }
  async getEntity(orgId: string, entityId: string): Promise<EntityDoc | null> {
    const db = await getDbAsync()
    for (const collName of ALL_ENTITY_COLLECTIONS) {
      const col = db.collection(collName)
      try {
        const doc = await col.document(entityId)
        if (doc && (doc as { org_id?: string }).org_id === orgId) {
          const { _key, _id, ...rest } = doc as { _key: string; _id: string; org_id?: string; [k: string]: unknown }
          return { id: _key, ...rest } as EntityDoc
        }
      } catch {
        // not in this collection
      }
    }
    return null
  }

  async deleteEntity(_orgId: string, _entityId: string): Promise<void> {
    return Promise.resolve()
  }
  async upsertEdge(_orgId: string, _edge: EdgeDoc): Promise<void> {
    return Promise.resolve()
  }

  private async getConnectedEntities(
    orgId: string,
    entityId: string,
    direction: "inbound" | "outbound",
    depth = 1
  ): Promise<EntityDoc[]> {
    const db = await getDbAsync()
    const possibleIds = ENTITY_COLLECTIONS_FOR_FILE.map((c) => `${c}/${entityId}`)
    const filter = direction === "inbound" ? "e._to" : "e._from"
    const maxDepth = Math.min(Math.max(depth, 1), 5)

    if (maxDepth === 1) {
      const cursor = await db.query(
        `
        FOR e IN calls
          FILTER e.org_id == @orgId AND ${filter} IN @possibleIds
          LIMIT 500
          LET doc = DOCUMENT(${direction === "inbound" ? "e._from" : "e._to"})
          FILTER doc != null
          RETURN doc
        `,
        { orgId, possibleIds }
      )
      const docs = await cursor.all()
      return docs.map((d: { _key: string; _id?: string; [k: string]: unknown }) => {
        const { _key, _id, ...rest } = d
        return { id: _key, ...rest } as EntityDoc
      })
    }

    // Multi-hop traversal
    const traverseDir = direction === "inbound" ? "INBOUND" : "OUTBOUND"
    const cursor = await db.query(
      `
      FOR startId IN @possibleIds
        LET startDoc = DOCUMENT(startId)
        FILTER startDoc != null AND startDoc.org_id == @orgId
        FOR v, e IN 1..@maxDepth ${traverseDir} startDoc calls
          FILTER v.org_id == @orgId
          LIMIT 500
          RETURN DISTINCT v
      `,
      { orgId, possibleIds, maxDepth }
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id?: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as EntityDoc
    })
  }

  async getCallersOf(orgId: string, entityId: string, depth?: number): Promise<EntityDoc[]> {
    return this.getConnectedEntities(orgId, entityId, "inbound", depth)
  }
  async getCalleesOf(orgId: string, entityId: string, depth?: number): Promise<EntityDoc[]> {
    return this.getConnectedEntities(orgId, entityId, "outbound", depth)
  }

  async impactAnalysis(orgId: string, entityId: string, maxDepth: number): Promise<ImpactResult> {
    const db = await getDbAsync()
    const possibleIds = ENTITY_COLLECTIONS_FOR_FILE.map((c) => `${c}/${entityId}`)
    const clampedDepth = Math.min(Math.max(maxDepth, 1), 10)

    const cursor = await db.query(
      `
      FOR startId IN @possibleIds
        LET startDoc = DOCUMENT(startId)
        FILTER startDoc != null AND startDoc.org_id == @orgId
        FOR v, e, p IN 1..@maxDepth INBOUND startDoc calls
          FILTER v.org_id == @orgId
          LIMIT 500
          RETURN DISTINCT v
      `,
      { orgId, possibleIds, maxDepth: clampedDepth }
    )
    const docs = await cursor.all()
    const affected = docs.map((d: { _key: string; _id?: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as EntityDoc
    })
    return { entityId, affected }
  }

  async getEntitiesByFile(orgId: string, repoId: string, filePath: string): Promise<EntityDoc[]> {
    const db = await getDbAsync()
    const results: EntityDoc[] = []
    const bindVars = { orgId, repoId, filePath }
    for (const collName of ENTITY_COLLECTIONS_FOR_FILE) {
      const cursor = await db.query(
        `
        FOR doc IN @@coll
          FILTER doc.org_id == @orgId AND doc.repo_id == @repoId AND doc.file_path == @filePath
          SORT doc.start_line ASC
          RETURN doc
        `,
        { ...bindVars, "@coll": collName }
      )
      const docs = await cursor.all()
      for (const d of docs) {
        const { _key, _id, ...rest } = d as { _key: string; _id: string; [k: string]: unknown }
        results.push({ id: _key, ...rest } as EntityDoc)
      }
    }
    // Deduplicate by id (same entity may appear in multiple collections due to kind mapping)
    const seen = new Set<string>()
    const deduped = results.filter((e) => {
      if (seen.has(e.id)) return false
      seen.add(e.id)
      return true
    })
    deduped.sort((a, b) => (Number(a.start_line) || 0) - (Number(b.start_line) || 0))
    return deduped
  }
  async upsertRule(orgId: string, rule: RuleDoc): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("rules")
    await col.save(
      { _key: rule.id, ...rule, org_id: rule.org_id ?? orgId, updated_at: new Date().toISOString() },
      { overwriteMode: "update" }
    )
  }

  async queryRules(orgId: string, filter: RuleFilter): Promise<RuleDoc[]> {
    const db = await getDbAsync()
    const filters: string[] = ["doc.org_id == @orgId"]
    const bindVars: Record<string, unknown> = { orgId, limit: Math.min(filter.limit ?? 50, 100) }
    if (filter.repoId) { filters.push("(doc.repo_id == @repoId OR doc.repo_id == null)"); bindVars.repoId = filter.repoId }
    if (filter.scope) { filters.push("doc.scope == @scope"); bindVars.scope = filter.scope }
    if (filter.type) { filters.push("doc.type == @type"); bindVars.type = filter.type }
    if (filter.status) { filters.push("doc.status == @status"); bindVars.status = filter.status }
    if (filter.enforcement) { filters.push("doc.enforcement == @enforcement"); bindVars.enforcement = filter.enforcement }
    if (filter.language) { filters.push("@language IN doc.languages"); bindVars.language = filter.language }
    const cursor = await db.query(
      `FOR doc IN rules FILTER ${filters.join(" AND ")} SORT doc.priority DESC LIMIT @limit RETURN doc`,
      bindVars
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as RuleDoc
    })
  }

  async deleteRule(orgId: string, ruleId: string): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("rules")
    try {
      const doc = await col.document(ruleId)
      if ((doc as { org_id?: string }).org_id === orgId) {
        await col.remove(ruleId)
      }
    } catch { /* not found */ }
  }

  async archiveRule(orgId: string, ruleId: string): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("rules")
    try {
      const doc = await col.document(ruleId)
      if ((doc as { org_id?: string }).org_id === orgId) {
        await col.update(ruleId, { status: "archived", updated_at: new Date().toISOString() })
      }
    } catch { /* not found */ }
  }

  async upsertPattern(orgId: string, pattern: PatternDoc): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("patterns")
    await col.save(
      { _key: pattern.id, ...pattern, org_id: pattern.org_id ?? orgId, updated_at: new Date().toISOString() },
      { overwriteMode: "update" }
    )
  }

  async queryPatterns(orgId: string, filter: PatternFilter): Promise<PatternDoc[]> {
    const db = await getDbAsync()
    const filters: string[] = ["doc.org_id == @orgId"]
    const bindVars: Record<string, unknown> = { orgId, limit: Math.min(filter.limit ?? 50, 100) }
    if (filter.repoId) { filters.push("doc.repo_id == @repoId"); bindVars.repoId = filter.repoId }
    if (filter.type) { filters.push("doc.type == @type"); bindVars.type = filter.type }
    if (filter.status) { filters.push("doc.status == @status"); bindVars.status = filter.status }
    if (filter.source) { filters.push("doc.source == @source"); bindVars.source = filter.source }
    if (filter.language) { filters.push("doc.language == @language"); bindVars.language = filter.language }
    if (filter.minConfidence !== undefined) { filters.push("doc.confidence >= @minConf"); bindVars.minConf = filter.minConfidence }
    const cursor = await db.query(
      `FOR doc IN patterns FILTER ${filters.join(" AND ")} SORT doc.confidence DESC LIMIT @limit RETURN doc`,
      bindVars
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as PatternDoc
    })
  }

  async updatePatternStatus(orgId: string, patternId: string, status: string): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("patterns")
    try {
      const doc = await col.document(patternId)
      if ((doc as { org_id?: string }).org_id === orgId) {
        await col.update(patternId, { status, updated_at: new Date().toISOString() })
      }
    } catch { /* not found */ }
  }

  async getPatternByHash(orgId: string, repoId: string, hash: string): Promise<PatternDoc | null> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `FOR doc IN patterns FILTER doc.org_id == @orgId AND doc.repo_id == @repoId AND doc._key == @hash LIMIT 1 RETURN doc`,
      { orgId, repoId, hash }
    )
    const docs = await cursor.all()
    if (docs.length === 0) return null
    const { _key, _id, ...rest } = docs[0] as { _key: string; _id: string; [k: string]: unknown }
    return { id: _key, ...rest } as PatternDoc
  }

  async getRuleHealth(orgId: string, ruleId: string): Promise<RuleHealthDoc | null> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `FOR doc IN rule_health FILTER doc.org_id == @orgId AND doc.rule_id == @ruleId LIMIT 1 RETURN doc`,
      { orgId, ruleId }
    )
    const docs = await cursor.all()
    if (docs.length === 0) return null
    const { _key, _id, ...rest } = docs[0] as { _key: string; _id: string; [k: string]: unknown }
    return { id: _key, ...rest } as RuleHealthDoc
  }

  async upsertRuleHealth(orgId: string, health: RuleHealthDoc): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("rule_health")
    await col.save(
      { _key: health.id, ...health, org_id: health.org_id ?? orgId, updated_at: new Date().toISOString() },
      { overwriteMode: "update" }
    )
  }

  async upsertMinedPattern(orgId: string, pattern: MinedPatternDoc): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("mined_patterns")
    await col.save(
      { _key: pattern.id, ...pattern, org_id: pattern.org_id ?? orgId },
      { overwriteMode: "update" }
    )
  }

  async queryMinedPatterns(orgId: string, repoId: string): Promise<MinedPatternDoc[]> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `FOR doc IN mined_patterns FILTER doc.org_id == @orgId AND doc.repo_id == @repoId SORT doc.confidence DESC LIMIT 100 RETURN doc`,
      { orgId, repoId }
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as MinedPatternDoc
    })
  }

  async upsertImpactReport(orgId: string, report: ImpactReportDoc): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("impact_reports")
    await col.save(
      { _key: report.id, ...report, org_id: report.org_id ?? orgId },
      { overwriteMode: "update" }
    )
  }

  async getImpactReport(orgId: string, ruleId: string): Promise<ImpactReportDoc | null> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `FOR doc IN impact_reports FILTER doc.org_id == @orgId AND doc.rule_id == @ruleId SORT doc.generated_at DESC LIMIT 1 RETURN doc`,
      { orgId, ruleId }
    )
    const docs = await cursor.all()
    if (docs.length === 0) return null
    const { _key, _id, ...rest } = docs[0] as { _key: string; _id: string; [k: string]: unknown }
    return { id: _key, ...rest } as ImpactReportDoc
  }

  async queryRuleExceptions(orgId: string, ruleId: string): Promise<RuleExceptionDoc[]> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `FOR doc IN rule_exceptions FILTER doc.org_id == @orgId AND doc.rule_id == @ruleId AND doc.status == "active" LIMIT 500 RETURN doc`,
      { orgId, ruleId }
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as RuleExceptionDoc
    })
  }

  async upsertRuleException(orgId: string, exception: RuleExceptionDoc): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("rule_exceptions")
    await col.save(
      { _key: exception.id, ...exception, org_id: exception.org_id ?? orgId },
      { overwriteMode: "update" }
    )
  }

  async updateRuleException(orgId: string, exceptionId: string, status: string): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("rule_exceptions")
    try {
      const doc = await col.document(exceptionId)
      if ((doc as { org_id?: string }).org_id === orgId) {
        await col.update(exceptionId, { status })
      }
    } catch { /* not found */ }
  }
  async upsertSnippet(_orgId: string, _snippet: SnippetDoc): Promise<void> {
    return Promise.resolve()
  }
  async querySnippets(_orgId: string, _filter: SnippetFilter): Promise<SnippetDoc[]> {
    return Promise.resolve([])
  }
  async getFeatures(_orgId: string, _repoId: string): Promise<FeatureDoc[]> {
    return Promise.resolve([])
  }
  async getBlueprint(_orgId: string, _repoId: string): Promise<BlueprintData> {
    return Promise.resolve({ features: [] })
  }
  async bulkUpsertEntities(orgId: string, entities: EntityDoc[]): Promise<void> {
    if (entities.length === 0) return
    const db = await getDbAsync()
    const byKind = new Map<string, EntityDoc[]>()
    for (const e of entities) {
      const kind = (e.kind as string) ?? "function"
      const coll = KIND_TO_COLLECTION[kind] ?? "functions"
      if (!byKind.has(coll)) byKind.set(coll, [])
      const key = (e.id ?? (e as { _key?: string })._key) as string
      byKind.get(coll)!.push({ ...e, _key: key, org_id: e.org_id ?? orgId } as EntityDoc & { _key: string })
    }
    for (const [collName, list] of Array.from(byKind.entries())) {
      const col = db.collection(collName)
      for (let i = 0; i < list.length; i += BATCH_SIZE) {
        const batch = list.slice(i, i + BATCH_SIZE).map((e) => {
          const { id, ...rest } = e
          return { _key: (e as EntityDoc & { _key?: string })._key ?? id, ...rest }
        })
        await col.import(batch, { onDuplicate: "update" })
      }
    }
  }

  async bulkUpsertEdges(orgId: string, edges: EdgeDoc[]): Promise<void> {
    if (edges.length === 0) return
    const db = await getDbAsync()
    const byKind = new Map<string, EdgeDoc[]>()
    for (const e of edges) {
      const kind = (e.kind as string) ?? "calls"
      const coll = EDGE_COLLECTIONS.includes(kind as (typeof EDGE_COLLECTIONS)[number]) ? kind : "calls"
      if (!byKind.has(coll)) byKind.set(coll, [])
      byKind.get(coll)!.push({ ...e, org_id: e.org_id ?? orgId })
    }
    for (const [collName, list] of Array.from(byKind.entries())) {
      const col = db.collection(collName)
      for (let i = 0; i < list.length; i += BATCH_SIZE) {
        const batch = list.slice(i, i + BATCH_SIZE).map((e) => ({
          _from: qualifyVertexHandle(e._from),
          _to: qualifyVertexHandle(e._to),
          org_id: e.org_id,
          repo_id: e.repo_id,
          kind: e.kind,
        }))
        await col.import(batch, { onDuplicate: "update" })
      }
    }
  }

  async getFilePaths(orgId: string, repoId: string): Promise<{ path: string }[]> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `FOR doc IN files FILTER doc.org_id == @orgId AND doc.repo_id == @repoId SORT doc.file_path ASC RETURN { path: doc.file_path }`,
      { orgId, repoId }
    )
    return cursor.all() as Promise<{ path: string }[]>
  }

  async deleteRepoData(orgId: string, repoId: string): Promise<void> {
    const db = await getDbAsync()
    const docCols = [...DOC_COLLECTIONS]
    const edgeCols = [...EDGE_COLLECTIONS]
    for (const name of docCols) {
      const cursor = await db.query(
        `FOR doc IN @@coll FILTER doc.org_id == @orgId AND doc.repo_id == @repoId REMOVE doc IN @@coll`,
        { "@coll": name, orgId, repoId }
      )
      await cursor.all()
    }
    for (const name of edgeCols) {
      const cursor = await db.query(
        `FOR doc IN @@coll FILTER doc.org_id == @orgId AND doc.repo_id == @repoId REMOVE doc IN @@coll`,
        { "@coll": name, orgId, repoId }
      )
      await cursor.all()
    }
  }

  async healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }> {
    const start = Date.now()
    try {
      const db = getDb()
      await db.listCollections()
      return { status: "up", latencyMs: Date.now() - start }
    } catch {
      return { status: "down", latencyMs: Date.now() - start }
    }
  }

  // ── Phase 2: Search ───────────────────────────────────────────

  async searchEntities(
    orgId: string,
    repoId: string,
    query: string,
    limit = 20
  ): Promise<SearchResult[]> {
    const db = await getDbAsync()
    const clampedLimit = Math.min(Math.max(limit, 1), 50)
    const results: SearchResult[] = []

    // Search across entity collections using LIKE for name matching
    // ArangoDB fulltext indexes use FULLTEXT() function
    for (const collName of ENTITY_COLLECTIONS_FOR_FILE) {
      const cursor = await db.query(
        `
        FOR doc IN @@coll
          FILTER doc.org_id == @orgId AND doc.repo_id == @repoId
          FILTER CONTAINS(LOWER(doc.name), LOWER(@query)) OR CONTAINS(LOWER(doc.signature || ""), LOWER(@query))
          LIMIT @limit
          RETURN {
            name: doc.name,
            kind: doc.kind,
            file_path: doc.file_path,
            line: doc.start_line || 0,
            signature: doc.signature,
            score: LENGTH(@query) / LENGTH(doc.name)
          }
        `,
        { "@coll": collName, orgId, repoId, query, limit: clampedLimit }
      )
      const docs = await cursor.all()
      results.push(...(docs as SearchResult[]))
    }

    // Sort by score descending, deduplicate, limit
    results.sort((a, b) => (b.score || 0) - (a.score || 0))
    return results.slice(0, clampedLimit)
  }

  // ── Phase 2: Import chain ─────────────────────────────────────

  async getImports(
    orgId: string,
    repoId: string,
    filePath: string,
    depth = 1
  ): Promise<ImportChain[]> {
    const db = await getDbAsync()
    const clampedDepth = Math.min(Math.max(depth, 1), 5)

    // First find the file document
    const fileCursor = await db.query(
      `
      FOR doc IN files
        FILTER doc.org_id == @orgId AND doc.repo_id == @repoId AND doc.file_path == @filePath
        LIMIT 1
        RETURN doc
      `,
      { orgId, repoId, filePath }
    )
    const fileDocs = await fileCursor.all()
    if (fileDocs.length === 0) return []

    const fileDoc = fileDocs[0] as { _id: string; [k: string]: unknown }

    // Traverse import edges
    const cursor = await db.query(
      `
      FOR v, e, p IN 1..@maxDepth OUTBOUND @fileId imports
        FILTER v.org_id == @orgId AND v.repo_id == @repoId
        LET distance = LENGTH(p.edges)
        LET entities = (
          FOR ent IN UNION(
            (FOR e2 IN functions FILTER e2.org_id == @orgId AND e2.repo_id == @repoId AND e2.file_path == v.file_path RETURN e2),
            (FOR e2 IN classes FILTER e2.org_id == @orgId AND e2.repo_id == @repoId AND e2.file_path == v.file_path RETURN e2),
            (FOR e2 IN interfaces FILTER e2.org_id == @orgId AND e2.repo_id == @repoId AND e2.file_path == v.file_path RETURN e2),
            (FOR e2 IN variables FILTER e2.org_id == @orgId AND e2.repo_id == @repoId AND e2.file_path == v.file_path RETURN e2)
          )
          RETURN { id: ent._key, name: ent.name, kind: ent.kind, file_path: ent.file_path }
        )
        RETURN DISTINCT { path: v.file_path, entities: entities, distance: distance }
      `,
      { orgId, repoId, fileId: fileDoc._id, maxDepth: clampedDepth }
    )

    const results = await cursor.all()
    return results as ImportChain[]
  }

  // ── Phase 2: Project stats ────────────────────────────────────

  async getProjectStats(orgId: string, repoId: string): Promise<ProjectStats> {
    const db = await getDbAsync()

    // Single AQL query replaces 5 separate COUNT queries + 1 language query.
    // Each sub-query still uses the idx_{coll}_org_repo persistent index.
    const cursor = await db.query(
      `
      LET f = LENGTH(FOR d IN files FILTER d.org_id == @orgId AND d.repo_id == @repoId RETURN 1)
      LET fn = LENGTH(FOR d IN functions FILTER d.org_id == @orgId AND d.repo_id == @repoId RETURN 1)
      LET cl = LENGTH(FOR d IN classes FILTER d.org_id == @orgId AND d.repo_id == @repoId RETURN 1)
      LET ifc = LENGTH(FOR d IN interfaces FILTER d.org_id == @orgId AND d.repo_id == @repoId RETURN 1)
      LET v = LENGTH(FOR d IN variables FILTER d.org_id == @orgId AND d.repo_id == @repoId RETURN 1)
      LET langs = (
        FOR doc IN files
          FILTER doc.org_id == @orgId AND doc.repo_id == @repoId AND doc.language != null
          COLLECT lang = doc.language WITH COUNT INTO cnt
          RETURN { language: lang, count: cnt }
      )
      RETURN { files: f, functions: fn, classes: cl, interfaces: ifc, variables: v, langs }
      `,
      { orgId, repoId }
    )

    const result = (await cursor.all())[0] as {
      files: number
      functions: number
      classes: number
      interfaces: number
      variables: number
      langs: Array<{ language: string; count: number }>
    } | undefined

    const languages: Record<string, number> = {}
    if (result?.langs) {
      for (const ld of result.langs) {
        languages[ld.language] = ld.count
      }
    }

    return {
      files: result?.files ?? 0,
      functions: result?.functions ?? 0,
      classes: result?.classes ?? 0,
      interfaces: result?.interfaces ?? 0,
      variables: result?.variables ?? 0,
      languages,
    }
  }

  // ── Phase 2: Workspace overlay ────────────────────────────────

  async upsertWorkspaceEntity(orgId: string, workspaceId: string, entity: EntityDoc): Promise<void> {
    const db = await getDbAsync()
    const kind = (entity.kind as string) ?? "function"
    const collName = KIND_TO_COLLECTION[kind] ?? "functions"
    const col = db.collection(collName)
    const overlayKey = `ws:${workspaceId}:${entity.id}`

    await col.save(
      {
        _key: overlayKey,
        ...entity,
        id: overlayKey,
        org_id: entity.org_id ?? orgId,
        _workspace_id: workspaceId,
      },
      { overwriteMode: "update" }
    )
  }

  async getEntityWithOverlay(
    orgId: string,
    entityId: string,
    workspaceId?: string
  ): Promise<EntityDoc | null> {
    if (workspaceId) {
      // Check overlay first
      const overlayKey = `ws:${workspaceId}:${entityId}`
      const db = await getDbAsync()
      for (const collName of ALL_ENTITY_COLLECTIONS) {
        const col = db.collection(collName)
        try {
          const doc = await col.document(overlayKey)
          if (doc && (doc as { org_id?: string }).org_id === orgId) {
            const { _key, _id, _workspace_id, ...rest } = doc as {
              _key: string
              _id: string
              _workspace_id?: string
              [k: string]: unknown
            }
            return { id: entityId, ...rest } as EntityDoc
          }
        } catch {
          // not in this collection
        }
      }
    }
    // Fall back to committed entity
    return this.getEntity(orgId, entityId)
  }

  async cleanupExpiredWorkspaces(workspaceId: string): Promise<void> {
    const db = await getDbAsync()
    const prefix = `ws:${workspaceId}:`

    for (const collName of ALL_ENTITY_COLLECTIONS) {
      const cursor = await db.query(
        `
        FOR doc IN @@coll
          FILTER STARTS_WITH(doc._key, @prefix)
          REMOVE doc IN @@coll
        `,
        { "@coll": collName, prefix }
      )
      await cursor.all()
    }
  }

  // ── Phase 4: Justification CRUD ────────────────────────────────

  async bulkUpsertJustifications(orgId: string, justifications: JustificationDoc[]): Promise<void> {
    if (justifications.length === 0) return
    const db = await getDbAsync()
    const col = db.collection("justifications")

    // Bi-temporal: set valid_to on old justifications before inserting new ones
    const entityIds = justifications.map((j) => j.entity_id)
    await db.query(
      `
      FOR doc IN justifications
        FILTER doc.org_id == @orgId AND doc.entity_id IN @entityIds AND doc.valid_to == null
        UPDATE doc WITH { valid_to: DATE_ISO8601(DATE_NOW()) } IN justifications
      `,
      { orgId, entityIds }
    )

    for (let i = 0; i < justifications.length; i += BATCH_SIZE) {
      const batch = justifications.slice(i, i + BATCH_SIZE).map((j) => ({
        _key: j.id,
        ...j,
        org_id: j.org_id ?? orgId,
      }))
      await col.import(batch, { onDuplicate: "update" })
    }
  }

  async getJustification(orgId: string, entityId: string): Promise<JustificationDoc | null> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      FOR doc IN justifications
        FILTER doc.org_id == @orgId AND doc.entity_id == @entityId AND doc.valid_to == null
        LIMIT 1
        RETURN doc
      `,
      { orgId, entityId }
    )
    const docs = await cursor.all()
    if (docs.length === 0) return null
    const { _key, _id, ...rest } = docs[0] as { _key: string; _id: string; [k: string]: unknown }
    return { id: _key, ...rest } as JustificationDoc
  }

  async getJustifications(orgId: string, repoId: string): Promise<JustificationDoc[]> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      FOR doc IN justifications
        FILTER doc.org_id == @orgId AND doc.repo_id == @repoId AND doc.valid_to == null
        LIMIT 10000
        RETURN doc
      `,
      { orgId, repoId }
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as JustificationDoc
    })
  }

  async getJustificationHistory(orgId: string, entityId: string): Promise<JustificationDoc[]> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      FOR doc IN justifications
        FILTER doc.org_id == @orgId AND doc.entity_id == @entityId
        SORT doc.valid_from DESC
        LIMIT 100
        RETURN doc
      `,
      { orgId, entityId }
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as JustificationDoc
    })
  }

  // ── Phase 4: Feature Aggregations ──────────────────────────────

  async bulkUpsertFeatureAggregations(orgId: string, features: FeatureAggregation[]): Promise<void> {
    if (features.length === 0) return
    const db = await getDbAsync()
    const col = db.collection("features_agg")
    for (let i = 0; i < features.length; i += BATCH_SIZE) {
      const batch = features.slice(i, i + BATCH_SIZE).map((f) => ({
        _key: f.id,
        ...f,
        org_id: f.org_id ?? orgId,
      }))
      await col.import(batch, { onDuplicate: "update" })
    }
  }

  async getFeatureAggregations(orgId: string, repoId: string): Promise<FeatureAggregation[]> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      FOR doc IN features_agg
        FILTER doc.org_id == @orgId AND doc.repo_id == @repoId
        LIMIT 500
        RETURN doc
      `,
      { orgId, repoId }
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as FeatureAggregation
    })
  }

  // ── Phase 4: Health Reports ────────────────────────────────────

  async upsertHealthReport(orgId: string, report: HealthReportDoc): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("health_reports")
    await col.save(
      { _key: report.id, ...report, org_id: report.org_id ?? orgId },
      { overwriteMode: "update" }
    )
  }

  async getHealthReport(orgId: string, repoId: string): Promise<HealthReportDoc | null> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      FOR doc IN health_reports
        FILTER doc.org_id == @orgId AND doc.repo_id == @repoId
        SORT doc.generated_at DESC
        LIMIT 1
        RETURN doc
      `,
      { orgId, repoId }
    )
    const docs = await cursor.all()
    if (docs.length === 0) return null
    const { _key, _id, ...rest } = docs[0] as { _key: string; _id: string; [k: string]: unknown }
    return { id: _key, ...rest } as HealthReportDoc
  }

  // ── Phase 4: Domain Ontology ───────────────────────────────────

  async upsertDomainOntology(orgId: string, ontology: DomainOntologyDoc): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("domain_ontologies")
    try { await col.create() } catch { /* already exists */ }
    await col.save(
      { _key: ontology.id, ...ontology, org_id: ontology.org_id ?? orgId },
      { overwriteMode: "update" }
    )
  }

  async getDomainOntology(orgId: string, repoId: string): Promise<DomainOntologyDoc | null> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      FOR doc IN domain_ontologies
        FILTER doc.org_id == @orgId AND doc.repo_id == @repoId
        SORT doc.generated_at DESC
        LIMIT 1
        RETURN doc
      `,
      { orgId, repoId }
    )
    const docs = await cursor.all()
    if (docs.length === 0) return null
    const { _key, _id, ...rest } = docs[0] as { _key: string; _id: string; [k: string]: unknown }
    return { id: _key, ...rest } as DomainOntologyDoc
  }

  // ── Phase 4: Drift Scores ─────────────────────────────────────

  async bulkUpsertDriftScores(orgId: string, scores: DriftScoreDoc[]): Promise<void> {
    if (scores.length === 0) return
    const db = await getDbAsync()
    const col = db.collection("drift_scores")
    for (let i = 0; i < scores.length; i += BATCH_SIZE) {
      const batch = scores.slice(i, i + BATCH_SIZE).map((s) => ({
        _key: s.id,
        ...s,
        org_id: s.org_id ?? orgId,
      }))
      await col.import(batch, { onDuplicate: "update" })
    }
  }

  async getDriftScores(orgId: string, repoId: string): Promise<DriftScoreDoc[]> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      FOR doc IN drift_scores
        FILTER doc.org_id == @orgId AND doc.repo_id == @repoId
        LIMIT 5000
        RETURN doc
      `,
      { orgId, repoId }
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as DriftScoreDoc
    })
  }

  // ── Phase 4: ADRs ─────────────────────────────────────────────

  async bulkUpsertADRs(orgId: string, adrs: ADRDoc[]): Promise<void> {
    if (adrs.length === 0) return
    const db = await getDbAsync()
    const col = db.collection("adrs")
    for (let i = 0; i < adrs.length; i += BATCH_SIZE) {
      const batch = adrs.slice(i, i + BATCH_SIZE).map((a) => ({
        _key: a.id,
        ...a,
        org_id: a.org_id ?? orgId,
      }))
      await col.import(batch, { onDuplicate: "update" })
    }
  }

  async getADRs(orgId: string, repoId: string): Promise<ADRDoc[]> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      FOR doc IN adrs
        FILTER doc.org_id == @orgId AND doc.repo_id == @repoId
        LIMIT 200
        RETURN doc
      `,
      { orgId, repoId }
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as ADRDoc
    })
  }

  // ── Phase 4: GraphRAG Sub-graph Extraction ─────────────────────

  async getSubgraph(
    orgId: string,
    entityId: string,
    depth = 2,
    opts?: { crossRepo?: boolean }
  ): Promise<SubgraphResult> {
    const db = await getDbAsync()
    const clampedDepth = Math.min(Math.max(depth, 1), 5)
    const possibleIds = ALL_ENTITY_COLLECTIONS.map((c) => `${c}/${entityId}`)

    const orgFilter = opts?.crossRepo ? "" : "AND v.repo_id == startDoc.repo_id"

    const cursor = await db.query(
      `
      FOR startId IN @possibleIds
        LET startDoc = DOCUMENT(startId)
        FILTER startDoc != null AND startDoc.org_id == @orgId
        LET vertices = (
          FOR v, e IN 1..@maxDepth ANY startDoc calls, imports, extends, implements
            FILTER v.org_id == @orgId ${orgFilter}
            LIMIT 200
            RETURN DISTINCT v
        )
        LET edges = (
          FOR v, e IN 1..@maxDepth ANY startDoc calls, imports, extends, implements
            FILTER v.org_id == @orgId ${orgFilter}
            LIMIT 500
            RETURN DISTINCT e
        )
        RETURN { vertices: APPEND([startDoc], vertices), edges: edges }
      `,
      { orgId, possibleIds, maxDepth: clampedDepth }
    )

    const results = await cursor.all()
    if (results.length === 0) return { entities: [], edges: [] }

    const first = results[0] as { vertices: Array<{ _key: string; _id: string; [k: string]: unknown }>; edges: Array<{ _from: string; _to: string; [k: string]: unknown }> }
    const entities = (first.vertices ?? []).map((d) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as EntityDoc
    })
    const edges = (first.edges ?? []).map((e) => ({
      _from: e._from,
      _to: e._to,
      kind: (e.kind as string) ?? "calls",
      org_id: (e.org_id as string) ?? orgId,
      repo_id: (e.repo_id as string) ?? "",
    })) as EdgeDoc[]

    return { entities, edges }
  }

  async getBatchSubgraphs(
    orgId: string,
    entityIds: string[],
    depth = 2
  ): Promise<Map<string, SubgraphResult>> {
    const result = new Map<string, SubgraphResult>()
    if (entityIds.length === 0) return result

    const db = await getDbAsync()
    const clampedDepth = Math.min(Math.max(depth, 1), 5)
    const CHUNK_SIZE = 50

    for (let i = 0; i < entityIds.length; i += CHUNK_SIZE) {
      const chunk = entityIds.slice(i, i + CHUNK_SIZE)

      // Build all possible document IDs for each entity in the chunk
      const entityPossibleIds = chunk.map((eid) =>
        ALL_ENTITY_COLLECTIONS.map((c) => `${c}/${eid}`)
      )

      const cursor = await db.query(
        `
        FOR entityGroup IN @entityPossibleIds
          LET startDoc = FIRST(
            FOR sid IN entityGroup
              LET doc = DOCUMENT(sid)
              FILTER doc != null AND doc.org_id == @orgId
              RETURN doc
          )
          FILTER startDoc != null
          LET entityKey = startDoc._key
          LET vertices = (
            FOR v, e IN 1..@maxDepth ANY startDoc calls, imports, extends, implements
              FILTER v.org_id == @orgId AND v.repo_id == startDoc.repo_id
              LIMIT 200
              RETURN DISTINCT v
          )
          LET edges = (
            FOR v, e IN 1..@maxDepth ANY startDoc calls, imports, extends, implements
              FILTER v.org_id == @orgId AND v.repo_id == startDoc.repo_id
              LIMIT 500
              RETURN DISTINCT e
          )
          RETURN { entityKey: entityKey, vertices: APPEND([startDoc], vertices), edges: edges }
        `,
        { orgId, entityPossibleIds, maxDepth: clampedDepth }
      )

      const rows = await cursor.all()
      for (const row of rows) {
        const { entityKey, vertices, edges: rowEdges } = row as {
          entityKey: string
          vertices: Array<{ _key: string; _id: string; [k: string]: unknown }>
          edges: Array<{ _from: string; _to: string; [k: string]: unknown }>
        }

        const entities = (vertices ?? []).map((d) => {
          const { _key, _id, ...rest } = d
          return { id: _key, ...rest } as EntityDoc
        })
        const edges = (rowEdges ?? []).map((e) => ({
          _from: e._from,
          _to: e._to,
          kind: (e.kind as string) ?? "calls",
          org_id: (e.org_id as string) ?? orgId,
          repo_id: (e.repo_id as string) ?? "",
        })) as EdgeDoc[]

        result.set(entityKey, { entities, edges })
      }

      // Fill in empty results for entities not found
      for (const eid of chunk) {
        if (!result.has(eid)) {
          result.set(eid, { entities: [], edges: [] })
        }
      }
    }

    return result
  }

  // ── Phase 4: Bulk fetch all entities/edges ─────────────────────

  async getAllEntities(orgId: string, repoId: string, limit = 10000): Promise<EntityDoc[]> {
    const db = await getDbAsync()
    const results: EntityDoc[] = []
    const perCollectionLimit = Math.ceil(limit / ALL_ENTITY_COLLECTIONS.length)
    for (const collName of ALL_ENTITY_COLLECTIONS) {
      if (results.length >= limit) break
      const cursor = await db.query(
        `
        FOR doc IN @@coll
          FILTER doc.org_id == @orgId AND doc.repo_id == @repoId
          LIMIT @lim
          RETURN doc
        `,
        { "@coll": collName, orgId, repoId, lim: perCollectionLimit }
      )
      const docs = await cursor.all()
      for (const d of docs) {
        const { _key, _id, ...rest } = d as { _key: string; _id: string; [k: string]: unknown }
        results.push({ id: _key, ...rest } as EntityDoc)
      }
    }
    return results.slice(0, limit)
  }

  async getAllEdges(orgId: string, repoId: string, limit = 20000): Promise<EdgeDoc[]> {
    const db = await getDbAsync()
    const results: EdgeDoc[] = []
    const perCollectionLimit = Math.ceil(limit / EDGE_COLLECTIONS.length)
    for (const edgeName of EDGE_COLLECTIONS) {
      if (results.length >= limit) break
      const cursor = await db.query(
        `
        FOR doc IN @@coll
          FILTER doc.org_id == @orgId AND doc.repo_id == @repoId
          LIMIT @lim
          RETURN doc
        `,
        { "@coll": edgeName, orgId, repoId, lim: perCollectionLimit }
      )
      const docs = await cursor.all()
      for (const d of docs) {
        results.push(d as EdgeDoc)
      }
    }
    return results.slice(0, limit)
  }

  // ── Phase 4: Token Usage Tracking ──────────────────────────────

  async logTokenUsage(orgId: string, entry: TokenUsageEntry): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("token_usage_log")
    await col.save(
      { _key: entry.id, ...entry, org_id: entry.org_id ?? orgId },
      { overwriteMode: "update" }
    )
  }

  async getTokenUsage(orgId: string, repoId: string): Promise<TokenUsageEntry[]> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      FOR doc IN token_usage_log
        FILTER doc.org_id == @orgId AND doc.repo_id == @repoId
        SORT doc.created_at DESC
        LIMIT 1000
        RETURN doc
      `,
      { orgId, repoId }
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as TokenUsageEntry
    })
  }

  async getTokenUsageSummary(orgId: string, repoId: string): Promise<TokenUsageSummary> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      FOR doc IN token_usage_log
        FILTER doc.org_id == @orgId AND doc.repo_id == @repoId
        COLLECT model = doc.model INTO group
        RETURN {
          model: model,
          input_tokens: SUM(group[*].doc.input_tokens),
          output_tokens: SUM(group[*].doc.output_tokens)
        }
      `,
      { orgId, repoId }
    )
    const rows = await cursor.all() as Array<{ model: string; input_tokens: number; output_tokens: number }>

    const { MODEL_COSTS } = require("@/lib/llm/config") as typeof import("@/lib/llm/config")

    let totalInput = 0
    let totalOutput = 0
    let totalCost = 0
    const byModel: Record<string, { input_tokens: number; output_tokens: number; cost_usd: number }> = {}

    for (const row of rows) {
      const { MODEL_COST_FALLBACK } = require("@/lib/llm/config") as typeof import("@/lib/llm/config")
      const costs = MODEL_COSTS[row.model] ?? MODEL_COST_FALLBACK
      const cost = row.input_tokens * costs.input + row.output_tokens * costs.output
      totalInput += row.input_tokens
      totalOutput += row.output_tokens
      totalCost += cost
      byModel[row.model] = { input_tokens: row.input_tokens, output_tokens: row.output_tokens, cost_usd: Math.round(cost * 10000) / 10000 }
    }

    return {
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      estimated_cost_usd: Math.round(totalCost * 10000) / 10000,
      by_model: byModel,
    }
  }

  // ── Phase 5: Incremental Indexing ──────────────────────────────

  async createEdgesForEntity(orgId: string, entityKey: string, edges: EdgeDoc[]): Promise<void> {
    if (edges.length === 0) return
    const db = await getDbAsync()

    // Build all possible qualified IDs for this entity key
    const possibleIds = ALL_ENTITY_COLLECTIONS.map((c) => `${c}/${entityKey}`)

    // Step 1: Delete old edges where _from or _to references the entity key
    for (const edgeName of EDGE_COLLECTIONS) {
      try {
        const cursor = await db.query(
          `
          FOR e IN @@coll
            FILTER e.org_id == @orgId AND (e._from IN @possibleIds OR e._to IN @possibleIds)
            REMOVE e IN @@coll
          `,
          { "@coll": edgeName, orgId, possibleIds }
        )
        await cursor.all()
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[createEdgesForEntity] Failed to delete old edges from ${edgeName}: ${message}`)
      }
    }

    // Step 2: Insert new edges (group by edge kind → collection)
    const byKind = new Map<string, EdgeDoc[]>()
    for (const e of edges) {
      const kind = (e.kind as string) ?? "calls"
      const coll = EDGE_COLLECTIONS.includes(kind as (typeof EDGE_COLLECTIONS)[number]) ? kind : "calls"
      if (!byKind.has(coll)) byKind.set(coll, [])
      byKind.get(coll)!.push({ ...e, org_id: e.org_id ?? orgId })
    }
    for (const [collName, list] of Array.from(byKind.entries())) {
      const col = db.collection(collName)
      for (let i = 0; i < list.length; i += BATCH_SIZE) {
        const batch = list.slice(i, i + BATCH_SIZE).map((e) => ({
          _from: qualifyVertexHandle(e._from),
          _to: qualifyVertexHandle(e._to),
          org_id: e.org_id,
          repo_id: e.repo_id,
          kind: e.kind,
        }))
        await col.import(batch, { onDuplicate: "update" })
      }
    }
  }

  async getEdgesForEntities(orgId: string, entityKeys: string[]): Promise<EdgeDoc[]> {
    if (entityKeys.length === 0) return []
    const db = await getDbAsync()
    const results: EdgeDoc[] = []
    // Build all possible qualified IDs for these keys
    const possibleIds = entityKeys.flatMap((key) =>
      ALL_ENTITY_COLLECTIONS.map((c) => `${c}/${key}`)
    )
    for (const edgeName of EDGE_COLLECTIONS) {
      const cursor = await db.query(
        `
        FOR e IN @@coll
          FILTER e.org_id == @orgId AND (e._from IN @possibleIds OR e._to IN @possibleIds)
          RETURN e
        `,
        { "@coll": edgeName, orgId, possibleIds }
      )
      const docs = await cursor.all()
      for (const d of docs) {
        results.push(d as EdgeDoc)
      }
    }
    return results
  }

  async batchDeleteEntities(orgId: string, entityKeys: string[]): Promise<void> {
    if (entityKeys.length === 0) return
    const db = await getDbAsync()
    for (const collName of ALL_ENTITY_COLLECTIONS) {
      const cursor = await db.query(
        `
        FOR doc IN @@coll
          FILTER doc.org_id == @orgId AND doc._key IN @keys
          REMOVE doc IN @@coll
        `,
        { "@coll": collName, orgId, keys: entityKeys }
      )
      await cursor.all()
    }
  }

  async batchDeleteEdgesByEntity(orgId: string, entityKeys: string[]): Promise<void> {
    if (entityKeys.length === 0) return
    const db = await getDbAsync()
    const possibleIds = entityKeys.flatMap((key) =>
      ALL_ENTITY_COLLECTIONS.map((c) => `${c}/${key}`)
    )
    for (const edgeName of EDGE_COLLECTIONS) {
      const cursor = await db.query(
        `
        FOR e IN @@coll
          FILTER e.org_id == @orgId AND (e._from IN @possibleIds OR e._to IN @possibleIds)
          REMOVE e IN @@coll
        `,
        { "@coll": edgeName, orgId, possibleIds }
      )
      await cursor.all()
    }
  }

  async findBrokenEdges(orgId: string, repoId: string, deletedKeys: string[]): Promise<EdgeDoc[]> {
    if (deletedKeys.length === 0) return []
    const db = await getDbAsync()
    const possibleIds = deletedKeys.flatMap((key) =>
      ALL_ENTITY_COLLECTIONS.map((c) => `${c}/${key}`)
    )
    const results: EdgeDoc[] = []
    for (const edgeName of EDGE_COLLECTIONS) {
      const cursor = await db.query(
        `
        FOR e IN @@coll
          FILTER e.org_id == @orgId AND e.repo_id == @repoId
            AND (e._from IN @possibleIds OR e._to IN @possibleIds)
          RETURN e
        `,
        { "@coll": edgeName, orgId, repoId, possibleIds }
      )
      const docs = await cursor.all()
      for (const d of docs) {
        results.push(d as EdgeDoc)
      }
    }
    return results
  }

  // ── Phase 5: Index Events ──────────────────────────────────────

  async insertIndexEvent(orgId: string, event: IndexEventDoc): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("index_events")
    const crypto = require("node:crypto") as typeof import("node:crypto")
    await col.save({
      _key: crypto.randomUUID(),
      ...event,
      org_id: event.org_id ?? orgId,
      created_at: event.created_at || new Date().toISOString(),
    })
  }

  async getIndexEvents(orgId: string, repoId: string, limit = 50): Promise<IndexEventDoc[]> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      FOR doc IN index_events
        FILTER doc.org_id == @orgId AND doc.repo_id == @repoId
        SORT doc.created_at DESC
        LIMIT @limit
        RETURN doc
      `,
      { orgId, repoId, limit }
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return rest as unknown as IndexEventDoc
    })
  }

  async getLatestIndexEvent(orgId: string, repoId: string): Promise<IndexEventDoc | null> {
    const events = await this.getIndexEvents(orgId, repoId, 1)
    return events[0] ?? null
  }

  // ── Phase 5.5: Prompt Ledger ──────────────────────────────────

  async appendLedgerEntry(orgId: string, entry: LedgerEntry): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("ledger")
    await col.save({
      _key: entry.id,
      ...entry,
      org_id: entry.org_id ?? orgId,
      created_at: entry.created_at || new Date().toISOString(),
    })
  }

  async updateLedgerEntryStatus(orgId: string, entryId: string, status: LedgerEntryStatus): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("ledger")
    try {
      const doc = await col.document(entryId)
      const currentStatus = (doc as { status: LedgerEntryStatus }).status
      if (!validateLedgerTransition(currentStatus, status)) {
        throw new Error(`Invalid ledger transition: ${currentStatus} → ${status}`)
      }
      const updates: Record<string, unknown> = { status }
      if (status === "working") updates.validated_at = new Date().toISOString()
      await col.update(entryId, updates)
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("Invalid ledger transition")) throw error
      throw new Error(`Ledger entry ${entryId} not found for org ${orgId}`)
    }
  }

  async queryLedgerTimeline(query: LedgerTimelineQuery): Promise<PaginatedResult<LedgerEntry>> {
    const db = await getDbAsync()
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const filters: string[] = ["doc.org_id == @orgId", "doc.repo_id == @repoId"]
    const bindVars: Record<string, unknown> = { orgId: query.orgId, repoId: query.repoId, limit: limit + 1 }

    if (query.branch) {
      filters.push("doc.branch == @branch")
      bindVars.branch = query.branch
    }
    if (query.timelineBranch !== undefined) {
      filters.push("doc.timeline_branch == @timelineBranch")
      bindVars.timelineBranch = query.timelineBranch
    }
    if (query.status) {
      filters.push("doc.status == @status")
      bindVars.status = query.status
    }
    if (query.userId) {
      filters.push("doc.user_id == @userId")
      bindVars.userId = query.userId
    }
    if (query.cursor) {
      // Cursor-based pagination: entries created before the cursor entry
      filters.push("doc.created_at < (FOR c IN ledger FILTER c._key == @cursor RETURN c.created_at)[0]")
      bindVars.cursor = query.cursor
    }

    const cursor = await db.query(
      `
      FOR doc IN ledger
        FILTER ${filters.join(" AND ")}
        SORT doc.created_at DESC
        LIMIT @limit
        RETURN doc
      `,
      bindVars
    )
    const docs = await cursor.all()
    const hasMore = docs.length > limit
    const items = (hasMore ? docs.slice(0, limit) : docs).map(
      (d: { _key: string; _id: string; [k: string]: unknown }) => {
        const { _key, _id, ...rest } = d
        return { id: _key, ...rest } as LedgerEntry
      }
    )
    const lastItem = items[items.length - 1]
    return {
      items,
      cursor: lastItem ? lastItem.id : null,
      hasMore,
    }
  }

  async getUncommittedEntries(orgId: string, repoId: string, branch: string): Promise<LedgerEntry[]> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      FOR doc IN ledger
        FILTER doc.org_id == @orgId AND doc.repo_id == @repoId AND doc.branch == @branch
          AND doc.status NOT IN ["committed", "reverted"]
        SORT doc.created_at ASC
        LIMIT 500
        RETURN doc
      `,
      { orgId, repoId, branch }
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as LedgerEntry
    })
  }

  async getMaxTimelineBranch(orgId: string, repoId: string, branch: string): Promise<number> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      RETURN MAX(
        FOR doc IN ledger
          FILTER doc.org_id == @orgId AND doc.repo_id == @repoId AND doc.branch == @branch
          RETURN doc.timeline_branch
      ) || 0
      `,
      { orgId, repoId, branch }
    )
    const results = await cursor.all()
    return (results[0] as number) ?? 0
  }

  async markEntriesReverted(orgId: string, entryIds: string[]): Promise<void> {
    if (entryIds.length === 0) return
    const db = await getDbAsync()
    await db.query(
      `
      FOR doc IN ledger
        FILTER doc.org_id == @orgId AND doc._key IN @entryIds
          AND doc.status NOT IN ["committed", "reverted"]
        UPDATE doc WITH { status: "reverted" } IN ledger
      `,
      { orgId, entryIds }
    )
  }

  async appendLedgerSummary(orgId: string, summary: LedgerSummary): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("ledger_summaries")
    await col.save({
      _key: summary.id,
      ...summary,
      org_id: summary.org_id ?? orgId,
      created_at: summary.created_at || new Date().toISOString(),
    })
  }

  async queryLedgerSummaries(orgId: string, repoId: string, branch?: string, limit = 50): Promise<LedgerSummary[]> {
    const db = await getDbAsync()
    const filters = ["doc.org_id == @orgId", "doc.repo_id == @repoId"]
    const bindVars: Record<string, unknown> = { orgId, repoId, limit }
    if (branch) {
      filters.push("doc.branch == @branch")
      bindVars.branch = branch
    }
    const cursor = await db.query(
      `
      FOR doc IN ledger_summaries
        FILTER ${filters.join(" AND ")}
        SORT doc.created_at DESC
        LIMIT @limit
        RETURN doc
      `,
      bindVars
    )
    const docs = await cursor.all()
    return docs.map((d: { _key: string; _id: string; [k: string]: unknown }) => {
      const { _key, _id, ...rest } = d
      return { id: _key, ...rest } as LedgerSummary
    })
  }

  async getLedgerEntry(orgId: string, entryId: string): Promise<LedgerEntry | null> {
    const db = await getDbAsync()
    const col = db.collection("ledger")
    try {
      const doc = await col.document(entryId)
      if ((doc as { org_id?: string }).org_id !== orgId) return null
      const { _key, _id, ...rest } = doc as { _key: string; _id: string; [k: string]: unknown }
      return { id: _key, ...rest } as LedgerEntry
    } catch {
      return null
    }
  }

  async appendWorkingSnapshot(orgId: string, snapshot: WorkingSnapshot): Promise<void> {
    const db = await getDbAsync()
    const col = db.collection("working_snapshots")
    await col.save({
      _key: snapshot.id,
      ...snapshot,
      org_id: snapshot.org_id ?? orgId,
      created_at: snapshot.created_at || new Date().toISOString(),
    })
  }

  async getLatestWorkingSnapshot(orgId: string, repoId: string, branch: string): Promise<WorkingSnapshot | null> {
    const db = await getDbAsync()
    const cursor = await db.query(
      `
      FOR doc IN working_snapshots
        FILTER doc.org_id == @orgId AND doc.repo_id == @repoId AND doc.branch == @branch
        SORT doc.created_at DESC
        LIMIT 1
        RETURN doc
      `,
      { orgId, repoId, branch }
    )
    const docs = await cursor.all()
    if (docs.length === 0) return null
    const { _key, _id, ...rest } = docs[0] as { _key: string; _id: string; [k: string]: unknown }
    return { id: _key, ...rest } as WorkingSnapshot
  }

  // ── Scale: Bounded Context Analysis ─────────────────────────

  async findCrossFeatureMutations(orgId: string, repoId: string): Promise<import("@/lib/ports/types").BoundedContextFinding[]> {
    const db = await getDbAsync()
    // Find entities that call into a different feature_tag's entities where the callee is a DB mutation
    const cursor = await db.query(
      `
      LET justifications = (
        FOR j IN justifications
          FILTER j.org_id == @orgId AND j.repo_id == @repoId AND j.valid_to == null
          RETURN { entity_id: j.entity_id, feature_tag: j.feature_tag }
      )
      LET featureMap = MERGE(FOR j IN justifications RETURN { [j.entity_id]: j.feature_tag })
      FOR e IN calls
        FILTER e.org_id == @orgId AND e.repo_id == @repoId
        LET fromKey = SPLIT(e._from, "/")[1]
        LET toKey = SPLIT(e._to, "/")[1]
        LET fromFeature = featureMap[fromKey]
        LET toFeature = featureMap[toKey]
        FILTER fromFeature != null AND toFeature != null AND fromFeature != toFeature
        LET toName = SPLIT(e._to, "/")[1]
        FILTER REGEX_TEST(toName, "insert|update|delete|upsert|save|create|remove|destroy|write", true)
        LIMIT 50
        RETURN {
          sourceFeature: fromFeature,
          targetFeature: toFeature,
          fromKey: fromKey,
          toKey: toKey,
          fromCollection: SPLIT(e._from, "/")[0],
          toCollection: SPLIT(e._to, "/")[0]
        }
      `,
      { orgId, repoId }
    )
    const rawResults = await cursor.all()

    // Enrich with entity details
    const findings: import("@/lib/ports/types").BoundedContextFinding[] = []
    for (const r of rawResults as Array<{
      sourceFeature: string
      targetFeature: string
      fromKey: string
      toKey: string
      fromCollection: string
      toCollection: string
    }>) {
      const sourceEntity = await this.getEntity(orgId, r.fromKey)
      const targetEntity = await this.getEntity(orgId, r.toKey)
      if (!sourceEntity || !targetEntity) continue

      findings.push({
        sourceFeature: r.sourceFeature,
        targetFeature: r.targetFeature,
        sourceEntity: { id: sourceEntity.id, name: sourceEntity.name, filePath: sourceEntity.file_path },
        targetEntity: { id: targetEntity.id, name: targetEntity.name, filePath: targetEntity.file_path },
        message: `\`${sourceEntity.name}\` (feature: ${r.sourceFeature}) calls mutation \`${targetEntity.name}\` (feature: ${r.targetFeature}). This cross-feature mutation may indicate bounded context bleed.`,
      })
    }

    return findings
  }

  // ── Entity Browsing with Justifications ─────────────────────────

  async getEntitiesWithJustifications(
    orgId: string,
    repoId: string,
    opts?: {
      kind?: string
      taxonomy?: string
      featureTag?: string
      search?: string
      offset?: number
      limit?: number
    }
  ): Promise<{ entities: Array<import("@/lib/ports/types").EntityDoc & { justification?: import("@/lib/ports/types").JustificationDoc }>; total: number }> {
    const db = await getDbAsync()
    const offset = opts?.offset ?? 0
    const limit = Math.min(opts?.limit ?? 50, 200)

    // Map kind filter to collection(s)
    const collections = opts?.kind
      ? [KIND_TO_COLLECTION[opts.kind] ?? "functions"].filter(Boolean)
      : [...ALL_ENTITY_COLLECTIONS]

    // Unique collections
    const uniqueCollections = Array.from(new Set(collections))

    // Build per-collection filters
    const entityFilters: string[] = ["doc.org_id == @orgId", "doc.repo_id == @repoId"]
    const bindVars: Record<string, unknown> = { orgId, repoId, offset, limit }

    if (opts?.search) {
      entityFilters.push("CONTAINS(LOWER(doc.name), LOWER(@search))")
      bindVars.search = opts.search
    }

    // Build UNION of all entity collections
    const unionParts = uniqueCollections.map((coll, i) => {
      const collVar = `@coll${i}`
      bindVars[`coll${i}`] = coll
      return `(FOR doc IN @@coll${i} FILTER ${entityFilters.join(" AND ")} RETURN doc)`
    })

    // Build justification filter
    const justFilters: string[] = []
    if (opts?.taxonomy) {
      justFilters.push("j.taxonomy == @taxonomy")
      bindVars.taxonomy = opts.taxonomy
    }
    if (opts?.featureTag) {
      justFilters.push("j.feature_tag == @featureTag")
      bindVars.featureTag = opts.featureTag
    }
    const justFilterClause = justFilters.length > 0
      ? `FILTER ${justFilters.join(" AND ")}`
      : ""

    // If taxonomy/featureTag filters are present, we need to filter via justification JOIN
    const needsJustFilter = opts?.taxonomy || opts?.featureTag

    const query = needsJustFilter
      ? `
        LET allEntities = UNION(${unionParts.join(", ")})
        LET joined = (
          FOR e IN allEntities
            LET j = FIRST(
              FOR jd IN justifications
                FILTER jd.org_id == @orgId AND jd.entity_id == e._key AND jd.valid_to == null
                ${justFilterClause}
                RETURN jd
            )
            FILTER j != null
            RETURN MERGE(e, { _justification: j })
        )
        LET total = LENGTH(joined)
        LET paged = (
          FOR item IN joined
            SORT item.name ASC
            LIMIT @offset, @limit
            RETURN item
        )
        RETURN { items: paged, total: total }
      `
      : `
        LET allEntities = UNION(${unionParts.join(", ")})
        LET total = LENGTH(allEntities)
        LET paged = (
          FOR e IN allEntities
            SORT e.name ASC
            LIMIT @offset, @limit
            LET j = FIRST(
              FOR jd IN justifications
                FILTER jd.org_id == @orgId AND jd.entity_id == e._key AND jd.valid_to == null
                RETURN jd
            )
            RETURN MERGE(e, { _justification: j })
        )
        RETURN { items: paged, total: total }
      `

    const cursor = await db.query(query, bindVars)
    const results = await cursor.all()
    const result = results[0] as { items: Array<Record<string, unknown>>; total: number } | undefined

    if (!result) return { entities: [], total: 0 }

    const entities = result.items.map((item) => {
      const { _key, _id, _justification, ...rest } = item as {
        _key: string
        _id: string
        _justification?: Record<string, unknown>
        [k: string]: unknown
      }
      const entity = { id: _key, ...rest } as import("@/lib/ports/types").EntityDoc & {
        justification?: import("@/lib/ports/types").JustificationDoc
      }
      if (_justification) {
        const { _key: jKey, _id: jId, ...jRest } = _justification as {
          _key: string
          _id: string
          [k: string]: unknown
        }
        entity.justification = { id: jKey, ...jRest } as import("@/lib/ports/types").JustificationDoc
      }
      return entity
    })

    return { entities, total: result.total }
  }

  // ── Shadow Reindexing ─────────────────────────────────────────

  async deleteByIndexVersion(orgId: string, repoId: string, indexVersion: string): Promise<void> {
    const db = await getDbAsync()
    const entityCollections = ["files", "functions", "classes", "interfaces", "variables"] as const
    for (const name of entityCollections) {
      await db.query(
        `FOR doc IN @@coll FILTER doc.org_id == @orgId AND doc.repo_id == @repoId AND doc.index_version == @iv REMOVE doc IN @@coll`,
        { "@coll": name, orgId, repoId, iv: indexVersion }
      )
    }
    for (const name of EDGE_COLLECTIONS) {
      await db.query(
        `FOR doc IN @@coll FILTER doc.org_id == @orgId AND doc.repo_id == @repoId AND doc.index_version == @iv REMOVE doc IN @@coll`,
        { "@coll": name, orgId, repoId, iv: indexVersion }
      )
    }
  }
}
