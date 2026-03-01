/**
 * Dead code detection via graph analysis.
 *
 * Zero inbound calls + not exported = dead code. Pure graph analysis, no LLM needed.
 * Dead code entities get auto-classified as UTILITY with feature_tag "dead_code".
 *
 * L-17: Framework-invoked patterns (decorators, lifecycle hooks, event handlers,
 * config/factory exports) are excluded — they have zero inbound graph edges
 * but are called by the framework at runtime.
 */

import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"

const TEST_FILE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /\/__tests__\//,
  /\/test\//,
]

export const ENTRY_POINT_PATTERNS = [
  /\/route\.(ts|js)$/,
  /\/page\.(tsx|jsx)$/,
  /\/layout\.(tsx|jsx)$/,
  /\/middleware\.(ts|js)$/,
  /\/proxy\.(ts|js)$/,
  /main\.(ts|js)$/,
  /index\.(ts|js)$/,
  /cli\.(ts|js)$/,
]

// ── L-17: Framework-Invoked Exclusion Patterns ────────────────────────────────

/**
 * Decorator names that indicate framework registration.
 * NestJS, Spring, FastAPI, GraphQL decorators.
 */
const DECORATOR_PATTERNS = /^(Get|Post|Put|Delete|Patch|Head|Options|Query|Mutation|Subscription|MessagePattern|EventPattern|Cron|Injectable|Controller|Module|Guard|Interceptor|Pipe|UseGuards|UseInterceptors)$/

/**
 * Lifecycle hook method names that frameworks call implicitly.
 */
const LIFECYCLE_HOOKS = new Set([
  // React
  "componentDidMount", "componentDidUpdate", "componentWillUnmount",
  "getDerivedStateFromProps", "getSnapshotBeforeUpdate", "shouldComponentUpdate",
  // Angular
  "ngOnInit", "ngOnDestroy", "ngOnChanges", "ngAfterViewInit",
  "ngAfterContentInit", "ngDoCheck",
  // Vue
  "mounted", "created", "beforeMount", "beforeDestroy", "beforeUnmount",
  "setup", "onMounted", "onUnmounted",
  // NestJS
  "onModuleInit", "onModuleDestroy", "onApplicationBootstrap", "onApplicationShutdown",
  // Generic
  "main", "init", "configure", "register", "bootstrap",
])

/**
 * Event handler naming patterns.
 */
const EVENT_HANDLER_PATTERN = /^(on[A-Z]|handle[A-Z]|.*Listener$|.*Handler$|.*Callback$|.*Observer$|.*Subscriber$)/

/**
 * Config/factory export naming patterns.
 */
const CONFIG_EXPORT_PATTERN = /^(config|configuration|Config$|.*Config$|.*Factory$|create[A-Z]|use[A-Z]|provide[A-Z]|register[A-Z])/

/**
 * Check if an entity is framework-invoked (L-17).
 * Returns true if the entity matches any framework pattern and should
 * be excluded from dead code detection.
 */
function isFrameworkInvoked(entity: EntityDoc): boolean {
  const name = entity.name

  // 1. Check decorators metadata (if the indexer captured them)
  const decorators = (entity as Record<string, unknown>).decorators as string[] | undefined
  if (decorators && decorators.some((d) => DECORATOR_PATTERNS.test(d))) {
    return true
  }

  // 2. Lifecycle hooks
  if (LIFECYCLE_HOOKS.has(name)) {
    return true
  }

  // 3. Event handler naming patterns
  if (EVENT_HANDLER_PATTERN.test(name)) {
    return true
  }

  // 4. Config/factory export patterns
  if (CONFIG_EXPORT_PATTERN.test(name)) {
    return true
  }

  return false
}

/**
 * Detect dead code entities: functions/classes with no inbound references
 * that are not exported, not in test files, and not entry points.
 *
 * L-17: Also excludes framework-invoked entities (decorator-registered endpoints,
 * lifecycle hooks, event handlers, config/factory exports).
 *
 * @returns Map of entity ID → dead code reason string
 */
export function detectDeadCode(
  entities: EntityDoc[],
  edges: EdgeDoc[]
): Map<string, string> {
  const deadCode = new Map<string, string>()

  // Build set of entities with inbound references (calls or references)
  const hasInbound = new Set<string>()
  for (const edge of edges) {
    if (edge.kind === "calls" || edge.kind === "references" || edge.kind === "imports") {
      const toId = edge._to.split("/").pop()!
      hasInbound.add(toId)
    }
  }

  for (const entity of entities) {
    // Skip file/module/namespace/directory entities
    if (entity.kind === "file" || entity.kind === "module" || entity.kind === "namespace" || entity.kind === "directory") {
      continue
    }

    // Skip test entities
    if (TEST_FILE_PATTERNS.some((p) => p.test(entity.file_path))) {
      continue
    }

    // Skip entry points
    if (ENTRY_POINT_PATTERNS.some((p) => p.test(entity.file_path))) {
      continue
    }

    // Skip exported entities (public API) — heuristic: top-level entities without a parent
    // are potentially exported. Entities with `exported` flag set are definitely exported.
    if ((entity as Record<string, unknown>).exported === true) {
      continue
    }

    // Skip types/interfaces/enums (they're used at compile time, not runtime calls)
    if (entity.kind === "type" || entity.kind === "interface" || entity.kind === "enum") {
      continue
    }

    // Skip constructors (called implicitly via `new`)
    if (entity.name === "constructor" || entity.name === "__init__") {
      continue
    }

    // L-17: Skip framework-invoked entities
    if (isFrameworkInvoked(entity)) {
      continue
    }

    // Entity with zero inbound references → dead code candidate
    if (!hasInbound.has(entity.id)) {
      const isExported = (entity as Record<string, unknown>).exported
      const reason = isExported === false
        ? "zero inbound references, private scope"
        : "zero inbound references, not exported"
      deadCode.set(entity.id, reason)
    }
  }

  return deadCode
}
