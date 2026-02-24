/**
 * Shared environment loader for scripts and workers.
 *
 * Load order (first file found wins per-variable, later files don't overwrite):
 *   1. Shell environment (always takes precedence — never overwritten by dotenv)
 *   2. `.env.local`  — local dev overrides (gitignored, Next.js convention)
 *   3. `.env`        — production/shared defaults (may be committed or Docker-injected)
 *
 * In Docker containers, env vars come from docker-compose `environment:` + `env_file:`,
 * so dotenv is a no-op (all vars are already in process.env). This is safe to call always.
 *
 * Import this file BEFORE any other imports that read process.env at module scope:
 *   import "./load-env"
 */

import { config } from "dotenv"
import path from "node:path"

const root = process.cwd()

// quiet: true — no error if file doesn't exist (e.g. production Docker container)
// dotenv never overwrites existing env vars, so shell env > .env.local > .env
config({ path: path.resolve(root, ".env.local"), quiet: true })
config({ path: path.resolve(root, ".env"), quiet: true })
