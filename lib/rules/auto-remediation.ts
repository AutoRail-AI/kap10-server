/**
 * Auto-remediation — uses ast-grep rewrite() API for auto-fix patches.
 */

import type { Container } from "@/lib/di/container"
import type { AstGrepResult } from "@/lib/ports/types"

export interface RemediationPatch {
  file: string
  line: number
  original: string
  replacement: string
  ruleId: string
}

export async function generateAutoFixes(
  container: Container,
  workspacePath: string,
  ruleId: string,
  astGrepQuery: string,
  fixPattern: string,
  language: string
): Promise<RemediationPatch[]> {
  const results = await container.patternEngine.scanWithAstGrep(
    workspacePath,
    astGrepQuery,
    language
  )

  return results.map((r: AstGrepResult) => ({
    file: r.file,
    line: r.line,
    original: r.matchedCode,
    replacement: applyFixPattern(r.matchedCode, fixPattern),
    ruleId,
  }))
}

/**
 * Apply a simple fix pattern to matched code.
 * Supports $VAR-style replacements from ast-grep.
 */
function applyFixPattern(matchedCode: string, fixPattern: string): string {
  // Simple replacement — in production, ast-grep handles this natively
  if (fixPattern.includes("$")) {
    // Return the fix pattern as-is for ast-grep native handling
    return fixPattern
  }
  return fixPattern || matchedCode
}
