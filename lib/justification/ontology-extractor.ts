/**
 * Phase 4: Domain Ontology Extractor — discovers DDD ubiquitous language
 * from code entity names using frequency analysis and LLM refinement.
 */

import type { EntityDoc } from "@/lib/ports/types"

/** Common programming stopwords to filter out of domain terms. */
const PROGRAMMING_STOPWORDS = new Set([
  "get", "set", "add", "remove", "delete", "update", "create", "find", "fetch",
  "save", "load", "init", "start", "stop", "run", "execute", "handle", "process",
  "parse", "format", "convert", "transform", "validate", "check", "is", "has",
  "can", "should", "will", "do", "make", "build", "render", "mount", "unmount",
  "use", "with", "from", "to", "of", "by", "for", "in", "on", "at", "the",
  "and", "or", "not", "all", "each", "every", "some", "any", "new", "old",
  "data", "info", "item", "list", "map", "set", "array", "object", "string",
  "number", "boolean", "null", "undefined", "void", "async", "await", "promise",
  "error", "result", "response", "request", "input", "output", "params", "args",
  "config", "options", "props", "state", "context", "provider", "consumer",
  "component", "module", "service", "controller", "model", "view", "util",
  "helper", "index", "type", "interface", "enum", "class", "function", "method",
  "test", "spec", "mock", "stub", "fake", "fixture", "setup", "teardown",
  "before", "after", "describe", "it", "expect", "assert",
  "default", "export", "import", "return", "throw", "catch", "try", "finally",
  "constructor", "prototype", "instance", "static", "abstract", "override",
  "public", "private", "protected", "readonly", "const", "let", "var",
])

/** Minimum term length to consider. */
const MIN_TERM_LENGTH = 3

/** Minimum frequency to include in ontology. */
const MIN_FREQUENCY = 2

/**
 * Split a camelCase or snake_case identifier into individual terms.
 */
export function splitIdentifier(name: string): string[] {
  // Split on underscores, hyphens, dots
  const parts = name.split(/[_\-.\/]/)

  const terms: string[] = []
  for (const part of parts) {
    // Split camelCase: "getUserById" → ["get", "User", "By", "Id"]
    const camelParts = part.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
    for (const cp of camelParts) {
      const lower = cp.toLowerCase()
      if (lower.length >= MIN_TERM_LENGTH && !PROGRAMMING_STOPWORDS.has(lower)) {
        terms.push(lower)
      }
    }
  }
  return terms
}

/**
 * Extract domain terms from entity names with frequency analysis.
 * Returns terms sorted by frequency descending.
 */
export function extractDomainTerms(
  entities: EntityDoc[]
): Array<{ term: string; frequency: number }> {
  const freq = new Map<string, number>()

  for (const entity of entities) {
    const name = entity.name ?? ""
    const terms = splitIdentifier(name)
    const uniqueTerms = Array.from(new Set(terms))
    for (const term of uniqueTerms) {
      freq.set(term, (freq.get(term) ?? 0) + 1)
    }
  }

  return Array.from(freq.entries())
    .filter(([, count]) => count >= MIN_FREQUENCY)
    .sort((a, b) => b[1] - a[1])
    .map(([term, frequency]) => ({ term, frequency }))
}

/**
 * Build an LLM prompt to refine raw domain terms into a proper ontology
 * with ubiquitous language definitions and related terms.
 */
export function buildOntologyPrompt(
  terms: Array<{ term: string; frequency: number }>,
  sampleEntities: EntityDoc[]
): string {
  const topTerms = terms.slice(0, 50)
  const termList = topTerms.map((t) => `  - "${t.term}" (appears ${t.frequency} times)`).join("\n")

  const samples = sampleEntities
    .slice(0, 20)
    .map((e) => `  - ${e.kind}: ${e.name} (${e.file_path})`)
    .join("\n")

  return `You are analyzing a software codebase to discover its domain-driven design (DDD) ubiquitous language.

## Extracted Domain Terms (by frequency)
${termList}

## Sample Entities
${samples}

## Task
Analyze these terms and entity names to:
1. Identify the core domain concepts (business entities, actions, rules)
2. Group related terms together
3. Define each domain concept in plain business language (the "ubiquitous language")
4. Filter out technical/infrastructure terms that aren't domain-specific

Return a JSON object with:
- "terms": array of { "term": string, "frequency": number, "relatedTerms": string[] }
- "ubiquitousLanguage": { [term]: "business definition" }

Focus on business-meaningful terms, not technical implementation details.`
}
