import "./chunk-3RG5ZIWI.js";

// src/cloud-proxy.ts
var CloudProxy = class {
  serverUrl;
  apiKey;
  timeout;
  maxRetries;
  constructor(opts) {
    this.serverUrl = opts.serverUrl;
    this.apiKey = opts.apiKey;
    this.timeout = opts.timeout ?? 1e4;
    this.maxRetries = opts.maxRetries ?? 1;
  }
  async callTool(toolName, args) {
    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        const res = await fetch(`${this.serverUrl}/api/mcp/tool`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({ tool: toolName, args }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
          const body2 = await res.json().catch(() => ({}));
          throw new Error(body2.error ?? `HTTP ${res.status}`);
        }
        const body = await res.json();
        return body.data ?? body;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, 1e3));
        }
      }
    }
    throw lastError ?? new Error("Cloud proxy call failed");
  }
};
export {
  CloudProxy
};
