import mongoose from "mongoose"
import { connectDB } from "@/lib/db/mongodb"
import type { AgentTool } from "../types"

export const databaseTool: AgentTool = {
  name: "query_database",
  description: "Query the database for information. Use this to search for users, organizations, or other data.",
  parameters: {
    type: "object",
    properties: {
      collection: {
        type: "string",
        description: "The collection name (e.g., 'user', 'organization')",
      },
      query: {
        type: "object",
        description: "MongoDB query object (as JSON string)",
      },
      limit: {
        type: "number",
        description: "Maximum number of results (default: 10)",
      },
    },
    required: ["collection", "query"],
  },
  handler: async ({ collection, query, limit = 10 }) => {
    try {
      await connectDB()
      const queryObj = typeof query === "string" ? JSON.parse(query) : query
      const coll = mongoose.connection.collection(collection)
      const results = await coll.find(queryObj).limit(limit).toArray()
      return { success: true, results, count: results.length }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  },
}

export const emailTool: AgentTool = {
  name: "send_email",
  description: "Send an email to a user. Use this to send notifications, reports, or other communications.",
  parameters: {
    type: "object",
    properties: {
      to: {
        type: "string",
        description: "Recipient email address",
      },
      subject: {
        type: "string",
        description: "Email subject",
      },
      body: {
        type: "string",
        description: "Email body (HTML supported)",
      },
    },
    required: ["to", "subject", "body"],
  },
  handler: async ({ to, subject, body }) => {
    try {
      const { Resend } = await import("resend")
      const resend = new Resend(process.env.RESEND_API_KEY)
      
      if (!process.env.RESEND_API_KEY) {
        return { success: false, error: "Resend API key not configured" }
      }

      const result = await resend.emails.send({
        from: process.env.EMAIL_FROM || "noreply@example.com",
        to,
        subject,
        html: body,
      })
      
      return { success: true, messageId: result.data?.id }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  },
}

export const webSearchTool: AgentTool = {
  name: "web_search",
  description: "Search the web for current information. Use this when you need up-to-date information that might not be in the database.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query",
      },
      maxResults: {
        type: "number",
        description: "Maximum number of results (default: 5)",
      },
    },
    required: ["query"],
  },
  handler: async ({ query: _query, maxResults: _maxResults = 5 }) => {
    // Placeholder implementation
    // In production, integrate with a search API like Tavily, Serper, or Google Custom Search
    try {
      // Example: You could use Tavily API
      // const response = await fetch("https://api.tavily.com/search", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({
      //     api_key: process.env.TAVILY_API_KEY,
      //     query,
      //     max_results: maxResults,
      //   }),
      // })
      // const data = await response.json()
      // return { success: true, results: data.results }
      
      return {
        success: true,
        message: "Web search not configured. Please set up a search API (Tavily, Serper, etc.)",
        results: [],
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  },
}

// Export all tools
export const defaultTools = [databaseTool, emailTool, webSearchTool]

