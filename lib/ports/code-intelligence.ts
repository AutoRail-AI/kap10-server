export interface Definition {
  path: string
  line: number
  [key: string]: unknown
}

export interface Reference {
  path: string
  line: number
  [key: string]: unknown
}

export interface ICodeIntelligence {
  indexWorkspace(workspacePath: string): Promise<{ filesProcessed: number }>
  getDefinitions(filePath: string, line: number, column: number): Promise<Definition[]>
  getReferences(filePath: string, line: number, column: number): Promise<Reference[]>
}
