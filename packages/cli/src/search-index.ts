/**
 * Local search index using CozoDB relations.
 *
 * Tokenizes entity names (camelCase, snake_case, PascalCase) and stores
 * as search_tokens relation for fast local text search.
 */

import type { CozoDb } from "./cozo-schema.js"

/**
 * Tokenize an entity name into searchable tokens.
 * Handles camelCase, PascalCase, snake_case, and kebab-case.
 */
export function tokenize(name: string): string[] {
  // Split on non-alphanumeric, then split camelCase
  const parts = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter((p) => p.length > 0)
    .map((p) => p.toLowerCase())

  return [...new Set(parts)]
}

/**
 * Build search index from entities already loaded in CozoDB.
 * Reads all entities, tokenizes names, and populates search_tokens.
 */
export function buildSearchIndex(db: CozoDb): void {
  // Read all entities
  const result = db.run("?[key, name] := *entities[key, kind, name, fp, sl, sig, body]")

  for (const row of result.rows) {
    const [key, name] = row as [string, string]
    const tokens = tokenize(name)
    for (const token of tokens) {
      try {
        db.run(
          "?[token, entity_key] <- [[$token, $key]] :put search_tokens { token, entity_key }",
          { token, key }
        )
      } catch {
        // Duplicate — ignore
      }
    }
  }
}

/**
 * Search local entities by query string.
 * Tokenizes query, finds matching entities via token intersection, ranks by match count.
 */
export function searchLocal(
  db: CozoDb,
  query: string,
  limit = 20
): Array<{ key: string; name: string; kind: string; file_path: string; score: number }> {
  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return []

  // Find entities that match ANY token, count matches per entity
  const tokenList = queryTokens.map((t) => `"${t}"`).join(", ")
  const result = db.run(`
    tokens[t] <- [[${tokenList}]]
    matched[ek, count(t)] := tokens[t], *search_tokens[t, ek]
    ?[ek, cnt, name, kind, fp] := matched[ek, cnt],
      *entities[ek, kind, name, fp, sl, sig, body]
    :order -cnt
    :limit ${limit}
  `)

  return result.rows.map((row) => {
    const [key, score, name, kind, file_path] = row as [string, number, string, string, string]
    return { key, name, kind, file_path, score }
  })
}
