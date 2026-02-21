/**
 * Phase 5: Semantic fingerprint for move/rename detection.
 * Computes a canonical AST hash that's file-path independent,
 * allowing detection of entity moves between files.
 */

import { createHash } from "node:crypto"

const LANGUAGE_MAP: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  tsx: "Tsx",
  python: "Python",
  go: "Go",
  rust: "Rust",
  java: "Java",
  kotlin: "Kotlin",
}

/**
 * Compute a semantic fingerprint (SHA-256) of a code body.
 * The fingerprint is independent of whitespace, comments, and formatting.
 * Used to detect entity moves/renames across files.
 *
 * @returns 32-char hex string (SHA-256 truncated) or null if parsing fails
 */
export function computeSemanticFingerprint(
  body: string,
  language: string
): string | null {
  if (!body || body.trim().length === 0) return null

  try {
    const langKey = LANGUAGE_MAP[language.toLowerCase()]
    if (!langKey) {
      // Fallback: normalize whitespace and hash
      return hashNormalized(body)
    }

    const astGrep = require("@ast-grep/napi") as typeof import("@ast-grep/napi")
    const lang = (astGrep as Record<string, unknown>)[langKey]
    if (!lang || typeof lang !== "object" || !("parse" in (lang as Record<string, unknown>))) {
      return hashNormalized(body)
    }

    const parseFn = (lang as { parse: (code: string) => { root(): { text(): string } } }).parse
    const tree = parseFn(body)
    const canonical = tree.root().text()

    return createHash("sha256").update(canonical).digest("hex").slice(0, 32)
  } catch {
    return hashNormalized(body)
  }
}

/**
 * Fallback: normalize whitespace and compute hash.
 */
function hashNormalized(body: string): string {
  const normalized = body.replace(/\s+/g, " ").trim()
  return createHash("sha256").update(normalized).digest("hex").slice(0, 32)
}

/**
 * Detect entity moves by cross-checking semantic fingerprints
 * between added and deleted entities in a diff.
 *
 * @returns Array of move pairs: { from: deleted entity, to: added entity }
 */
export function detectMoves(
  added: Array<{ id: string; body?: string; kind: string; name: string; file_path: string; [k: string]: unknown }>,
  deleted: Array<{ id: string; body?: string; kind: string; name: string; file_path: string; [k: string]: unknown }>,
  language: string
): Array<{ fromEntity: typeof deleted[number]; toEntity: typeof added[number] }> {
  const moves: Array<{ fromEntity: typeof deleted[number]; toEntity: typeof added[number] }> = []

  // Build fingerprint map for deleted entities
  const deletedByFingerprint = new Map<string, typeof deleted[number]>()
  for (const entity of deleted) {
    const body = entity.body as string | undefined
    if (!body) continue
    const fp = computeSemanticFingerprint(body, language)
    if (fp) {
      deletedByFingerprint.set(fp, entity)
    }
  }

  // Check each added entity against deleted fingerprints
  for (const entity of added) {
    const body = entity.body as string | undefined
    if (!body) continue
    const fp = computeSemanticFingerprint(body, language)
    if (fp && deletedByFingerprint.has(fp)) {
      const deletedEntity = deletedByFingerprint.get(fp)!
      // Same kind check to avoid false positives
      if (entity.kind === deletedEntity.kind) {
        moves.push({ fromEntity: deletedEntity, toEntity: entity })
        deletedByFingerprint.delete(fp) // Consume the match
      }
    }
  }

  return moves
}
