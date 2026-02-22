/**
 * Pattern Catalog Loader — discovers and loads YAML pattern definitions
 * from the catalog directory.
 */

import type { AstGrepQuery } from "@/lib/ports/types"

export interface CatalogPattern {
  id: string
  type: string
  title: string
  description: string
  language: string
  pattern: string
  message?: string
  fix?: string
}

let cachedPatterns: CatalogPattern[] | null = null

export function loadCatalogPatterns(): CatalogPattern[] {
  if (cachedPatterns) return cachedPatterns

  const fs = require("node:fs") as typeof import("node:fs")
  const path = require("node:path") as typeof import("node:path")
  const yaml = require("yaml") as typeof import("yaml")

  const catalogDir = path.join(__dirname, "catalog")
  if (!fs.existsSync(catalogDir)) {
    cachedPatterns = []
    return cachedPatterns
  }

  const files = fs.readdirSync(catalogDir).filter((f: string) => f.endsWith(".yaml") || f.endsWith(".yml"))
  const patterns: CatalogPattern[] = []

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(catalogDir, file), "utf8")
      const parsed = yaml.parse(content) as { patterns?: CatalogPattern[] }
      if (parsed?.patterns && Array.isArray(parsed.patterns)) {
        patterns.push(...parsed.patterns)
      }
    } catch {
      console.warn(`[catalog-loader] Failed to parse ${file}`)
    }
  }

  cachedPatterns = patterns
  return cachedPatterns
}

export function catalogToAstGrepQueries(language?: string): AstGrepQuery[] {
  const patterns = loadCatalogPatterns()
  const filtered = language ? patterns.filter((p) => p.language === language) : patterns
  return filtered.map((p) => ({
    id: p.id,
    pattern: p.pattern,
    language: p.language,
    message: p.message ?? p.description,
    fix: p.fix,
  }))
}
