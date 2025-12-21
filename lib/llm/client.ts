import { createOpenAI } from "@ai-sdk/openai"

/**
 * Provider-agnostic LLM client configuration
 *
 * Supports any OpenAI-compatible API endpoint including:
 * - OpenAI
 * - Azure OpenAI
 * - Local LLMs (Ollama, LM Studio, vLLM, etc.)
 * - Custom self-hosted models
 *
 * Configure via environment variables:
 * - LLM_API_URL: Base URL of the API (default: OpenAI)
 * - LLM_API_KEY: API key for authentication
 * - LLM_MODEL: Model name to use (default: gpt-4o)
 */

// Default configuration
const DEFAULT_API_URL = "https://api.openai.com/v1"
const DEFAULT_MODEL = "gpt-4o"

// Get configuration from environment
function getConfig() {
  return {
    apiUrl: process.env.LLM_API_URL || DEFAULT_API_URL,
    apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "",
    model: process.env.LLM_MODEL || DEFAULT_MODEL,
  }
}

/**
 * Create an LLM provider instance
 * Uses the AI SDK's OpenAI provider which is compatible with any
 * OpenAI-compatible API
 */
export function createLLMProvider() {
  const config = getConfig()

  if (!config.apiKey) {
    console.warn("LLM_API_KEY or OPENAI_API_KEY not set - LLM features will not work")
  }

  return createOpenAI({
    baseURL: config.apiUrl,
    apiKey: config.apiKey,
  })
}

/**
 * Get the configured model name
 */
export function getModel() {
  return getConfig().model
}

/**
 * Get the LLM model instance for use with AI SDK
 */
export function getLLMModel() {
  const provider = createLLMProvider()
  const modelName = getModel()
  return provider(modelName)
}

/**
 * Check if LLM is configured
 */
export function isLLMConfigured(): boolean {
  const config = getConfig()
  return Boolean(config.apiKey)
}

// Export types for external use
export interface LLMConfig {
  apiUrl: string
  apiKey: string
  model: string
}

export function getLLMConfig(): LLMConfig {
  return getConfig()
}
