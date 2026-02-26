/**
 * P1-TEST-05: Monorepo detection — pnpm, yarn, npm, nx, lerna workspaces.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { detectWorkspaceRoots } from "../monorepo"

describe("detectWorkspaceRoots", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "monorepo-test-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("detects single-package repo when no workspace config exists", () => {
    const result = detectWorkspaceRoots(tempDir)
    expect(result.type).toBe("single")
    expect(result.roots).toEqual(["."])
  })

  it("detects pnpm workspaces", () => {
    writeFileSync(
      join(tempDir, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n',
    )
    mkdirSync(join(tempDir, "packages", "core"), { recursive: true })
    mkdirSync(join(tempDir, "packages", "ui"), { recursive: true })

    const result = detectWorkspaceRoots(tempDir)
    expect(result.type).toBe("pnpm")
    expect(result.roots).toContain("packages/core")
    expect(result.roots).toContain("packages/ui")
  })

  it("detects npm/yarn workspaces from package.json", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    )
    mkdirSync(join(tempDir, "packages", "api"), { recursive: true })
    mkdirSync(join(tempDir, "packages", "web"), { recursive: true })

    const result = detectWorkspaceRoots(tempDir)
    expect(result.type).toBe("npm")
    expect(result.roots).toContain("packages/api")
    expect(result.roots).toContain("packages/web")
  })

  it("detects yarn workspaces (with yarn.lock)", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    )
    writeFileSync(join(tempDir, "yarn.lock"), "")
    mkdirSync(join(tempDir, "packages", "shared"), { recursive: true })

    const result = detectWorkspaceRoots(tempDir)
    expect(result.type).toBe("yarn")
    expect(result.roots).toContain("packages/shared")
  })

  it("detects nx workspaces", () => {
    writeFileSync(join(tempDir, "nx.json"), JSON.stringify({}))
    mkdirSync(join(tempDir, "packages", "lib-a"), { recursive: true })
    mkdirSync(join(tempDir, "packages", "lib-b"), { recursive: true })

    const result = detectWorkspaceRoots(tempDir)
    expect(result.type).toBe("nx")
    expect(result.roots.length).toBeGreaterThanOrEqual(2)
  })

  it("detects lerna workspaces", () => {
    writeFileSync(
      join(tempDir, "lerna.json"),
      JSON.stringify({ packages: ["packages/*"] }),
    )
    mkdirSync(join(tempDir, "packages", "module-a"), { recursive: true })

    const result = detectWorkspaceRoots(tempDir)
    expect(result.type).toBe("lerna")
    expect(result.roots).toContain("packages/module-a")
  })

  it("handles package.json with workspaces object format", () => {
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ workspaces: { packages: ["libs/*"] } }),
    )
    mkdirSync(join(tempDir, "libs", "utils"), { recursive: true })

    const result = detectWorkspaceRoots(tempDir)
    expect(result.roots).toContain("libs/utils")
  })

  it("prioritizes pnpm-workspace.yaml over package.json workspaces", () => {
    writeFileSync(
      join(tempDir, "pnpm-workspace.yaml"),
      'packages:\n  - "apps/*"\n',
    )
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ workspaces: ["packages/*"] }),
    )
    mkdirSync(join(tempDir, "apps", "web"), { recursive: true })
    mkdirSync(join(tempDir, "packages", "lib"), { recursive: true })

    const result = detectWorkspaceRoots(tempDir)
    expect(result.type).toBe("pnpm")
    expect(result.roots).toContain("apps/web")
  })
})
