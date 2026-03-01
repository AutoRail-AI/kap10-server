/**
 * L-06: Shared complexity estimation for all language parsers.
 *
 * Provides two metrics:
 * 1. **Cyclomatic complexity** — branch-point counting (if, for, while, case, etc.)
 *    Improved over per-parser originals: strips comments and string literals first.
 * 2. **Cognitive complexity** — Sonar-style metric that weights nested conditions higher.
 *    A 3-level nested `if` contributes 1+2+3=6, not 3.
 *
 * Both are language-aware via keyword configuration.
 */

// ── Language keyword configurations ──────────────────────────────────────────

interface LanguageKeywords {
  /** Branch-point keywords for cyclomatic complexity */
  branchKeywords: string[]
  /** Logical operators that add branching paths */
  logicalOps: string[]
  /** Nesting keywords for cognitive complexity (increments nesting depth) */
  nestingKeywords: string[]
  /** Non-nesting branch keywords (add 1 regardless of depth) */
  flatKeywords: string[]
  /** Comment patterns to strip */
  lineComment: string
  blockCommentStart: string
  blockCommentEnd: string
}

const LANG_CONFIG: Record<string, LanguageKeywords> = {
  typescript: {
    branchKeywords: ["if", "else\\s+if", "for", "while", "case", "catch"],
    logicalOps: ["&&", "\\|\\|", "\\?\\s*[^:?]"],
    nestingKeywords: ["if", "for", "while", "switch"],
    flatKeywords: ["else\\s+if", "else", "case", "catch"],
    lineComment: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
  },
  javascript: {
    branchKeywords: ["if", "else\\s+if", "for", "while", "case", "catch"],
    logicalOps: ["&&", "\\|\\|", "\\?\\s*[^:?]"],
    nestingKeywords: ["if", "for", "while", "switch"],
    flatKeywords: ["else\\s+if", "else", "case", "catch"],
    lineComment: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
  },
  python: {
    branchKeywords: ["if", "elif", "for", "while", "except"],
    logicalOps: ["\\band\\b", "\\bor\\b"],
    nestingKeywords: ["if", "for", "while", "try"],
    flatKeywords: ["elif", "else", "except"],
    lineComment: "#",
    blockCommentStart: '"""',
    blockCommentEnd: '"""',
  },
  go: {
    branchKeywords: ["if", "else\\s+if", "for", "case", "select"],
    logicalOps: ["&&", "\\|\\|"],
    nestingKeywords: ["if", "for", "switch", "select"],
    flatKeywords: ["else\\s+if", "else", "case"],
    lineComment: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
  },
  java: {
    branchKeywords: ["if", "else\\s+if", "for", "while", "do", "case", "catch", "switch"],
    logicalOps: ["&&", "\\|\\|", "\\?"],
    nestingKeywords: ["if", "for", "while", "do", "switch", "try"],
    flatKeywords: ["else\\s+if", "else", "case", "catch"],
    lineComment: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
  },
  csharp: {
    branchKeywords: ["if", "else\\s+if", "for", "foreach", "while", "do", "case", "catch", "switch"],
    logicalOps: ["&&", "\\|\\|", "\\?\\?", "\\?"],
    nestingKeywords: ["if", "for", "foreach", "while", "do", "switch", "try"],
    flatKeywords: ["else\\s+if", "else", "case", "catch"],
    lineComment: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
  },
  c: {
    branchKeywords: ["if", "else\\s+if", "for", "while", "do", "case", "switch"],
    logicalOps: ["&&", "\\|\\|", "\\?"],
    nestingKeywords: ["if", "for", "while", "do", "switch"],
    flatKeywords: ["else\\s+if", "else", "case"],
    lineComment: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
  },
  cpp: {
    branchKeywords: ["if", "else\\s+if", "for", "while", "do", "case", "catch", "switch"],
    logicalOps: ["&&", "\\|\\|", "\\?"],
    nestingKeywords: ["if", "for", "while", "do", "switch", "try"],
    flatKeywords: ["else\\s+if", "else", "case", "catch"],
    lineComment: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
  },
  ruby: {
    branchKeywords: ["if", "elsif", "unless", "for", "while", "until", "when", "rescue"],
    logicalOps: ["&&", "\\|\\|"],
    nestingKeywords: ["if", "unless", "for", "while", "until", "begin"],
    flatKeywords: ["elsif", "else", "when", "rescue"],
    lineComment: "#",
    blockCommentStart: "=begin",
    blockCommentEnd: "=end",
  },
  rust: {
    branchKeywords: ["if", "else\\s+if", "for", "while", "loop", "match"],
    logicalOps: ["&&", "\\|\\|", "\\?"],
    nestingKeywords: ["if", "for", "while", "loop", "match"],
    flatKeywords: ["else\\s+if", "else"],
    lineComment: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
  },
  php: {
    branchKeywords: ["if", "elseif", "for", "foreach", "while", "do", "case", "catch", "match"],
    logicalOps: ["&&", "\\|\\|", "\\?\\?", "\\?"],
    nestingKeywords: ["if", "for", "foreach", "while", "do", "switch", "try", "match"],
    flatKeywords: ["elseif", "else", "case", "catch"],
    lineComment: "//",
    blockCommentStart: "/*",
    blockCommentEnd: "*/",
  },
}

// Fallback for unknown languages — uses C-like syntax
const DEFAULT_CONFIG: LanguageKeywords = LANG_CONFIG.typescript!

/**
 * Strip single-line and block comments from code body.
 * Also strips string literals to avoid false keyword matches inside strings.
 */
export function stripCommentsAndStrings(body: string, language: string): string {
  const config = LANG_CONFIG[language] ?? DEFAULT_CONFIG
  const lines = body.split("\n")
  const result: string[] = []
  let inBlockComment = false

  for (const line of lines) {
    let cleaned = line

    // Handle block comments
    if (inBlockComment) {
      const endIdx = cleaned.indexOf(config.blockCommentEnd)
      if (endIdx === -1) continue // entire line is in block comment
      cleaned = cleaned.slice(endIdx + config.blockCommentEnd.length)
      inBlockComment = false
    }

    // Remove block comments that start and end on same line
    if (config.blockCommentStart === "/*") {
      cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, " ")
    }

    // Check for block comment start (without end on same line)
    const blockStartIdx = cleaned.indexOf(config.blockCommentStart)
    if (blockStartIdx !== -1 && config.blockCommentStart === "/*") {
      cleaned = cleaned.slice(0, blockStartIdx)
      inBlockComment = true
    }

    // Remove line comments
    const lineCommentIdx = cleaned.indexOf(config.lineComment)
    if (lineCommentIdx !== -1) {
      // Make sure it's not inside a string (rough check — skip if preceded by quote)
      const beforeComment = cleaned.slice(0, lineCommentIdx)
      const singleQuotes = (beforeComment.match(/'/g) ?? []).length
      const doubleQuotes = (beforeComment.match(/"/g) ?? []).length
      if (singleQuotes % 2 === 0 && doubleQuotes % 2 === 0) {
        cleaned = cleaned.slice(0, lineCommentIdx)
      }
    }

    // Strip string literals (replace with spaces to preserve positions)
    cleaned = cleaned.replace(/"(?:[^"\\]|\\.)*"/g, " ")
    cleaned = cleaned.replace(/'(?:[^'\\]|\\.)*'/g, " ")
    cleaned = cleaned.replace(/`(?:[^`\\]|\\.)*`/g, " ")

    result.push(cleaned)
  }

  return result.join("\n")
}

/**
 * L-06: Improved cyclomatic complexity estimation.
 *
 * Strips comments and strings before counting branch keywords.
 * Language-aware keyword sets.
 *
 * @param body - The function/method source code body
 * @param language - Language identifier (e.g., "typescript", "python", "go")
 * @returns Cyclomatic complexity (baseline = 1)
 */
export function estimateCyclomaticComplexity(body: string, language = "typescript"): number {
  const config = LANG_CONFIG[language] ?? DEFAULT_CONFIG
  const cleaned = stripCommentsAndStrings(body, language)

  let complexity = 1

  // Count branch keywords
  const keywordPattern = config.branchKeywords.map((k) => `\\b${k}\\b`).join("|")
  const opPattern = config.logicalOps.join("|")
  const fullPattern = new RegExp(`${keywordPattern}|${opPattern}`, "g")

  let match: RegExpExecArray | null
  while ((match = fullPattern.exec(cleaned)) !== null) {
    complexity++
  }

  return complexity
}

/**
 * L-06: Cognitive complexity estimation (Sonar-style).
 *
 * Unlike cyclomatic complexity, cognitive complexity weights nested conditions higher.
 * Each nesting keyword (if, for, while, etc.) increments nesting depth.
 * Within a nesting block, each branch/condition adds (1 + nesting_depth) to the score.
 *
 * This means:
 * - `if (a) { ... }` → +1 (at depth 0)
 * - `if (a) { if (b) { ... } }` → +1 (outer if) + 2 (inner if at depth 1) = 3
 * - `if (a) { for (...) { if (c) { ... } } }` → +1 + 2 + 3 = 6
 *
 * @param body - The function/method source code body
 * @param language - Language identifier
 * @returns Cognitive complexity score (0 = trivial)
 */
export function estimateCognitiveComplexity(body: string, language = "typescript"): number {
  const config = LANG_CONFIG[language] ?? DEFAULT_CONFIG
  const cleaned = stripCommentsAndStrings(body, language)
  const lines = cleaned.split("\n")

  let cognitive = 0
  let nestingDepth = 0

  // Build regex patterns
  const nestingPattern = new RegExp(
    config.nestingKeywords.map((k) => `\\b${k}\\b`).join("|"),
  )
  const flatPattern = new RegExp(
    config.flatKeywords.map((k) => `\\b${k}\\b`).join("|"),
  )
  const logicalPattern = new RegExp(
    config.logicalOps.join("|"),
    "g",
  )

  // Track brace depth to detect nesting changes
  let braceDepth = 0
  // Map brace depth → nesting keyword depth at that brace level
  const nestingAtBrace = new Map<number, number>()

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Check for nesting keywords (add 1 + nestingDepth, then increase nesting)
    if (nestingPattern.test(trimmed) && !flatPattern.test(trimmed)) {
      cognitive += 1 + nestingDepth
      nestingDepth++
      // Track that at the next brace depth, this nesting was pushed
      const openBraces = (trimmed.match(/\{/g) ?? []).length
      if (openBraces > 0) {
        nestingAtBrace.set(braceDepth + openBraces, nestingDepth)
      }
    } else if (flatPattern.test(trimmed)) {
      // Flat keywords (else, case, catch) — add 1, no nesting change
      cognitive += 1
    }

    // Count logical operators on this line
    const logicalMatches = trimmed.match(logicalPattern)
    if (logicalMatches) {
      cognitive += logicalMatches.length
    }

    // Track brace depth for nesting
    for (const ch of trimmed) {
      if (ch === "{") braceDepth++
      if (ch === "}") {
        if (nestingAtBrace.has(braceDepth)) {
          nestingDepth = Math.max(0, nestingDepth - 1)
          nestingAtBrace.delete(braceDepth)
        }
        braceDepth--
      }
    }
  }

  return cognitive
}

/**
 * L-06: Compute both complexity metrics for a code body.
 * Convenience function used by all language parsers.
 */
export function computeComplexity(
  body: string,
  language = "typescript",
): { cyclomatic: number; cognitive: number } {
  return {
    cyclomatic: estimateCyclomaticComplexity(body, language),
    cognitive: estimateCognitiveComplexity(body, language),
  }
}
