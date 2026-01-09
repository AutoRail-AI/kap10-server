import { OpenAI } from "openai"
import type { AgentConfig, AgentMessage, AgentState, AgentTool, ToolCall } from "./types"

export class AgentRunner {
  private client: OpenAI
  private config: AgentConfig
  private tools: Map<string, AgentTool>

  constructor(config: AgentConfig) {
    this.config = config
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
    this.tools = new Map()
    
    if (config.tools) {
      config.tools.forEach(tool => {
        this.tools.set(tool.name, tool)
      })
    }
  }

  async run(state: AgentState): Promise<AgentState> {
    const messages = this.formatMessages(state.messages)
    
    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages,
      tools: this.formatTools(),
      temperature: this.config.temperature || 0.7,
      max_tokens: this.config.maxTokens || 2000,
    })

    const assistantMessage = response.choices[0]?.message
    if (!assistantMessage) {
      throw new Error("No response from AI")
    }

    const newMessage: AgentMessage = {
      role: "assistant",
      content: assistantMessage.content || "",
      toolCalls: assistantMessage.tool_calls?.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
      })) as ToolCall[] | undefined,
      timestamp: new Date(),
    }

    // Execute tool calls if any
    if (newMessage.toolCalls && newMessage.toolCalls.length > 0) {
      const toolResults = await Promise.all(
        newMessage.toolCalls.map(async (toolCall) => {
          const tool = this.tools.get(toolCall.name)
          if (!tool) {
            return {
              toolCallId: toolCall.id,
              result: null,
              error: `Tool ${toolCall.name} not found`,
            }
          }

          try {
            const result = await tool.handler(toolCall.arguments)
            return {
              toolCallId: toolCall.id,
              result,
            }
          } catch (error) {
            return {
              toolCallId: toolCall.id,
              result: null,
              error: error instanceof Error ? error.message : "Unknown error",
            }
          }
        })
      )

      newMessage.toolResults = toolResults

      // Continue conversation with tool results
      return this.run({
        ...state,
        messages: [...state.messages, newMessage],
      })
    }

    return {
      ...state,
      messages: [...state.messages, newMessage],
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatMessages(messages: AgentMessage[]): any[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formatted: any[] = []
    
    // Add system prompt if provided
    if (this.config.systemPrompt) {
      formatted.push({
        role: "system",
        content: this.config.systemPrompt,
      })
    }

    // Format user/assistant messages
    for (const msg of messages) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const formattedMsg: any = {
        role: msg.role,
        content: msg.content,
      }

      if (msg.toolCalls && msg.toolCalls.length > 0) {
        formattedMsg.tool_calls = msg.toolCalls.map(tc => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }))
      }

      if (msg.toolResults && Array.isArray(msg.toolResults) && msg.toolResults.length > 0) {
        const firstResult = msg.toolResults[0]
        if (firstResult) {
          formattedMsg.tool_call_id = firstResult.toolCallId
          formattedMsg.content = JSON.stringify(msg.toolResults.map(tr => ({
            toolCallId: tr.toolCallId,
            result: tr.result,
            error: tr.error,
          })))
        }
      }

      formatted.push(formattedMsg)
    }

    return formatted
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatTools(): any[] {
    if (this.tools.size === 0) return []
    
    return Array.from(this.tools.values()).map(tool => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }
}

