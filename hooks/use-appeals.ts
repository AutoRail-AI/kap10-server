"use client"

import { useState, useCallback, useEffect } from "react"
import type { PaginatedAppeals, AppealHistoryItem, AppealHistoryFilters } from "@/lib/types/dashboard"

interface UseAppealsOptions {
  initialFetch?: boolean
  pageSize?: number
}

export function useAppeals(options: UseAppealsOptions = { initialFetch: true, pageSize: 10 }) {
  const [appeals, setAppeals] = useState<AppealHistoryItem[]>([])
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: options.pageSize || 10,
    total: 0,
    totalPages: 0,
  })
  const [filters, setFilters] = useState<AppealHistoryFilters>({})
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAppeals = useCallback(async (page = 1, newFilters?: AppealHistoryFilters) => {
    setIsLoading(true)
    setError(null)

    const activeFilters = newFilters !== undefined ? newFilters : filters

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pagination.pageSize.toString(),
      })

      if (activeFilters.status) params.set("status", activeFilters.status)
      if (activeFilters.provider) params.set("provider", activeFilters.provider)
      if (activeFilters.search) params.set("search", activeFilters.search)
      if (activeFilters.dateFrom) params.set("dateFrom", activeFilters.dateFrom.toISOString())
      if (activeFilters.dateTo) params.set("dateTo", activeFilters.dateTo.toISOString())

      const response = await fetch(`/api/appeals?${params}`)
      if (!response.ok) {
        throw new Error("Failed to fetch appeals")
      }

      const data = (await response.json()) as PaginatedAppeals
      setAppeals(data.appeals)
      setPagination({
        page: data.page,
        pageSize: data.pageSize,
        total: data.total,
        totalPages: data.totalPages,
      })

      if (newFilters !== undefined) {
        setFilters(newFilters)
      }
    } catch (err) {
      console.error("Error fetching appeals:", err)
      setError("Failed to load appeals")
    } finally {
      setIsLoading(false)
    }
  }, [filters, pagination.pageSize])

  const getAppeal = useCallback(async (id: string): Promise<AppealHistoryItem | null> => {
    try {
      const response = await fetch(`/api/appeals/${id}`)
      if (!response.ok) {
        return null
      }

      const data = (await response.json()) as { appeal: AppealHistoryItem }
      return data.appeal
    } catch (err) {
      console.error("Error fetching appeal:", err)
      return null
    }
  }, [])

  const updateAppealStatus = useCallback(async (
    id: string,
    status: "draft" | "generated" | "downloaded" | "submitted"
  ): Promise<boolean> => {
    try {
      const response = await fetch(`/api/appeals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })

      if (!response.ok) {
        return false
      }

      // Update local state
      setAppeals((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status } : a))
      )
      return true
    } catch (err) {
      console.error("Error updating appeal status:", err)
      return false
    }
  }, [])

  const goToPage = useCallback((page: number) => {
    fetchAppeals(page)
  }, [fetchAppeals])

  const applyFilters = useCallback((newFilters: AppealHistoryFilters) => {
    fetchAppeals(1, newFilters)
  }, [fetchAppeals])

  const clearFilters = useCallback(() => {
    fetchAppeals(1, {})
  }, [fetchAppeals])

  useEffect(() => {
    if (options.initialFetch) {
      fetchAppeals()
    }
  }, [options.initialFetch, fetchAppeals])

  return {
    appeals,
    pagination,
    filters,
    isLoading,
    error,
    fetchAppeals,
    getAppeal,
    updateAppealStatus,
    goToPage,
    applyFilters,
    clearFilters,
  }
}
