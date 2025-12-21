import { createUploadthing, type FileRouter } from "uploadthing/next"
import { UploadThingError } from "uploadthing/server"
import { auth } from "@/lib/auth"
import { headers } from "next/headers"

const f = createUploadthing()

/**
 * File router for document uploads
 * Handles PDF, DOC, DOCX, and TXT files
 */
export const ourFileRouter = {
  // Document uploader for policy documents
  documentUploader: f({
    pdf: { maxFileSize: "16MB", maxFileCount: 1 },
    "application/msword": { maxFileSize: "16MB", maxFileCount: 1 },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
      maxFileSize: "16MB",
      maxFileCount: 1,
    },
    "text/plain": { maxFileSize: "4MB", maxFileCount: 1 },
  })
    .middleware(async () => {
      // Get the authenticated user
      const session = await auth.api.getSession({
        headers: await headers(),
      })

      if (!session?.user?.id) {
        throw new UploadThingError("You must be logged in to upload documents")
      }

      // Return metadata to be stored with the file
      return { userId: session.user.id }
    })
    .onUploadComplete(async ({ metadata, file }) => {
      // This runs on the server after upload completes
      console.log("Upload complete for userId:", metadata.userId)
      console.log("File URL:", file.ufsUrl)

      // Return data to the client
      return {
        uploadedBy: metadata.userId,
        fileUrl: file.ufsUrl,
        fileKey: file.key,
        fileName: file.name,
        fileSize: file.size,
        fileType: getFileType(file.name),
      }
    }),

  // Logo uploader for letterhead
  logoUploader: f({
    image: { maxFileSize: "4MB", maxFileCount: 1 },
  })
    .middleware(async () => {
      const session = await auth.api.getSession({
        headers: await headers(),
      })

      if (!session?.user?.id) {
        throw new UploadThingError("You must be logged in to upload a logo")
      }

      return { userId: session.user.id }
    })
    .onUploadComplete(async ({ metadata, file }) => {
      return {
        uploadedBy: metadata.userId,
        fileUrl: file.ufsUrl,
        fileKey: file.key,
      }
    }),
} satisfies FileRouter

export type OurFileRouter = typeof ourFileRouter

/**
 * Get file type from filename
 */
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
      return "pdf" // Default to PDF
  }
}
