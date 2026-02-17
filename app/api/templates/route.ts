import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import type { Json } from "@/lib/db/types"
import { createTemplate, getTemplate, getTemplates, incrementUsageCount } from "@/lib/templates/manager"

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const organizationId = searchParams.get("organizationId")
  const type = searchParams.get("type")
  const category = searchParams.get("category")
  const tags = searchParams.get("tags")?.split(",")
  const publicOnly = searchParams.get("publicOnly") === "true"
  const featured = searchParams.get("featured") === "true"
  const limit = parseInt(searchParams.get("limit") || "50", 10)
  const id = searchParams.get("id")

  if (id) {
    const template = await getTemplate(id)
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }
    return NextResponse.json(template)
  }

  const templates = await getTemplates({
    userId: session.user.id,
    organizationId: organizationId || undefined,
    type: type || undefined,
    category: category || undefined,
    tags,
    publicOnly,
    featured,
    limit,
  })

  return NextResponse.json(templates)
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json()) as {
    name?: string
    description?: string
    type?: string
    category?: string
    tags?: string[]
    content?: string | Record<string, unknown>
    variables?: Array<{
      name: string
      description: string
      required: boolean
      default?: string
    }>
    public?: boolean
    organizationId?: string
  }
  const {
    name,
    description,
    type,
    category,
    tags,
    content,
    variables,
    public: isPublic,
    organizationId,
  } = body

  if (!name || !type || !content) {
    return NextResponse.json(
      { error: "name, type, and content are required" },
      { status: 400 }
    )
  }

  if (!["prompt", "workflow", "agent", "form"].includes(type)) {
    return NextResponse.json(
      { error: "Invalid template type" },
      { status: 400 }
    )
  }

  const parsedContent = typeof content === "string"
    ? (JSON.parse(content) as Record<string, unknown>)
    : (content as Record<string, unknown>)

  const template = await createTemplate({
    user_id: session.user.id,
    organization_id: organizationId || undefined,
    name,
    description,
    type,
    category,
    tags,
    content: parsedContent as Json,
    variables: variables as unknown as Json,
    public: isPublic,
  })

  return NextResponse.json(template)
}

export async function PATCH(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json()) as {
    templateId?: string
  }
  const { templateId } = body

  if (!templateId) {
    return NextResponse.json(
      { error: "templateId is required" },
      { status: 400 }
    )
  }

  await incrementUsageCount(templateId)

  return NextResponse.json({ success: true })
}
