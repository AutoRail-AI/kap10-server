"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  FileText,
  MoreVertical,
  Download,
  Trash2,
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import type { DocumentListItem } from "@/lib/types/document"

interface DocumentCardProps {
  document: DocumentListItem
  onDelete?: (id: string) => Promise<boolean | void>
  onSetActive?: (id: string) => Promise<boolean | void>
}

const statusConfig = {
  uploading: {
    label: "Uploading",
    icon: Loader2,
    className: "bg-blue-100 text-blue-800",
    iconClassName: "animate-spin",
  },
  processing: {
    label: "Processing",
    icon: Clock,
    className: "bg-yellow-100 text-yellow-800",
    iconClassName: "",
  },
  ready: {
    label: "Ready",
    icon: CheckCircle,
    className: "bg-green-100 text-green-800",
    iconClassName: "",
  },
  error: {
    label: "Error",
    icon: AlertCircle,
    className: "bg-red-100 text-red-800",
    iconClassName: "",
  },
}

const fileTypeIcons: Record<string, string> = {
  pdf: "PDF",
  doc: "DOC",
  docx: "DOCX",
  txt: "TXT",
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(date: Date): string {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export function DocumentCard({
  document,
  onDelete,
  onSetActive,
}: DocumentCardProps) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const status = statusConfig[document.status]
  const StatusIcon = status.icon

  const handleDelete = async () => {
    if (!onDelete) return
    setIsDeleting(true)
    try {
      await onDelete(document.id)
    } finally {
      setIsDeleting(false)
      setShowDeleteDialog(false)
    }
  }

  return (
    <>
      <Card className={cn("transition-shadow hover:shadow-md", document.isActive && "ring-2 ring-primary")}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            {/* File type icon */}
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium">
              {fileTypeIcons[document.fileType] || "FILE"}
            </div>

            {/* Document info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-medium truncate" title={document.name}>
                    {document.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                    <span>v{document.version}</span>
                    <span>·</span>
                    <span>{formatFileSize(document.fileSize)}</span>
                    {document.providerName && (
                      <>
                        <span>·</span>
                        <span className="truncate">{document.providerName}</span>
                      </>
                    )}
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                      <MoreVertical className="h-4 w-4" />
                      <span className="sr-only">More options</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <a
                        href={document.status === "ready" ? `/api/documents/${document.id}/download` : "#"}
                        className={document.status !== "ready" ? "pointer-events-none opacity-50" : ""}
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download
                      </a>
                    </DropdownMenuItem>
                    {!document.isActive && onSetActive && (
                      <DropdownMenuItem onClick={() => onSetActive(document.id)}>
                        <CheckCircle className="mr-2 h-4 w-4" />
                        Set as Active
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Status and date */}
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="secondary" className={cn("text-xs", status.className)}>
                  <StatusIcon className={cn("mr-1 h-3 w-3", status.iconClassName)} />
                  {status.label}
                </Badge>
                {document.isActive && (
                  <Badge variant="outline" className="text-xs">
                    Active
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatDate(document.uploadedAt)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{document.name}" and remove its file.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
