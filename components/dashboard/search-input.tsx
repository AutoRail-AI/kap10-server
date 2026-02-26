"use client"

import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface SearchInputProps {
  query: string
  mode: string
  onQueryChange: (query: string) => void
  onModeChange: (mode: string) => void
  placeholder?: string
}

export function SearchInput({
  query,
  mode,
  onQueryChange,
  onModeChange,
  placeholder = "Search your codebase by meaning…",
}: SearchInputProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={placeholder}
          className="h-9 pl-9 text-sm"
          autoFocus
        />
      </div>
      <Select value={mode} onValueChange={onModeChange}>
        <SelectTrigger className="h-9 w-[130px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="hybrid">Hybrid</SelectItem>
          <SelectItem value="semantic">Semantic</SelectItem>
          <SelectItem value="keyword">Keyword</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
