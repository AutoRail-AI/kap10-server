/**
 * Phase 4: Domain Ontology Extractor — discovers DDD ubiquitous language
 * from code entity names using frequency analysis and LLM refinement.
 */

import type { EntityDoc } from "@/lib/ports/types"

// ── Three-Tier Term Classification (L-25) ─────────────────────────────────────

export type TermTier = "domain" | "architectural" | "framework"

export interface ClassifiedTerm {
  term: string
  frequency: number
  tier: TermTier
  relatedTerms: string[]
}

const ARCHITECTURAL_TERMS = new Set([
  "handler", "controller", "service", "adapter", "factory", "repository",
  "middleware", "interceptor", "guard", "pipe", "resolver", "gateway",
  "proxy", "facade", "decorator", "observer", "listener", "emitter",
  "publisher", "subscriber", "consumer", "producer", "worker", "queue",
  "cache", "store", "registry", "router", "dispatcher", "scheduler",
  "manager", "provider", "strategy", "builder", "validator", "serializer",
  "transformer", "mapper", "converter", "parser", "formatter", "encoder",
  "decoder", "connector", "client", "server", "endpoint", "route",
  "migration", "seed", "fixture", "mock", "stub", "spy",
])

const FRAMEWORK_TERMS = new Set([
  "react", "next", "nextjs", "vue", "angular", "svelte", "express",
  "fastify", "koa", "nest", "nestjs", "prisma", "drizzle", "sequelize",
  "mongoose", "typeorm", "knex", "supabase", "firebase", "redis",
  "postgres", "postgresql", "mysql", "mongo", "mongodb", "sqlite",
  "temporal", "bull", "kafka", "rabbitmq", "graphql", "apollo", "trpc",
  "zod", "joi", "yup", "webpack", "vite", "turbopack", "esbuild",
  "tailwind", "chakra", "material", "shadcn", "storybook", "playwright",
  "jest", "vitest", "mocha", "cypress", "docker", "kubernetes", "aws",
  "gcp", "azure", "vercel", "cloudflare", "stripe", "auth0", "clerk",
  "arangodb", "arango", "graphology", "onnx",
])

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
 * L-25: Classify terms into three tiers — domain, architectural, framework.
 * Unknown terms default to "domain" (the safe choice — domain-specific terms
 * are the most likely to be unfamiliar).
 */
export function classifyTerms(
  terms: Array<{ term: string; frequency: number }>
): ClassifiedTerm[] {
  return terms.map(({ term, frequency }) => ({
    term,
    frequency,
    tier: classifyTier(term),
    relatedTerms: [],
  }))
}

function classifyTier(term: string): TermTier {
  const lower = term.toLowerCase()
  if (FRAMEWORK_TERMS.has(lower)) return "framework"
  if (ARCHITECTURAL_TERMS.has(lower)) return "architectural"
  return "domain"
}

/**
 * Split an identifier into raw lowercase parts without filtering stopwords.
 * Used by buildDomainToArchitectureMap where architectural terms (which ARE
 * programming stopwords) need to be preserved.
 */
function splitIdentifierRaw(name: string): string[] {
  const parts = name.split(/[_\-.\/]/)
  const terms: string[] = []
  for (const part of parts) {
    const camelParts = part.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
    for (const cp of camelParts) {
      const lower = cp.toLowerCase()
      if (lower.length >= MIN_TERM_LENGTH) {
        terms.push(lower)
      }
    }
  }
  return terms
}

/**
 * L-25: Build cross-tier relationships by scanning entity names for
 * co-occurrence of domain + architectural terms.
 * E.g., "PaymentHandler" → domain "payment" maps to ["paymentHandler"].
 */
export function buildDomainToArchitectureMap(
  entities: EntityDoc[],
  classifiedTerms: ClassifiedTerm[]
): Record<string, string[]> {
  const domainTerms = new Set(classifiedTerms.filter((t) => t.tier === "domain").map((t) => t.term))
  const archTerms = new Set(classifiedTerms.filter((t) => t.tier === "architectural").map((t) => t.term))
  const mapping: Record<string, Set<string>> = {}

  for (const entity of entities) {
    // Use raw split (no stopword filtering) since architectural terms are stopwords
    const parts = splitIdentifierRaw(entity.name ?? "")
    const foundDomain = parts.filter((p) => domainTerms.has(p))
    const foundArch = parts.filter((p) => archTerms.has(p))
    for (const d of foundDomain) {
      for (const a of foundArch) {
        if (!mapping[d]) mapping[d] = new Set()
        mapping[d].add(`${d}${a.charAt(0).toUpperCase() + a.slice(1)}`)
      }
    }
  }

  return Object.fromEntries(
    Object.entries(mapping).map(([k, v]) => [k, Array.from(v)])
  )
}

/**
 * Build an LLM prompt to refine raw domain terms into a proper ontology
 * with ubiquitous language definitions and related terms.
 *
 * When classifiedTerms are provided (L-25), the prompt includes three-tier
 * classification to help the LLM distinguish domain from infrastructure terms.
 */
export function buildOntologyPrompt(
  terms: Array<{ term: string; frequency: number }>,
  sampleEntities: EntityDoc[],
  classifiedTerms?: ClassifiedTerm[]
): string {
  const topTerms = terms.slice(0, 50)

  const samples = sampleEntities
    .slice(0, 20)
    .map((e) => `  - ${e.kind}: ${e.name} (${e.file_path})`)
    .join("\n")

  // L-25: If three-tier classification is available, group terms by tier
  let termSection: string
  if (classifiedTerms && classifiedTerms.length > 0) {
    const byTier = { domain: [] as ClassifiedTerm[], architectural: [] as ClassifiedTerm[], framework: [] as ClassifiedTerm[] }
    for (const ct of classifiedTerms.slice(0, 50)) {
      byTier[ct.tier].push(ct)
    }
    const formatTier = (items: ClassifiedTerm[]) =>
      items.map((t) => `  - "${t.term}" (freq: ${t.frequency})`).join("\n") || "  (none detected)"

    termSection = `## Pre-classified Domain Terms

### Domain (business concepts)
${formatTier(byTier.domain)}

### Architectural (design patterns)
${formatTier(byTier.architectural)}

### Framework/Infrastructure
${formatTier(byTier.framework)}

Review and correct these classifications. Move misclassified terms to the right tier.`
  } else {
    const termList = topTerms.map((t) => `  - "${t.term}" (appears ${t.frequency} times)`).join("\n")
    termSection = `## Extracted Domain Terms (by frequency)\n${termList}`
  }

  return `You are analyzing a software codebase to discover its domain-driven design (DDD) ubiquitous language.

${termSection}

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
