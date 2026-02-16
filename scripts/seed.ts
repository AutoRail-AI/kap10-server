#!/usr/bin/env tsx
/**
 * Seed script for development
 * Usage: pnpm tsx scripts/seed.ts
 */

import { createTemplate } from "../lib/templates/manager"

async function seed() {
  console.log("🌱 Starting seed...")

  try {
    // Seed templates
    console.log("📝 Seeding templates...")
    await createTemplate({
      name: "Customer Support Agent",
      description: "A helpful customer support agent template",
      type: "agent",
      category: "support",
      tags: ["support", "customer-service"],
      content: {
        systemPrompt:
          "You are a helpful customer support agent. Be polite, professional, and solution-oriented.",
        tools: ["database", "email"],
      },
      public: true,
    })

    await createTemplate({
      name: "Content Writer",
      description: "AI content writing assistant",
      type: "prompt",
      category: "writing",
      tags: ["writing", "content"],
      content: {
        prompt: "Write engaging and SEO-friendly content about: {topic}",
      },
      variables: [
        {
          name: "topic",
          description: "The topic to write about",
          required: true,
        },
      ] as any,
      public: true,
    })

    console.log("✅ Seed completed successfully!")
  } catch (error) {
    console.error("❌ Seed failed:", error)
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

seed()
