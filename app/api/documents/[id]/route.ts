import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import {
  getDocument,
  updateDocument,
  updateDocumentStatus,
  deleteDocument,
  setActiveVersion,
} from "@/lib/documents"
import { headers } from "next/headers"
import { UTApi } from "uploadthing/server"

interface RouteParams {
  params: Promise<{ id: string }>
}

const utapi = new UTApi()

/**
 * GET /api/documents/[id]
 * Get a single document
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const document = await getDocument({
      id,
      userId: session.user.id,
    })

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      )
    }

    return NextResponse.json({ document })
  } catch (error) {
    console.error("Error fetching document:", error)
    return NextResponse.json(
      { error: "Failed to fetch document" },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/documents/[id]
 * Update a document
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const body = (await request.json()) as {
      name?: string
      version?: string
      providerId?: string | null
      isActive?: boolean
      status?: "uploading" | "processing" | "ready" | "error"
      errorMessage?: string
      setActiveVersion?: boolean
      metadata?: {
        pageCount?: number
        processedAt?: Date
        chunkCount?: number
      }
    }

    // Handle setting active version
    if (body.setActiveVersion) {
      const success = await setActiveVersion({
        id,
        userId: session.user.id,
      })

      if (!success) {
        return NextResponse.json(
          { error: "Failed to set active version" },
          { status: 400 }
        )
      }

      return NextResponse.json({ success: true })
    }

    // Handle status update
    if (body.status) {
      const success = await updateDocumentStatus({
        id,
        userId: session.user.id,
        status: body.status,
        errorMessage: body.errorMessage,
        metadata: body.metadata,
      })

      if (!success) {
        return NextResponse.json(
          { error: "Failed to update document status" },
          { status: 400 }
        )
      }

      return NextResponse.json({ success: true })
    }

    // Handle general update
    const success = await updateDocument({
      id,
      userId: session.user.id,
      name: body.name,
      version: body.version,
      providerId: body.providerId,
      isActive: body.isActive,
    })

    if (!success) {
      return NextResponse.json(
        { error: "Failed to update document" },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error updating document:", error)
    return NextResponse.json(
      { error: "Failed to update document" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/documents/[id]
 * Delete a document and its file
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params

    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const result = await deleteDocument({
      id,
      userId: session.user.id,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      )
    }

    // Delete the file from uploadthing
    if (result.fileKey) {
      try {
        await utapi.deleteFiles(result.fileKey)
      } catch (fileError) {
        console.error("Error deleting file from uploadthing:", fileError)
        // Don't fail the request if file deletion fails
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting document:", error)
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 }
    )
  }
}
