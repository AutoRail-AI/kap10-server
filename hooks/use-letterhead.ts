"use client"

import { useState, useCallback, useEffect } from "react"
import type { LetterheadSettings } from "@/lib/types/letterhead"

interface UseLetterheadOptions {
  initialFetch?: boolean
}

export function useLetterhead(options: UseLetterheadOptions = { initialFetch: true }) {
  const [letterhead, setLetterhead] = useState<LetterheadSettings | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchLetterhead = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/letterhead")
      if (!response.ok) {
        throw new Error("Failed to fetch letterhead")
      }

      const data = (await response.json()) as { letterhead: LetterheadSettings | null }
      setLetterhead(data.letterhead)
    } catch (err) {
      console.error("Error fetching letterhead:", err)
      setError("Failed to load letterhead settings")
    } finally {
      setIsLoading(false)
    }
  }, [])

  const saveLetterhead = useCallback(async (settings: LetterheadSettings): Promise<boolean> => {
    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch("/api/letterhead", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      })

      if (!response.ok) {
        const data = (await response.json()) as { error?: string }
        throw new Error(data.error || "Failed to save letterhead")
      }

      setLetterhead(settings)
      return true
    } catch (err) {
      console.error("Error saving letterhead:", err)
      setError(err instanceof Error ? err.message : "Failed to save letterhead settings")
      return false
    } finally {
      setIsSaving(false)
    }
  }, [])

  const updateLogo = useCallback(async (logo: string, logoKey: string): Promise<boolean> => {
    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch("/api/letterhead/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logo, logoKey }),
      })

      if (!response.ok) {
        throw new Error("Failed to update logo")
      }

      setLetterhead((prev) => prev ? { ...prev, logo, logoKey } : null)
      return true
    } catch (err) {
      console.error("Error updating logo:", err)
      setError("Failed to update logo")
      return false
    } finally {
      setIsSaving(false)
    }
  }, [])

  const removeLogo = useCallback(async (): Promise<boolean> => {
    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch("/api/letterhead/logo", {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to remove logo")
      }

      setLetterhead((prev) => prev ? { ...prev, logo: undefined, logoKey: undefined } : null)
      return true
    } catch (err) {
      console.error("Error removing logo:", err)
      setError("Failed to remove logo")
      return false
    } finally {
      setIsSaving(false)
    }
  }, [])

  const deleteLetterhead = useCallback(async (): Promise<boolean> => {
    setIsSaving(true)
    setError(null)

    try {
      const response = await fetch("/api/letterhead", {
        method: "DELETE",
      })

      if (!response.ok) {
        throw new Error("Failed to delete letterhead")
      }

      setLetterhead(null)
      return true
    } catch (err) {
      console.error("Error deleting letterhead:", err)
      setError("Failed to delete letterhead settings")
      return false
    } finally {
      setIsSaving(false)
    }
  }, [])

  useEffect(() => {
    if (options.initialFetch) {
      fetchLetterhead()
    }
  }, [options.initialFetch, fetchLetterhead])

  return {
    letterhead,
    isLoading,
    isSaving,
    error,
    fetchLetterhead,
    saveLetterhead,
    updateLogo,
    removeLogo,
    deleteLetterhead,
  }
}
