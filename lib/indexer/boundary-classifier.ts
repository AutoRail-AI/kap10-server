/**
 * I-03: System Boundary Classifier — classifies third-party imports by category.
 *
 * Maps known npm/PyPI/Go/Maven packages to boundary categories (payment, database,
 * cache, messaging, auth, cloud, monitoring, http-client, testing, ui-framework).
 * Unknown packages are classified as "third-party".
 */

export type BoundaryCategory =
  | "payment"
  | "database"
  | "cache"
  | "messaging"
  | "auth"
  | "cloud"
  | "monitoring"
  | "http-client"
  | "testing"
  | "ui-framework"
  | "ai-ml"
  | "third-party"

/**
 * Known package → category mappings for npm ecosystem.
 * Prefix matching: "@aws-sdk" matches "@aws-sdk/client-s3".
 */
const NPM_CATEGORIES: Array<{ pattern: string; category: BoundaryCategory }> = [
  // Payment
  { pattern: "stripe", category: "payment" },
  { pattern: "braintree", category: "payment" },
  { pattern: "paypal", category: "payment" },
  { pattern: "@paddle", category: "payment" },
  { pattern: "razorpay", category: "payment" },

  // Database / ORM
  { pattern: "pg", category: "database" },
  { pattern: "mysql2", category: "database" },
  { pattern: "mongoose", category: "database" },
  { pattern: "mongodb", category: "database" },
  { pattern: "@prisma", category: "database" },
  { pattern: "prisma", category: "database" },
  { pattern: "typeorm", category: "database" },
  { pattern: "drizzle-orm", category: "database" },
  { pattern: "knex", category: "database" },
  { pattern: "sequelize", category: "database" },
  { pattern: "arangojs", category: "database" },
  { pattern: "@supabase", category: "database" },
  { pattern: "better-sqlite3", category: "database" },
  { pattern: "sqlite3", category: "database" },

  // Cache / Queue
  { pattern: "ioredis", category: "cache" },
  { pattern: "redis", category: "cache" },
  { pattern: "memcached", category: "cache" },
  { pattern: "lru-cache", category: "cache" },

  // Messaging
  { pattern: "amqplib", category: "messaging" },
  { pattern: "kafkajs", category: "messaging" },
  { pattern: "@aws-sdk/client-sqs", category: "messaging" },
  { pattern: "@aws-sdk/client-sns", category: "messaging" },
  { pattern: "bullmq", category: "messaging" },
  { pattern: "bull", category: "messaging" },
  { pattern: "@temporalio", category: "messaging" },

  // Auth
  { pattern: "passport", category: "auth" },
  { pattern: "better-auth", category: "auth" },
  { pattern: "jsonwebtoken", category: "auth" },
  { pattern: "jose", category: "auth" },
  { pattern: "@auth", category: "auth" },
  { pattern: "next-auth", category: "auth" },
  { pattern: "@clerk", category: "auth" },

  // Cloud
  { pattern: "@aws-sdk", category: "cloud" },
  { pattern: "@google-cloud", category: "cloud" },
  { pattern: "@azure", category: "cloud" },
  { pattern: "firebase", category: "cloud" },

  // Monitoring / Logging
  { pattern: "@sentry", category: "monitoring" },
  { pattern: "pino", category: "monitoring" },
  { pattern: "winston", category: "monitoring" },
  { pattern: "dd-trace", category: "monitoring" },
  { pattern: "@opentelemetry", category: "monitoring" },
  { pattern: "newrelic", category: "monitoring" },

  // HTTP Client
  { pattern: "axios", category: "http-client" },
  { pattern: "node-fetch", category: "http-client" },
  { pattern: "undici", category: "http-client" },
  { pattern: "got", category: "http-client" },
  { pattern: "ky", category: "http-client" },
  { pattern: "@octokit", category: "http-client" },

  // Testing
  { pattern: "vitest", category: "testing" },
  { pattern: "jest", category: "testing" },
  { pattern: "mocha", category: "testing" },
  { pattern: "@playwright", category: "testing" },
  { pattern: "cypress", category: "testing" },
  { pattern: "supertest", category: "testing" },

  // UI Framework
  { pattern: "react", category: "ui-framework" },
  { pattern: "vue", category: "ui-framework" },
  { pattern: "@angular", category: "ui-framework" },
  { pattern: "svelte", category: "ui-framework" },
  { pattern: "next", category: "ui-framework" },
  { pattern: "nuxt", category: "ui-framework" },

  // AI/ML
  { pattern: "@ai-sdk", category: "ai-ml" },
  { pattern: "openai", category: "ai-ml" },
  { pattern: "@anthropic-ai", category: "ai-ml" },
  { pattern: "@google/generative-ai", category: "ai-ml" },
  { pattern: "langchain", category: "ai-ml" },
  { pattern: "llamaindex", category: "ai-ml" },
]

/**
 * Known Python package → category mappings.
 */
const PYTHON_CATEGORIES: Array<{ pattern: string; category: BoundaryCategory }> = [
  { pattern: "stripe", category: "payment" },
  { pattern: "sqlalchemy", category: "database" },
  { pattern: "django.db", category: "database" },
  { pattern: "psycopg", category: "database" },
  { pattern: "pymongo", category: "database" },
  { pattern: "redis", category: "cache" },
  { pattern: "celery", category: "messaging" },
  { pattern: "pika", category: "messaging" },
  { pattern: "kafka", category: "messaging" },
  { pattern: "boto3", category: "cloud" },
  { pattern: "google.cloud", category: "cloud" },
  { pattern: "azure", category: "cloud" },
  { pattern: "requests", category: "http-client" },
  { pattern: "httpx", category: "http-client" },
  { pattern: "aiohttp", category: "http-client" },
  { pattern: "sentry_sdk", category: "monitoring" },
  { pattern: "pytest", category: "testing" },
  { pattern: "unittest", category: "testing" },
  { pattern: "flask", category: "ui-framework" },
  { pattern: "django", category: "ui-framework" },
  { pattern: "fastapi", category: "ui-framework" },
  { pattern: "openai", category: "ai-ml" },
  { pattern: "anthropic", category: "ai-ml" },
  { pattern: "langchain", category: "ai-ml" },
]

/**
 * Known Go module prefix → category mappings.
 */
const GO_CATEGORIES: Array<{ pattern: string; category: BoundaryCategory }> = [
  { pattern: "github.com/stripe", category: "payment" },
  { pattern: "gorm.io", category: "database" },
  { pattern: "github.com/jackc/pgx", category: "database" },
  { pattern: "github.com/go-sql-driver", category: "database" },
  { pattern: "go.mongodb.org", category: "database" },
  { pattern: "github.com/go-redis", category: "cache" },
  { pattern: "github.com/nats-io", category: "messaging" },
  { pattern: "github.com/segmentio/kafka-go", category: "messaging" },
  { pattern: "github.com/rabbitmq", category: "messaging" },
  { pattern: "github.com/aws/aws-sdk-go", category: "cloud" },
  { pattern: "cloud.google.com", category: "cloud" },
  { pattern: "github.com/getsentry/sentry-go", category: "monitoring" },
  { pattern: "go.opentelemetry.io", category: "monitoring" },
  { pattern: "github.com/gin-gonic", category: "ui-framework" },
  { pattern: "github.com/labstack/echo", category: "ui-framework" },
  { pattern: "github.com/gofiber", category: "ui-framework" },
  { pattern: "github.com/sashabaranov/go-openai", category: "ai-ml" },
]

/**
 * Known Java package → category mappings.
 */
const JAVA_CATEGORIES: Array<{ pattern: string; category: BoundaryCategory }> = [
  { pattern: "com.stripe", category: "payment" },
  { pattern: "org.hibernate", category: "database" },
  { pattern: "org.springframework.data", category: "database" },
  { pattern: "org.apache.kafka", category: "messaging" },
  { pattern: "com.rabbitmq", category: "messaging" },
  { pattern: "software.amazon.awssdk", category: "cloud" },
  { pattern: "com.google.cloud", category: "cloud" },
  { pattern: "io.sentry", category: "monitoring" },
  { pattern: "io.opentelemetry", category: "monitoring" },
  { pattern: "org.springframework.web", category: "ui-framework" },
  { pattern: "org.springframework.boot", category: "ui-framework" },
  { pattern: "junit", category: "testing" },
  { pattern: "org.mockito", category: "testing" },
  { pattern: "org.springframework.security", category: "auth" },
]

function classifyFromList(
  packageName: string,
  list: Array<{ pattern: string; category: BoundaryCategory }>
): BoundaryCategory {
  for (const { pattern, category } of list) {
    if (packageName === pattern || packageName.startsWith(pattern + "/") || packageName.startsWith(pattern + ".")) {
      return category
    }
  }
  return "third-party"
}

/**
 * Classify a third-party import by its package name and language.
 */
export function classifyBoundary(
  packageName: string,
  language: "typescript" | "python" | "go" | "java" | string
): BoundaryCategory {
  switch (language) {
    case "typescript":
    case "javascript":
      return classifyFromList(packageName, NPM_CATEGORIES)
    case "python":
      return classifyFromList(packageName, PYTHON_CATEGORIES)
    case "go":
      return classifyFromList(packageName, GO_CATEGORIES)
    case "java":
      return classifyFromList(packageName, JAVA_CATEGORIES)
    default:
      return "third-party"
  }
}

/**
 * Check if an import source is external (third-party or stdlib).
 * Returns the extracted package name if external, null if internal.
 */
export function extractExternalPackageName(
  source: string,
  language: string
): string | null {
  switch (language) {
    case "typescript":
    case "javascript": {
      // Internal: relative (./, ../) or alias (@/, ~/)
      if (source.startsWith(".") || source.startsWith("@/") || source.startsWith("~/")) return null
      // Scoped packages: @scope/name → @scope/name
      if (source.startsWith("@")) {
        const parts = source.split("/")
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : source
      }
      // Bare packages: lodash, express → first segment
      return source.split("/")[0] ?? source
    }
    case "python": {
      // Relative imports are internal
      if (source.startsWith(".")) return null
      // Absolute imports: top-level package name
      return source.split(".")[0] ?? source
    }
    case "go": {
      // Standard library: single-segment or known prefixes handled elsewhere
      // External: multi-segment with domain (github.com/..., golang.org/...)
      if (!source.includes("/")) return null // stdlib
      return source
    }
    case "java": {
      // java.*, javax.*, sun.*, jdk.* are stdlib
      if (source.startsWith("java.") || source.startsWith("javax.") ||
          source.startsWith("sun.") || source.startsWith("jdk.")) return null
      // Top 2-3 segments as package identifier
      const parts = source.split(".")
      return parts.slice(0, Math.min(3, parts.length)).join(".")
    }
    default:
      return null
  }
}
