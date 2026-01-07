import { createEnv } from "@t3-oss/env-nextjs"
import { z } from "zod"

export const env = createEnv({
  server: {
    ANALYZE: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    // Database
    MONGODB_URI: z.string().url().optional(),
    // Redis (for job queues)
    REDIS_URL: z.string().url().optional(),
    // Better Auth
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    BETTER_AUTH_URL: z.string().url().optional(),
    // Google OAuth
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    // Email (Resend)
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().email().optional(),
    // Uploadthing (file uploads)
    UPLOADTHING_TOKEN: z.string().optional(),
    // AI Agent Configuration
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    TAVILY_API_KEY: z.string().optional(),
    // Organization Settings
    ORGANIZATION_LIMIT: z.string().optional(),
    MEMBERSHIP_LIMIT: z.string().optional(),
    // Stripe Billing
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_ID_FREE: z.string().optional(),
    STRIPE_PRICE_ID_PRO: z.string().optional(),
    STRIPE_PRICE_ID_ENTERPRISE: z.string().optional(),
    // PostHog Analytics
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
    NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
    // Sentry Error Tracking
    SENTRY_DSN: z.string().url().optional(),
    SENTRY_AUTH_TOKEN: z.string().optional(),
    // Feature Flags
    FEATURE_FLAGS_ENABLED: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
    NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
  },
  runtimeEnv: {
    ANALYZE: process.env.ANALYZE,
    MONGODB_URI: process.env.MONGODB_URI,
    REDIS_URL: process.env.REDIS_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    UPLOADTHING_TOKEN: process.env.UPLOADTHING_TOKEN,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    // AI Agent Configuration
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    // Organization Settings
    ORGANIZATION_LIMIT: process.env.ORGANIZATION_LIMIT,
    MEMBERSHIP_LIMIT: process.env.MEMBERSHIP_LIMIT,
    // Stripe Billing
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_ID_FREE: process.env.STRIPE_PRICE_ID_FREE,
    STRIPE_PRICE_ID_PRO: process.env.STRIPE_PRICE_ID_PRO,
    STRIPE_PRICE_ID_ENTERPRISE: process.env.STRIPE_PRICE_ID_ENTERPRISE,
    // PostHog Analytics
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    // Sentry Error Tracking
    SENTRY_DSN: process.env.SENTRY_DSN,
    SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
    // Feature Flags
    FEATURE_FLAGS_ENABLED: process.env.FEATURE_FLAGS_ENABLED,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  },
})
