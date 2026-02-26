/**
 * SupabaseStorageAdapter — IStorageProvider implementation using Supabase Storage.
 * Lazy-loaded to avoid connecting during Next.js build.
 */

import type { IStorageProvider } from "@/lib/ports/storage-provider"

let supabaseClient: ReturnType<typeof getSupabaseAdmin> | null = null

function getSupabaseAdmin() {
  const { createClient } = require("@supabase/supabase-js") as typeof import("@supabase/supabase-js")
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? ""
  return createClient(url, key)
}

function getClient() {
  if (!supabaseClient) {
    supabaseClient = getSupabaseAdmin()
  }
  return supabaseClient
}

export class SupabaseStorageAdapter implements IStorageProvider {
  async generateUploadUrl(
    bucket: string,
    path: string,
    _expiresInSeconds = 3600
  ): Promise<{ url: string; token: string }> {
    const client = getClient()
    const { data, error } = await client.storage
      .from(bucket)
      .createSignedUploadUrl(path)

    if (error) throw new Error(`Storage upload URL error: ${error.message}`)
    return {
      url: data.signedUrl,
      token: data.token,
    }
  }

  async downloadFile(bucket: string, path: string): Promise<Buffer> {
    const client = getClient()
    const { data, error } = await client.storage
      .from(bucket)
      .download(path)

    if (error) throw new Error(`Storage download error: ${error.message}`)
    const arrayBuffer = await data.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  async deleteFile(bucket: string, path: string): Promise<void> {
    const client = getClient()
    const { error } = await client.storage
      .from(bucket)
      .remove([path])

    if (error) throw new Error(`Storage delete error: ${error.message}`)
  }

  async healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }> {
    const start = Date.now()
    try {
      const client = getClient()
      await client.storage.listBuckets()
      return { status: "up", latencyMs: Date.now() - start }
    } catch {
      return { status: "down", latencyMs: Date.now() - start }
    }
  }
}
