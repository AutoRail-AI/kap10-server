import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createDocument, getDocumentList } from "@/lib/documents"
import { headers } from "next/headers"

/**
 * GET /api/documents
 * Get list of documents for the current user
 */
export async function GET(request: NextRequest) {
  try {
    // Get authenticated user (required for documents)
    const session = await auth.api.getSession({
      headers: await headers(),
    })

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    // Parse query params
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get("status") as
      | "uploading"
      | "processing"
      | "ready"
      | "error"
      | null
    const providerId = searchParams.get("providerId")
    const search = searchParams.get("search")
    const limit = parseInt(searchParams.get("limit") || "50", 10)
    const offset = parseInt(searchParams.get("offset") || "0", 10)

    const documents = await getDocumentList({
      userId: session.user.id,
      status: status || undefined,
      providerId: providerId || undefined,
      search: search || undefined,
      limit,
      offset,
    })

    return NextResponse.json({ documents })
  } catch (error) {
    console.error("Error fetching documents:", error)
    return NextResponse.json(
      { error: "Failed to fetch documents" },
      { status: 500 }
    )
  }
}

/**
 * POST /api/documents
 * Create a new document record (after uploadthing upload completes)
 */
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
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
      name: string
      version?: string
      fileUrl: string
      fileKey: string
      fileType: "pdf" | "doc" | "docx" | "txt"
      fileSize: number
      providerId?: string
      originalFileName?: string
    }

    if (!body.name || !body.fileUrl || !body.fileKey) {
      return NextResponse.json(
        { error: "Name, fileUrl, and fileKey are required" },
        { status: 400 }
      )
    }

    const document = await createDocument({
      userId: session.user.id,
      name: body.name,
      version: body.version || "1.0",
      fileUrl: body.fileUrl,
      fileKey: body.fileKey,
      fileType: body.fileType || "pdf",
      fileSize: body.fileSize || 0,
      providerId: body.providerId,
      originalFileName: body.originalFileName,
    })

    return NextResponse.json({ document }, { status: 201 })
  } catch (error) {
    console.error("Error creating document:", error)
    return NextResponse.json(
      { error: "Failed to create document" },
      { status: 500 }
    )
  }
}
