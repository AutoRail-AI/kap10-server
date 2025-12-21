"use client"

import { useState, useCallback, useEffect } from "react"
import type { DashboardData } from "@/lib/types/dashboard"

interface UseDashboardOptions {
  initialFetch?: boolean
}

export function useDashboard(options: UseDashboardOptions = { initialFetch: true }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchDashboard = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/dashboard")
      if (!response.ok) {
        throw new Error("Failed to fetch dashboard data")
      }

      const result = (await response.json()) as DashboardData
      setData(result)
    } catch (err) {
      console.error("Error fetching dashboard:", err)
      setError("Failed to load dashboard data")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (options.initialFetch) {
      fetchDashboard()
    }
  }, [options.initialFetch, fetchDashboard])

  return {
    data,
    stats: data?.stats,
    usageHistory: data?.usageHistory,
    recentAppeals: data?.recentAppeals,
    recentConversations: data?.recentConversations,
    isLoading,
    error,
    refresh: fetchDashboard,
  }
}
