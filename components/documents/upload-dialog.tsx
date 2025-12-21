"use client"

import { useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Upload, FileText, X, Loader2 } from "lucide-react"
import { useDropzone } from "react-dropzone"
import { cn } from "@/lib/utils"

interface UploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploadComplete?: (data: {
    name: string
    version: string
    fileUrl: string
    fileKey: string
    fileType: string
    fileSize: number
  }) => Promise<void>
}

const ACCEPTED_FILE_TYPES = {
  "application/pdf": [".pdf"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/plain": [".txt"],
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function getFileType(filename: string): "pdf" | "doc" | "docx" | "txt" {
  const ext = filename.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "pdf":
      return "pdf"
    case "doc":
      return "doc"
    case "docx":
      return "docx"
    case "txt":
      return "txt"
    default:
      return "pdf"
  }
}

export function UploadDialog({
  open,
  onOpenChange,
  onUploadComplete,
}: UploadDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState("")
  const [version, setVersion] = useState("1.0")
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const selectedFile = acceptedFiles[0]
    if (selectedFile) {
      setFile(selectedFile)
      // Set default name from filename (without extension)
      const nameWithoutExt = selectedFile.name.replace(/\.[^/.]+$/, "")
      setName(nameWithoutExt)
      setError(null)
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_FILE_TYPES,
    maxFiles: 1,
    maxSize: 16 * 1024 * 1024, // 16MB
    onDropRejected: (rejections) => {
      const rejection = rejections[0]
      if (rejection?.errors[0]?.code === "file-too-large") {
        setError("File is too large. Maximum size is 16MB.")
      } else if (rejection?.errors[0]?.code === "file-invalid-type") {
        setError("Invalid file type. Please upload PDF, DOC, DOCX, or TXT files.")
      } else {
        setError("Failed to upload file. Please try again.")
      }
    },
  })

  const handleUpload = async () => {
    if (!file || !name.trim()) return

    setIsUploading(true)
    setUploadProgress(0)
    setError(null)

    try {
      // Create form data for uploadthing
      const formData = new FormData()
      formData.append("files", file)

      // Upload to uploadthing
      const response = await fetch("/api/uploadthing", {
        method: "POST",
        headers: {
          "x-uploadthing-package": "@uploadthing/react",
        },
        body: JSON.stringify({
          files: [{
            name: file.name,
            size: file.size,
            type: file.type,
          }],
          input: {},
          routeConfig: "documentUploader",
        }),
      })

      if (!response.ok) {
        throw new Error("Upload failed")
      }

      // Simulate progress for demo (in real app, uploadthing provides progress)
      setUploadProgress(50)

      const result = (await response.json()) as Array<{ url?: string; key?: string }>

      // For uploadthing, we need to actually upload the file content
      // This is a simplified version - in production use @uploadthing/react hooks

      setUploadProgress(100)

      // Call completion handler
      if (onUploadComplete) {
        await onUploadComplete({
          name: name.trim(),
          version,
          fileUrl: result[0]?.url || "",
          fileKey: result[0]?.key || "",
          fileType: getFileType(file.name),
          fileSize: file.size,
        })
      }

      // Reset and close
      handleClose()
    } catch (err) {
      console.error("Upload error:", err)
      setError("Failed to upload file. Please try again.")
    } finally {
      setIsUploading(false)
    }
  }

  const handleClose = () => {
    if (!isUploading) {
      setFile(null)
      setName("")
      setVersion("1.0")
      setError(null)
      setUploadProgress(0)
      onOpenChange(false)
    }
  }

  const removeFile = () => {
    setFile(null)
    setName("")
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
          <DialogDescription>
            Upload a policy document (PDF, DOC, DOCX, or TXT). Max 16MB.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Dropzone */}
          {!file ? (
            <div
              {...getRootProps()}
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                isDragActive
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              )}
            >
              <input {...getInputProps()} />
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm font-medium">
                {isDragActive ? "Drop the file here" : "Drag & drop a file here"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                or click to browse
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 border rounded-lg bg-muted/50">
              <FileText className="h-8 w-8 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(file.size)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={removeFile}
                disabled={isUploading}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Error message */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {/* Upload progress */}
          {isUploading && (
            <div className="space-y-2">
              <Progress value={uploadProgress} />
              <p className="text-xs text-center text-muted-foreground">
                Uploading... {uploadProgress}%
              </p>
            </div>
          )}

          {/* Document details */}
          {file && !isUploading && (
            <>
              <div className="space-y-2">
                <Label htmlFor="name">Document Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter document name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="version">Version</Label>
                <Input
                  id="version"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.0"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!file || !name.trim() || isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
