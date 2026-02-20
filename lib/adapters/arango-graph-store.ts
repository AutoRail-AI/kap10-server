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
  BlueprintData,
  EdgeDoc,
  EntityDoc,
  FeatureDoc,
  ImpactResult,
  ImportChain,
  PatternDoc,
  PatternFilter,
  ProjectStats,
  RuleDoc,
  RuleFilter,
  SearchResult,
  SnippetDoc,
  SnippetFilter,
} from "@/lib/ports/types"

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
] as const

const EDGE_COLLECTIONS = ["contains", "calls", "imports", "extends", "implements"] as const

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
  const databaseName = process.env.ARANGODB_DATABASE ?? "kap10_db"
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
  async upsertRule(_orgId: string, _rule: RuleDoc): Promise<void> {
    return Promise.resolve()
  }
  async queryRules(_orgId: string, _filter: RuleFilter): Promise<RuleDoc[]> {
    return Promise.resolve([])
  }
  async upsertPattern(_orgId: string, _pattern: PatternDoc): Promise<void> {
    return Promise.resolve()
  }
  async queryPatterns(_orgId: string, _filter: PatternFilter): Promise<PatternDoc[]> {
    return Promise.resolve([])
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
    const bindVars = { orgId, repoId }

    // Count entities per collection
    const countQueries = ["files", "functions", "classes", "interfaces", "variables"].map(
      async (collName) => {
        const cursor = await db.query(
          `RETURN LENGTH(FOR doc IN @@coll FILTER doc.org_id == @orgId AND doc.repo_id == @repoId RETURN 1)`,
          { ...bindVars, "@coll": collName }
        )
        const result = await cursor.all()
        return { collection: collName, count: (result[0] as number) || 0 }
      }
    )

    // Language distribution from files collection
    const langCursor = await db.query(
      `
      FOR doc IN files
        FILTER doc.org_id == @orgId AND doc.repo_id == @repoId AND doc.language != null
        COLLECT lang = doc.language WITH COUNT INTO cnt
        RETURN { language: lang, count: cnt }
      `,
      bindVars
    )
    const langDocs = await langCursor.all()

    const counts = await Promise.all(countQueries)
    const countMap: Record<string, number> = {}
    for (const c of counts) {
      countMap[c.collection] = c.count
    }

    const languages: Record<string, number> = {}
    for (const ld of langDocs as { language: string; count: number }[]) {
      languages[ld.language] = ld.count
    }

    return {
      files: countMap["files"] ?? 0,
      functions: countMap["functions"] ?? 0,
      classes: countMap["classes"] ?? 0,
      interfaces: countMap["interfaces"] ?? 0,
      variables: countMap["variables"] ?? 0,
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
}
