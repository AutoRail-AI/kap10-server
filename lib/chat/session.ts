const SESSION_KEY = "appealgen_session_id"

/**
 * Get or create a session ID for anonymous users
 * Stored in localStorage for persistence across page reloads
 */
export function getSessionId(): string {
  if (typeof window === "undefined") {
    // Server-side: return empty string, will be handled by client
    return ""
  }

  let sessionId = localStorage.getItem(SESSION_KEY)

  if (!sessionId) {
    sessionId = crypto.randomUUID()
    localStorage.setItem(SESSION_KEY, sessionId)
  }

  return sessionId
}

/**
 * Clear the session ID (useful for testing or logout)
 */
export function clearSessionId(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem(SESSION_KEY)
}

/**
 * Check if a session ID exists
 */
export function hasSessionId(): boolean {
  if (typeof window === "undefined") return false
  return localStorage.getItem(SESSION_KEY) !== null
}

/**
 * Generate a new session ID (force regeneration)
 */
export function regenerateSessionId(): string {
  if (typeof window === "undefined") return ""
  const sessionId = crypto.randomUUID()
  localStorage.setItem(SESSION_KEY, sessionId)
  return sessionId
}
