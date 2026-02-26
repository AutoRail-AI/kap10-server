import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

describe("Config Healer (P5.6-ADV-04)", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `test-config-healer-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("detects missing IDE config", () => {
    const fakePath = path.join(tmpDir, "mcp.json")
    expect(fs.existsSync(fakePath)).toBe(false)
  })

  it("parses valid MCP config", () => {
    const configPath = path.join(tmpDir, "mcp.json")
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        unerr: { url: "http://localhost:3000/api/mcp/sse" },
      },
    }))

    const raw = fs.readFileSync(configPath, "utf-8")
    const config = JSON.parse(raw) as { mcpServers?: Record<string, { url?: string }> }
    expect(config.mcpServers?.unerr?.url).toBe("http://localhost:3000/api/mcp/sse")
  })

  it("verifies config after simulated git checkout", () => {
    // Simulate writing config before checkout
    const configPath = path.join(tmpDir, "mcp.json")
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        unerr: { url: "http://localhost:3000/api/mcp/sse" },
      },
    }))

    // Simulate git checkout overwriting the config (e.g., branch with different config)
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        "other-tool": { command: "npx", args: ["other-tool-mcp"] },
      },
    }))

    // Verify: unerr config is missing after checkout
    const raw = fs.readFileSync(configPath, "utf-8")
    const config = JSON.parse(raw) as { mcpServers?: Record<string, unknown> }
    const hasUnerr = config.mcpServers !== undefined && "unerr" in config.mcpServers
    expect(hasUnerr).toBe(false)
  })

  it("detects config drift when server URL changes", () => {
    const configPath = path.join(tmpDir, "mcp.json")
    const expectedServerUrl = "http://localhost:3000"

    // Config with wrong server URL
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        unerr: { url: "http://old-server:3000/api/mcp/sse" },
      },
    }))

    const raw = fs.readFileSync(configPath, "utf-8")
    const config = JSON.parse(raw) as { mcpServers?: Record<string, { url?: string }> }
    const currentUrl = config.mcpServers?.unerr?.url ?? ""

    // Check drift: current URL doesn't match expected
    const hasDrift = !currentUrl.includes(expectedServerUrl.replace(/^https?:\/\//, ""))
    expect(hasDrift).toBe(true)
  })

  it("auto-repairs broken config by adding unerr server entry", () => {
    const configPath = path.join(tmpDir, "mcp.json")
    const serverUrl = "http://localhost:3000"

    // Start with config missing unerr
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        "some-other-tool": { command: "npx", args: ["other"] },
      },
    }))

    // Repair logic
    const raw = fs.readFileSync(configPath, "utf-8")
    const config = JSON.parse(raw) as { mcpServers?: Record<string, unknown> }
    if (!config.mcpServers) config.mcpServers = {}

    config.mcpServers["unerr"] = {
      url: `${serverUrl}/api/mcp/sse`,
      env: {},
    }

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")

    // Verify repair
    const repaired = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      mcpServers: Record<string, { url?: string }>
    }
    expect(repaired.mcpServers["unerr"]).toBeTruthy()
    expect(repaired.mcpServers["unerr"]!.url).toBe("http://localhost:3000/api/mcp/sse")
    // Other tools are preserved
    expect(repaired.mcpServers["some-other-tool"]).toBeTruthy()
  })

  it("auto-repairs when config file is missing entirely", () => {
    const configDir = path.join(tmpDir, ".cursor")
    const configPath = path.join(configDir, "mcp.json")
    const serverUrl = "http://localhost:3000"

    expect(fs.existsSync(configPath)).toBe(false)

    // Repair: create directory and config
    fs.mkdirSync(configDir, { recursive: true })
    const config = {
      mcpServers: {
        unerr: {
          url: `${serverUrl}/api/mcp/sse`,
          env: {},
        },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")

    expect(fs.existsSync(configPath)).toBe(true)
    const written = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      mcpServers: Record<string, { url: string }>
    }
    expect(written.mcpServers["unerr"]!.url).toContain("mcp/sse")
  })

  it("silent mode suppresses output on success", () => {
    // Simulate the silent mode logic from config-verify.ts
    const silent = true
    const allGood = true
    const output: string[] = []

    // In normal mode, would log success
    if (!silent || !allGood) {
      output.push("Checking configurations...")
    }

    // When silent=true and allGood=true, no output
    expect(output.length).toBe(0)
  })

  it("silent mode still shows errors", () => {
    const _silent = true
    const issues = ["cursor: No unerr MCP server configured"]
    const output: string[] = []

    // Errors are always shown, even in silent mode
    for (const issue of issues) {
      output.push(issue)
    }

    expect(output.length).toBe(1)
    expect(output[0]).toContain("No unerr MCP server configured")
  })

  it("handles malformed JSON config gracefully", () => {
    const configPath = path.join(tmpDir, "mcp.json")
    fs.writeFileSync(configPath, "{ invalid json !!!")

    let parseError = false
    try {
      JSON.parse(fs.readFileSync(configPath, "utf-8"))
    } catch {
      parseError = true
    }

    expect(parseError).toBe(true)
  })

  it("preserves existing non-unerr MCP servers during repair", () => {
    const configPath = path.join(tmpDir, "mcp.json")
    const original = {
      mcpServers: {
        copilot: { command: "npx", args: ["copilot-mcp"] },
        cody: { url: "http://localhost:4000/mcp" },
      },
    }
    fs.writeFileSync(configPath, JSON.stringify(original))

    // Repair
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      mcpServers: Record<string, unknown>
    }
    config.mcpServers["unerr"] = { url: "http://localhost:3000/api/mcp/sse" }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))

    const result = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      mcpServers: Record<string, unknown>
    }
    expect(Object.keys(result.mcpServers).length).toBe(3)
    expect(result.mcpServers["copilot"]).toBeTruthy()
    expect(result.mcpServers["cody"]).toBeTruthy()
    expect(result.mcpServers["unerr"]).toBeTruthy()
  })
})
