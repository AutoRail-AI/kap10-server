import { describe, expect, it } from "vitest"
import { scrubSecrets, scrubMCPPayload, shannonEntropy } from "../scrubber"

describe("scrubSecrets", () => {
  it("redacts AWS access keys", () => {
    const input = "key = AKIAIOSFODNN7EXAMPLE"
    expect(scrubSecrets(input)).toContain("[REDACTED:aws_key]")
    expect(scrubSecrets(input)).not.toContain("AKIAIOSFODNN7EXAMPLE")
  })

  it("redacts GitHub tokens (classic)", () => {
    const input = "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"
    expect(scrubSecrets(input)).toContain("[REDACTED:github_token]")
  })

  it("redacts GitHub fine-grained tokens", () => {
    const input = `token: github_pat_${"a".repeat(82)}`
    expect(scrubSecrets(input)).toContain("[REDACTED:github_token]")
  })

  it("redacts JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    expect(scrubSecrets(`Bearer ${jwt}`)).toContain("[REDACTED:jwt]")
  })

  it("redacts Slack tokens", () => {
    const input = "token: xoxb-123456789012-123456789012-ABCDEFGHIJKLmnopqrstUVWX"
    expect(scrubSecrets(input)).toContain("[REDACTED:slack_token]")
  })

  it("redacts Stripe keys", () => {
    expect(scrubSecrets("sk_test_abc123def456ghi789jkl012")).toContain("[REDACTED:stripe_key]")
    expect(scrubSecrets("pk_live_abc123def456ghi789jkl012")).toContain("[REDACTED:stripe_key]")
  })

  it("redacts password in key-value context", () => {
    const input = 'password = "hunter2"'
    expect(scrubSecrets(input)).toContain("[REDACTED:password]")
    expect(scrubSecrets(input)).not.toContain("hunter2")
  })

  it("redacts secret in key-value context", () => {
    const input = "secret: my_super_secret_value"
    expect(scrubSecrets(input)).toContain("[REDACTED:password]")
  })

  it("leaves normal code unchanged", () => {
    const input = "function validateCredentials(username: string, password: string) { return true }"
    const result = scrubSecrets(input)
    expect(result).toContain("validateCredentials")
    expect(result).toContain("username")
  })

  it("leaves variable names unchanged", () => {
    const input = "const maxRetries = 5; const baseUrl = 'http://localhost:3000'"
    const result = scrubSecrets(input)
    expect(result).toContain("maxRetries")
    expect(result).toContain("baseUrl")
  })

  it("redacts private key blocks", () => {
    const input = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----"
    expect(scrubSecrets(input)).toContain("[REDACTED:private_key]")
  })
})

describe("scrubMCPPayload", () => {
  it("scrubs nested objects", () => {
    const payload = {
      method: "tools/call",
      params: {
        name: "search_code",
        arguments: {
          query: "AKIAIOSFODNN7EXAMPLE",
        },
      },
    }
    const result = scrubMCPPayload(payload)
    expect((result.params as Record<string, Record<string, string>>).arguments.query).toContain("[REDACTED:aws_key]")
  })

  it("handles null and undefined", () => {
    expect(scrubMCPPayload(null)).toBeNull()
    expect(scrubMCPPayload(undefined)).toBeUndefined()
  })

  it("handles arrays", () => {
    const payload = ["AKIAIOSFODNN7EXAMPLE", "normal text"]
    const result = scrubMCPPayload(payload)
    expect(result[0]).toContain("[REDACTED:aws_key]")
    expect(result[1]).toBe("normal text")
  })
})

describe("shannonEntropy", () => {
  it("returns 0 for empty string", () => {
    expect(shannonEntropy("")).toBe(0)
  })

  it("returns 0 for single char string", () => {
    expect(shannonEntropy("aaaa")).toBe(0)
  })

  it("returns high entropy for random strings", () => {
    const random = "a1B2c3D4e5F6g7H8i9J0kLmNoPqRsT"
    expect(shannonEntropy(random)).toBeGreaterThan(4)
  })

  it("returns low entropy for repetitive strings", () => {
    expect(shannonEntropy("aaabbbccc")).toBeLessThan(2)
  })
})
