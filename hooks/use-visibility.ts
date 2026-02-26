"use client"

import { useSyncExternalStore } from "react"

/**
 * Returns `true` when the browser tab/window is visible.
 * All polling hooks should gate their intervals on this —
 * no point burning requests while the user is in another tab.
 */

function subscribe(callback: () => void): () => void {
  document.addEventListener("visibilitychange", callback)
  return () => document.removeEventListener("visibilitychange", callback)
}

function getSnapshot(): boolean {
  return document.visibilityState === "visible"
}

function getServerSnapshot(): boolean {
  return true
}

export function useVisibility(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
