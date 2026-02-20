#!/usr/bin/env node
/**
 * @kap10/cli — Local-first code intelligence CLI.
 *
 * Commands:
 *   kap10 auth login   — Authenticate with kap10 server
 *   kap10 auth logout  — Remove stored credentials
 *   kap10 pull         — Download graph snapshot for a repo
 *   kap10 serve        — Start local MCP server with graph queries
 */

import { Command } from "commander"
import { registerAuthCommand } from "./commands/auth.js"
import { registerPullCommand } from "./commands/pull.js"
import { registerServeCommand } from "./commands/serve.js"

const program = new Command()

program
  .name("kap10")
  .description("Local-first code intelligence CLI")
  .version("0.1.0")

registerAuthCommand(program)
registerPullCommand(program)
registerServeCommand(program)

program.parse()
