#!/usr/bin/env tsx
/**
 * Migration script for database schema updates
 * Usage: pnpm tsx scripts/migrate.ts
 *
 * Note: For Supabase, use the Supabase CLI for migrations:
 *   supabase db push
 *   supabase migration up
 *
 * This script can be used for custom data migrations.
 */

import { supabase } from "../lib/db/supabase"

async function migrate() {
  console.log("🔄 Starting migration...")

  try {
    // Verify database connectivity
    const { error } = await supabase.from("feature_flags").select("id").limit(1)
    if (error) {
      console.log("⚠️ Could not connect to Supabase:", error.message)
      console.log("   Make sure your SUPABASE_URL and SUPABASE_SECRET_KEY are set.")
      process.exit(1)
    }

    console.log("✅ Database connection verified!")

    // Add any custom data migration logic here
    // For schema migrations, use: supabase migration up

    console.log("✅ Migration completed successfully!")
  } catch (error) {
    console.error("❌ Migration failed:", error)
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

migrate()
