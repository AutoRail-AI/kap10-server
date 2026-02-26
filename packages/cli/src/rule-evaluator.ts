/**
 * Phase 10b: Local rule evaluator — tree-sitter structural + naming evaluation.
 *
 * Evaluates rules locally without cloud round-trips.
 * - Structural rules: Uses tree-sitter to parse AST and match node types
 * - Naming rules: Uses regex against entity names from CozoDB
 * - Semgrep/LLM rules: Skipped (require cloud)
 */

import type { CompactRule , CozoGraphStore } from "./local-graph.js"

export interface RuleViolation {
  ruleKey: string
  ruleName: string
  severity: string
  message: string
  filePath: string
  line?: number
  matchedCode?: string
}

export interface EvaluationResult {
  violations: RuleViolation[]
  _meta: {
    source: "local"
    evaluatedRules: number
    skippedRules: number
    engines: { structural: number; naming: number; skipped: number }
  }
}

type TreeSitterParser = {
  parse(input: string): { rootNode: TreeSitterNode }
}

type TreeSitterNode = {
  type: string
  text: string
  startPosition: { row: number; column: number }
  endPosition: { row: number; column: number }
  children: TreeSitterNode[]
  namedChildren: TreeSitterNode[]
}

// Lazy-loaded tree-sitter instance
let parserCache: Map<string, TreeSitterParser> | null = null

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "typescript",
  ".jsx": "typescript",
  ".py": "python",
  ".go": "go",
}

/**
 * Detect language from file extension.
 */
function detectLanguage(filePath: string): string | null {
  const ext = filePath.slice(filePath.lastIndexOf("."))
  return LANGUAGE_MAP[ext] ?? null
}

/**
 * Lazy-load tree-sitter parser for a language.
 * Returns null if the language is not supported or tree-sitter is not available.
 */
async function getParser(language: string): Promise<TreeSitterParser | null> {
  if (!parserCache) {
    parserCache = new Map()
  }

  if (parserCache.has(language)) {
    return parserCache.get(language)!
  }

  try {
    const TreeSitter = (await import("web-tree-sitter")).default
    await TreeSitter.init()
    const parser = new TreeSitter()

    // Try to load language grammar from node_modules
    const langFile = `tree-sitter-${language}.wasm`
    try {
      const { join } = await import("node:path")
      const { existsSync } = await import("node:fs")

      // Check multiple possible locations for WASM files
      const possiblePaths = [
        join(process.cwd(), "node_modules", `tree-sitter-${language}`, langFile),
        join(process.cwd(), "node_modules", "web-tree-sitter", langFile),
      ]

      let wasmPath: string | null = null
      for (const p of possiblePaths) {
        if (existsSync(p)) {
          wasmPath = p
          break
        }
      }

      if (!wasmPath) {
        // Grammar WASM not found — degrade gracefully
        return null
      }

      const lang = await TreeSitter.Language.load(wasmPath)
      parser.setLanguage(lang)
      parserCache.set(language, parser as unknown as TreeSitterParser)
      return parser as unknown as TreeSitterParser
    } catch {
      return null
    }
  } catch {
    // web-tree-sitter not available
    return null
  }
}

/**
 * Walk tree-sitter AST and collect nodes matching target types.
 */
function collectNodesByType(node: TreeSitterNode, targetTypes: string[]): TreeSitterNode[] {
  const results: TreeSitterNode[] = []

  function walk(n: TreeSitterNode): void {
    if (targetTypes.includes(n.type)) {
      results.push(n)
    }
    for (const child of n.children) {
      walk(child)
    }
  }

  walk(node)
  return results
}

/**
 * Evaluate a structural rule using tree-sitter AST matching.
 */
async function evaluateStructural(
  rule: CompactRule,
  filePath: string,
  content: string
): Promise<RuleViolation[]> {
  const language = detectLanguage(filePath)
  if (!language) return []

  const parser = await getParser(language)
  if (!parser) return []

  const tree = parser.parse(content)

  // Parse rule.query as comma-separated node types to match
  const targetTypes = rule.query.split(",").map((t) => t.trim()).filter(Boolean)
  if (targetTypes.length === 0) return []

  const matches = collectNodesByType(tree.rootNode, targetTypes)

  return matches.map((node) => ({
    ruleKey: rule.key,
    ruleName: rule.name,
    severity: rule.severity,
    message: rule.message || `Structural rule "${rule.name}" matched node type "${node.type}"`,
    filePath,
    line: node.startPosition.row + 1,
    matchedCode: node.text.slice(0, 200),
  }))
}

/**
 * Evaluate a naming rule using regex against entity names in the file.
 */
function evaluateNaming(
  rule: CompactRule,
  filePath: string,
  localGraph: CozoGraphStore
): RuleViolation[] {
  const entities = localGraph.getEntitiesByFile(filePath)
  if (entities.length === 0) return []

  let regex: RegExp
  try {
    regex = new RegExp(rule.query)
  } catch {
    return []
  }

  const violations: RuleViolation[] = []

  for (const entity of entities) {
    if (regex.test(entity.name)) {
      violations.push({
        ruleKey: rule.key,
        ruleName: rule.name,
        severity: rule.severity,
        message: rule.message || `Naming rule "${rule.name}" matched entity "${entity.name}"`,
        filePath,
        line: entity.start_line,
        matchedCode: entity.name,
      })
    }
  }

  return violations
}

/**
 * Evaluate all applicable rules against a file.
 *
 * Partitions rules by engine:
 * - structural: tree-sitter AST matching
 * - naming: regex match against entity names
 * - semgrep/llm: skipped (require cloud)
 */
export async function evaluateRules(
  rules: CompactRule[],
  filePath: string,
  content: string,
  localGraph: CozoGraphStore
): Promise<EvaluationResult> {
  const violations: RuleViolation[] = []
  let structuralCount = 0
  let namingCount = 0
  let skippedCount = 0

  for (const rule of rules) {
    if (!rule.enabled) {
      skippedCount++
      continue
    }

    switch (rule.engine) {
      case "structural": {
        structuralCount++
        const structViolations = await evaluateStructural(rule, filePath, content)
        violations.push(...structViolations)
        break
      }
      case "naming": {
        namingCount++
        const nameViolations = evaluateNaming(rule, filePath, localGraph)
        violations.push(...nameViolations)
        break
      }
      default:
        // semgrep, llm, etc. — skip for local evaluation
        skippedCount++
        break
    }
  }

  return {
    violations,
    _meta: {
      source: "local",
      evaluatedRules: structuralCount + namingCount,
      skippedRules: skippedCount,
      engines: {
        structural: structuralCount,
        naming: namingCount,
        skipped: skippedCount,
      },
    },
  }
}
