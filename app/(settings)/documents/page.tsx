"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DocumentList, UploadDialog } from "@/components/documents"
import { useDocuments } from "@/hooks"
import { Plus, Search, FileText } from "lucide-react"

export default function DocumentsPage() {
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [search, setSearch] = useState("")

  const {
    documents,
    isLoading,
    error,
    createDocument,
    deleteDocument,
    setActiveVersion,
  } = useDocuments({ search })

  const handleUploadComplete = async (data: {
    name: string
    version: string
    fileUrl: string
    fileKey: string
    fileType: string
    fileSize: number
  }) => {
    await createDocument({
      name: data.name,
      version: data.version,
      fileUrl: data.fileUrl,
      fileKey: data.fileKey,
      fileType: data.fileType,
      fileSize: data.fileSize,
    })
  }

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground">
            Manage your policy documents for appeal generation
          </p>
        </div>
        <Button onClick={() => setIsUploadOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Upload Document
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search documents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-6 rounded-lg bg-destructive/10 p-4 text-destructive">
          {error}
        </div>
      )}

      {/* Document list */}
      <DocumentList
        documents={documents}
        isLoading={isLoading}
        onDelete={deleteDocument}
        onSetActive={setActiveVersion}
      />

      {/* Upload dialog */}
      <UploadDialog
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        onUploadComplete={handleUploadComplete}
      />
    </div>
  )
}
