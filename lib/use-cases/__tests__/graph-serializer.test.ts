import { describe, expect, it } from "vitest"
import { serializeSnapshot, deserializeSnapshot, computeChecksum } from "../graph-serializer"

describe("graph-serializer", () => {
  const sampleData = {
    repoId: "repo-1",
    orgId: "org-1",
    entities: [
      { key: "fn1", kind: "function", name: "doStuff", file_path: "src/index.ts", start_line: 10, signature: "function doStuff(): void" },
      { key: "cls1", kind: "class", name: "MyClass", file_path: "src/my-class.ts", start_line: 1 },
    ],
    edges: [
      { from_key: "fn1", to_key: "cls1", type: "calls" },
    ],
  }

  describe("serializeSnapshot / deserializeSnapshot", () => {
    it("round-trips correctly", () => {
      const buffer = serializeSnapshot(sampleData)
      expect(Buffer.isBuffer(buffer)).toBe(true)
      expect(buffer.length).toBeGreaterThan(0)

      const decoded = deserializeSnapshot(buffer)
      expect(decoded.version).toBe(1)
      expect(decoded.repoId).toBe("repo-1")
      expect(decoded.orgId).toBe("org-1")
      expect(decoded.entities).toHaveLength(2)
      expect(decoded.edges).toHaveLength(1)
      expect(decoded.generatedAt).toBeTruthy()
    })

    it("preserves entity data through round-trip", () => {
      const buffer = serializeSnapshot(sampleData)
      const decoded = deserializeSnapshot(buffer)
      expect(decoded.entities[0]).toMatchObject({
        key: "fn1",
        kind: "function",
        name: "doStuff",
        file_path: "src/index.ts",
      })
    })

    it("preserves edge data through round-trip", () => {
      const buffer = serializeSnapshot(sampleData)
      const decoded = deserializeSnapshot(buffer)
      expect(decoded.edges[0]).toMatchObject({
        from_key: "fn1",
        to_key: "cls1",
        type: "calls",
      })
    })
  })

  describe("deserializeSnapshot validation", () => {
    it("rejects unsupported version", () => {
      const { pack } = require("msgpackr") as typeof import("msgpackr")
      const badBuffer = pack({ version: 99, repoId: "x", orgId: "x", entities: [], edges: [], generatedAt: "" }) as Buffer
      expect(() => deserializeSnapshot(badBuffer)).toThrow("Unsupported snapshot version: 99")
    })
  })

  describe("computeChecksum", () => {
    it("returns a hex SHA-256 digest", () => {
      const buffer = serializeSnapshot(sampleData)
      const checksum = computeChecksum(buffer)
      expect(checksum).toMatch(/^[0-9a-f]{64}$/)
    })

    it("is deterministic for same input", () => {
      const buffer = serializeSnapshot(sampleData)
      const c1 = computeChecksum(buffer)
      const c2 = computeChecksum(buffer)
      expect(c1).toBe(c2)
    })

    it("differs for different input", () => {
      const buf1 = serializeSnapshot(sampleData)
      const buf2 = serializeSnapshot({ ...sampleData, repoId: "different-repo" })
      expect(computeChecksum(buf1)).not.toBe(computeChecksum(buf2))
    })
  })
})
