import "./chunk-3RG5ZIWI.js";

// src/prefetch.ts
var PrefetchManager = class {
  serverUrl;
  apiKey;
  debounceMs;
  minIntervalMs;
  timer = null;
  lastSentAt = 0;
  disposed = false;
  constructor(opts) {
    this.serverUrl = opts.serverUrl;
    this.apiKey = opts.apiKey;
    this.debounceMs = opts.debounceMs ?? 500;
    this.minIntervalMs = opts.minIntervalMs ?? 500;
  }
  /**
   * Called on cursor change. Debounces and rate-limits before firing.
   */
  onCursorChange(context) {
    if (this.disposed) return;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.firePrefetch(context);
    }, this.debounceMs);
  }
  /**
   * Fire the prefetch request. Rate-limited and fire-and-forget.
   */
  firePrefetch(context) {
    const now = Date.now();
    if (now - this.lastSentAt < this.minIntervalMs) return;
    this.lastSentAt = now;
    fetch(`${this.serverUrl}/api/prefetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        filePath: context.filePath,
        line: context.line,
        entityKey: context.entityKey,
        repoId: context.repoId
      }),
      signal: AbortSignal.timeout(5e3)
    }).catch(() => {
    });
  }
  /**
   * Clean up timers.
   */
  dispose() {
    this.disposed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
};
export {
  PrefetchManager
};
