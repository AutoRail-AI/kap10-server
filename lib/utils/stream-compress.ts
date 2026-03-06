import { createGzip } from "node:zlib"
import { Readable } from "node:stream"

/**
 * Stream-compress a buffer using gzip with async iteration.
 *
 * How it works:
 *   1. `Readable.from(raw)` creates a pull-based stream from the buffer
 *   2. `.pipe(createGzip())` compresses in 16KB internal chunks
 *   3. `for await` yields to the event loop between each compressed chunk
 *   4. Compressed chunks (~3MB total) are collected in an array, then concatenated
 *
 * Why this is better than gzipAsync/gzipSync:
 *   - gzipSync blocks the event loop for seconds on large buffers
 *   - gzipAsync uses the libuv threadpool but still allocates raw + compressed simultaneously
 *   - This approach yields to the event loop and only accumulates the small compressed output
 *
 * Adaptive compression level:
 *   - Level 1 for buffers >10MB (3-5x faster, ~5% worse ratio on binary msgpack)
 *   - Level 6 for smaller buffers (better ratio, still fast)
 */
export async function streamGzip(
  raw: Buffer,
  level?: number,
): Promise<{ compressed: Buffer; rawBytes: number }> {
  const rawBytes = raw.length
  const compressionLevel = level ?? (rawBytes > 10 * 1024 * 1024 ? 1 : 6)

  const chunks: Buffer[] = []
  const gzipStream = Readable.from(raw).pipe(createGzip({ level: compressionLevel }))

  for await (const chunk of gzipStream) {
    chunks.push(chunk as Buffer)
  }

  return { compressed: Buffer.concat(chunks), rawBytes }
}
