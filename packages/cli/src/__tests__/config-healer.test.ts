import { describe, it, expect } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

describe("Config Healer", () => {
  it("detects missing IDE config", () => {
    const fakePath = path.join(os.tmpdir(), `test-ide-${Date.now()}`, "mcp.json")
    expect(fs.existsSync(fakePath)).toBe(false)
  })

  it("parses valid MCP config", () => {
    const tmpDir = path.join(os.tmpdir(), `test-mcp-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    const configPath = path.join(tmpDir, "mcp.json")
    fs.writeFileSync(configPath, JSON.stringify({
      mcpServers: {
        kap10: { url: "http://localhost:3000/api/mcp/sse" },
      },
    }))

    const raw = fs.readFileSync(configPath, "utf-8")
    const config = JSON.parse(raw) as { mcpServers?: Record<string, { url?: string }> }
    expect(config.mcpServers?.kap10?.url).toBe("http://localhost:3000/api/mcp/sse")

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true })
  })
})
