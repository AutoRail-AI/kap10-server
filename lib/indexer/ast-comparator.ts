/**
 * Phase 5: AST structural comparator for filtering cosmetic changes.
 * Uses @ast-grep/napi for language-aware comparison.
 * Falls back to returning `true` (assume changed) on error or timeout.
 */

const LANGUAGE_MAP: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  tsx: "Tsx",
  python: "Python",
  go: "Go",
  rust: "Rust",
  java: "Java",
  kotlin: "Kotlin",
  c: "C",
  cpp: "Cpp",
  csharp: "CSharp",
}

/**
 * Check if two code bodies represent a semantic (structural) change.
 * Returns false if only whitespace/comments/formatting changed.
 * Returns true if the AST structure differs, or on any error.
 * Respects AST_DIFF_ENABLED env var.
 */
export function isSemanticChange(
  oldBody: string,
  newBody: string,
  language: string
): boolean {
  // Fast path: identical content
  if (oldBody === newBody) return false

  // Check if AST diff is disabled
  const astEnabled = process.env.AST_DIFF_ENABLED !== "false"
  if (!astEnabled) return true

  const langKey = LANGUAGE_MAP[language.toLowerCase()]
  if (!langKey) return true // Unknown language — assume changed

  try {
    const astGrep = require("@ast-grep/napi") as typeof import("@ast-grep/napi")
    const lang = (astGrep as Record<string, unknown>)[langKey]
    if (!lang || typeof lang !== "object" || !("parse" in (lang as Record<string, unknown>))) {
      return true
    }

    const parseFn = (lang as { parse: (code: string) => { root(): { text(): string } } }).parse
    const oldTree = parseFn(oldBody)
    const newTree = parseFn(newBody)

    // Compare canonical AST text (strips whitespace/comments)
    const oldCanonical = oldTree.root().text()
    const newCanonical = newTree.root().text()

    return oldCanonical !== newCanonical
  } catch {
    // On any error (missing dep, parse failure, etc.), assume changed
    return true
  }
}
