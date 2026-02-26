"use client"

import { BookText, Search } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import type { DomainOntologyDoc } from "@/lib/ports/types"

export function GlossaryView({ repoId }: { repoId: string }) {
  const [ontology, setOntology] = useState<DomainOntologyDoc | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("")
  const tableRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/repos/${repoId}/glossary`)
        if (res.ok) {
          const json = (await res.json()) as { data: { ontology: DomainOntologyDoc | null } }
          setOntology(json.data.ontology)
        }
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [repoId])

  const ubiquitousLanguage = useMemo(() => {
    if (!ontology?.ubiquitous_language) return []
    return Object.entries(ontology.ubiquitous_language)
      .map(([term, definition]) => {
        const termData = ontology.terms?.find(
          (t) => t.term.toLowerCase() === term.toLowerCase()
        )
        return {
          term,
          definition,
          relatedTerms: termData?.relatedTerms ?? [],
        }
      })
      .filter(
        (entry) =>
          !filter ||
          entry.term.toLowerCase().includes(filter.toLowerCase()) ||
          entry.definition.toLowerCase().includes(filter.toLowerCase())
      )
      .sort((a, b) => a.term.localeCompare(b.term))
  }, [ontology, filter])

  const domainTerms = useMemo(() => {
    if (!ontology?.terms) return []
    return [...ontology.terms].sort((a, b) => b.frequency - a.frequency)
  }, [ontology])

  const maxFreq = domainTerms.length > 0 ? domainTerms[0]!.frequency : 1

  const scrollToTerm = (term: string) => {
    setFilter(term)
    tableRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (!ontology) {
    return (
      <div className="glass-card border-border rounded-lg border p-6 text-center space-y-3">
        <BookText className="h-8 w-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">
          No domain ontology available yet.
        </p>
        <p className="text-xs text-muted-foreground">
          Run the justification pipeline to extract domain vocabulary.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Project Header */}
      <div className="glass-card border-border rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            {ontology.project_name && (
              <h2 className="font-grotesk text-base font-semibold text-foreground">
                {ontology.project_name}
              </h2>
            )}
            {ontology.project_domain && (
              <p className="text-xs text-primary mt-0.5">{ontology.project_domain}</p>
            )}
          </div>
        </div>
        {ontology.project_description && (
          <p className="text-sm text-muted-foreground">{ontology.project_description}</p>
        )}
        {ontology.tech_stack && ontology.tech_stack.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {ontology.tech_stack.map((tech) => (
              <span
                key={tech}
                className="inline-block px-2 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-primary border border-primary/20"
              >
                {tech}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Ubiquitous Language Table */}
      {ubiquitousLanguage.length > 0 || Object.keys(ontology.ubiquitous_language ?? {}).length > 0 ? (
        <div className="space-y-3" ref={tableRef}>
          <div className="flex items-center justify-between">
            <h3 className="font-grotesk text-sm font-semibold text-foreground">
              Ubiquitous Language
            </h3>
            <div className="relative w-48">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                className="h-8 pl-8 text-xs"
                placeholder="Filter terms..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Term</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Definition</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground">Related</th>
                </tr>
              </thead>
              <tbody>
                {ubiquitousLanguage.map((entry) => (
                  <tr key={entry.term} className="border-b border-border/50 hover:bg-muted/10">
                    <td className="px-3 py-2 font-mono text-foreground font-medium whitespace-nowrap">
                      {entry.term}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{entry.definition}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {entry.relatedTerms.length > 0
                        ? entry.relatedTerms.join(", ")
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ubiquitousLanguage.length === 0 && filter && (
            <p className="text-xs text-muted-foreground text-center py-4">
              No terms match &quot;{filter}&quot;
            </p>
          )}
        </div>
      ) : null}

      {/* All Domain Terms */}
      {domainTerms.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-grotesk text-sm font-semibold text-foreground">
            All Domain Terms ({domainTerms.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {domainTerms.map((t) => {
              const hasDefinition = ontology.ubiquitous_language
                ? t.term in ontology.ubiquitous_language
                : false
              return (
                <button
                  key={t.term}
                  className={`inline-block px-2.5 py-1 rounded text-xs border transition-colors ${
                    hasDefinition
                      ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 cursor-pointer"
                      : "bg-white/5 text-foreground border-white/10"
                  }`}
                  style={{ opacity: 0.4 + 0.6 * (t.frequency / maxFreq) }}
                  onClick={() => hasDefinition && scrollToTerm(t.term)}
                  title={`Frequency: ${t.frequency}${hasDefinition ? " (click to see definition)" : ""}`}
                >
                  {t.term}
                  <span className="ml-1 text-[10px] text-muted-foreground">{t.frequency}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
