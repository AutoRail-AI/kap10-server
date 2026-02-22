/**
 * Test check — detects changed lib/ files missing companion test files.
 */

import type { ReviewConfig, TestFinding } from "@/lib/ports/types"
import type { DiffFile } from "../diff-analyzer"

const TEST_PATH_PATTERNS = ["lib/", "src/"]
const TEST_EXTENSIONS = [".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx"]

export async function runTestCheck(
  diffFiles: DiffFile[],
  workspacePath: string,
  config: ReviewConfig
): Promise<TestFinding[]> {
  if (!config.checksEnabled.test) return []

  const findings: TestFinding[] = []
  const fs = await import("node:fs")
  const path = await import("node:path")

  for (const file of diffFiles) {
    // Only check files under lib/ or src/
    const matchesTestPath = TEST_PATH_PATTERNS.some((p) => file.filePath.startsWith(p))
    if (!matchesTestPath) continue

    // Skip test files themselves
    if (TEST_EXTENSIONS.some((ext) => file.filePath.endsWith(ext))) continue

    // Skip non-TypeScript/JavaScript files
    if (!/\.(ts|tsx|js|jsx)$/.test(file.filePath)) continue

    // Skip ignored paths
    if (config.ignorePaths.some((p) => file.filePath.startsWith(p))) continue

    // Build expected test paths
    const dir = path.dirname(file.filePath)
    const ext = path.extname(file.filePath)
    const basename = path.basename(file.filePath, ext)

    const expectedPaths = TEST_EXTENSIONS.map((testExt) =>
      path.join(dir, "__tests__", `${basename}${testExt}`)
    )

    // Check if any test companion exists
    const hasTest = expectedPaths.some((testPath) => {
      try {
        fs.accessSync(path.join(workspacePath, testPath))
        return true
      } catch {
        return false
      }
    })

    if (!hasTest) {
      findings.push({
        filePath: file.filePath,
        expectedTestPath: path.join(dir, "__tests__", `${basename}.test${ext}`),
        message: `No test companion found for \`${file.filePath}\`. Expected at \`${path.join(dir, "__tests__", `${basename}.test${ext}`)}\`.`,
      })
    }
  }

  return findings
}
