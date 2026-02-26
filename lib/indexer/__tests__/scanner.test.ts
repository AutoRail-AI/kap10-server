/**
 * Unit tests for workspace scanner.
 *
 * Tests file discovery, language detection, and extension mapping.
 * Note: scanWorkspace requires a real git repo, so we test detectLanguages
 * and getLanguageForExtension which are pure functions.
 */
import { afterEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { detectLanguages, getLanguageForExtension, scanWorkspace } from "../scanner"
import type { ScannedFile } from "../types"

describe("getLanguageForExtension", () => {
  it("maps TypeScript extensions", () => {
    expect(getLanguageForExtension(".ts")).toBe("typescript")
    expect(getLanguageForExtension(".tsx")).toBe("typescript")
  })

  it("maps JavaScript extensions", () => {
    expect(getLanguageForExtension(".js")).toBe("javascript")
    expect(getLanguageForExtension(".jsx")).toBe("javascript")
    expect(getLanguageForExtension(".mjs")).toBe("javascript")
    expect(getLanguageForExtension(".cjs")).toBe("javascript")
  })

  it("maps Python extensions", () => {
    expect(getLanguageForExtension(".py")).toBe("python")
    expect(getLanguageForExtension(".pyi")).toBe("python")
  })

  it("maps Go extension", () => {
    expect(getLanguageForExtension(".go")).toBe("go")
  })

  it("maps other language extensions", () => {
    expect(getLanguageForExtension(".rs")).toBe("rust")
    expect(getLanguageForExtension(".java")).toBe("java")
    expect(getLanguageForExtension(".rb")).toBe("ruby")
    expect(getLanguageForExtension(".cs")).toBe("csharp")
  })

  it("maps config file extensions", () => {
    expect(getLanguageForExtension(".json")).toBe("json")
    expect(getLanguageForExtension(".yaml")).toBe("yaml")
    expect(getLanguageForExtension(".yml")).toBe("yaml")
    expect(getLanguageForExtension(".toml")).toBe("toml")
  })

  it("returns undefined for unknown extensions", () => {
    expect(getLanguageForExtension(".xyz")).toBeUndefined()
    expect(getLanguageForExtension(".unknown")).toBeUndefined()
    expect(getLanguageForExtension("")).toBeUndefined()
  })
})

describe("detectLanguages", () => {
  it("detects languages from scanned files", () => {
    const files: ScannedFile[] = [
      { relativePath: "src/index.ts", absolutePath: "/abs/src/index.ts", extension: ".ts" },
      { relativePath: "src/App.tsx", absolutePath: "/abs/src/App.tsx", extension: ".tsx" },
      { relativePath: "src/utils.js", absolutePath: "/abs/src/utils.js", extension: ".js" },
      { relativePath: "main.py", absolutePath: "/abs/main.py", extension: ".py" },
      { relativePath: "main.go", absolutePath: "/abs/main.go", extension: ".go" },
    ]

    const langs = detectLanguages(files)

    expect(langs.length).toBeGreaterThanOrEqual(3)

    const tsLang = langs.find((l) => l.language === "typescript")
    expect(tsLang).toBeDefined()
    expect(tsLang!.fileCount).toBe(2)
    expect(tsLang!.extensions).toContain(".ts")
    expect(tsLang!.extensions).toContain(".tsx")

    const pyLang = langs.find((l) => l.language === "python")
    expect(pyLang).toBeDefined()
    expect(pyLang!.fileCount).toBe(1)

    const goLang = langs.find((l) => l.language === "go")
    expect(goLang).toBeDefined()
    expect(goLang!.fileCount).toBe(1)
  })

  it("sorts by file count descending", () => {
    const files: ScannedFile[] = [
      { relativePath: "a.py", absolutePath: "/a.py", extension: ".py" },
      { relativePath: "b.ts", absolutePath: "/b.ts", extension: ".ts" },
      { relativePath: "c.ts", absolutePath: "/c.ts", extension: ".ts" },
      { relativePath: "d.ts", absolutePath: "/d.ts", extension: ".ts" },
    ]

    const langs = detectLanguages(files)

    expect(langs[0]!.language).toBe("typescript")
    expect(langs[0]!.fileCount).toBe(3)
    expect(langs[1]!.language).toBe("python")
    expect(langs[1]!.fileCount).toBe(1)
  })

  it("returns empty for files with no recognized extensions", () => {
    const files: ScannedFile[] = [
      { relativePath: "README.txt", absolutePath: "/README.txt", extension: ".txt" },
      { relativePath: "data.bin", absolutePath: "/data.bin", extension: ".bin" },
    ]

    const langs = detectLanguages(files)
    expect(langs).toHaveLength(0)
  })

  it("returns empty for empty input", () => {
    const langs = detectLanguages([])
    expect(langs).toHaveLength(0)
  })
})

describe("scanWorkspace", () => {
  let tempDir: string

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it("returns empty array for non-existent directory", async () => {
    const result = await scanWorkspace("/nonexistent/path/abc123")
    expect(result).toEqual([])
  })

  it("scans a git-initialized directory", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "scanner-test-"))

    // Create a minimal git repo
    const { execSync } = require("node:child_process") as typeof import("node:child_process")
    execSync("git init", { cwd: tempDir, stdio: "pipe" })
    execSync("git config user.email test@test.com", { cwd: tempDir, stdio: "pipe" })
    execSync("git config user.name Test", { cwd: tempDir, stdio: "pipe" })

    // Create files
    mkdirSync(join(tempDir, "src"), { recursive: true })
    writeFileSync(join(tempDir, "src/index.ts"), "export const x = 1")
    writeFileSync(join(tempDir, "src/helper.py"), "def help(): pass")
    writeFileSync(join(tempDir, "README.md"), "# Readme")

    // Add to git so ls-files finds them
    execSync("git add .", { cwd: tempDir, stdio: "pipe" })

    const result = await scanWorkspace(tempDir)

    expect(result.length).toBe(3)
    const paths = result.map((f) => f.relativePath).sort()
    expect(paths).toEqual(["README.md", "src/helper.py", "src/index.ts"])
    expect(result.find((f) => f.extension === ".ts")).toBeDefined()
    expect(result.find((f) => f.extension === ".py")).toBeDefined()
  })

  it("excludes node_modules and .git directories", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "scanner-test-"))

    const { execSync } = require("node:child_process") as typeof import("node:child_process")
    execSync("git init", { cwd: tempDir, stdio: "pipe" })
    execSync("git config user.email test@test.com", { cwd: tempDir, stdio: "pipe" })
    execSync("git config user.name Test", { cwd: tempDir, stdio: "pipe" })

    mkdirSync(join(tempDir, "src"), { recursive: true })
    mkdirSync(join(tempDir, "node_modules/pkg"), { recursive: true })
    writeFileSync(join(tempDir, "src/app.ts"), "const x = 1")
    writeFileSync(join(tempDir, "node_modules/pkg/index.js"), "module.exports = {}")

    execSync("git add -f .", { cwd: tempDir, stdio: "pipe" })

    const result = await scanWorkspace(tempDir)

    // node_modules should be excluded by ALWAYS_IGNORE
    const nmFiles = result.filter((f) => f.relativePath.includes("node_modules"))
    expect(nmFiles).toHaveLength(0)

    // src/app.ts should be present
    expect(result.some((f) => f.relativePath === "src/app.ts")).toBe(true)
  })
})
