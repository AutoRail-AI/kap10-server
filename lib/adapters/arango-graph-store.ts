/**
 * ArangoGraphStore — IGraphStore implementation using ArangoDB.
 * Phase 0: bootstrapGraphSchema + health; other methods implemented but unused until Phase 1+.
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
  PatternDoc,
  PatternFilter,
  RuleDoc,
  RuleFilter,
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
const BATCH_SIZE = 1000

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
    for (const collName of ENTITY_COLLECTIONS_FOR_FILE) {
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
    direction: "inbound" | "outbound"
  ): Promise<EntityDoc[]> {
    const db = await getDbAsync()
    const possibleIds = ENTITY_COLLECTIONS_FOR_FILE.map((c) => `${c}/${entityId}`)
    const filter = direction === "inbound" ? "e._to" : "e._from"
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

  async getCallersOf(orgId: string, entityId: string): Promise<EntityDoc[]> {
    return this.getConnectedEntities(orgId, entityId, "inbound")
  }
  async getCalleesOf(orgId: string, entityId: string): Promise<EntityDoc[]> {
    return this.getConnectedEntities(orgId, entityId, "outbound")
  }
  async impactAnalysis(_orgId: string, _entityId: string, _maxDepth: number): Promise<ImpactResult> {
    return Promise.resolve({ entityId: "", affected: [] })
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
          SORT doc.line ASC
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
    results.sort((a, b) => (Number(a.line) ?? 0) - (Number(b.line) ?? 0))
    return results
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
      const kind = (e.kind as string) ?? "functions"
      const coll = ["files", "functions", "classes", "interfaces", "variables"].includes(kind) ? kind : "functions"
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
          _from: e._from,
          _to: e._to,
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
}
