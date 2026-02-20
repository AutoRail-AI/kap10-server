/**
 * Phase 10a: Graph upload activities for sync-local-graph workflow.
 *
 * Activities:
 *   - uploadToStorage: Upload msgpack buffer to Supabase Storage, upsert snapshot metadata
 *   - updateSnapshotStatus: Update snapshot metadata status
 *   - notifyConnectedClients: Publish sync notification via Redis
 */

import { heartbeat } from "@temporalio/activity"
import { getContainer } from "@/lib/di/container"

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
  const { supabase } = require("@/lib/db") as typeof import("@/lib/db")

  const bucketName = process.env.GRAPH_SNAPSHOT_BUCKET ?? "graph-snapshots"
  const storagePath = `${input.orgId}/${input.repoId}.msgpack`

  // Upload to Supabase Storage (upsert mode)
  const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(storagePath, input.buffer, {
      contentType: "application/x-msgpack",
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`)
  }

  heartbeat(`Uploaded ${input.buffer.length} bytes to ${storagePath}`)

  // Upsert snapshot metadata via Prisma
  const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client")
  const prisma = new PrismaClient()

  try {
    await prisma.graphSnapshotMeta.upsert({
      where: { repoId: input.repoId },
      create: {
        orgId: input.orgId,
        repoId: input.repoId,
        status: "available",
        checksum: input.checksum,
        storagePath,
        sizeBytes: input.buffer.length,
        entityCount: input.entityCount,
        edgeCount: input.edgeCount,
        generatedAt: new Date(),
      },
      update: {
        status: "available",
        checksum: input.checksum,
        storagePath,
        sizeBytes: input.buffer.length,
        entityCount: input.entityCount,
        edgeCount: input.edgeCount,
        generatedAt: new Date(),
      },
    })
  } finally {
    await prisma.$disconnect()
  }

  return { storagePath, sizeBytes: input.buffer.length }
}

/**
 * Update snapshot metadata status (generating, available, failed).
 */
export async function updateSnapshotStatus(input: {
  orgId: string
  repoId: string
  status: "generating" | "available" | "failed"
}): Promise<void> {
  const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client")
  const prisma = new PrismaClient()

  try {
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
  } finally {
    await prisma.$disconnect()
  }
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
