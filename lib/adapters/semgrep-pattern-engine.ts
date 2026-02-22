/**
 * SemgrepPatternEngine — IPatternEngine implementation using Semgrep CLI + @ast-grep/napi.
 * Phase 6: Real detection via subprocess execution (execa) and native AST scanning.
 */

import type { IPatternEngine, PatternMatch } from "@/lib/ports/pattern-engine"
import type { AstGrepResult } from "@/lib/ports/types"

export class SemgrepPatternEngine implements IPatternEngine {
  async scanPatterns(workspacePath: string, rulesPath: string): Promise<PatternMatch[]> {
    const { execa } = await import("execa")
    try {
      const result = await execa("semgrep", [
        "scan",
        "--config", rulesPath,
        "--json",
        "--no-git-ignore",
        "--max-target-bytes", "1000000",
        workspacePath,
      ], { timeout: 120_000, reject: false })

      if (!result.stdout) return []

      const parsed = JSON.parse(result.stdout) as {
        results?: Array<{
          check_id: string
          path: string
          start: { line: number; col: number }
          extra?: { message?: string; severity?: string; fix?: string; lines?: string }
        }>
      }

      return (parsed.results ?? []).map((r) => ({
        ruleId: r.check_id,
        file: r.path,
        line: r.start.line,
        column: r.start.col,
        message: r.extra?.message,
        severity: mapSeverity(r.extra?.severity),
        fix: r.extra?.fix,
        matchedCode: r.extra?.lines,
      }))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[SemgrepPatternEngine] scanPatterns failed: ${message}`)
      return []
    }
  }

  async matchRule(code: string, ruleYaml: string): Promise<PatternMatch[]> {
    const { execa } = await import("execa")
    const fs = require("node:fs") as typeof import("node:fs")
    const path = require("node:path") as typeof import("node:path")
    const os = require("node:os") as typeof import("node:os")

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "semgrep-"))
    const codePath = path.join(tmpDir, "target.ts")
    const rulePath = path.join(tmpDir, "rule.yaml")

    try {
      fs.writeFileSync(codePath, code)
      fs.writeFileSync(rulePath, ruleYaml)

      const result = await execa("semgrep", [
        "scan",
        "--config", rulePath,
        "--json",
        codePath,
      ], { timeout: 30_000, reject: false })

      if (!result.stdout) return []

      const parsed = JSON.parse(result.stdout) as {
        results?: Array<{
          check_id: string
          path: string
          start: { line: number; col: number }
          extra?: { message?: string; severity?: string; fix?: string }
        }>
      }

      return (parsed.results ?? []).map((r) => ({
        ruleId: r.check_id,
        file: r.path,
        line: r.start.line,
        column: r.start.col,
        message: r.extra?.message,
        severity: mapSeverity(r.extra?.severity),
        fix: r.extra?.fix,
      }))
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  async scanWithAstGrep(workspacePath: string, pattern: string, language: string): Promise<AstGrepResult[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const astGrep = require("@ast-grep/napi") as { Lang: Record<string, string>; parse: (lang: string, src: string) => { root: () => { findAll: (pattern: string) => Array<{ range: () => { start: { line: number; column: number }; end: { line: number; column: number } }; text: () => string }> } } }
      const fs = require("node:fs") as typeof import("node:fs")
      const path = require("node:path") as typeof import("node:path")

      const langMap: Record<string, string | undefined> = {
        typescript: astGrep.Lang.TypeScript,
        javascript: astGrep.Lang.JavaScript,
        python: astGrep.Lang.Python,
        go: astGrep.Lang.Go,
        rust: astGrep.Lang.Rust,
        java: astGrep.Lang.Java,
        tsx: astGrep.Lang.Tsx,
      }

      const astLang = langMap[language.toLowerCase()]
      if (!astLang) return []

      const results: AstGrepResult[] = []
      const extensions: Record<string, string[]> = {
        typescript: [".ts"],
        javascript: [".js"],
        python: [".py"],
        go: [".go"],
        rust: [".rs"],
        java: [".java"],
        tsx: [".tsx"],
      }

      const exts = extensions[language.toLowerCase()] ?? [`.${language}`]

      const walkDir = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue
            walkDir(fullPath)
          } else if (exts.some((ext: string) => entry.name.endsWith(ext))) {
            try {
              const source = fs.readFileSync(fullPath, "utf8")
              const tree = astGrep.parse(astLang, source)
              const root = tree.root()
              const matches = root.findAll(pattern)
              for (const match of matches) {
                const range = match.range()
                results.push({
                  file: path.relative(workspacePath, fullPath),
                  line: range.start.line + 1,
                  column: range.start.column,
                  endLine: range.end.line + 1,
                  endColumn: range.end.column,
                  matchedCode: match.text(),
                })
              }
            } catch {
              // skip unparseable files
            }
          }
        }
      }

      walkDir(workspacePath)
      return results
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[SemgrepPatternEngine] scanWithAstGrep failed: ${message}`)
      return []
    }
  }

  async validateSemgrepYaml(yamlContent: string): Promise<{ valid: boolean; errors: string[] }> {
    try {
      const yaml = require("yaml") as typeof import("yaml")
      const parsed = yaml.parse(yamlContent) as { rules?: unknown[] }
      const errors: string[] = []

      if (!parsed || typeof parsed !== "object") {
        return { valid: false, errors: ["Invalid YAML structure"] }
      }

      if (!parsed.rules || !Array.isArray(parsed.rules)) {
        return { valid: false, errors: ["Missing 'rules' array in YAML"] }
      }

      for (let i = 0; i < parsed.rules.length; i++) {
        const rule = parsed.rules[i] as Record<string, unknown> | undefined
        if (!rule || typeof rule !== "object") {
          errors.push(`Rule ${i}: not an object`)
          continue
        }
        if (!rule.id) errors.push(`Rule ${i}: missing 'id'`)
        if (!rule.patterns && !rule.pattern) errors.push(`Rule ${i}: missing 'pattern' or 'patterns'`)
        if (!rule.message) errors.push(`Rule ${i}: missing 'message'`)
      }

      return { valid: errors.length === 0, errors }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { valid: false, errors: [`YAML parse error: ${message}`] }
    }
  }
}

function mapSeverity(s?: string): "info" | "warning" | "error" | undefined {
  if (!s) return undefined
  const lower = s.toLowerCase()
  if (lower === "error") return "error"
  if (lower === "warning") return "warning"
  return "info"
}
