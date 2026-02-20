/**
 * kap10 serve — Start local MCP server with graph query tools.
 *
 * Reads pulled snapshot from ~/.kap10/snapshots, loads into CozoDB,
 * starts stdio MCP server with all 11 tools via query router.
 */

import { Command } from "commander"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { getCredentials } from "./auth.js"
import { getManifest } from "./pull.js"
import { isSnapshotStale, getStalenessInfo } from "../auto-sync.js"

const KAP10_DIR = join(homedir(), ".kap10")
const SNAPSHOTS_DIR = join(KAP10_DIR, "snapshots")
const MANIFESTS_DIR = join(KAP10_DIR, "manifests")

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start local MCP server")
    .option("--repo <repoId>", "Specific repo to serve (default: all pulled repos)")
    .action(async (opts: { repo?: string }) => {
      const creds = getCredentials()
      if (!creds) {
        console.error("Not authenticated. Run: kap10 auth login")
        process.exit(1)
      }

      // Find available snapshots
      let repoIds: string[] = []
      if (opts.repo) {
        repoIds = [opts.repo]
      } else {
        // Discover all pulled repos from manifests
        if (existsSync(MANIFESTS_DIR)) {
          repoIds = readdirSync(MANIFESTS_DIR)
            .filter((f) => f.endsWith(".json"))
            .map((f) => f.replace(".json", ""))
        }
      }

      if (repoIds.length === 0) {
        console.error("No snapshots found. Run: kap10 pull --repo <repoId>")
        process.exit(1)
      }

      // Check staleness
      for (const repoId of repoIds) {
        const info = getStalenessInfo(repoId)
        if (info.isStale) {
          console.warn(`Warning: Snapshot for ${repoId} is ${info.ageHours}h old (stale). Run: kap10 pull --repo ${repoId}`)
        }
      }

      // Load CozoDB
      console.log("Initializing CozoDB...")
      let CozoDb: unknown
      try {
        const cozoModule = await import("cozo-node")
        CozoDb = (cozoModule as { default?: { CozoDb: unknown }; CozoDb?: unknown }).default
          ? (cozoModule as { default: { CozoDb: unknown } }).default.CozoDb
          : (cozoModule as { CozoDb: unknown }).CozoDb
      } catch (err: unknown) {
        console.error("Failed to load cozo-node. Install it: npm install cozo-node")
        console.error(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = new (CozoDb as any)() as import("../cozo-schema.js").CozoDb

      const { CozoGraphStore } = await import("../local-graph.js")
      const localGraph = new CozoGraphStore(db)

      // Load snapshots
      for (const repoId of repoIds) {
        const manifest = getManifest(repoId)
        if (!manifest) {
          console.warn(`No manifest for ${repoId}, skipping`)
          continue
        }

        const snapshotPath = join(SNAPSHOTS_DIR, `${repoId}.msgpack`)
        if (!existsSync(snapshotPath)) {
          console.warn(`Snapshot file not found for ${repoId}, skipping`)
          continue
        }

        console.log(`Loading snapshot for ${repoId}...`)
        const { unpack } = await import("msgpackr")
        const buffer = readFileSync(snapshotPath)
        const envelope = unpack(buffer) as import("../local-graph.js").SnapshotEnvelope
        localGraph.loadSnapshot(envelope)
        console.log(`Loaded ${manifest.entityCount} entities, ${manifest.edgeCount} edges`)
      }

      // Create cloud proxy
      const { CloudProxy } = await import("../cloud-proxy.js")
      const cloudProxy = new CloudProxy({
        serverUrl: creds.serverUrl,
        apiKey: creds.apiKey,
      })

      // Create query router
      const { QueryRouter } = await import("../query-router.js")
      const router = new QueryRouter(localGraph, cloudProxy)

      // Start stdio MCP server
      console.log("Starting MCP server on stdio...")
      const { Server } = await import("@modelcontextprotocol/sdk/server/index.js")
      const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js")

      const server = new Server(
        { name: "kap10-local", version: "0.1.0" },
        { capabilities: { tools: {} } }
      )

      // Register tool list handler
      const toolDefinitions = [
        { name: "get_function", description: "Get function details by key", inputSchema: { type: "object" as const, properties: { key: { type: "string" } }, required: ["key"] } },
        { name: "get_class", description: "Get class details by key", inputSchema: { type: "object" as const, properties: { key: { type: "string" } }, required: ["key"] } },
        { name: "get_file", description: "Get file entities by key", inputSchema: { type: "object" as const, properties: { key: { type: "string" } }, required: ["key"] } },
        { name: "get_callers", description: "Get callers of an entity", inputSchema: { type: "object" as const, properties: { key: { type: "string" } }, required: ["key"] } },
        { name: "get_callees", description: "Get callees of an entity", inputSchema: { type: "object" as const, properties: { key: { type: "string" } }, required: ["key"] } },
        { name: "get_imports", description: "Get imports for a file", inputSchema: { type: "object" as const, properties: { file_path: { type: "string" } }, required: ["file_path"] } },
        { name: "search_code", description: "Search code entities by name", inputSchema: { type: "object" as const, properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
        { name: "semantic_search", description: "Semantic search (cloud)", inputSchema: { type: "object" as const, properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } },
        { name: "find_similar", description: "Find similar entities (cloud)", inputSchema: { type: "object" as const, properties: { key: { type: "string" }, limit: { type: "number" } }, required: ["key"] } },
        { name: "get_project_stats", description: "Get project stats (cloud)", inputSchema: { type: "object" as const, properties: {} } },
        { name: "sync_local_diff", description: "Sync local changes (cloud)", inputSchema: { type: "object" as const, properties: { diff: { type: "string" } }, required: ["diff"] } },
      ]

      server.setRequestHandler(
        { method: "tools/list" } as { method: string },
        async () => ({ tools: toolDefinitions })
      )

      server.setRequestHandler(
        { method: "tools/call" } as { method: string },
        async (request: { params: { name: string; arguments?: Record<string, unknown> } }) => {
          const { name, arguments: args = {} } = request.params
          const result = await router.execute(name, args)
          return {
            content: [{ type: "text", text: JSON.stringify(result.content, null, 2) }],
            _meta: result._meta,
          }
        }
      )

      const transport = new StdioServerTransport()
      await server.connect(transport)
      console.error("kap10 MCP server running on stdio")
    })
}
