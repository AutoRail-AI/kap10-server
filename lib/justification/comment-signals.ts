/**
 * Extracts author-annotated comment signals from entity source code.
 *
 * Detects TODO, FIXME, HACK, DEPRECATED, NOTE, WARNING, and @deprecated
 * JSDoc annotations. These signals provide valuable context to the LLM
 * about the developer's intent and known issues.
 */

export interface CommentSignals {
  /** TODO/FIXME/HACK/NOTE/WARNING markers found in the code */
  markers: Array<{ kind: string; text: string }>
  /** Whether the entity is annotated as deprecated */
  isDeprecated: boolean
  /** @deprecated reason if available */
  deprecationReason?: string
}

const MARKER_PATTERN = /(?:\/\/|#|\/\*\*?)\s*(?:@?)?(TODO|FIXME|HACK|NOTE|WARNING|XXX)\b[:\s]*(.*)/gi
const DEPRECATED_JSDOC = /@deprecated\s*(.*)/i
const TS_DEPRECATED_DECORATOR = /@Deprecated\b/

/**
 * Extract comment signals from an entity's body text.
 * Returns structured markers and deprecation info.
 */
export function extractCommentSignals(body: string | undefined | null): CommentSignals | null {
  if (!body) return null

  const markers: Array<{ kind: string; text: string }> = []
  let isDeprecated = false
  let deprecationReason: string | undefined

  // Scan for TODO/FIXME/HACK/NOTE/WARNING markers
  let match: RegExpExecArray | null
  const markerRegex = new RegExp(MARKER_PATTERN.source, "gi")
  while ((match = markerRegex.exec(body)) !== null) {
    const kind = (match[1] ?? "").toUpperCase()
    const text = (match[2] ?? "").trim().slice(0, 120)
    if (text || kind) {
      markers.push({ kind, text })
    }
    if (markers.length >= 10) break // Cap at 10 markers
  }

  // Check for @deprecated JSDoc annotation
  const deprecatedMatch = DEPRECATED_JSDOC.exec(body)
  if (deprecatedMatch) {
    isDeprecated = true
    const reason = (deprecatedMatch[1] ?? "").trim()
    if (reason) deprecationReason = reason.slice(0, 200)
  }

  // Check for @Deprecated decorator
  if (TS_DEPRECATED_DECORATOR.test(body)) {
    isDeprecated = true
  }

  if (markers.length === 0 && !isDeprecated) return null

  return {
    markers,
    isDeprecated,
    ...(deprecationReason ? { deprecationReason } : {}),
  }
}

/**
 * Format comment signals as a prompt section for the LLM.
 */
export function formatCommentSignalsForPrompt(signals: CommentSignals): string {
  const lines: string[] = []

  if (signals.isDeprecated) {
    lines.push(`**DEPRECATED**${signals.deprecationReason ? `: ${signals.deprecationReason}` : ""}`)
  }

  if (signals.markers.length > 0) {
    for (const m of signals.markers) {
      lines.push(`- ${m.kind}: ${m.text}`)
    }
  }

  return lines.join("\n")
}
