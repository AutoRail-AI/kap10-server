/**
 * Generic fallback plugin.
 *
 * For files with no language-specific plugin, creates a file-level entity only.
 * Ensures every file in the repo gets representation in the knowledge graph.
 */
import { entityHash } from "../../entity-hash"
import type { ParsedEntity } from "../../types"

/**
 * Create a file entity for a file that has no language-specific plugin.
 */
export function createFileEntity(
  repoId: string,
  filePath: string,
): ParsedEntity {
  return {
    id: entityHash(repoId, filePath, "file", filePath),
    kind: "file",
    name: filePath.split("/").pop() ?? filePath,
    file_path: filePath,
  }
}
