#!/usr/bin/env npx tsx
/**
 * Background Job Worker
 *
 * This script runs the BullMQ workers to process background jobs.
 * Run this as a separate process alongside your Next.js app.
 *
 * Usage:
 *   pnpm worker          # Start workers
 *   npx tsx scripts/worker.ts
 *
 * In production, run this as a separate service/container.
 */

import { closeRedis, startWorkers, stopWorkers } from "../lib/queue"

console.log("Starting background job worker...")

// Start workers
startWorkers()

// Graceful shutdown
const shutdown = async () => {
  console.log("\nShutting down workers...")
  await stopWorkers()
  await closeRedis()
  console.log("Workers shut down successfully")
  process.exit(0)
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

// Keep the process running
console.log("Worker is running. Press Ctrl+C to stop.")
