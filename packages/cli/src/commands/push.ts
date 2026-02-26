/**
 * unerr push — .gitignore-aware zip upload + trigger indexing.
 */
import { Command } from "commander"
import * as fs from "node:fs"
import * as path from "node:path"
import { getCredentials } from "./auth.js"

function loadConfig(): { repoId: string; serverUrl: string; orgId: string } | null {
  const configPath = path.join(process.cwd(), ".unerr", "config.json")
  if (!fs.existsSync(configPath)) return null
  const raw = fs.readFileSync(configPath, "utf-8")
  return JSON.parse(raw) as { repoId: string; serverUrl: string; orgId: string }
}

export function registerPushCommand(program: Command): void {
  program
    .command("push")
    .description("Upload local repository for indexing")
    .option("--local-parse", "Use local AST extraction (requires unerr-parse binary)")
    .action(async (_opts: { localParse?: boolean }) => {
      try {
        const config = loadConfig()
        if (!config) {
          console.error("Not initialized. Run: unerr init")
          process.exit(1)
        }

        const creds = getCredentials()
        if (!creds?.apiKey) {
          console.error("Not authenticated. Run: unerr auth login")
          process.exit(1)
        }

        console.log("Preparing upload...")

        // Phase 1: Request upload URL
        const uploadRes = await fetch(`${config.serverUrl}/api/cli/index`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${creds.apiKey}`,
          },
          body: JSON.stringify({
            phase: "request_upload",
            repoId: config.repoId,
          }),
        })

        if (!uploadRes.ok) {
          const body = (await uploadRes.json()) as { error?: string }
          console.error(`Upload request failed: ${body.error ?? uploadRes.statusText}`)
          process.exit(1)
        }

        const { uploadUrl, uploadPath } = (await uploadRes.json()) as {
          uploadUrl: string
          uploadPath: string
        }

        // Create .gitignore-aware zip using archiver
        const archiver = (await import("archiver")).default
        const ignore = (await import("ignore")).default

        // Load .gitignore patterns
        const gitignorePath = path.join(process.cwd(), ".gitignore")
        const ig = ignore()
        ig.add([".git", ".unerr", "node_modules"])
        if (fs.existsSync(gitignorePath)) {
          ig.add(fs.readFileSync(gitignorePath, "utf-8"))
        }

        // Create zip buffer
        const archive = archiver("zip", { zlib: { level: 6 } })
        const chunks: Buffer[] = []

        archive.on("data", (chunk: Buffer) => chunks.push(chunk))

        // Walk directory and add non-ignored files
        function walkDir(dir: string, relativeTo: string) {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            const relPath = path.relative(relativeTo, fullPath)
            if (ig.ignores(relPath)) continue
            if (entry.isDirectory()) {
              walkDir(fullPath, relativeTo)
            } else if (entry.isFile()) {
              archive.file(fullPath, { name: relPath })
            }
          }
        }

        walkDir(process.cwd(), process.cwd())
        await archive.finalize()

        // Wait for all chunks
        await new Promise<void>((resolve) => archive.on("end", resolve))
        const zipBuffer = Buffer.concat(chunks)

        console.log(`Uploading ${(zipBuffer.length / 1024 / 1024).toFixed(1)}MB...`)

        // Upload zip
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/zip" },
          body: zipBuffer,
        })

        if (!putRes.ok) {
          console.error(`Upload failed: ${putRes.statusText}`)
          process.exit(1)
        }

        // Phase 2: Trigger indexing
        const triggerRes = await fetch(`${config.serverUrl}/api/cli/index`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${creds.apiKey}`,
          },
          body: JSON.stringify({
            phase: "trigger_index",
            repoId: config.repoId,
            uploadPath,
          }),
        })

        if (!triggerRes.ok) {
          const body = (await triggerRes.json()) as { error?: string }
          console.error(`Index trigger failed: ${body.error ?? triggerRes.statusText}`)
          process.exit(1)
        }

        const triggerResult = (await triggerRes.json()) as { workflowId: string }
        console.log(`Indexing started (workflow: ${triggerResult.workflowId})`)
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`Error: ${message}`)
        process.exit(1)
      }
    })
}
