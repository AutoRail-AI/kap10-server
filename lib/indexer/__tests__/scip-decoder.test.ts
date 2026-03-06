/**
 * Tests for the shared SCIP protobuf decoder.
 *
 * Since we can't easily generate real .scip files in tests,
 * we test the exported parseSCIPSymbol function and verify
 * the decoder handles edge cases gracefully.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { describe, expect, it, beforeAll, afterAll } from "vitest"

import { isExternalSymbol, parseSCIPSymbol, resolveProjectPackageNames } from "../scip-decoder"

describe("parseSCIPSymbol", () => {
  it("parses function symbols (ending with ())", () => {
    const result = parseSCIPSymbol("scip-typescript npm package func()")
    expect(result).toEqual({
      kind: "function",
      name: "func",
      signature: "func()",
    })
  })

  it("parses method symbols (ending with ().)", () => {
    // In real SCIP, method descriptors are separate space-delimited parts
    const result = parseSCIPSymbol("scip-typescript npm package method().")
    expect(result).toEqual({
      kind: "method",
      name: "method",
      signature: "method()",
    })
  })

  it("parses class symbols (ending with #)", () => {
    const result = parseSCIPSymbol("scip-typescript npm package UserService#")
    expect(result).toEqual({
      kind: "class",
      name: "UserService",
    })
  })

  it("parses variable symbols (ending with .)", () => {
    const result = parseSCIPSymbol("scip-typescript npm package MAX_SIZE.")
    expect(result).toEqual({
      kind: "variable",
      name: "MAX_SIZE",
    })
  })

  it("parses module symbols (ending with /)", () => {
    const result = parseSCIPSymbol("scip-typescript npm package utils/")
    expect(result).toEqual({
      kind: "module",
      name: "utils",
    })
  })

  it("works with Python SCIP symbols", () => {
    const result = parseSCIPSymbol("scip-python python project MyClass#")
    expect(result).toEqual({
      kind: "class",
      name: "MyClass",
    })
  })

  it("works with Go SCIP symbols", () => {
    const result = parseSCIPSymbol("scip-go go mod/pkg HandleRequest()")
    expect(result).toEqual({
      kind: "function",
      name: "HandleRequest",
      signature: "HandleRequest()",
    })
  })

  it("returns null for symbols with < 2 parts", () => {
    expect(parseSCIPSymbol("single")).toBeNull()
  })

  it("returns null for symbols with unknown descriptor suffix", () => {
    expect(parseSCIPSymbol("scip-typescript npm unknown_suffix!")).toBeNull()
  })

  it("returns null for empty string", () => {
    expect(parseSCIPSymbol("")).toBeNull()
  })

  it("handles whitespace in symbol string", () => {
    const result = parseSCIPSymbol("  scip-typescript npm package func()  ")
    expect(result).toEqual({
      kind: "function",
      name: "func",
      signature: "func()",
    })
  })
})

describe("isExternalSymbol", () => {
  // Simulate a project with package name "unerr-web-server"
  const projectPkgs = new Set(["unerr-web-server", "."])

  it("detects TypeScript stdlib symbols as external", () => {
    expect(isExternalSymbol("scip-typescript npm typescript 5.x lib/`lib.es5.d.ts`/Array#", projectPkgs)).toBe(true)
    expect(isExternalSymbol("scip-typescript npm typescript 5.x lib/`lib.es2015.promise.d.ts`/Promise#", projectPkgs)).toBe(true)
    expect(isExternalSymbol("scip-typescript npm typescript 5.x lib/`lib.dom.d.ts`/Body#", projectPkgs)).toBe(true)
  })

  it("detects @types packages as external", () => {
    expect(isExternalSymbol("scip-typescript npm @types/node 20.x fs/readFileSync().", projectPkgs)).toBe(true)
    expect(isExternalSymbol("scip-typescript npm @types/react 18.x Component#", projectPkgs)).toBe(true)
  })

  it("detects npm dependency symbols as external", () => {
    expect(isExternalSymbol("scip-typescript npm express 4.18.1 Router#", projectPkgs)).toBe(true)
    expect(isExternalSymbol("scip-typescript npm zod 3.22.0 ZodString#", projectPkgs)).toBe(true)
    expect(isExternalSymbol("scip-typescript npm react 18.2.0 Component#", projectPkgs)).toBe(true)
  })

  it("allows project-local symbols (matches project package name)", () => {
    expect(isExternalSymbol("scip-typescript npm unerr-web-server 0.0.0 src/lib/foo.ts/MyClass#", projectPkgs)).toBe(false)
    expect(isExternalSymbol("scip-typescript npm unerr-web-server 0.0.0 src/utils/helper.ts/doWork().", projectPkgs)).toBe(false)
  })

  it("allows dot-package symbols (anonymous project)", () => {
    expect(isExternalSymbol("scip-typescript npm . . src/lib/foo.ts/MyClass#", projectPkgs)).toBe(false)
  })

  it("returns false for symbols with fewer than 4 parts", () => {
    expect(isExternalSymbol("local 1", projectPkgs)).toBe(false)
    expect(isExternalSymbol("scip-typescript npm", projectPkgs)).toBe(false)
  })
})

describe("resolveProjectPackageNames (multi-language)", () => {
  const testDir = join(tmpdir(), `scip-test-${Date.now()}`)

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  function setupAndResolve(files: Record<string, string>, language: string): Set<string> {
    const langDir = join(testDir, `${language}-${Date.now()}`)
    mkdirSync(langDir, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(langDir, name), content)
    }
    // Simulate a SCIP file in the same directory
    const scipFile = join(langDir, "index.scip")
    writeFileSync(scipFile, "")
    return resolveProjectPackageNames(scipFile, language)
  }

  it("resolves TypeScript project name from package.json", () => {
    const names = setupAndResolve({
      "package.json": JSON.stringify({ name: "my-ts-app" }),
    }, "typescript")
    expect(names.has("my-ts-app")).toBe(true)
    expect(names.has(".")).toBe(true)
  })

  it("resolves Python project name from pyproject.toml", () => {
    const names = setupAndResolve({
      "pyproject.toml": '[project]\nname = "my-python-lib"\nversion = "1.0.0"',
    }, "python")
    expect(names.has("my-python-lib")).toBe(true)
    expect(names.has(".")).toBe(true)
  })

  it("resolves Python fallback to 'project' when no name in manifest", () => {
    const names = setupAndResolve({
      "requirements.txt": "flask==2.0\n",
    }, "python")
    expect(names.has("project")).toBe(true)
  })

  it("resolves Go module name from go.mod", () => {
    const names = setupAndResolve({
      "go.mod": "module github.com/myorg/myrepo\n\ngo 1.21\n",
    }, "go")
    expect(names.has("github.com/myorg/myrepo")).toBe(true)
  })

  it("resolves Rust crate name from Cargo.toml", () => {
    const names = setupAndResolve({
      "Cargo.toml": '[package]\nname = "my-crate"\nversion = "0.1.0"',
    }, "rust")
    expect(names.has("my-crate")).toBe(true)
  })

  it("resolves Java artifact from pom.xml", () => {
    const names = setupAndResolve({
      "pom.xml": '<project><groupId>com.example</groupId><artifactId>my-app</artifactId></project>',
    }, "java")
    expect(names.has("my-app")).toBe(true)
    expect(names.has("com.example:my-app")).toBe(true)
  })

  it("resolves PHP package name from composer.json", () => {
    const names = setupAndResolve({
      "composer.json": JSON.stringify({ name: "vendor/my-package" }),
    }, "php")
    expect(names.has("vendor/my-package")).toBe(true)
  })

  it("always includes '.' fallback", () => {
    const names = setupAndResolve({}, "unknown")
    expect(names.has(".")).toBe(true)
  })
})

describe("SCIP edge classification (L-18a)", () => {
  it("function target → 'calls' edge kind", () => {
    const result = parseSCIPSymbol("scip-typescript npm pkg helper()")
    expect(result).not.toBeNull()
    const targetKind = result!.kind
    const edgeKind = (targetKind === "function" || targetKind === "method") ? "calls" : "references"
    expect(edgeKind).toBe("calls")
  })

  it("method target → 'calls' edge kind", () => {
    const result = parseSCIPSymbol("scip-typescript npm pkg doWork().")
    expect(result).not.toBeNull()
    const targetKind = result!.kind
    const edgeKind = (targetKind === "function" || targetKind === "method") ? "calls" : "references"
    expect(edgeKind).toBe("calls")
  })

  it("class target → 'references' edge kind", () => {
    const result = parseSCIPSymbol("scip-typescript npm pkg UserService#")
    expect(result).not.toBeNull()
    const targetKind = result!.kind
    const edgeKind = (targetKind === "function" || targetKind === "method") ? "calls" : "references"
    expect(edgeKind).toBe("references")
  })

  it("variable target → 'references' edge kind", () => {
    const result = parseSCIPSymbol("scip-typescript npm pkg MAX_SIZE.")
    expect(result).not.toBeNull()
    const targetKind = result!.kind
    const edgeKind = (targetKind === "function" || targetKind === "method") ? "calls" : "references"
    expect(edgeKind).toBe("references")
  })

  it("module target → 'references' edge kind", () => {
    const result = parseSCIPSymbol("scip-typescript npm pkg utils/")
    expect(result).not.toBeNull()
    const targetKind = result!.kind
    const edgeKind = (targetKind === "function" || targetKind === "method") ? "calls" : "references"
    expect(edgeKind).toBe("references")
  })
})
