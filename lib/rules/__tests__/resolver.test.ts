import { beforeEach, describe, expect, it } from "vitest"
import { createTestContainer } from "@/lib/di/container"
import type { Container } from "@/lib/di/container"
import { InMemoryGraphStore } from "@/lib/di/fakes"
import type { RuleDoc } from "@/lib/ports/types"
import type { ResolveRulesInput } from "@/lib/rules/resolver"
import { resolveRules } from "@/lib/rules/resolver"

let testId = 0

function makeRule(overrides: Partial<RuleDoc> & { id: string; title: string }): RuleDoc {
  return {
    org_id: "org-1",
    repo_id: "repo-1",
    name: overrides.title.toLowerCase().replace(/\s+/g, "-"),
    description: "Test rule",
    type: "architecture",
    scope: "repo",
    enforcement: "warn",
    priority: 5,
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe("resolveRules", () => {
  let container: Container
  let graphStore: InMemoryGraphStore
  let repoId: string

  beforeEach(() => {
    // Use unique repoId per test to avoid module-level cache collisions
    testId++
    repoId = `repo-${testId}`
    graphStore = new InMemoryGraphStore()
    container = createTestContainer({ graphStore })
  })

  it("returns rules sorted by scope priority (highest first)", async () => {
    const input: ResolveRulesInput = { orgId: "org-1", repoId }

    await graphStore.upsertRule("org-1", makeRule({ id: "r1", title: "Rule Org", scope: "org", priority: 5, repo_id: repoId }))
    await graphStore.upsertRule("org-1", makeRule({ id: "r2", title: "Rule Repo", scope: "repo", priority: 5, repo_id: repoId }))
    await graphStore.upsertRule("org-1", makeRule({ id: "r3", title: "Rule Workspace", scope: "workspace", priority: 5, repo_id: repoId }))

    const result = await resolveRules(container, input)

    expect(result.length).toBe(3)
    expect(result[0]!.scope).toBe("workspace")
    expect(result[1]!.scope).toBe("repo")
    expect(result[2]!.scope).toBe("org")
  })

  it("workspace scope rules override repo scope rules with same title", async () => {
    const input: ResolveRulesInput = { orgId: "org-1", repoId }

    await graphStore.upsertRule("org-1", makeRule({
      id: "r1",
      title: "No Console",
      scope: "repo",
      priority: 5,
      enforcement: "suggest",
      repo_id: repoId,
    }))
    await graphStore.upsertRule("org-1", makeRule({
      id: "r2",
      title: "No Console",
      scope: "workspace",
      priority: 5,
      enforcement: "block",
      repo_id: repoId,
    }))

    const result = await resolveRules(container, input)

    // Deduplicated by title: workspace wins because it has higher scope priority
    expect(result.length).toBe(1)
    expect(result[0]!.scope).toBe("workspace")
    expect(result[0]!.enforcement).toBe("block")
  })

  it("caps result at 50 rules", async () => {
    const input: ResolveRulesInput = { orgId: "org-1", repoId }

    for (let i = 0; i < 60; i++) {
      await graphStore.upsertRule("org-1", makeRule({
        id: `r${i}`,
        title: `Rule ${i}`,
        scope: "repo",
        priority: i,
        repo_id: repoId,
      }))
    }

    const result = await resolveRules(container, input)

    expect(result.length).toBe(50)
  })

  it("deduplicates rules by title (higher priority wins)", async () => {
    const input: ResolveRulesInput = { orgId: "org-1", repoId }

    await graphStore.upsertRule("org-1", makeRule({
      id: "r1",
      title: "Naming Convention",
      scope: "repo",
      priority: 3,
      repo_id: repoId,
    }))
    await graphStore.upsertRule("org-1", makeRule({
      id: "r2",
      title: "Naming Convention",
      scope: "repo",
      priority: 10,
      repo_id: repoId,
    }))

    const result = await resolveRules(container, input)

    // Same scope, deduplicated by title; higher priority (10) wins
    expect(result.length).toBe(1)
    expect(result[0]!.priority).toBe(10)
  })
})
