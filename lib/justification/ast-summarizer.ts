/**
 * Semantic anchor extraction + structural token replacement.
 *
 * Replaces naive `body.slice(0, N)` truncation with a summarization
 * that preserves the "soul" of a function — decision points, external
 * calls, mutations, error throws — and compresses boilerplate into
 * structural tokens like `[SETUP: 5 variables]` or `[LOOP: for over items]`.
 */

export interface SemanticAnchor {
  category: "decision" | "external_call" | "mutation" | "error" | "return" | "assertion"
  line: string      // verbatim source line (trimmed)
  lineNumber: number
}

export interface SummarizedBody {
  text: string
  anchors: SemanticAnchor[]
  originalLength: number
  wasTruncated: boolean
}

// ── Anchor detection patterns ──────────────────────────────────────────────

const DECISION_RE = /\b(if\s*\(|else\s+if\s*\(|switch\s*\(|case\s+\S|.*\?\s+.*:)/
const EXTERNAL_CALL_RE = /\b(await\s+|this\.\w+\.\w+\(|fetch\(|axios\.|\.query\(|\.execute\(|\.send\(|\.emit\(|\.publish\(|\.dispatch\()/
const MUTATION_RE = /(\.\w+\s*=\s|this\.\w+\s*=|\bstate\[|\.set\(|\.push\(|\.delete\(|\.splice\(|\.pop\(|\.shift\(|\.unshift\()/
const ERROR_RE = /\b(throw\s+(new\s+)?\w|reject\(|Error\()/
const RETURN_RE = /^\s*return\s+/
const ASSERTION_RE = /\b(expect\(|assert[\.(]|\.should\.|\.toBe|\.toEqual|\.toThrow|\.toMatch|\.toContain)/

// ── Structural block patterns ──────────────────────────────────────────────

const LOOP_RE = /^\s*(for\s*\(|for\s+\w+\s+of|while\s*\(|\.forEach\(|\.map\(|\.filter\(|\.reduce\()/
const TRY_RE = /^\s*(try\s*\{|catch\s*\(|finally\s*\{)/
const IMPORT_RE = /^\s*(import\s|const\s+\w+\s*=\s*require\(|from\s+['"])/
const DECLARATION_RE = /^\s*(const\s|let\s|var\s)/
const LOG_RE = /\b(console\.(log|warn|error|info|debug)|logger\.(log|warn|error|info|debug)|log\.(log|warn|error|info|debug))\(/
const COMMENT_RE = /^\s*(\/\/|\/\*|\*)/
const BLANK_RE = /^\s*$/
const BRACE_RE = /^\s*[{})\]]+;?\s*$/

function classifyAnchor(line: string): SemanticAnchor["category"] | null {
  if (ASSERTION_RE.test(line)) return "assertion"
  if (ERROR_RE.test(line)) return "error"
  if (RETURN_RE.test(line) && line.trim() !== "return" && line.trim() !== "return;") return "return"
  if (MUTATION_RE.test(line)) return "mutation"
  if (EXTERNAL_CALL_RE.test(line)) return "external_call"
  if (DECISION_RE.test(line)) return "decision"
  return null
}

function isBoilerplate(line: string): boolean {
  return (
    BLANK_RE.test(line) ||
    BRACE_RE.test(line) ||
    COMMENT_RE.test(line) ||
    LOG_RE.test(line)
  )
}

interface TaggedLine {
  text: string
  lineNumber: number
  anchor: SemanticAnchor | null
  structural: "loop" | "try" | "import" | "declaration" | "log" | "boilerplate" | null
}

function tagLine(line: string, lineNumber: number): TaggedLine {
  const trimmed = line.trimEnd()
  const anchor = classifyAnchor(trimmed)
  if (anchor) {
    return { text: trimmed, lineNumber, anchor: { category: anchor, line: trimmed.trim(), lineNumber }, structural: null }
  }

  // Structural classification for non-anchor lines
  if (LOG_RE.test(trimmed)) return { text: trimmed, lineNumber, anchor: null, structural: "log" }
  if (IMPORT_RE.test(trimmed)) return { text: trimmed, lineNumber, anchor: null, structural: "import" }
  if (LOOP_RE.test(trimmed)) return { text: trimmed, lineNumber, anchor: null, structural: "loop" }
  if (TRY_RE.test(trimmed)) return { text: trimmed, lineNumber, anchor: null, structural: "try" }
  if (DECLARATION_RE.test(trimmed)) return { text: trimmed, lineNumber, anchor: null, structural: "declaration" }
  if (isBoilerplate(trimmed)) return { text: trimmed, lineNumber, anchor: null, structural: "boilerplate" }

  return { text: trimmed, lineNumber, anchor: null, structural: null }
}

interface StructuralBlock {
  kind: string
  count: number
  hint?: string
}

function summarizeBlock(lines: TaggedLine[]): string {
  if (lines.length === 0) return ""
  if (lines.length <= 2) {
    // Too small to compress — keep verbatim
    return lines.map((l) => l.text).join("\n")
  }

  // Count categories
  const counts: Record<string, number> = {}
  for (const l of lines) {
    const kind = l.structural ?? "code"
    counts[kind] = (counts[kind] ?? 0) + 1
  }

  const blocks: StructuralBlock[] = []

  if (counts["import"] && counts["import"] > 0) blocks.push({ kind: "IMPORTS", count: counts["import"] })
  if (counts["declaration"] && counts["declaration"] > 0) blocks.push({ kind: "SETUP", count: counts["declaration"] })
  if (counts["loop"] && counts["loop"] > 0) {
    // Try to extract loop target
    const loopLine = lines.find((l) => l.structural === "loop")
    const hint = loopLine ? extractLoopHint(loopLine.text) : undefined
    blocks.push({ kind: "LOOP", count: counts["loop"], hint })
  }
  if (counts["try"] && counts["try"] > 0) blocks.push({ kind: "TRY_CATCH", count: counts["try"] })
  if (counts["log"] && counts["log"] > 0) blocks.push({ kind: "LOG", count: counts["log"] })

  const otherCount = lines.length - Object.values(counts).reduce((a: number, b) => a + (b ?? 0), 0) + (counts["code"] ?? 0) + (counts["boilerplate"] ?? 0)

  if (blocks.length > 0) {
    const tokens = blocks.map((b) => {
      if (b.hint) return `[${b.kind}: ${b.hint}]`
      if (b.count > 1) return `[${b.kind}: ${b.count} lines]`
      return `[${b.kind}]`
    })
    if (otherCount > 2) tokens.push(`[... ${otherCount} lines ...]`)
    return tokens.join("\n")
  }

  return `[... ${lines.length} lines ...]`
}

function extractLoopHint(line: string): string | undefined {
  // "for (const item of items)" → "for over items"
  const ofMatch = line.match(/for\s*\(\s*(?:const|let|var)\s+\w+\s+of\s+(\w+)/)
  if (ofMatch) return `for over ${ofMatch[1]}`

  // "for (let i = 0; i < arr.length" → "for over arr"
  const cMatch = line.match(/for\s*\(.*<\s*(\w+)\.length/)
  if (cMatch) return `for over ${cMatch[1]}`

  // ".forEach(" or ".map(" etc
  const fnMatch = line.match(/(\w+)\.(forEach|map|filter|reduce)\(/)
  if (fnMatch) return `${fnMatch[2]} over ${fnMatch[1]}`

  return undefined
}

/**
 * Summarize a function body by extracting semantic anchors and replacing
 * boilerplate with structural tokens. Short bodies are returned verbatim.
 */
export function summarizeBody(body: string, maxChars = 3000): SummarizedBody {
  if (!body || body.length === 0) {
    return { text: "", anchors: [], originalLength: 0, wasTruncated: false }
  }

  const originalLength = body.length

  // Short bodies don't need summarization
  if (body.length <= maxChars) {
    const lines = body.split("\n")
    const anchors: SemanticAnchor[] = []
    for (let i = 0; i < lines.length; i++) {
      const cat = classifyAnchor(lines[i]!)
      if (cat) anchors.push({ category: cat, line: lines[i]!.trim(), lineNumber: i + 1 })
    }
    return { text: body, anchors, originalLength, wasTruncated: false }
  }

  // Tag each line
  const lines = body.split("\n")
  const tagged = lines.map((line, i) => tagLine(line, i + 1))

  // Collect anchors
  const anchors: SemanticAnchor[] = tagged
    .filter((t) => t.anchor !== null)
    .map((t) => t.anchor!)

  // Build output: group consecutive non-anchor lines into structural blocks
  const output: string[] = []
  let blockBuffer: TaggedLine[] = []

  function flushBlock() {
    if (blockBuffer.length > 0) {
      const summary = summarizeBlock(blockBuffer)
      if (summary) output.push(summary)
      blockBuffer = []
    }
  }

  for (const tagged_line of tagged) {
    if (tagged_line.anchor) {
      flushBlock()
      output.push(tagged_line.text)
    } else {
      blockBuffer.push(tagged_line)
    }
  }
  flushBlock()

  let text = output.join("\n")

  // Final length enforcement — if still over budget, keep all anchors
  // and reduce structural tokens to one-line summaries
  if (text.length > maxChars) {
    const anchorLines = tagged
      .filter((t) => t.anchor)
      .map((t) => t.text)
    const nonAnchorCount = tagged.length - anchorLines.length
    text = anchorLines.join("\n")
    if (nonAnchorCount > 0) {
      text += `\n[... ${nonAnchorCount} lines of supporting code ...]`
    }
  }

  // Absolute last resort
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + "\n// ... truncated"
  }

  return { text, anchors, originalLength, wasTruncated: true }
}
