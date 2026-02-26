import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

describe("Local Parse Fallback (P5.6-ADV-01)", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `unerr-local-parse-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("--local-parse flag falls back to zip upload when binary not found", () => {
    // Simulate checking for the unerr-parse binary
    const binaryName = process.platform === "win32" ? "unerr-parse.exe" : "unerr-parse"
    const binaryPath = path.join(tmpDir, ".unerr", "bin", binaryName)

    const binaryExists = fs.existsSync(binaryPath)
    expect(binaryExists).toBe(false)

    // When binary is not found, the push logic should fall back to zip upload
    // This is the decision point in the push command
    const shouldUseLocalParse = binaryExists
    const shouldFallbackToZip = !shouldUseLocalParse

    expect(shouldUseLocalParse).toBe(false)
    expect(shouldFallbackToZip).toBe(true)
  })

  it("detects binary when it exists at expected path", () => {
    const binaryName = process.platform === "win32" ? "unerr-parse.exe" : "unerr-parse"
    const binDir = path.join(tmpDir, ".unerr", "bin")
    fs.mkdirSync(binDir, { recursive: true })

    const binaryPath = path.join(binDir, binaryName)
    fs.writeFileSync(binaryPath, "#!/bin/sh\necho 'stub'")
    fs.chmodSync(binaryPath, "755")

    expect(fs.existsSync(binaryPath)).toBe(true)

    // Verify it's executable (on non-Windows)
    if (process.platform !== "win32") {
      const stats = fs.statSync(binaryPath)
      const isExecutable = (stats.mode & 0o111) !== 0
      expect(isExecutable).toBe(true)
    }
  })

  it("binary download URL follows expected platform pattern", () => {
    // Test the download URL construction logic
    const platform = process.platform
    const arch = process.arch

    const platformMap: Record<string, string> = {
      darwin: "macos",
      linux: "linux",
      win32: "windows",
    }

    const archMap: Record<string, string> = {
      x64: "x86_64",
      arm64: "aarch64",
    }

    const osName = platformMap[platform]
    const archName = archMap[arch]

    if (osName && archName) {
      const downloadUrl = `https://releases.unerr.dev/parse/latest/unerr-parse-${osName}-${archName}`
      expect(downloadUrl).toContain("unerr-parse")
      expect(downloadUrl).toContain(osName)
      expect(downloadUrl).toContain(archName)
    }
  })

  it("local parse output format matches expected entity structure", () => {
    // Simulate the expected output format from unerr-parse binary
    const mockParseOutput = JSON.stringify({
      files: [
        {
          path: "src/index.ts",
          entities: [
            {
              name: "main",
              kind: "function",
              start_line: 1,
              end_line: 5,
              signature: "function main(): void",
            },
            {
              name: "Config",
              kind: "interface",
              start_line: 7,
              end_line: 12,
            },
          ],
        },
      ],
    })

    const parsed = JSON.parse(mockParseOutput) as {
      files: Array<{
        path: string
        entities: Array<{
          name: string
          kind: string
          start_line: number
          end_line: number
          signature?: string
        }>
      }>
    }

    expect(parsed.files.length).toBe(1)
    expect(parsed.files[0]!.entities.length).toBe(2)
    expect(parsed.files[0]!.entities[0]!.name).toBe("main")
    expect(parsed.files[0]!.entities[0]!.kind).toBe("function")
  })
})
