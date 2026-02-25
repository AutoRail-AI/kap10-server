#!/usr/bin/env tsx
/**
 * Seed script for development
 * Usage: pnpm tsx scripts/seed.ts
 */

async function seed() {
  console.log("🌱 Starting seed...")

  try {
    // TODO: Add Unerr seed data here
    console.log("✅ Seed completed successfully!")
  } catch (error: unknown) {
    console.error(
      "❌ Seed failed:",
      error instanceof Error ? error.message : String(error)
    )
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

seed()
