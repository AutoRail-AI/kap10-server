"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Upload, X, Loader2, Image as ImageIcon } from "lucide-react"
import { useDropzone } from "react-dropzone"
import { cn } from "@/lib/utils"
import Image from "next/image"

interface LogoUploadProps {
  currentLogo?: string
  onUpload: (logo: string, logoKey: string) => Promise<boolean>
  onRemove: () => Promise<boolean>
  isUploading?: boolean
}

export function LogoUpload({ currentLogo, onUpload, onRemove, isUploading }: LogoUploadProps) {
  const [isRemoving, setIsRemoving] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    setError(null)
    setPreviewUrl(URL.createObjectURL(file))
    setUploadProgress(10)

    try {
      // Get presigned URL from uploadthing
      const formData = new FormData()
      formData.append("files", file)

      setUploadProgress(30)

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
          routeConfig: "logoUploader",
        }),
      })

      if (!response.ok) {
        throw new Error("Failed to upload logo")
      }

      setUploadProgress(70)

      const result = (await response.json()) as Array<{ url?: string; key?: string; fileUrl?: string }>
      const uploadedFile = result[0]

      if (!uploadedFile?.url && !uploadedFile?.fileUrl) {
        throw new Error("Upload failed - no URL returned")
      }

      setUploadProgress(100)

      const logoUrl = uploadedFile.fileUrl || uploadedFile.url || ""
      const logoKey = uploadedFile.key || ""

      await onUpload(logoUrl, logoKey)
    } catch (err) {
      console.error("Logo upload error:", err)
      setError("Failed to upload logo. Please try again.")
      setPreviewUrl(null)
    } finally {
      setUploadProgress(0)
    }
  }, [onUpload])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"],
    },
    maxFiles: 1,
    maxSize: 4 * 1024 * 1024, // 4MB
    disabled: isUploading,
    onDropRejected: (rejections) => {
      const rejection = rejections[0]
      if (rejection?.errors[0]?.code === "file-too-large") {
        setError("Logo must be smaller than 4MB")
      } else if (rejection?.errors[0]?.code === "file-invalid-type") {
        setError("Please upload an image file (PNG, JPG, SVG, etc.)")
      } else {
        setError("Failed to upload logo")
      }
    },
  })

  const handleRemove = async () => {
    setIsRemoving(true)
    try {
      await onRemove()
      setPreviewUrl(null)
    } finally {
      setIsRemoving(false)
    }
  }

  const displayLogo = previewUrl || currentLogo

  return (
    <div className="space-y-4">
      {displayLogo ? (
        <div className="relative">
          <div className="relative h-32 w-full rounded-lg border bg-muted/50 overflow-hidden">
            <Image
              src={displayLogo}
              alt="Organization logo"
              fill
              className="object-contain p-4"
            />
          </div>
          <Button
            variant="destructive"
            size="icon"
            className="absolute top-2 right-2 h-8 w-8"
            onClick={handleRemove}
            disabled={isRemoving || isUploading}
          >
            {isRemoving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </Button>
        </div>
      ) : (
        <div
          {...getRootProps()}
          className={cn(
            "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-primary/50",
            isUploading && "pointer-events-none opacity-50"
          )}
        >
          <input {...getInputProps()} />
          {isUploading ? (
            <>
              <Loader2 className="h-10 w-10 mx-auto text-muted-foreground mb-4 animate-spin" />
              <p className="text-sm font-medium">Uploading... {uploadProgress}%</p>
            </>
          ) : (
            <>
              <ImageIcon className="h-10 w-10 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm font-medium">
                {isDragActive ? "Drop the logo here" : "Drag & drop your logo"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                or click to browse (PNG, JPG, SVG - max 4MB)
              </p>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {!displayLogo && !isUploading && (
        <div {...getRootProps()}>
          <Button type="button" variant="outline" className="w-full">
            <Upload className="mr-2 h-4 w-4" />
            Upload Logo
          </Button>
        </div>
      )}
    </div>
  )
}
