"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Search, X } from "lucide-react"
import type { AppealHistoryFilters } from "@/lib/types/dashboard"

interface AppealFiltersProps {
  filters: AppealHistoryFilters
  onApplyFilters: (filters: AppealHistoryFilters) => void
  onClearFilters: () => void
}

export function AppealFilters({ filters, onApplyFilters, onClearFilters }: AppealFiltersProps) {
  const [search, setSearch] = useState(filters.search || "")
  const [status, setStatus] = useState(filters.status || "")

  const handleSearch = () => {
    onApplyFilters({
      ...filters,
      search: search || undefined,
      status: status || undefined,
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch()
    }
  }

  const handleClear = () => {
    setSearch("")
    setStatus("")
    onClearFilters()
  }

  const hasFilters = search || status

  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search appeals..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          className="pl-10"
        />
      </div>

      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-full sm:w-[180px]">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="draft">Draft</SelectItem>
          <SelectItem value="generated">Generated</SelectItem>
          <SelectItem value="downloaded">Downloaded</SelectItem>
          <SelectItem value="submitted">Submitted</SelectItem>
        </SelectContent>
      </Select>

      <div className="flex gap-2">
        <Button onClick={handleSearch}>
          <Search className="h-4 w-4 mr-2" />
          Search
        </Button>
        {hasFilters && (
          <Button variant="outline" onClick={handleClear}>
            <X className="h-4 w-4 mr-2" />
            Clear
          </Button>
        )}
      </div>
    </div>
  )
}
