"use client"

import { useAppeals } from "@/hooks"
import { AppealFilters, AppealTable } from "@/components/history"

export default function HistoryPage() {
  const {
    appeals,
    pagination,
    filters,
    isLoading,
    applyFilters,
    clearFilters,
    goToPage,
  } = useAppeals()

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Appeal History</h1>
        <p className="text-muted-foreground mt-1">
          View and manage your previously generated appeals.
        </p>
      </div>

      <div className="space-y-6">
        {/* Filters */}
        <AppealFilters
          filters={filters}
          onApplyFilters={applyFilters}
          onClearFilters={clearFilters}
        />

        {/* Table */}
        <AppealTable
          appeals={appeals}
          isLoading={isLoading}
          pagination={pagination}
          onPageChange={goToPage}
        />
      </div>
    </div>
  )
}
