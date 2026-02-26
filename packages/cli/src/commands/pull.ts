/**
 * unerr pull — Download graph snapshot for a repo.
 *
 * Fetches pre-signed URL from server, downloads msgpack, verifies checksum,
 * stores in ~/.unerr/snapshots/{repoId}.msgpack with manifest.
 */

import { Command } from "commander"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { getCredentials } from "./auth.js"

const UNERR_DIR = join(homedir(), ".unerr")
const SNAPSHOTS_DIR = join(UNERR_DIR, "snapshots")
const MANIFESTS_DIR = join(UNERR_DIR, "manifests")

export interface SnapshotManifest {
  repoId: string
  checksum: string
  sizeBytes: number
  entityCount: number
  edgeCount: number
  ruleCount?: number
  patternCount?: number
  snapshotVersion?: number
  generatedAt: string | null
  pulledAt: string
  snapshotPath: string
}

export function getManifest(repoId: string): SnapshotManifest | null {
  const path = join(MANIFESTS_DIR, `${repoId}.json`)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SnapshotManifest
  } catch {
    return null
  }
}

export function getSnapshotBuffer(repoId: string): Buffer | null {
  const manifest = getManifest(repoId)
  if (!manifest) return null
  if (!existsSync(manifest.snapshotPath)) return null
  return readFileSync(manifest.snapshotPath)
}

export function registerPullCommand(program: Command): void {
  program
    .command("pull")
    .description("Download graph snapshot for a repo")
    .requiredOption("--repo <repoId>", "Repository ID")
    .option("--force", "Force re-download even if up to date")
    .action(async (opts: { repo: string; force?: boolean }) => {
      const creds = getCredentials()
      if (!creds) {
        console.error("Not authenticated. Run: unerr auth login")
        process.exit(1)
      }

      const { repo: repoId, force } = opts

      // Check existing manifest
      if (!force) {
        const existing = getManifest(repoId)
        if (existing) {
          console.log(`Existing snapshot found (${existing.checksum.slice(0, 8)}...)`)
        }
      }

      // Step 1: Get download URL
      console.log("Fetching download URL...")
      const metaRes = await fetch(`${creds.serverUrl}/api/graph-snapshots/${repoId}/download`, {
        headers: { Authorization: `Bearer ${creds.apiKey}` },
      })

      if (!metaRes.ok) {
        const body = (await metaRes.json().catch(() => ({}))) as { error?: string }
        console.error(`Failed to get download URL: ${body.error ?? metaRes.statusText}`)
        process.exit(1)
      }

      const meta = (await metaRes.json()) as {
        data: {
          url: string
          checksum: string
          entityCount: number
          edgeCount: number
          sizeBytes: number
          generatedAt: string | null
        }
      }

      const { url, checksum, entityCount, edgeCount, sizeBytes, generatedAt } = meta.data

      // Check if already up to date
      if (!force) {
        const existing = getManifest(repoId)
        if (existing && existing.checksum === checksum) {
          console.log("Snapshot is already up to date.")
          return
        }
      }

      // Step 2: Download
      console.log(`Downloading snapshot (${(sizeBytes / 1024).toFixed(1)} KB)...`)
      const downloadRes = await fetch(url)
      if (!downloadRes.ok) {
        console.error("Download failed")
        process.exit(1)
      }

      const buffer = Buffer.from(await downloadRes.arrayBuffer())

      // Step 3: Verify checksum
      console.log("Verifying checksum...")
      const computedChecksum = createHash("sha256").update(buffer).digest("hex")
      if (computedChecksum !== checksum) {
        console.error(`Checksum mismatch! Expected ${checksum.slice(0, 8)}..., got ${computedChecksum.slice(0, 8)}...`)
        process.exit(1)
      }

      // Step 4: Save snapshot
      mkdirSync(SNAPSHOTS_DIR, { recursive: true })
      mkdirSync(MANIFESTS_DIR, { recursive: true })

      const snapshotPath = join(SNAPSHOTS_DIR, `${repoId}.msgpack`)
      writeFileSync(snapshotPath, buffer)

      // Step 5: Detect v2 envelope (rules/patterns)
      let ruleCount = 0
      let patternCount = 0
      let snapshotVersion = 1
      try {
        const { unpack } = await import("msgpackr")
        const envelope = unpack(buffer) as { version?: number; rules?: unknown[]; patterns?: unknown[] }
        snapshotVersion = envelope.version ?? 1
        ruleCount = envelope.rules?.length ?? 0
        patternCount = envelope.patterns?.length ?? 0
      } catch {
        // Parse failure — use defaults
      }

      // Step 6: Save manifest
      const manifest: SnapshotManifest = {
        repoId,
        checksum,
        sizeBytes: buffer.length,
        entityCount,
        edgeCount,
        ruleCount,
        patternCount,
        snapshotVersion,
        generatedAt,
        pulledAt: new Date().toISOString(),
        snapshotPath,
      }
      writeFileSync(join(MANIFESTS_DIR, `${repoId}.json`), JSON.stringify(manifest, null, 2))

      const v2Info = snapshotVersion >= 2 ? `, ${ruleCount} rules, ${patternCount} patterns` : ""
      console.log(`Done! ${entityCount} entities, ${edgeCount} edges${v2Info}`)
      console.log(`Saved to ${snapshotPath}`)
    })
}
