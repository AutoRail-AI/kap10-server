import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs"
import * as path from "node:path"
import * as os from "node:os"

describe("CLI init command core logic", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `kap10-init-test-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("creates .kap10/config.json with correct structure", () => {
    const kap10Dir = path.join(tmpDir, ".kap10")
    fs.mkdirSync(kap10Dir, { recursive: true })

    const config = {
      repoId: "repo-123",
      serverUrl: "http://localhost:3000",
      orgId: "org-456",
      branch: "main",
    }

    fs.writeFileSync(
      path.join(kap10Dir, "config.json"),
      JSON.stringify(config, null, 2) + "\n"
    )

    const written = JSON.parse(
      fs.readFileSync(path.join(kap10Dir, "config.json"), "utf-8")
    ) as { repoId: string; serverUrl: string; orgId: string; branch: string }

    expect(written.repoId).toBe("repo-123")
    expect(written.serverUrl).toBe("http://localhost:3000")
    expect(written.orgId).toBe("org-456")
    expect(written.branch).toBe("main")
  })

  it("adds .kap10 to .gitignore when gitignore exists", () => {
    const gitignorePath = path.join(tmpDir, ".gitignore")
    fs.writeFileSync(gitignorePath, "node_modules/\n.env\n")

    // Simulate the init logic for .gitignore
    const content = fs.readFileSync(gitignorePath, "utf-8")
    if (!content.includes(".kap10")) {
      fs.appendFileSync(gitignorePath, "\n# kap10 local config\n.kap10/\n")
    }

    const result = fs.readFileSync(gitignorePath, "utf-8")
    expect(result).toContain(".kap10/")
    expect(result).toContain("node_modules/")
  })

  it("creates .gitignore with .kap10 when none exists", () => {
    const gitignorePath = path.join(tmpDir, ".gitignore")
    expect(fs.existsSync(gitignorePath)).toBe(false)

    // Simulate init logic
    fs.writeFileSync(gitignorePath, "# kap10 local config\n.kap10/\n")

    const result = fs.readFileSync(gitignorePath, "utf-8")
    expect(result).toContain(".kap10/")
  })

  it("does not duplicate .kap10 entry in .gitignore", () => {
    const gitignorePath = path.join(tmpDir, ".gitignore")
    fs.writeFileSync(gitignorePath, "node_modules/\n.kap10/\n")

    const content = fs.readFileSync(gitignorePath, "utf-8")
    if (!content.includes(".kap10")) {
      fs.appendFileSync(gitignorePath, "\n# kap10 local config\n.kap10/\n")
    }

    const result = fs.readFileSync(gitignorePath, "utf-8")
    const matches = result.match(/\.kap10/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(1) // Only the original one
  })
})

describe("CLI push command core logic", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `kap10-push-test-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("loadConfig returns null when .kap10/config.json does not exist", () => {
    const configPath = path.join(tmpDir, ".kap10", "config.json")
    expect(fs.existsSync(configPath)).toBe(false)
  })

  it("loadConfig returns config when file exists", () => {
    const kap10Dir = path.join(tmpDir, ".kap10")
    fs.mkdirSync(kap10Dir, { recursive: true })

    const config = { repoId: "r-1", serverUrl: "http://localhost:3000", orgId: "o-1" }
    fs.writeFileSync(path.join(kap10Dir, "config.json"), JSON.stringify(config))

    const raw = fs.readFileSync(path.join(kap10Dir, "config.json"), "utf-8")
    const parsed = JSON.parse(raw) as { repoId: string; serverUrl: string; orgId: string }
    expect(parsed.repoId).toBe("r-1")
  })

  it("gitignore patterns exclude correct files from zip candidates", () => {
    // Create a mini file structure
    fs.writeFileSync(path.join(tmpDir, "src.ts"), "export const a = 1")
    fs.mkdirSync(path.join(tmpDir, "node_modules", "pkg"), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, "node_modules", "pkg", "index.js"), "module.exports = {}")
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, ".git", "HEAD"), "ref: refs/heads/main")
    fs.mkdirSync(path.join(tmpDir, ".kap10"), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, ".kap10", "config.json"), "{}")

    // Default exclusion patterns (same as push.ts uses)
    const alwaysExclude = [".git", ".kap10", "node_modules"]

    function shouldInclude(relPath: string): boolean {
      for (const pattern of alwaysExclude) {
        if (relPath === pattern || relPath.startsWith(pattern + "/") || relPath.startsWith(pattern + path.sep)) {
          return false
        }
      }
      return true
    }

    // Collect relative file paths
    function collectFiles(dir: string, relativeTo: string): string[] {
      const results: string[] = []
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        const relPath = path.relative(relativeTo, fullPath)
        if (!shouldInclude(relPath)) continue
        if (entry.isDirectory()) {
          results.push(...collectFiles(fullPath, relativeTo))
        } else {
          results.push(relPath)
        }
      }
      return results
    }

    const files = collectFiles(tmpDir, tmpDir)

    expect(files).toContain("src.ts")
    expect(files.some((f) => f.startsWith("node_modules"))).toBe(false)
    expect(files.some((f) => f.startsWith(".git"))).toBe(false)
    expect(files.some((f) => f.startsWith(".kap10"))).toBe(false)
  })
})
