export interface PatternMatch {
  ruleId: string
  file: string
  line: number
  [key: string]: unknown
}

export interface IPatternEngine {
  scanPatterns(workspacePath: string, rulesPath: string): Promise<PatternMatch[]>
  matchRule(code: string, ruleYaml: string): Promise<PatternMatch[]>
}
