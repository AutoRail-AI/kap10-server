/**
 * IStorageProvider — 12th port.
 * Abstraction over file storage (Supabase Storage in production, in-memory for tests).
 */

export interface IStorageProvider {
  /** Generate a pre-signed upload URL for a file path */
  generateUploadUrl(bucket: string, path: string, expiresInSeconds?: number): Promise<{ url: string; token: string }>
  /** Download a file as a Buffer */
  downloadFile(bucket: string, path: string): Promise<Buffer>
  /** Delete a file */
  deleteFile(bucket: string, path: string): Promise<void>
  /** Health check */
  healthCheck(): Promise<{ status: "up" | "down"; latencyMs?: number }>
}
