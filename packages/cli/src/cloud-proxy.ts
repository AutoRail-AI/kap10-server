/**
 * Cloud Proxy — HTTP client to cloud MCP endpoint.
 *
 * Used for tools that require server-side resources (vector DB, stats).
 * Timeout: 10s, retry: 1
 */

export class CloudProxy {
  private serverUrl: string
  private apiKey: string
  private timeout: number
  private maxRetries: number

  constructor(opts: {
    serverUrl: string
    apiKey: string
    timeout?: number
    maxRetries?: number
  }) {
    this.serverUrl = opts.serverUrl
    this.apiKey = opts.apiKey
    this.timeout = opts.timeout ?? 10_000
    this.maxRetries = opts.maxRetries ?? 1
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.timeout)

        const res = await fetch(`${this.serverUrl}/api/mcp/tool`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({ tool: toolName, args }),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }

        const body = (await res.json()) as { data?: unknown }
        return body.data ?? body
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
    }

    throw lastError ?? new Error("Cloud proxy call failed")
  }
}
