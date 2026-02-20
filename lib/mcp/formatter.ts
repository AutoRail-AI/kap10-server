/**
 * Semantic truncation formatter for MCP tool responses.
 * Ensures all responses fit within LLM context windows (default 32KB).
 *
 * Truncation priority (highest preserved first):
 * 1. Entity name + signature
 * 2. File path + line number
 * 3. Callers/callees (capped at 20 each)
 * 4. Body/source code (truncated at function boundaries)
 */

const DEFAULT_MAX_BYTES = parseInt(process.env.MCP_MAX_RESPONSE_BYTES ?? "32768", 10)

interface TruncationOptions {
  maxBytes?: number
}

/**
 * Measure byte length of a string (UTF-8).
 */
function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8")
}

/**
 * Truncate a code body at function/statement boundaries.
 * Finds the last complete line before the byte limit.
 */
function truncateBody(body: string, maxBytes: number): string {
  if (byteLength(body) <= maxBytes) return body

  const lines = body.split("\n")
  let currentSize = 0
  const kept: string[] = []

  for (const line of lines) {
    const lineBytes = byteLength(line + "\n")
    if (currentSize + lineBytes > maxBytes) break
    kept.push(line)
    currentSize += lineBytes
  }

  return kept.join("\n")
}

/**
 * Truncate an array of items to a maximum count and annotate.
 */
function truncateArray<T>(items: T[], maxCount: number): { items: T[]; truncated: boolean } {
  if (items.length <= maxCount) return { items, truncated: false }
  return { items: items.slice(0, maxCount), truncated: true }
}

/**
 * Apply semantic truncation to an MCP tool result.
 * The result is a JSON object that will be serialized.
 */
export function truncateToolResult(
  result: Record<string, unknown>,
  options: TruncationOptions = {}
): Record<string, unknown> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  // Quick check: if already small enough, return as-is
  const serialized = JSON.stringify(result)
  if (byteLength(serialized) <= maxBytes) return result

  const truncated = { ...result }

  // Step 1: Cap callers/callees arrays at 20 items
  if (Array.isArray(truncated.callers)) {
    const { items, truncated: wasTruncated } = truncateArray(
      truncated.callers as unknown[],
      20
    )
    truncated.callers = items
    if (wasTruncated) {
      truncated._callersTruncated = true
    }
  }
  if (Array.isArray(truncated.callees)) {
    const { items, truncated: wasTruncated } = truncateArray(
      truncated.callees as unknown[],
      20
    )
    truncated.callees = items
    if (wasTruncated) {
      truncated._calleesTruncated = true
    }
  }

  // Step 2: Cap results arrays at 50
  if (Array.isArray(truncated.results)) {
    const { items, truncated: wasTruncated } = truncateArray(
      truncated.results as unknown[],
      50
    )
    truncated.results = items
    if (wasTruncated) {
      truncated._resultsTruncated = true
    }
  }

  // Step 3: Cap imports/entities arrays
  if (Array.isArray(truncated.imports)) {
    const { items, truncated: wasTruncated } = truncateArray(
      truncated.imports as unknown[],
      30
    )
    truncated.imports = items
    if (wasTruncated) {
      truncated._importsTruncated = true
    }
  }
  if (Array.isArray(truncated.entities)) {
    const { items, truncated: wasTruncated } = truncateArray(
      truncated.entities as unknown[],
      50
    )
    truncated.entities = items
    if (wasTruncated) {
      truncated._entitiesTruncated = true
    }
  }

  // Check size again
  let currentSerialized = JSON.stringify(truncated)
  if (byteLength(currentSerialized) <= maxBytes) return truncated

  // Step 4: Truncate body/source code fields
  const bodyFields = ["body", "source", "content", "code"]
  for (const field of bodyFields) {
    if (typeof truncated[field] === "string") {
      const bodyStr = truncated[field] as string
      const overhead = byteLength(currentSerialized) - byteLength(bodyStr)
      const bodyBudget = Math.max(maxBytes - overhead - 200, 500)
      truncated[field] = truncateBody(bodyStr, bodyBudget)
    }
  }

  // Also truncate body fields inside nested objects (function.body, etc.)
  for (const key of Object.keys(truncated)) {
    const val = truncated[key]
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = val as Record<string, unknown>
      for (const field of bodyFields) {
        if (typeof nested[field] === "string") {
          const bodyStr = nested[field] as string
          if (byteLength(bodyStr) > 2000) {
            nested[field] = truncateBody(bodyStr, 2000)
          }
        }
      }
    }
  }

  // Final check
  currentSerialized = JSON.stringify(truncated)
  if (byteLength(currentSerialized) > maxBytes) {
    truncated._hint = "[truncated — call get_function with specific name for full details]"
  }

  return truncated
}

/**
 * Format a tool result for MCP response.
 * Applies truncation and wraps in MCP content format.
 */
export function formatToolResponse(
  result: Record<string, unknown>,
  options: TruncationOptions = {}
): { content: Array<{ type: "text"; text: string }> } {
  const truncated = truncateToolResult(result, options)
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(truncated, null, 2),
      },
    ],
  }
}

/**
 * Format a tool error for MCP response.
 */
export function formatToolError(
  message: string
): { isError: true; content: Array<{ type: "text"; text: string }> } {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: message,
      },
    ],
  }
}
