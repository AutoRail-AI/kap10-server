/**
 * Shared doc comment extraction utilities for all language parsers.
 *
 * Extracts JSDoc, Python docstrings, and Go doc comments from source lines.
 * Returns undefined if the extracted comment is too short (<10 chars) to filter noise.
 */

const MIN_DOC_LENGTH = 10

/**
 * Extract a JSDoc/TSDoc comment block preceding a TypeScript/JavaScript entity.
 * Scans backward from the entity's start line for:
 *   - Block comments: `/** ... *​/`
 *   - Consecutive single-line comments: `// ...`
 */
export function extractJSDocComment(lines: string[], entityLineIdx: number): string | undefined {
  if (entityLineIdx <= 0) return undefined

  // Scan backward from the line before the entity
  let i = entityLineIdx - 1

  // Skip blank lines between entity and comment
  while (i >= 0 && !lines[i]!.trim()) i--
  if (i < 0) return undefined

  const currentLine = lines[i]!.trim()

  // Case 1: Block comment ending with */
  if (currentLine.endsWith("*/")) {
    const endIdx = i
    // Scan backward to find the opening /**
    while (i >= 0) {
      const line = lines[i]!.trim()
      if (line.startsWith("/**") || line.startsWith("/*")) {
        return cleanBlockComment(lines.slice(i, endIdx + 1))
      }
      i--
    }
    return undefined
  }

  // Case 2: Consecutive // comment lines
  if (currentLine.startsWith("//")) {
    const endIdx = i
    while (i > 0 && lines[i - 1]!.trim().startsWith("//")) {
      i--
    }
    return cleanLineComments(lines.slice(i, endIdx + 1))
  }

  return undefined
}

/**
 * Extract a Python docstring immediately following a `def` or `class` line.
 * Looks for triple-quoted strings (`"""..."""` or `'''...'''`).
 */
export function extractPythonDocstring(lines: string[], defLineIdx: number): string | undefined {
  if (defLineIdx >= lines.length - 1) return undefined

  // The docstring should be on the next non-blank line after the def/class line
  let i = defLineIdx + 1
  while (i < lines.length && !lines[i]!.trim()) i++
  if (i >= lines.length) return undefined

  const firstLine = lines[i]!.trim()

  // Detect triple-quote delimiter
  let delimiter: string | undefined
  if (firstLine.startsWith('"""')) delimiter = '"""'
  else if (firstLine.startsWith("'''")) delimiter = "'''"
  else return undefined

  // Single-line docstring: """text"""
  if (firstLine.endsWith(delimiter) && firstLine.length > delimiter.length * 2) {
    const content = firstLine.slice(delimiter.length, -delimiter.length).trim()
    return content.length >= MIN_DOC_LENGTH ? content : undefined
  }
  // Also handle: """text""" where start/end are the same delimiter occurrence
  if (firstLine.indexOf(delimiter, delimiter.length) !== -1) {
    const endPos = firstLine.indexOf(delimiter, delimiter.length)
    const content = firstLine.slice(delimiter.length, endPos).trim()
    return content.length >= MIN_DOC_LENGTH ? content : undefined
  }

  // Multi-line docstring
  const docLines: string[] = [firstLine.slice(delimiter.length)]
  i++
  while (i < lines.length) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (trimmed.includes(delimiter)) {
      const endPos = trimmed.indexOf(delimiter)
      if (endPos > 0) docLines.push(trimmed.slice(0, endPos))
      break
    }
    docLines.push(trimmed)
    i++
  }

  const content = docLines
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .trim()

  return content.length >= MIN_DOC_LENGTH ? content : undefined
}

/**
 * Extract a Go doc comment preceding a function/type declaration.
 * Go convention: consecutive `//` lines immediately before the declaration.
 */
export function extractGoDocComment(lines: string[], entityLineIdx: number): string | undefined {
  if (entityLineIdx <= 0) return undefined

  let i = entityLineIdx - 1

  // Skip blank lines
  while (i >= 0 && !lines[i]!.trim()) i--
  if (i < 0) return undefined

  const currentLine = lines[i]!.trim()
  if (!currentLine.startsWith("//")) return undefined

  // Collect consecutive // lines
  const endIdx = i
  while (i > 0 && lines[i - 1]!.trim().startsWith("//")) {
    i--
  }

  return cleanLineComments(lines.slice(i, endIdx + 1))
}

/**
 * Dispatch to the correct doc extractor based on language.
 * Convenience for the SCIP post-pass where language is known at runtime.
 */
export function extractDocComment(
  lines: string[],
  entityLineIdx: number,
  language?: string
): string | undefined {
  if (language === "python") {
    return extractPythonDocstring(lines, entityLineIdx)
  }
  if (language === "go") {
    return extractGoDocComment(lines, entityLineIdx)
  }
  // Default: JSDoc/TSDoc/JavaDoc style (works for TS, JS, Java, and most C-family languages)
  return extractJSDocComment(lines, entityLineIdx)
}

// ── Internal helpers ──

function cleanBlockComment(commentLines: string[]): string | undefined {
  const cleaned = commentLines
    .map((l) => {
      let s = l.trim()
      if (s.startsWith("/**")) s = s.slice(3)
      else if (s.startsWith("/*")) s = s.slice(2)
      if (s.endsWith("*/")) s = s.slice(0, -2)
      if (s.startsWith("*")) s = s.slice(1)
      return s.trim()
    })
    .filter(Boolean)
    .join(" ")
    .trim()

  // Strip @tags (e.g., @param, @returns) — keep only the description
  const descOnly = cleaned.split(/\s@\w+/)[0]?.trim() ?? cleaned
  return descOnly.length >= MIN_DOC_LENGTH ? descOnly : undefined
}

function cleanLineComments(commentLines: string[]): string | undefined {
  const cleaned = commentLines
    .map((l) => l.trim().replace(/^\/\/\s?/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim()

  return cleaned.length >= MIN_DOC_LENGTH ? cleaned : undefined
}
