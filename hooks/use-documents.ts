"use client"

import { useCallback, useEffect, useState } from "react"
import type { DocumentListItem } from "@/lib/types/document"

interface UseDocumentsOptions {
  status?: "uploading" | "processing" | "ready" | "error"
  providerId?: string
  search?: string
}

/**
 * Hook for managing documents
 */
export function useDocuments(options: UseDocumentsOptions = {}) {
  const [documents, setDocuments] = useState<DocumentListItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch documents
  const fetchDocuments = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (options.status) params.set("status", options.status)
      if (options.providerId) params.set("providerId", options.providerId)
      if (options.search) params.set("search", options.search)

      const response = await fetch(`/api/documents?${params.toString()}`)

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Please log in to view documents")
        }
        throw new Error("Failed to fetch documents")
      }

      const data = (await response.json()) as { documents: DocumentListItem[] }
      setDocuments(data.documents)
    } catch (err) {
      console.error("Error fetching documents:", err)
      setError(err instanceof Error ? err.message : "Failed to fetch documents")
    } finally {
      setIsLoading(false)
    }
  }, [options.status, options.providerId, options.search])

  // Create document
  const createDocument = useCallback(
    async (params: {
      name: string
      version: string
      fileUrl: string
      fileKey: string
      fileType: string
      fileSize: number
      providerId?: string
    }): Promise<string | null> => {
      try {
        const response = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        })

        if (!response.ok) {
          throw new Error("Failed to create document")
        }

        const data = (await response.json()) as { document: { id: string } }

        // Refresh the list
        await fetchDocuments()

        return data.document.id
      } catch (err) {
        console.error("Error creating document:", err)
        setError(err instanceof Error ? err.message : "Failed to create document")
        return null
      }
    },
    [fetchDocuments]
  )

  // Delete document
  const deleteDocument = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const response = await fetch(`/api/documents/${id}`, {
          method: "DELETE",
        })

        if (!response.ok) {
          throw new Error("Failed to delete document")
        }

        // Remove from local state
        setDocuments((prev) => prev.filter((d) => d.id !== id))
        return true
      } catch (err) {
        console.error("Error deleting document:", err)
        setError(err instanceof Error ? err.message : "Failed to delete document")
        return false
      }
    },
    []
  )

  // Set active version
  const setActiveVersion = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const response = await fetch(`/api/documents/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setActiveVersion: true }),
        })

        if (!response.ok) {
          throw new Error("Failed to set active version")
        }

        // Refresh the list to get updated isActive states
        await fetchDocuments()
        return true
      } catch (err) {
        console.error("Error setting active version:", err)
        setError(err instanceof Error ? err.message : "Failed to set active version")
        return false
      }
    },
    [fetchDocuments]
  )

  // Fetch on mount and when options change
  useEffect(() => {
    fetchDocuments()
  }, [fetchDocuments])

  return {
    documents,
    isLoading,
    error,
    fetchDocuments,
    createDocument,
    deleteDocument,
    setActiveVersion,
  }
}
