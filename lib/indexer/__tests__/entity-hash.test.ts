/**
 * P1-TEST-04: Entity hashing — deterministic, collision-resistant, 16-char hex.
 */
import { describe, expect, it } from "vitest"

import { edgeHash, entityHash } from "../entity-hash"

describe("entityHash", () => {
  it("returns a 16-character hex string", () => {
    const hash = entityHash("repo-1", "src/index.ts", "function", "main")
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(hash).toHaveLength(16)
  })

  it("is deterministic — same inputs produce same hash", () => {
    const hash1 = entityHash("repo-1", "src/index.ts", "function", "main", "main()")
    const hash2 = entityHash("repo-1", "src/index.ts", "function", "main", "main()")
    expect(hash1).toBe(hash2)
  })

  it("produces different hashes for different repos", () => {
    const hash1 = entityHash("repo-1", "src/index.ts", "function", "main")
    const hash2 = entityHash("repo-2", "src/index.ts", "function", "main")
    expect(hash1).not.toBe(hash2)
  })

  it("produces different hashes for different file paths", () => {
    const hash1 = entityHash("repo-1", "src/a.ts", "function", "foo")
    const hash2 = entityHash("repo-1", "src/b.ts", "function", "foo")
    expect(hash1).not.toBe(hash2)
  })

  it("produces different hashes for different entity kinds", () => {
    const hash1 = entityHash("repo-1", "src/a.ts", "function", "Foo")
    const hash2 = entityHash("repo-1", "src/a.ts", "class", "Foo")
    expect(hash1).not.toBe(hash2)
  })

  it("produces different hashes for different names", () => {
    const hash1 = entityHash("repo-1", "src/a.ts", "function", "foo")
    const hash2 = entityHash("repo-1", "src/a.ts", "function", "bar")
    expect(hash1).not.toBe(hash2)
  })

  it("produces different hashes with different signatures", () => {
    const hash1 = entityHash("repo-1", "src/a.ts", "function", "foo", "foo(a: string)")
    const hash2 = entityHash("repo-1", "src/a.ts", "function", "foo", "foo(a: number)")
    expect(hash1).not.toBe(hash2)
  })

  it("treats undefined signature as empty string", () => {
    const hash1 = entityHash("repo-1", "src/a.ts", "function", "foo", undefined)
    const hash2 = entityHash("repo-1", "src/a.ts", "function", "foo")
    expect(hash1).toBe(hash2)
  })

  it("has low collision rate across many entities", () => {
    const hashes = new Set<string>()
    for (let i = 0; i < 10000; i++) {
      const hash = entityHash("repo-1", `src/file${i}.ts`, "function", `fn${i}`)
      hashes.add(hash)
    }
    // 10000 unique inputs should produce 10000 unique hashes (or very close)
    expect(hashes.size).toBe(10000)
  })
})

describe("edgeHash", () => {
  it("returns a 16-character hex string", () => {
    const hash = edgeHash("abc123", "def456", "calls")
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it("is deterministic", () => {
    const hash1 = edgeHash("abc123", "def456", "calls")
    const hash2 = edgeHash("abc123", "def456", "calls")
    expect(hash1).toBe(hash2)
  })

  it("produces different hashes for different edge kinds", () => {
    const hash1 = edgeHash("abc123", "def456", "calls")
    const hash2 = edgeHash("abc123", "def456", "imports")
    expect(hash1).not.toBe(hash2)
  })

  it("produces different hashes for swapped from/to", () => {
    const hash1 = edgeHash("abc123", "def456", "calls")
    const hash2 = edgeHash("def456", "abc123", "calls")
    expect(hash1).not.toBe(hash2)
  })
})
