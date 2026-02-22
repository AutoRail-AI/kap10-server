/**
 * CozoDB Datalog schema for local graph store.
 *
 * Six relations:
 *   - entities: All graph entities (functions, classes, files, etc.)
 *   - edges: Relationships between entities (calls, imports, extends, etc.)
 *   - file_index: File path → entity key mapping for fast file queries
 *   - search_tokens: Inverted index for local text search
 *   - rules: Code rules for local evaluation (Phase 10b)
 *   - patterns: Detected code patterns (Phase 10b)
 */

export interface CozoDb {
  run(query: string, params?: Record<string, unknown>): { rows: unknown[][] }
}

/**
 * Initialize CozoDB schema. Creates all required relations.
 * Safe to call multiple times (`:create` is idempotent in CozoDB).
 */
export function initSchema(db: CozoDb): void {
  // Entity relation
  db.run(`
    :create entities {
      key: String
      =>
      kind: String,
      name: String,
      file_path: String,
      start_line: Int default 0,
      signature: String default "",
      body: String default ""
    }
  `)

  // Edge relation
  db.run(`
    :create edges {
      from_key: String,
      to_key: String,
      type: String
    }
  `)

  // File index for fast file-based lookups
  db.run(`
    :create file_index {
      file_path: String,
      entity_key: String
    }
  `)

  // Search tokens (inverted index)
  db.run(`
    :create search_tokens {
      token: String,
      entity_key: String
    }
  `)

  // Rules (Phase 10b)
  db.run(`
    :create rules {
      key: String
      =>
      name: String default "",
      scope: String default "repo",
      severity: String default "warn",
      engine: String default "structural",
      query: String default "",
      message: String default "",
      file_glob: String default "",
      enabled: Bool default true,
      repo_id: String default ""
    }
  `)

  // Patterns (Phase 10b)
  db.run(`
    :create patterns {
      key: String
      =>
      name: String default "",
      kind: String default "",
      frequency: Int default 0,
      confidence: Float default 0.0,
      exemplar_keys: String default "",
      promoted_rule_key: String default ""
    }
  `)
}
