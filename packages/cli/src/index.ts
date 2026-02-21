#!/usr/bin/env node
/**
 * @autorail/kap10 — Local-first code intelligence CLI.
 *
 * Commands:
 *   kap10 auth login   — Authenticate with kap10 server (RFC 8628 device flow)
 *   kap10 auth logout  — Remove stored credentials
 *   kap10 connect      — Golden path: auth + git detect + IDE config
 *   kap10 pull         — Download graph snapshot for a repo
 *   kap10 serve        — Start local MCP server with graph queries
 */

import { Command } from "commander"
import { registerAuthCommand } from "./commands/auth.js"
import { registerConnectCommand } from "./commands/connect.js"
import { registerPullCommand } from "./commands/pull.js"
import { registerServeCommand } from "./commands/serve.js"

const program = new Command()

program
  .name("kap10")
  .description("Local-first code intelligence CLI")
  .version("0.1.0")

registerAuthCommand(program)
registerConnectCommand(program)
registerPullCommand(program)
registerServeCommand(program)

program.parse()
