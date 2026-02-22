import { describe, it, expect, vi, beforeEach } from "vitest"
import { runTestCheck } from "../test-check"
import type { ReviewConfig } from "@/lib/ports/types"
import { DEFAULT_REVIEW_CONFIG } from "@/lib/ports/types"
import type { DiffFile } from "../../diff-analyzer"

// Mock node:fs so tests don't touch the real filesystem
vi.mock("node:fs", () => ({
  default: {
    accessSync: vi.fn(),
  },
  accessSync: vi.fn(),
}))

function makeConfig(overrides: Partial<ReviewConfig> = {}): ReviewConfig {
  return { ...DEFAULT_REVIEW_CONFIG, ...overrides }
}

function makeDiffFile(filePath: string): DiffFile {
  return {
    filePath,
    additions: 10,
    deletions: 2,
    hunks: [],
  }
}

describe("runTestCheck", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("returns empty array when test check is disabled", async () => {
    const config = makeConfig({ checksEnabled: { ...DEFAULT_REVIEW_CONFIG.checksEnabled, test: false } })
    const findings = await runTestCheck(
      [makeDiffFile("lib/service.ts")],
      "/workspace",
      config
    )
    expect(findings).toHaveLength(0)
  })

  it("returns empty array when no diff files are provided", async () => {
    const config = makeConfig()
    const findings = await runTestCheck([], "/workspace", config)
    expect(findings).toHaveLength(0)
  })

  it("generates a finding for a lib/ file missing companion test", async () => {
    const { accessSync } = await import("node:fs")
    // accessSync always throws → no test files found
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("ENOENT")
    })

    const config = makeConfig()
    const findings = await runTestCheck(
      [makeDiffFile("lib/utils/helpers.ts")],
      "/workspace",
      config
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]!.filePath).toBe("lib/utils/helpers.ts")
    expect(findings[0]!.expectedTestPath).toContain("__tests__")
    expect(findings[0]!.expectedTestPath).toContain("helpers.test.ts")
    expect(findings[0]!.message).toContain("lib/utils/helpers.ts")
  })

  it("generates a finding for a src/ file missing companion test", async () => {
    const { accessSync } = await import("node:fs")
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("ENOENT")
    })

    const config = makeConfig()
    const findings = await runTestCheck(
      [makeDiffFile("src/core/processor.ts")],
      "/workspace",
      config
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]!.filePath).toBe("src/core/processor.ts")
    expect(findings[0]!.expectedTestPath).toContain("processor.test.ts")
  })

  it("does not generate a finding when companion test file exists", async () => {
    const { accessSync } = await import("node:fs")
    // accessSync succeeds → test file exists
    vi.mocked(accessSync).mockImplementation(() => undefined)

    const config = makeConfig()
    const findings = await runTestCheck(
      [makeDiffFile("lib/auth/verify.ts")],
      "/workspace",
      config
    )

    expect(findings).toHaveLength(0)
  })

  it("skips test files themselves (files ending in .test.ts)", async () => {
    const { accessSync } = await import("node:fs")
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("ENOENT")
    })

    const config = makeConfig()
    const findings = await runTestCheck(
      [makeDiffFile("lib/auth/__tests__/verify.test.ts")],
      "/workspace",
      config
    )

    expect(findings).toHaveLength(0)
  })

  it("skips .spec.ts files", async () => {
    const { accessSync } = await import("node:fs")
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("ENOENT")
    })

    const config = makeConfig()
    const findings = await runTestCheck(
      [makeDiffFile("lib/auth/__tests__/verify.spec.ts")],
      "/workspace",
      config
    )

    expect(findings).toHaveLength(0)
  })

  it("skips files outside lib/ or src/ directories", async () => {
    const { accessSync } = await import("node:fs")
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("ENOENT")
    })

    const config = makeConfig()
    const findings = await runTestCheck(
      [
        makeDiffFile("app/page.tsx"),
        makeDiffFile("scripts/build.ts"),
        makeDiffFile("docs/README.md"),
      ],
      "/workspace",
      config
    )

    expect(findings).toHaveLength(0)
  })

  it("skips non-TypeScript/JavaScript files inside lib/", async () => {
    const { accessSync } = await import("node:fs")
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("ENOENT")
    })

    const config = makeConfig()
    const findings = await runTestCheck(
      [makeDiffFile("lib/config/settings.yaml")],
      "/workspace",
      config
    )

    expect(findings).toHaveLength(0)
  })

  it("skips files matching ignorePaths", async () => {
    const { accessSync } = await import("node:fs")
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("ENOENT")
    })

    const config = makeConfig({ ignorePaths: ["lib/generated/"] })
    const findings = await runTestCheck(
      [makeDiffFile("lib/generated/schema.ts")],
      "/workspace",
      config
    )

    expect(findings).toHaveLength(0)
  })

  it("handles .tsx files in lib/ and expects .test.tsx companion", async () => {
    const { accessSync } = await import("node:fs")
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("ENOENT")
    })

    const config = makeConfig()
    const findings = await runTestCheck(
      [makeDiffFile("lib/components/Button.tsx")],
      "/workspace",
      config
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]!.expectedTestPath).toContain("Button.test.tsx")
  })

  it("reports finding only for files missing tests, not for files that have them", async () => {
    const { accessSync } = await import("node:fs")
    // Simulate: verify.ts has a test, processor.ts does not
    vi.mocked(accessSync).mockImplementation((path: unknown) => {
      const p = path as string
      if (p.includes("verify")) return undefined
      throw new Error("ENOENT")
    })

    const config = makeConfig()
    const findings = await runTestCheck(
      [
        makeDiffFile("lib/auth/verify.ts"),
        makeDiffFile("lib/core/processor.ts"),
      ],
      "/workspace",
      config
    )

    expect(findings).toHaveLength(1)
    expect(findings[0]!.filePath).toBe("lib/core/processor.ts")
  })
})
