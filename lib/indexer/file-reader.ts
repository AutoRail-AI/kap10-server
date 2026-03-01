/**
 * K-07: Encoding-aware file reader for the indexing pipeline.
 *
 * Reads the first 4KB as a raw Buffer, detects likely encoding,
 * and re-reads with the detected encoding if not UTF-8.
 *
 * Handles:
 *   - UTF-8 (with and without BOM)
 *   - Latin-1 / CP-1252 (common in legacy codebases)
 *   - Binary files (detected and skipped)
 *
 * Falls back to UTF-8 with replacement characters for unknown encodings.
 */

import { readFileSync } from "node:fs"

/** Maximum bytes to probe for encoding detection. */
const PROBE_SIZE = 4096

/**
 * Read a source file with automatic encoding detection.
 * Returns null for binary files (files with null bytes).
 */
export function readFileWithEncoding(absolutePath: string): { content: string; encoding: string } | null {
  const probe = readFileSync(absolutePath).subarray(0, PROBE_SIZE)

  // Binary detection: null bytes indicate a binary file (not source code)
  if (probe.includes(0x00)) {
    return null
  }

  // UTF-8 BOM: strip and read as UTF-8
  if (probe[0] === 0xef && probe[1] === 0xbb && probe[2] === 0xbf) {
    const content = readFileSync(absolutePath, "utf-8")
    // Strip BOM
    return { content: content.charCodeAt(0) === 0xfeff ? content.slice(1) : content, encoding: "utf-8-bom" }
  }

  // Check if the file is valid UTF-8 by looking for invalid sequences
  if (isLikelyUTF8(probe)) {
    return { content: readFileSync(absolutePath, "utf-8"), encoding: "utf-8" }
  }

  // Not valid UTF-8 — read as Latin-1 (ISO-8859-1), which maps bytes 1:1
  // This handles CP-1252, Latin-1, and other single-byte Western encodings.
  return { content: readFileSync(absolutePath, "latin1"), encoding: "latin1" }
}

/**
 * Check if a buffer is likely valid UTF-8.
 *
 * Scans for bytes in the 0x80-0xFF range (non-ASCII) and validates
 * that they form proper UTF-8 multi-byte sequences. If any invalid
 * sequences are found, the file is likely Latin-1 or another encoding.
 */
function isLikelyUTF8(buf: Buffer): boolean {
  let i = 0
  let highByteCount = 0
  let invalidCount = 0

  while (i < buf.length) {
    const b = buf[i]!
    if (b < 0x80) {
      // ASCII — always valid
      i++
      continue
    }

    highByteCount++

    // 2-byte sequence: 110xxxxx 10xxxxxx
    if ((b & 0xe0) === 0xc0) {
      if (i + 1 >= buf.length || (buf[i + 1]! & 0xc0) !== 0x80) {
        invalidCount++
        i++
        continue
      }
      i += 2
      continue
    }

    // 3-byte sequence: 1110xxxx 10xxxxxx 10xxxxxx
    if ((b & 0xf0) === 0xe0) {
      if (i + 2 >= buf.length || (buf[i + 1]! & 0xc0) !== 0x80 || (buf[i + 2]! & 0xc0) !== 0x80) {
        invalidCount++
        i++
        continue
      }
      i += 3
      continue
    }

    // 4-byte sequence: 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
    if ((b & 0xf8) === 0xf0) {
      if (i + 3 >= buf.length || (buf[i + 1]! & 0xc0) !== 0x80 || (buf[i + 2]! & 0xc0) !== 0x80 || (buf[i + 3]! & 0xc0) !== 0x80) {
        invalidCount++
        i++
        continue
      }
      i += 4
      continue
    }

    // Invalid leading byte (0x80-0xBF or 0xF8-0xFF)
    invalidCount++
    i++
  }

  // If no high bytes at all, it's pure ASCII (valid UTF-8)
  if (highByteCount === 0) return true

  // If more than 20% of high-byte sequences are invalid UTF-8, it's likely Latin-1
  return invalidCount / highByteCount < 0.2
}
