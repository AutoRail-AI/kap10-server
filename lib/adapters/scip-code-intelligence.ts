/**
 * Stub ICodeIntelligence (Phase 0). Phase 1+ will implement with SCIP.
 */

import type { ICodeIntelligence } from "@/lib/ports/code-intelligence"
import { NotImplementedError } from "./errors"

export class SCIPCodeIntelligence implements ICodeIntelligence {
  async indexWorkspace(): Promise<{ filesProcessed: number }> {
    throw new NotImplementedError("ICodeIntelligence.indexWorkspace not implemented in Phase 0")
  }

  async getDefinitions(): Promise<never[]> {
    throw new NotImplementedError("ICodeIntelligence.getDefinitions not implemented in Phase 0")
  }

  async getReferences(): Promise<never[]> {
    throw new NotImplementedError("ICodeIntelligence.getReferences not implemented in Phase 0")
  }
}
