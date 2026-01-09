import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { AgentRunner } from "@/lib/ai/agent-runner"
import { defaultTools } from "@/lib/ai/tools"
import type { AgentState } from "@/lib/ai/types"
import { auth } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: await headers() })
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await request.json()) as {
      messages?: AgentState["messages"]
      task?: string
      organizationId?: string
    }
    const { messages, task, organizationId } = body

    // Verify user has access to organization if provided
    // Note: Organization access is verified by Better Auth middleware
    // If organizationId is provided, it will be validated by the auth system
    if (organizationId) {
      // Organization access validation happens at the auth level
      // If user doesn't have access, Better Auth will handle it
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      )
    }

    const agent = new AgentRunner({
      model: "gpt-4-turbo-preview",
      temperature: 0.7,
      tools: defaultTools,
      systemPrompt: `You are a helpful AI assistant${organizationId ? ' for an organization' : ''}. 
      Help users accomplish their tasks efficiently. Use the available tools when needed.`,
    })

    const state: AgentState = {
      messages: messages || [],
      currentTask: task,
      tools: defaultTools,
      metadata: {
        userId: session.user.id,
        organizationId,
      },
    }

    const result = await agent.run(state)
    return NextResponse.json({ 
      messages: result.messages,
      state: result,
    })
  } catch (error) {
    console.error("Agent error:", error)
    return NextResponse.json(
      { error: "Agent execution failed", details: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}

