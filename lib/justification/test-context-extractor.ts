/**
 * Phase 4: Test Context Extractor — finds test files for an entity
 * and extracts assertion descriptions to boost justification confidence.
 */

import type { EdgeDoc, EntityDoc } from "@/lib/ports/types"
import type { TestContext } from "./types"

const TEST_FILE_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /__tests__\//,
]

/**
 * Find test files that exercise a given entity by traversing
 * "calls" edges to find *.test.ts callers.
 */
export function findTestFiles(
  entityId: string,
  allEntities: EntityDoc[],
  edges: EdgeDoc[]
): string[] {
  const testFiles = new Set<string>()

  // Build a reverse lookup: entity ID → callers
  const callerIds = new Set<string>()
  for (const edge of edges) {
    if (edge.kind !== "calls" && edge.kind !== "imports" && edge.kind !== "references") continue
    const toId = edge._to.split("/").pop()
    if (toId === entityId) {
      const fromId = edge._from.split("/").pop()
      if (fromId) callerIds.add(fromId)
    }
  }

  // Check if any caller resides in a test file
  for (const entity of allEntities) {
    if (callerIds.has(entity.id) && isTestFile(entity.file_path)) {
      testFiles.add(entity.file_path)
    }
  }

  // Also check if the entity's own file has a corresponding test file
  const entity = allEntities.find((e) => e.id === entityId)
  if (entity) {
    const basePath = entity.file_path.replace(/\.[jt]sx?$/, "")
    for (const e of allEntities) {
      if (
        e.kind === "file" &&
        (e.file_path === `${basePath}.test.ts` ||
          e.file_path === `${basePath}.spec.ts` ||
          e.file_path === `${basePath}.test.tsx` ||
          e.file_path === `${basePath}.spec.tsx`)
      ) {
        testFiles.add(e.file_path)
      }
    }
  }

  return Array.from(testFiles)
}

/**
 * Extract test assertion descriptions (describe/it block names)
 * from test entities in the graph.
 */
export function extractTestAssertions(
  testFiles: string[],
  allEntities: EntityDoc[]
): string[] {
  const seen = new Set<string>()
  const assertions: string[] = []

  function addAssertion(text: string): void {
    const trimmed = text.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      assertions.push(trimmed)
    }
  }

  const testBlockRe = /(?:describe|it|test)\(\s*["'`]([^"'`]+)["'`]/g

  for (const filePath of testFiles) {
    const fileEntities = allEntities.filter((e) => e.file_path === filePath)
    for (const entity of fileEntities) {
      // Legacy: entity name prefix convention
      const name = entity.name ?? ""
      if (
        name.startsWith("describe:") ||
        name.startsWith("it:") ||
        name.startsWith("test:")
      ) {
        addAssertion(name)
      }

      // Parse describe/it/test blocks from entity body text
      const body = (entity.body as string) ?? ""
      if (body) {
        let match: RegExpExecArray | null
        while ((match = testBlockRe.exec(body)) !== null) {
          if (match[1]) addAssertion(match[1])
        }
      }

      // Also check signature for test descriptions
      const sig = (entity.signature as string) ?? ""
      if (sig) {
        let match: RegExpExecArray | null
        while ((match = testBlockRe.exec(sig)) !== null) {
          if (match[1]) addAssertion(match[1])
        }
      }
    }
  }

  return assertions.slice(0, 20)
}

/**
 * Build a complete test context for an entity.
 */
export function buildTestContext(
  entityId: string,
  allEntities: EntityDoc[],
  edges: EdgeDoc[]
): TestContext | undefined {
  const testFiles = findTestFiles(entityId, allEntities, edges)
  if (testFiles.length === 0) return undefined

  const assertions = extractTestAssertions(testFiles, allEntities)
  return { testFiles, assertions }
}

function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERNS.some((p) => p.test(filePath))
}
