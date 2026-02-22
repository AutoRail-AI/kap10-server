/**
 * CozoGraphStore — Local graph store backed by CozoDB.
 *
 * Provides read-only IGraphStore-like interface for local graph queries.
 * Loaded from msgpack snapshots pulled from the cloud.
 */

import { initSchema } from "./cozo-schema.js"
import type { CozoDb } from "./cozo-schema.js"
import { buildSearchIndex, searchLocal } from "./search-index.js"

export interface CompactEntity {
  key: string
  kind: string
  name: string
  file_path: string
  start_line?: number
  signature?: string
  body?: string
}

export interface CompactEdge {
  from_key: string
  to_key: string
  type: string
}

export interface CompactRule {
  key: string
  name: string
  scope: string
  severity: string
  engine: string
  query: string
  message: string
  file_glob: string
  enabled: boolean
  repo_id: string
}

export interface CompactPattern {
  key: string
  name: string
  kind: string
  frequency: number
  confidence: number
  exemplar_keys: string[]
  promoted_rule_key: string
}

export interface SnapshotEnvelope {
  version: number
  repoId: string
  orgId: string
  entities: CompactEntity[]
  edges: CompactEdge[]
  rules?: CompactRule[]
  patterns?: CompactPattern[]
  generatedAt: string
}

export interface LocalEntity {
  key: string
  kind: string
  name: string
  file_path: string
  start_line: number
  signature: string
  body: string
}

export class CozoGraphStore {
  private db: CozoDb
  private loaded = false

  constructor(db: CozoDb) {
    this.db = db
    initSchema(db)
  }

  /**
   * Load a deserialized snapshot into CozoDB.
   */
  loadSnapshot(envelope: SnapshotEnvelope): void {
    // Bulk insert entities
    for (const entity of envelope.entities) {
      this.db.run(
        `?[key, kind, name, file_path, start_line, signature, body] <- [[$key, $kind, $name, $fp, $sl, $sig, $body]]
         :put entities { key => kind, name, file_path, start_line, signature, body }`,
        {
          key: entity.key,
          kind: entity.kind,
          name: entity.name,
          fp: entity.file_path,
          sl: entity.start_line ?? 0,
          sig: entity.signature ?? "",
          body: entity.body ?? "",
        }
      )

      // Build file index
      this.db.run(
        `?[file_path, entity_key] <- [[$fp, $key]] :put file_index { file_path, entity_key }`,
        { fp: entity.file_path, key: entity.key }
      )
    }

    // Bulk insert edges
    for (const edge of envelope.edges) {
      this.db.run(
        `?[from_key, to_key, type] <- [[$from, $to, $type]] :put edges { from_key, to_key, type }`,
        { from: edge.from_key, to: edge.to_key, type: edge.type }
      )
    }

    // Load rules if present (v2 envelope)
    if (envelope.rules && envelope.rules.length > 0) {
      this.loadRules(envelope.rules)
    }

    // Load patterns if present (v2 envelope)
    if (envelope.patterns && envelope.patterns.length > 0) {
      this.loadPatterns(envelope.patterns)
    }

    // Build search index
    buildSearchIndex(this.db)
    this.loaded = true
  }

  /**
   * Get a single entity by key.
   */
  getEntity(key: string): LocalEntity | null {
    const result = this.db.run(
      "?[key, kind, name, fp, sl, sig, body] := *entities[key, kind, name, fp, sl, sig, body], key = $key",
      { key }
    )
    if (result.rows.length === 0) return null
    const [k, kind, name, fp, sl, sig, body] = result.rows[0] as [string, string, string, string, number, string, string]
    return { key: k, kind, name, file_path: fp, start_line: sl, signature: sig, body }
  }

  /**
   * Get all entities that call the given entity.
   */
  getCallersOf(key: string): LocalEntity[] {
    const result = this.db.run(
      `?[k, kind, name, fp, sl, sig, body] := *edges[from_key, $key, "calls"],
        *entities[from_key, kind, name, fp, sl, sig, body],
        k = from_key`,
      { key }
    )
    return result.rows.map((row) => {
      const [k, kind, name, fp, sl, sig, body] = row as [string, string, string, string, number, string, string]
      return { key: k, kind, name, file_path: fp, start_line: sl, signature: sig, body }
    })
  }

  /**
   * Get all entities called by the given entity.
   */
  getCalleesOf(key: string): LocalEntity[] {
    const result = this.db.run(
      `?[k, kind, name, fp, sl, sig, body] := *edges[$key, to_key, "calls"],
        *entities[to_key, kind, name, fp, sl, sig, body],
        k = to_key`,
      { key }
    )
    return result.rows.map((row) => {
      const [k, kind, name, fp, sl, sig, body] = row as [string, string, string, string, number, string, string]
      return { key: k, kind, name, file_path: fp, start_line: sl, signature: sig, body }
    })
  }

  /**
   * Get all entities in a given file.
   */
  getEntitiesByFile(filePath: string): LocalEntity[] {
    const result = this.db.run(
      `?[k, kind, name, fp, sl, sig, body] := *file_index[$fp, ek],
        *entities[ek, kind, name, fp, sl, sig, body],
        k = ek`,
      { fp: filePath }
    )
    return result.rows.map((row) => {
      const [k, kind, name, fp, sl, sig, body] = row as [string, string, string, string, number, string, string]
      return { key: k, kind, name, file_path: fp, start_line: sl, signature: sig, body }
    })
  }

  /**
   * Search entities by name query.
   */
  searchEntities(query: string, limit = 20): Array<{ key: string; name: string; kind: string; file_path: string; score: number }> {
    return searchLocal(this.db, query, limit)
  }

  /**
   * Get import edges for a file.
   */
  getImports(filePath: string): Array<{ from: string; to: string }> {
    const result = this.db.run(
      `?[from_key, to_key] := *file_index[$fp, ek],
        *edges[ek, to_key, "imports"],
        from_key = ek`,
      { fp: filePath }
    )
    return result.rows.map((row) => {
      const [from, to] = row as [string, string]
      return { from, to }
    })
  }

  /**
   * Bulk insert rules into CozoDB.
   */
  loadRules(rules: CompactRule[]): void {
    for (const rule of rules) {
      this.db.run(
        `?[key, name, scope, severity, engine, query, message, file_glob, enabled, repo_id] <- [[$key, $name, $scope, $severity, $engine, $query, $message, $fg, $enabled, $rid]]
         :put rules { key => name, scope, severity, engine, query, message, file_glob, enabled, repo_id }`,
        {
          key: rule.key,
          name: rule.name,
          scope: rule.scope,
          severity: rule.severity,
          engine: rule.engine,
          query: rule.query,
          message: rule.message,
          fg: rule.file_glob,
          enabled: rule.enabled,
          rid: rule.repo_id,
        }
      )
    }
  }

  /**
   * Bulk insert patterns into CozoDB.
   */
  loadPatterns(patterns: CompactPattern[]): void {
    for (const pattern of patterns) {
      this.db.run(
        `?[key, name, kind, frequency, confidence, exemplar_keys, promoted_rule_key] <- [[$key, $name, $kind, $freq, $conf, $ek, $prk]]
         :put patterns { key => name, kind, frequency, confidence, exemplar_keys, promoted_rule_key }`,
        {
          key: pattern.key,
          name: pattern.name,
          kind: pattern.kind,
          freq: pattern.frequency,
          conf: pattern.confidence,
          ek: pattern.exemplar_keys.join(","),
          prk: pattern.promoted_rule_key,
        }
      )
    }
  }

  /**
   * Check if rules exist in the local store.
   */
  hasRules(): boolean {
    const result = this.db.run("?[key] := *rules[key, name, scope, severity, engine, query, message, fg, enabled, rid] :limit 1")
    return result.rows.length > 0
  }

  /**
   * Get rules, optionally filtered by file path glob matching.
   * Returns rules sorted by scope priority (workspace > branch > path > repo > org).
   */
  getRules(filePath?: string): CompactRule[] {
    const result = this.db.run(
      "?[key, name, scope, severity, engine, query, message, fg, enabled, rid] := *rules[key, name, scope, severity, engine, query, message, fg, enabled, rid], enabled = true"
    )

    const rules: CompactRule[] = result.rows.map((row) => {
      const [key, name, scope, severity, engine, query, message, file_glob, enabled, repo_id] = row as [string, string, string, string, string, string, string, string, boolean, string]
      return { key, name, scope, severity, engine, query, message, file_glob, enabled, repo_id }
    })

    // Filter by file path glob if provided
    if (filePath) {
      return rules.filter((rule) => {
        if (!rule.file_glob) return true
        return matchGlob(filePath, rule.file_glob)
      })
    }

    // Sort by scope priority
    const scopePriority: Record<string, number> = { workspace: 5, branch: 4, path: 3, repo: 2, org: 1 }
    rules.sort((a, b) => (scopePriority[b.scope] ?? 0) - (scopePriority[a.scope] ?? 0))

    return rules
  }

  /**
   * Get all patterns.
   */
  getPatterns(): CompactPattern[] {
    const result = this.db.run(
      "?[key, name, kind, freq, conf, ek, prk] := *patterns[key, name, kind, freq, conf, ek, prk]"
    )

    return result.rows.map((row) => {
      const [key, name, kind, frequency, confidence, exemplarKeysStr, promoted_rule_key] = row as [string, string, string, number, number, string, string]
      return {
        key,
        name,
        kind,
        frequency,
        confidence,
        exemplar_keys: exemplarKeysStr ? exemplarKeysStr.split(",").filter(Boolean) : [],
        promoted_rule_key,
      }
    })
  }

  /**
   * Health check — always up for local store.
   */
  healthCheck(): { status: "up"; latencyMs: number } {
    return { status: "up", latencyMs: 0 }
  }

  isLoaded(): boolean {
    return this.loaded
  }
}

/** Simple glob matching — supports * and ** patterns. */
function matchGlob(filePath: string, glob: string): boolean {
  const regex = glob
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
  return new RegExp(`^${regex}$`).test(filePath)
}
