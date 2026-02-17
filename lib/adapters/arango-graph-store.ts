/**
 * ArangoGraphStore — IGraphStore implementation using ArangoDB.
 * Phase 0: bootstrapGraphSchema + health; other methods implemented but unused until Phase 1+.
 */

import { Database } from "arangojs"
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

function getConfig() {
  const url = process.env.ARANGODB_URL ?? "http://localhost:8529"
  const password = process.env.ARANGO_ROOT_PASSWORD ?? "changeme"
  const databaseName = process.env.ARANGODB_DATABASE ?? "kap10_db"
  return { url, password, databaseName }
}

let dbInstance: Database | null = null

async function getDbAsync(): Promise<Database> {
  if (!dbInstance) {
    const { url, password, databaseName } = getConfig()
    const base = new Database({ url, auth: { username: "root", password } })
    try {
      await base.createDatabase(databaseName)
    } catch {
      // exists
    }
    base.useDatabase(databaseName)
    dbInstance = base
  }
  return dbInstance
}

function getDb(): Database {
  if (!dbInstance) {
    const { url, password, databaseName } = getConfig()
    const base = new Database({ url, auth: { username: "root", password } })
    base.useDatabase(databaseName)
    dbInstance = base
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
  async getEntity(_orgId: string, _entityId: string): Promise<EntityDoc | null> {
    return Promise.resolve(null)
  }
  async deleteEntity(_orgId: string, _entityId: string): Promise<void> {
    return Promise.resolve()
  }
  async upsertEdge(_orgId: string, _edge: EdgeDoc): Promise<void> {
    return Promise.resolve()
  }
  async getCallersOf(_orgId: string, _entityId: string, _depth?: number): Promise<EntityDoc[]> {
    return Promise.resolve([])
  }
  async getCalleesOf(_orgId: string, _entityId: string, _depth?: number): Promise<EntityDoc[]> {
    return Promise.resolve([])
  }
  async impactAnalysis(_orgId: string, _entityId: string, _maxDepth: number): Promise<ImpactResult> {
    return Promise.resolve({ entityId: "", affected: [] })
  }
  async getEntitiesByFile(_orgId: string, _filePath: string): Promise<EntityDoc[]> {
    return Promise.resolve([])
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
  async bulkUpsertEntities(_orgId: string, _entities: EntityDoc[]): Promise<void> {
    return Promise.resolve()
  }
  async bulkUpsertEdges(_orgId: string, _edges: EdgeDoc[]): Promise<void> {
    return Promise.resolve()
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
