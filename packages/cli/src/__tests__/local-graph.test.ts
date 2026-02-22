/**
 * Phase 10b TEST-01: CozoDB rules/patterns integration tests.
 */

import { describe, expect, it, beforeEach } from "vitest"
import { initSchema } from "../cozo-schema.js"
import type { CozoDb } from "../cozo-schema.js"
import { CozoGraphStore } from "../local-graph.js"
import type { CompactRule, CompactPattern, SnapshotEnvelope } from "../local-graph.js"

function createInMemoryDb(): CozoDb {
  // Minimal CozoDB mock using in-memory maps
  const relations = new Map<string, Map<string, unknown[]>>()

  return {
    run(query: string, params?: Record<string, unknown>) {
      // Handle :create statements
      if (query.includes(":create ")) {
        const match = query.match(/:create\s+(\w+)/)
        if (match) {
          relations.set(match[1]!, new Map())
        }
        return { rows: [] }
      }

      // Handle :put statements
      if (query.includes(":put ")) {
        const match = query.match(/:put\s+(\w+)/)
        if (match) {
          const relation = relations.get(match[1]!)
          if (relation && params) {
            const key = params.key as string ?? params.token as string ?? params.fp as string ?? `${params.from}-${params.to}-${params.type}`
            relation.set(key, Object.values(params))
          }
        }
        return { rows: [] }
      }

      // Handle queries for rules
      if (query.includes("*rules[") && query.includes("enabled = true")) {
        const rulesRelation = relations.get("rules")
        if (!rulesRelation) return { rows: [] }
        return {
          rows: Array.from(rulesRelation.values()).filter((row) => {
            // Check enabled field (index 8)
            return row[8] === true
          }),
        }
      }

      if (query.includes("*rules[") && query.includes(":limit 1")) {
        const rulesRelation = relations.get("rules")
        if (!rulesRelation || rulesRelation.size === 0) return { rows: [] }
        return { rows: [Array.from(rulesRelation.values())[0]!] }
      }

      // Handle queries for patterns
      if (query.includes("*patterns[")) {
        const patternsRelation = relations.get("patterns")
        if (!patternsRelation) return { rows: [] }
        return { rows: Array.from(patternsRelation.values()) }
      }

      // Handle entity queries
      if (query.includes("*entities[") && params?.key) {
        const entitiesRelation = relations.get("entities")
        if (!entitiesRelation) return { rows: [] }
        const entry = entitiesRelation.get(params.key as string)
        return { rows: entry ? [entry] : [] }
      }

      // Handle file_index queries
      if (query.includes("*file_index[") && params?.fp) {
        const fileIndexRelation = relations.get("file_index")
        if (!fileIndexRelation) return { rows: [] }
        const matching: unknown[][] = []
        for (const [, value] of fileIndexRelation) {
          if ((value as unknown[])[0] === params.fp) {
            // Return entity data
            const entityKey = (value as unknown[])[1] as string
            const entitiesRelation = relations.get("entities")
            if (entitiesRelation) {
              const entity = entitiesRelation.get(entityKey)
              if (entity) matching.push(entity as unknown[])
            }
          }
        }
        return { rows: matching }
      }

      // Default: return empty
      return { rows: [] }
    },
  }
}

describe("CozoGraphStore — Rules & Patterns (Phase 10b)", () => {
  let db: CozoDb
  let store: CozoGraphStore

  beforeEach(() => {
    db = createInMemoryDb()
    store = new CozoGraphStore(db)
  })

  describe("hasRules", () => {
    it("returns false when no rules loaded", () => {
      expect(store.hasRules()).toBe(false)
    })

    it("returns true after loading rules", () => {
      const rules: CompactRule[] = [
        {
          key: "rule-1",
          name: "No console.log",
          scope: "repo",
          severity: "warn",
          engine: "structural",
          query: "call_expression",
          message: "Avoid console.log in production",
          file_glob: "**/*.ts",
          enabled: true,
          repo_id: "repo-1",
        },
      ]
      store.loadRules(rules)
      expect(store.hasRules()).toBe(true)
    })
  })

  describe("loadRules + getRules", () => {
    it("loads and retrieves rules", () => {
      const rules: CompactRule[] = [
        {
          key: "rule-1",
          name: "No console.log",
          scope: "repo",
          severity: "warn",
          engine: "structural",
          query: "call_expression",
          message: "Avoid console.log",
          file_glob: "",
          enabled: true,
          repo_id: "repo-1",
        },
        {
          key: "rule-2",
          name: "PascalCase classes",
          scope: "org",
          severity: "error",
          engine: "naming",
          query: "^[a-z]",
          message: "Classes must be PascalCase",
          file_glob: "**/*.ts",
          enabled: true,
          repo_id: "repo-1",
        },
      ]
      store.loadRules(rules)
      const result = store.getRules()
      expect(result.length).toBe(2)
    })

    it("filters by file glob", () => {
      const rules: CompactRule[] = [
        {
          key: "rule-ts",
          name: "TS only",
          scope: "repo",
          severity: "warn",
          engine: "structural",
          query: "call_expression",
          message: "TS rule",
          file_glob: "**/*.ts",
          enabled: true,
          repo_id: "repo-1",
        },
        {
          key: "rule-py",
          name: "Python only",
          scope: "repo",
          severity: "warn",
          engine: "structural",
          query: "function_definition",
          message: "Python rule",
          file_glob: "**/*.py",
          enabled: true,
          repo_id: "repo-1",
        },
      ]
      store.loadRules(rules)
      const tsRules = store.getRules("src/index.ts")
      expect(tsRules.length).toBe(1)
      expect(tsRules[0]!.key).toBe("rule-ts")
    })

    it("excludes disabled rules", () => {
      const rules: CompactRule[] = [
        {
          key: "rule-disabled",
          name: "Disabled",
          scope: "repo",
          severity: "warn",
          engine: "structural",
          query: "call_expression",
          message: "Disabled",
          file_glob: "",
          enabled: false,
          repo_id: "repo-1",
        },
      ]
      store.loadRules(rules)
      const result = store.getRules()
      expect(result.length).toBe(0)
    })
  })

  describe("loadPatterns + getPatterns", () => {
    it("loads and retrieves patterns", () => {
      const patterns: CompactPattern[] = [
        {
          key: "pattern-1",
          name: "Error Boundary",
          kind: "structural",
          frequency: 15,
          confidence: 0.85,
          exemplar_keys: ["file1:10", "file2:20"],
          promoted_rule_key: "",
        },
      ]
      store.loadPatterns(patterns)
      const result = store.getPatterns()
      expect(result.length).toBe(1)
      expect(result[0]!.name).toBe("Error Boundary")
      expect(result[0]!.exemplar_keys).toEqual(["file1:10", "file2:20"])
    })
  })

  describe("loadSnapshot with v2 envelope", () => {
    it("loads rules and patterns from v2 envelope", () => {
      const envelope: SnapshotEnvelope = {
        version: 2,
        repoId: "repo-1",
        orgId: "org-1",
        entities: [
          { key: "fn1", kind: "function", name: "doStuff", file_path: "src/index.ts", start_line: 10, signature: "doStuff()", body: "return 42" },
        ],
        edges: [
          { from_key: "fn1", to_key: "fn2", type: "calls" },
        ],
        rules: [
          {
            key: "rule-1",
            name: "Test Rule",
            scope: "repo",
            severity: "warn",
            engine: "structural",
            query: "call_expression",
            message: "Test message",
            file_glob: "",
            enabled: true,
            repo_id: "repo-1",
          },
        ],
        patterns: [
          {
            key: "pattern-1",
            name: "Test Pattern",
            kind: "structural",
            frequency: 5,
            confidence: 0.9,
            exemplar_keys: ["ex1"],
            promoted_rule_key: "",
          },
        ],
        generatedAt: new Date().toISOString(),
      }
      store.loadSnapshot(envelope)
      expect(store.hasRules()).toBe(true)
      expect(store.getRules().length).toBe(1)
      expect(store.getPatterns().length).toBe(1)
    })

    it("loads v1 envelope without rules/patterns", () => {
      const envelope: SnapshotEnvelope = {
        version: 1,
        repoId: "repo-1",
        orgId: "org-1",
        entities: [],
        edges: [],
        generatedAt: new Date().toISOString(),
      }
      store.loadSnapshot(envelope)
      expect(store.hasRules()).toBe(false)
      expect(store.getPatterns().length).toBe(0)
    })
  })
})
