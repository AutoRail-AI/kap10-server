/**
 * Stub IPatternEngine (Phase 0). Phase 6+ will implement with Semgrep/ast-grep.
 */

import type { IPatternEngine, PatternMatch } from "@/lib/ports/pattern-engine"
import { NotImplementedError } from "./errors"

export class SemgrepPatternEngine implements IPatternEngine {
  async scanPatterns(): Promise<PatternMatch[]> {
    throw new NotImplementedError("IPatternEngine.scanPatterns not implemented in Phase 0")
  }

  async matchRule(): Promise<PatternMatch[]> {
    throw new NotImplementedError("IPatternEngine.matchRule not implemented in Phase 0")
  }
}
