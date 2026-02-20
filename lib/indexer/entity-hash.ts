/**
 * SHA-256 stable entity identity hashing.
 *
 * Produces deterministic _key values for ArangoDB documents so that
 * re-indexing the same repo yields the same entity IDs (enabling upsert).
 *
 * Hash inputs: repoId + filePath + kind + name + signature
 * Output: 16-char hex string (64 bits — collision-safe for per-repo entity sets)
 */
import { createHash } from "node:crypto"

/**
 * Generate a deterministic entity ID from its identity components.
 * Returns a 16-character hex string suitable for use as an ArangoDB _key.
 */
export function entityHash(
  repoId: string,
  filePath: string,
  kind: string,
  name: string,
  signature?: string,
): string {
  const input = [repoId, filePath, kind, name, signature ?? ""].join("\0")
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}

/**
 * Generate a deterministic edge key from its endpoints and kind.
 */
export function edgeHash(fromId: string, toId: string, kind: string): string {
  const input = [fromId, toId, kind].join("\0")
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}
