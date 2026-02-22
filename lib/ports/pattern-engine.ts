import type { AstGrepResult } from "./types"

export interface PatternMatch {
  ruleId: string
  file: string
  line: number
  column?: number
  message?: string
  severity?: "info" | "warning" | "error"
  fix?: string
  matchedCode?: string
}

export interface IPatternEngine {
  scanPatterns(workspacePath: string, rulesPath: string): Promise<PatternMatch[]>
  matchRule(code: string, ruleYaml: string): Promise<PatternMatch[]>
  scanWithAstGrep(workspacePath: string, pattern: string, language: string): Promise<AstGrepResult[]>
  validateSemgrepYaml(yaml: string): Promise<{ valid: boolean; errors: string[] }>
}
