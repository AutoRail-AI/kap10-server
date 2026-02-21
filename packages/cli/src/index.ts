#!/usr/bin/env node
/**
 * @autorail/kap10 — Local-first code intelligence CLI.
 *
 * Commands:
 *   kap10 auth login      — Authenticate with kap10 server (RFC 8628 device flow)
 *   kap10 auth logout     — Remove stored credentials
 *   kap10 connect         — Golden path: auth + git detect + IDE config
 *   kap10 init            — Register a local repo with kap10 server
 *   kap10 push            — Upload local repository for indexing
 *   kap10 pull            — Download graph snapshot for a repo
 *   kap10 serve           — Start local MCP server with graph queries
 *   kap10 watch           — Watch for file changes and sync to kap10 server
 *   kap10 rewind          — Revert ledger to a previous working state
 *   kap10 timeline        — Show the prompt ledger timeline
 *   kap10 mark-working    — Mark a ledger entry as a known-good working state
 *   kap10 branches        — Show timeline branches for this repository
 *   kap10 circuit-reset   — Reset a tripped circuit breaker for an entity
 *   kap10 config verify   — Check and repair MCP configuration for IDEs
 *   kap10 config install-hooks — Install git hooks for auto-verification
 */

import { Command } from "commander"
import { registerAuthCommand } from "./commands/auth.js"
import { registerBranchesCommand } from "./commands/branches.js"
import { registerCircuitResetCommand } from "./commands/circuit-reset.js"
import { registerConfigVerifyCommand } from "./commands/config-verify.js"
import { registerConnectCommand } from "./commands/connect.js"
import { registerInitCommand } from "./commands/init.js"
import { registerMarkWorkingCommand } from "./commands/mark-working.js"
import { registerPushCommand } from "./commands/push.js"
import { registerPullCommand } from "./commands/pull.js"
import { registerRewindCommand } from "./commands/rewind.js"
import { registerServeCommand } from "./commands/serve.js"
import { registerTimelineCommand } from "./commands/timeline.js"
import { registerWatchCommand } from "./commands/watch.js"

const program = new Command()

program
  .name("kap10")
  .description("Local-first code intelligence CLI")
  .version("0.1.0")

registerAuthCommand(program)
registerBranchesCommand(program)
registerCircuitResetCommand(program)
registerConfigVerifyCommand(program)
registerConnectCommand(program)
registerInitCommand(program)
registerMarkWorkingCommand(program)
registerPushCommand(program)
registerPullCommand(program)
registerRewindCommand(program)
registerServeCommand(program)
registerTimelineCommand(program)
registerWatchCommand(program)

program.parse()
