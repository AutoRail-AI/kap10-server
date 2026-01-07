export type AgentRole = "assistant" | "user" | "system"

export interface AgentMessage {
  role: AgentRole
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: Date
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}

export interface ToolResult {
  toolCallId: string
  result: any
  error?: string
}

export interface AgentState {
  messages: AgentMessage[]
  currentTask?: string
  tools: AgentTool[]
  metadata?: Record<string, any>
}

export interface AgentTool {
  name: string
  description: string
  parameters: {
    type: "object"
    properties: Record<string, {
      type: string
      description: string
      required?: boolean
    }>
    required?: string[]
  }
  handler: (args: Record<string, any>) => Promise<any>
}

export interface AgentConfig {
  model: string
  temperature?: number
  maxTokens?: number
  tools?: AgentTool[]
  systemPrompt?: string
}

