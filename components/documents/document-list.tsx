"use client"

import { DocumentCard } from "./document-card"
import { Skeleton } from "@/components/ui/skeleton"
import { FileText } from "lucide-react"
import type { DocumentListItem } from "@/lib/types/document"

interface DocumentListProps {
  documents: DocumentListItem[]
  isLoading?: boolean
  onDelete?: (id: string) => Promise<boolean | void>
  onSetActive?: (id: string) => Promise<boolean | void>
}

export function DocumentList({
  documents,
  isLoading,
  onDelete,
  onSetActive,
}: DocumentListProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    )
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium">No documents yet</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Upload policy documents to get started with appeal generation.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {documents.map((doc) => (
        <DocumentCard
          key={doc.id}
          document={doc}
          onDelete={onDelete}
          onSetActive={onSetActive}
        />
      ))}
    </div>
  )
}
