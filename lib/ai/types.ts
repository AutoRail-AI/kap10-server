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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arguments: Record<string, any>
}

export interface ToolResult {
  toolCallId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any
  error?: string
}

export interface AgentState {
  messages: AgentMessage[]
  currentTask?: string
  tools: AgentTool[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: Record<string, any>) => Promise<any>
}

export interface AgentConfig {
  model: string
  temperature?: number
  maxTokens?: number
  tools?: AgentTool[]
  systemPrompt?: string
}

