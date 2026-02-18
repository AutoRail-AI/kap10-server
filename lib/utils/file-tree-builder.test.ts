/**
 * Unit tests for buildFileTree — flat paths to nested tree (Phase 1 repo browsing).
 */
import { describe, expect, it } from "vitest"

import { buildFileTree, type TreeNode } from "./file-tree-builder"

function paths(pathStrings: string[]): { path: string }[] {
  return pathStrings.map((path) => ({ path }))
}

describe("buildFileTree", () => {
  it("returns empty array for no paths", () => {
    expect(buildFileTree([])).toEqual([])
  })

  it("builds single file at root", () => {
    const tree = buildFileTree(paths(["index.ts"]))
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ name: "index.ts", path: "index.ts", type: "file" })
    expect(tree[0]?.children).toBeUndefined()
  })

  it("builds nested directories and files", () => {
    const tree = buildFileTree(paths(["src/index.ts", "src/utils/helper.ts", "src/utils/format.ts"]))
    expect(tree).toHaveLength(1)
    const src = tree[0] as TreeNode
    expect(src.name).toBe("src")
    expect(src.type).toBe("dir")
    expect(src.children).toHaveLength(2)
    const indexNode = src.children?.find((c) => c.name === "index.ts")
    const utilsNode = src.children?.find((c) => c.name === "utils")
    expect(indexNode).toMatchObject({ name: "index.ts", path: "src/index.ts", type: "file" })
    expect(utilsNode).toMatchObject({ name: "utils", path: "src/utils", type: "dir" })
    expect(utilsNode?.children).toHaveLength(2)
    const helper = utilsNode?.children?.find((c) => c.name === "helper.ts")
    const format = utilsNode?.children?.find((c) => c.name === "format.ts")
    expect(helper).toMatchObject({ path: "src/utils/helper.ts", type: "file" })
    expect(format).toMatchObject({ path: "src/utils/format.ts", type: "file" })
  })

  it("sorts directories first then files, alphabetically", () => {
    const tree = buildFileTree(paths(["a.ts", "b.ts", "lib/foo.ts"]))
    expect(tree.map((n) => n.name)).toEqual(["a.ts", "b.ts", "lib"])
    const lib = tree.find((n) => n.name === "lib")
    expect(lib?.children?.map((c) => c.name)).toEqual(["foo.ts"])
  })

  it("handles root-level and nested files", () => {
    const tree = buildFileTree(paths(["README.md", "src/main.ts", "package.json"]))
    expect(tree).toHaveLength(3)
    const names = tree.map((n) => n.name).sort()
    expect(names).toEqual(["README.md", "package.json", "src"])
    const src = tree.find((n) => n.name === "src") as TreeNode
    expect(src.children).toHaveLength(1)
    expect(src.children?.[0]).toMatchObject({ name: "main.ts", type: "file" })
  })

  it("does not mutate input paths", () => {
    const input = paths(["x/y/z.ts"])
    const before = input[0]?.path
    buildFileTree(input)
    expect(input[0]?.path).toBe(before)
  })
})
