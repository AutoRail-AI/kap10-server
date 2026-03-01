/**
 * Tests for cross-file call resolution (L-02).
 */
import { describe, expect, it } from "vitest"

import { entityHash } from "../entity-hash"
import type { ParsedEdge, ParsedEntity } from "../types"
import { resolveCrossFileCalls } from "../cross-file-calls"

const REPO_ID = "test-repo"

function makeFileEntity(filePath: string): ParsedEntity {
  return {
    id: entityHash(REPO_ID, filePath, "file", filePath),
    kind: "file",
    name: filePath,
    file_path: filePath,
  }
}

function makeFuncEntity(filePath: string, name: string, body?: string): ParsedEntity {
  const sig = `function ${name}()`
  return {
    id: entityHash(REPO_ID, filePath, "function", name, sig),
    kind: "function",
    name,
    file_path: filePath,
    start_line: 1,
    language: "typescript",
    signature: sig,
    body,
  }
}

function makeClassEntity(filePath: string, name: string): ParsedEntity {
  return {
    id: entityHash(REPO_ID, filePath, "class", name),
    kind: "class",
    name,
    file_path: filePath,
    start_line: 1,
    language: "typescript",
  }
}

function makeImportEdge(
  fromFileId: string,
  toFileId: string,
  importedSymbols: string[],
  isExternal?: boolean,
): ParsedEdge {
  return {
    from_id: fromFileId,
    to_id: toFileId,
    kind: "imports",
    imported_symbols: importedSymbols,
    is_external: isExternal ?? false,
  }
}

describe("resolveCrossFileCalls", () => {
  it("creates a 'calls' edge when an imported function is called in a body", () => {
    const fileA = makeFileEntity("src/a.ts")
    const fileB = makeFileEntity("src/b.ts")
    const helper = makeFuncEntity("src/b.ts", "helper")
    const main = makeFuncEntity("src/a.ts", "main", `
      function main() {
        const result = helper(42)
        return result
      }
    `)

    const entities = [fileA, fileB, helper, main]
    const edges: ParsedEdge[] = [
      makeImportEdge(fileA.id, fileB.id, ["helper"]),
    ]

    const crossFileEdges = resolveCrossFileCalls(entities, edges, REPO_ID)

    expect(crossFileEdges.length).toBe(1)
    expect(crossFileEdges[0]).toEqual({
      from_id: main.id,
      to_id: helper.id,
      kind: "calls",
    })
  })

  it("does not create an edge when imported symbol is not called in body", () => {
    const fileA = makeFileEntity("src/a.ts")
    const fileB = makeFileEntity("src/b.ts")
    const helper = makeFuncEntity("src/b.ts", "helper")
    const main = makeFuncEntity("src/a.ts", "main", `
      function main() {
        console.log("no calls to helper here")
      }
    `)

    const entities = [fileA, fileB, helper, main]
    const edges: ParsedEdge[] = [
      makeImportEdge(fileA.id, fileB.id, ["helper"]),
    ]

    const crossFileEdges = resolveCrossFileCalls(entities, edges, REPO_ID)
    expect(crossFileEdges.length).toBe(0)
  })

  it("skips external imports", () => {
    const fileA = makeFileEntity("src/a.ts")
    const main = makeFuncEntity("src/a.ts", "main", `
      function main() {
        readFileSync("test.txt")
      }
    `)

    const entities = [fileA, main]
    const edges: ParsedEdge[] = [
      makeImportEdge(fileA.id, "external:node:fs", ["readFileSync"], true),
    ]

    const crossFileEdges = resolveCrossFileCalls(entities, edges, REPO_ID)
    expect(crossFileEdges.length).toBe(0)
  })

  it("creates multiple edges for multiple imports from the same file", () => {
    const fileA = makeFileEntity("src/a.ts")
    const fileB = makeFileEntity("src/b.ts")
    const foo = makeFuncEntity("src/b.ts", "foo")
    const bar = makeFuncEntity("src/b.ts", "bar")
    const main = makeFuncEntity("src/a.ts", "main", `
      function main() {
        foo(1)
        bar(2)
      }
    `)

    const entities = [fileA, fileB, foo, bar, main]
    const edges: ParsedEdge[] = [
      makeImportEdge(fileA.id, fileB.id, ["foo", "bar"]),
    ]

    const crossFileEdges = resolveCrossFileCalls(entities, edges, REPO_ID)
    expect(crossFileEdges.length).toBe(2)

    const targetIds = crossFileEdges.map((e) => e.to_id).sort()
    expect(targetIds).toEqual([bar.id, foo.id].sort())
  })

  it("detects constructor calls (new ClassName())", () => {
    const fileA = makeFileEntity("src/a.ts")
    const fileB = makeFileEntity("src/b.ts")
    const myClass = makeClassEntity("src/b.ts", "MyService")
    const main = makeFuncEntity("src/a.ts", "main", `
      function main() {
        const svc = new MyService()
        return svc
      }
    `)

    const entities = [fileA, fileB, myClass, main]
    const edges: ParsedEdge[] = [
      makeImportEdge(fileA.id, fileB.id, ["MyService"]),
    ]

    const crossFileEdges = resolveCrossFileCalls(entities, edges, REPO_ID)
    expect(crossFileEdges.length).toBe(1)
    expect(crossFileEdges[0]!.to_id).toBe(myClass.id)
  })

  it("deduplicates edges when a symbol is called multiple times", () => {
    const fileA = makeFileEntity("src/a.ts")
    const fileB = makeFileEntity("src/b.ts")
    const helper = makeFuncEntity("src/b.ts", "helper")
    const main = makeFuncEntity("src/a.ts", "main", `
      function main() {
        helper(1)
        helper(2)
        helper(3)
      }
    `)

    const entities = [fileA, fileB, helper, main]
    const edges: ParsedEdge[] = [
      makeImportEdge(fileA.id, fileB.id, ["helper"]),
    ]

    const crossFileEdges = resolveCrossFileCalls(entities, edges, REPO_ID)
    expect(crossFileEdges.length).toBe(1)
  })

  it("returns empty when there are no import edges", () => {
    const fileA = makeFileEntity("src/a.ts")
    const main = makeFuncEntity("src/a.ts", "main", "function main() { helper() }")

    const entities = [fileA, main]
    const edges: ParsedEdge[] = []

    const crossFileEdges = resolveCrossFileCalls(entities, edges, REPO_ID)
    expect(crossFileEdges.length).toBe(0)
  })

  it("returns empty when there are no callable entities", () => {
    const fileA = makeFileEntity("src/a.ts")
    const fileB = makeFileEntity("src/b.ts")

    const entities = [fileA, fileB]
    const edges: ParsedEdge[] = [
      makeImportEdge(fileA.id, fileB.id, ["something"]),
    ]

    const crossFileEdges = resolveCrossFileCalls(entities, edges, REPO_ID)
    expect(crossFileEdges.length).toBe(0)
  })
})
