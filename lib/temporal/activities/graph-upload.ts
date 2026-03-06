/**
 * Phase 10a: Graph upload activities for sync-local-graph workflow.
 *
 * Activities:
 *   - uploadToStorage: Upload msgpack buffer to Supabase Storage, upsert snapshot metadata
 *   - updateSnapshotStatus: Update snapshot metadata status
 *   - notifyConnectedClients: Publish sync notification via Redis
 */

import { heartbeat } from "@temporalio/activity"
import { getPrisma } from "@/lib/db/prisma"
import { getContainer } from "@/lib/di/container"
import { streamGzip } from "@/lib/utils/stream-compress"
import { logger } from "@/lib/utils/logger"

export interface UploadInput {
  orgId: string
  repoId: string
  buffer: Buffer
  checksum: string
  entityCount: number
  edgeCount: number
}

/**
 * Upload msgpack buffer to Supabase Storage and upsert GraphSnapshotMeta row.
 */
export async function uploadToStorage(input: UploadInput): Promise<{
  storagePath: string
  sizeBytes: number
}> {
  const log = logger.child({ service: "graph-upload", organizationId: input.orgId, repoId: input.repoId })
  log.info("Uploading graph snapshot to storage", { sizeBytes: input.buffer.length, entityCount: input.entityCount, edgeCount: input.edgeCount })
  const { supabase } = require("@/lib/db") as typeof import("@/lib/db")

  const bucketName = process.env.GRAPH_SNAPSHOT_BUCKET ?? "graph-snapshots"
  const storagePath = `${input.orgId}/${input.repoId}.msgpack.gz`

  // Stream-compress via async gzip (event loop stays responsive)
  const { compressed, rawBytes } = await streamGzip(input.buffer)
  // input.buffer is now eligible for GC — only `compressed` (small) remains
  if (global.gc) global.gc()

  log.info("Compressing graph snapshot", {
    rawBytes,
    compressedBytes: compressed.length,
  })

  // Upload compressed to Supabase Storage (upsert mode)
  const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(storagePath, compressed, {
      contentType: "application/gzip",
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`)
  }

  const sizeBytes = compressed.length
  heartbeat(`Uploaded ${sizeBytes} bytes (compressed) to ${storagePath}`)

  // Upsert snapshot metadata via Prisma
  const prisma = getPrisma()

  await prisma.graphSnapshotMeta.upsert({
    where: { repoId: input.repoId },
    create: {
      orgId: input.orgId,
      repoId: input.repoId,
      status: "available",
      checksum: input.checksum,
      storagePath,
      sizeBytes,
      entityCount: input.entityCount,
      edgeCount: input.edgeCount,
      generatedAt: new Date(),
    },
    update: {
      status: "available",
      checksum: input.checksum,
      storagePath,
      sizeBytes,
      entityCount: input.entityCount,
      edgeCount: input.edgeCount,
      generatedAt: new Date(),
    },
  })

  return { storagePath, sizeBytes }
}

/**
 * Update snapshot metadata status (generating, available, failed).
 */
export async function updateSnapshotStatus(input: {
  orgId: string
  repoId: string
  status: "generating" | "available" | "failed"
}): Promise<void> {
  const log = logger.child({ service: "graph-upload", organizationId: input.orgId, repoId: input.repoId })
  log.info("Updating snapshot status", { snapshotStatus: input.status })
  const prisma = getPrisma()

  await prisma.graphSnapshotMeta.upsert({
    where: { repoId: input.repoId },
    create: {
      orgId: input.orgId,
      repoId: input.repoId,
      status: input.status,
    },
    update: {
      status: input.status,
    },
  })
}

/**
 * Notify connected clients of snapshot availability via Redis pub/sub.
 */
export async function notifyConnectedClients(input: {
  orgId: string
  repoId: string
}): Promise<void> {
  try {
    const container = getContainer()
    await container.cacheStore.set(
      `graph-sync:${input.orgId}:${input.repoId}`,
      { status: "available", repoId: input.repoId, timestamp: Date.now() },
      3600
    )
    heartbeat("Notification published")
  } catch {
    // Non-critical — CLI will poll on next check
  }
}
