/**
 * L-20: Unified intent signal extraction for justification prompts.
 *
 * Four signal sources:
 *   1. fromTests — assertion descriptions from test files
 *   2. fromEntryPoints — API route / page / entry point detection
 *   3. fromNaming — camelCase/snake_case → readable intent hint
 *   4. fromCommits — filtered commit messages
 */

import type { EntityDoc } from "@/lib/ports/types"
import { isDescriptiveName } from "./confidence"
import type { TestContext } from "./types"

export interface IntentSignals {
  fromTests: string[]
  fromEntryPoints: string[]
  fromNaming: string | null
  fromCommits: string[]
}

/** Entry point file patterns — reused from dead-code-detector.ts */
const ENTRY_POINT_PATTERNS = [
  /\/route\.(ts|js)$/,
  /\/page\.(tsx|jsx)$/,
  /\/layout\.(tsx|jsx)$/,
  /\/middleware\.(ts|js)$/,
  /\/proxy\.(ts|js)$/,
  /main\.(ts|js)$/,
  /index\.(ts|js)$/,
  /cli\.(ts|js)$/,
]

/** HTTP method patterns in API route file paths */
const API_ROUTE_RE = /\/api\/(.+?)\/route\.(ts|js)$/

/** Merge/version commit patterns to filter out */
const NOISE_COMMIT_RE = /^(merge|bump|chore|release|version|v?\d+\.\d+)/i

/**
 * Extract intent signals from all available sources.
 */
export function extractIntentSignals(
  entity: EntityDoc,
  testContext: TestContext | undefined,
  historicalContext: string[] | undefined,
  graphNeighbors: Array<{
    id: string
    name: string
    kind: string
    direction: string
    file_path?: string
  }>,
  _allEntities: EntityDoc[]
): IntentSignals {
  return {
    fromTests: extractFromTests(testContext),
    fromEntryPoints: extractFromEntryPoints(entity, graphNeighbors),
    fromNaming: extractFromNaming(entity.name),
    fromCommits: extractFromCommits(historicalContext),
  }
}

function extractFromTests(testContext: TestContext | undefined): string[] {
  if (!testContext?.assertions?.length) return []
  return testContext.assertions.slice(0, 5)
}

function extractFromEntryPoints(
  entity: EntityDoc,
  graphNeighbors: Array<{
    id: string
    name: string
    kind: string
    direction: string
    file_path?: string
  }>
): string[] {
  const signals: string[] = []

  // Check if entity's own file is an entry point
  const apiMatch = API_ROUTE_RE.exec(entity.file_path)
  if (apiMatch) {
    signals.push(`API route: /api/${apiMatch[1]}`)
  } else if (ENTRY_POINT_PATTERNS.some((p) => p.test(entity.file_path))) {
    signals.push(`Entry point: ${entity.file_path}`)
  }

  // Check inbound callers from entry point files
  const inboundCallers = graphNeighbors.filter(
    (n) => n.direction === "inbound" && n.file_path
  )
  for (const caller of inboundCallers.slice(0, 3)) {
    const callerApiMatch = API_ROUTE_RE.exec(caller.file_path!)
    if (callerApiMatch) {
      signals.push(`Called from ${caller.name} in /api/${callerApiMatch[1]}`)
    } else if (ENTRY_POINT_PATTERNS.some((p) => p.test(caller.file_path!))) {
      signals.push(`Called from ${caller.name} in ${caller.file_path}`)
    }
  }

  return signals
}

/**
 * Split camelCase/PascalCase/snake_case into readable intent.
 * Returns null for non-descriptive names.
 */
export function extractFromNaming(name: string): string | null {
  if (!isDescriptiveName(name)) return null

  // Split on camelCase, PascalCase, and snake_case boundaries
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase → camel Case
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // HTTPParser → HTTP Parser
    .replace(/_/g, " ") // snake_case → snake case
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0)

  if (words.length < 2) return null

  // Apply verb conjugation for common patterns
  const first = words[0]!
  const rest = words.slice(1).join(" ")

  // Common verb → 3rd person
  const verbMap: Record<string, string> = {
    process: "processes",
    validate: "validates",
    create: "creates",
    update: "updates",
    delete: "deletes",
    fetch: "fetches",
    get: "gets",
    set: "sets",
    build: "builds",
    parse: "parses",
    transform: "transforms",
    handle: "handles",
    send: "sends",
    check: "checks",
    compute: "computes",
    calculate: "calculates",
    generate: "generates",
    load: "loads",
    save: "saves",
    store: "stores",
    find: "finds",
    search: "searches",
    filter: "filters",
    sort: "sorts",
    render: "renders",
    format: "formats",
    extract: "extracts",
    detect: "detects",
    resolve: "resolves",
    dispatch: "dispatches",
    schedule: "schedules",
    initialize: "initializes",
    configure: "configures",
    register: "registers",
    authenticate: "authenticates",
    authorize: "authorizes",
    encrypt: "encrypts",
    decrypt: "decrypts",
    serialize: "serializes",
    deserialize: "deserializes",
    normalize: "normalizes",
    aggregate: "aggregates",
    merge: "merges",
    sync: "syncs",
    emit: "emits",
    listen: "listens",
    subscribe: "subscribes",
    publish: "publishes",
    notify: "notifies",
    retry: "retries",
    queue: "queues",
    cache: "caches",
  }

  const conjugated = verbMap[first] ?? first
  return `${conjugated} ${rest}`
}

function extractFromCommits(historicalContext: string[] | undefined): string[] {
  if (!historicalContext?.length) return []
  return historicalContext
    .filter((msg) => !NOISE_COMMIT_RE.test(msg))
    .slice(0, 3)
}
