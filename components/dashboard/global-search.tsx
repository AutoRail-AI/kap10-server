"use client"

import { Search } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"

export function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Cmd+K / Ctrl+K to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setIsOpen((prev) => !prev)
      }
      if (e.key === "Escape") {
        setIsOpen(false)
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      if (query.trim()) {
        router.push(`/search?q=${encodeURIComponent(query.trim())}`)
        setIsOpen(false)
        setQuery("")
      }
    },
    [query, router]
  )

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(true)}
        className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-muted/10 px-3 text-xs text-muted-foreground transition-colors hover:bg-muted/20"
      >
        <Search className="h-3 w-3" />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded border border-border bg-muted/20 px-1 py-0.5 font-mono text-[10px]">
          ⌘K
        </kbd>
      </button>

      {/* Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />
          <div className="glass-panel relative z-50 w-full max-w-lg rounded-lg border border-border shadow-2xl">
            <form onSubmit={handleSubmit}>
              <div className="flex items-center gap-2 border-b border-border px-4">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your codebase by meaning…"
                  className="h-12 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
                <Badge
                  variant="outline"
                  className="h-5 px-1.5 text-[10px] font-normal text-muted-foreground"
                >
                  ESC
                </Badge>
              </div>
            </form>
            <div className="p-3 text-center text-xs text-muted-foreground">
              Press <kbd className="rounded border border-border bg-muted/20 px-1 py-0.5 font-mono text-[10px]">Enter</kbd> to search
            </div>
          </div>
        </div>
      )}
    </>
  )
}
