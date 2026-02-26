/**
 * Edge secret scrubber — processes MCP payloads (inbound and outbound)
 * to redact secrets using regex patterns and Shannon entropy analysis.
 */

interface ScrubPattern {
  name: string
  regex: RegExp
  tag: string
}

const SECRET_PATTERNS: ScrubPattern[] = [
  {
    name: "AWS Access Key",
    regex: /AKIA[0-9A-Z]{16}/g,
    tag: "aws_key",
  },
  {
    name: "AWS Secret Key",
    regex: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/g,
    tag: "aws_secret",
  },
  {
    name: "GitHub Token (classic)",
    regex: /gh[ps]_[A-Za-z0-9_]{36,}/g,
    tag: "github_token",
  },
  {
    name: "GitHub Fine-grained Token",
    regex: /github_pat_[A-Za-z0-9_]{82,}/g,
    tag: "github_token",
  },
  {
    name: "JWT",
    regex: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    tag: "jwt",
  },
  {
    name: "Slack Token",
    regex: /xox[bpors]-[A-Za-z0-9-]+/g,
    tag: "slack_token",
  },
  {
    name: "Stripe Key",
    regex: /(?:sk|pk)_(?:test|live)_[A-Za-z0-9]{20,}/g,
    tag: "stripe_key",
  },
  {
    name: "OpenAI Key",
    regex: /sk-[A-Za-z0-9]{48,}/g,
    tag: "openai_key",
  },
  {
    name: "Anthropic Key",
    regex: /sk-ant-[A-Za-z0-9_-]{90,}/g,
    tag: "anthropic_key",
  },
  {
    name: "Private Key Block",
    regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE KEY-----/g,
    tag: "private_key",
  },
]

/** Key-value patterns for password/secret/token fields */
const KV_PATTERN = /(?:password|secret|token|api_key|apikey|auth_token|access_token|private_key)\s*[=:]\s*["']?([^\s"',;}{]+)["']?/gi

/** Shannon entropy of a string (bits per character) */
function shannonEntropy(s: string): number {
  if (s.length === 0) return 0
  const freq = new Map<string, number>()
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1)
  }
  let entropy = 0
  freq.forEach((count) => {
    const p = count / s.length
    entropy -= p * Math.log2(p)
  })
  return entropy
}

/** Detect high-entropy strings that look like secrets */
const HIGH_ENTROPY_REGEX = /[A-Za-z0-9+/=_-]{20,}/g
const ENTROPY_THRESHOLD = 4.5
const MIN_ENTROPY_LENGTH = 20

/** Common non-secret high-entropy patterns to skip */
const _ENTROPY_ALLOWLIST = new Set([
  // Base64 encoded common strings, UUIDs, etc. are fine
])

function isLikelySecret(token: string): boolean {
  if (token.length < MIN_ENTROPY_LENGTH) return false
  // Skip things that look like file paths, URLs, or common base64 patterns
  if (token.includes("/") || token.includes("\\")) return false
  if (token.startsWith("http")) return false
  // Skip common programming tokens
  if (/^[a-z_]+$/i.test(token)) return false // all lowercase or underscores = variable names
  if (/^[A-Z_]+$/.test(token)) return false // all uppercase = constants
  return shannonEntropy(token) > ENTROPY_THRESHOLD
}

/**
 * Scrub secrets from a string payload.
 * Returns the scrubbed string with `[REDACTED:{type}]` replacements.
 */
export function scrubSecrets(input: string): string {
  let result = input

  // Apply known secret patterns
  for (const pattern of SECRET_PATTERNS) {
    // Reset regex lastIndex for safety
    pattern.regex.lastIndex = 0
    result = result.replace(pattern.regex, `[REDACTED:${pattern.tag}]`)
  }

  // Apply key-value patterns (password = "hunter2" → password = "[REDACTED:password]")
  result = result.replace(KV_PATTERN, (match, value: string) => {
    if (!value || value.length < 3) return match
    // Skip if value was already redacted by a specific pattern above
    if (value.includes("REDACTED")) return match
    return match.replace(value, "[REDACTED:password]")
  })

  // Apply high-entropy detection
  // We need to re-scan after pattern replacement to avoid double-redacting
  const remaining = result
  const tokens = remaining.match(HIGH_ENTROPY_REGEX)
  if (tokens) {
    for (const token of tokens) {
      // Skip already redacted tokens
      if (token.includes("REDACTED")) continue
      if (isLikelySecret(token)) {
        result = result.replace(token, "[REDACTED:high_entropy]")
      }
    }
  }

  return result
}

/**
 * Scrub an MCP payload object (deep clone + string scrubbing).
 * Processes all string values recursively.
 */
export function scrubMCPPayload<T>(payload: T): T {
  if (payload === null || payload === undefined) return payload
  if (typeof payload === "string") return scrubSecrets(payload) as T
  if (Array.isArray(payload)) return payload.map((item) => scrubMCPPayload(item)) as T
  if (typeof payload === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      result[key] = scrubMCPPayload(value)
    }
    return result as T
  }
  return payload
}

export { shannonEntropy }
