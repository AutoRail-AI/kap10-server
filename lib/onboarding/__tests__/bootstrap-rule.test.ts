import { describe, expect, it } from "vitest"
import { generateBootstrapRule, getBootstrapRuleVersion } from "../bootstrap-rule"

describe("generateBootstrapRule", () => {
  it("includes the repo name", () => {
    const rule = generateBootstrapRule("acme/web-app")
    expect(rule).toContain("acme/web-app")
  })

  it("includes kap10 rule version frontmatter", () => {
    const rule = generateBootstrapRule("test/repo")
    expect(rule).toContain("kap10_rule_version:")
  })

  it("includes pre-flight instructions", () => {
    const rule = generateBootstrapRule("test/repo")
    expect(rule).toContain("Pre-flight")
    expect(rule).toContain("get_function")
    expect(rule).toContain("get_callers")
    expect(rule).toContain("search_code")
  })

  it("includes post-flight sync instructions", () => {
    const rule = generateBootstrapRule("test/repo")
    expect(rule).toContain("Post-flight")
    expect(rule).toContain("sync_local_diff")
    expect(rule).toContain("git diff")
  })

  it("includes alwaysApply: true", () => {
    const rule = generateBootstrapRule("test/repo")
    expect(rule).toContain("alwaysApply: true")
  })

  it("mentions lockfile exclusion", () => {
    const rule = generateBootstrapRule("test/repo")
    expect(rule).toContain("lockfile")
  })

  it("includes glob patterns for supported languages", () => {
    const rule = generateBootstrapRule("test/repo")
    expect(rule).toContain("**/*.ts")
    expect(rule).toContain("**/*.py")
    expect(rule).toContain("**/*.go")
  })
})

describe("getBootstrapRuleVersion", () => {
  it("returns a semver string", () => {
    const version = getBootstrapRuleVersion()
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
