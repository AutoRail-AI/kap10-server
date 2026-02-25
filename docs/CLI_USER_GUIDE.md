# unerr CLI — User Guide

**@autorail/unerr** is the local-first code intelligence CLI. It connects your IDE to unerr's graph, rules, and MCP tools so AI coding agents can query your codebase and enforce standards.

---

## Table of Contents

1. [What the CLI Does](#what-the-cli-does)
2. [Installation](#installation)
3. [Quick Start](#quick-start)
4. [Authentication](#authentication)
5. [Commands Reference](#commands-reference)
6. [Concepts](#concepts)
7. [MCP Tools (Local Serve)](#mcp-tools-local-serve)
8. [Configuration & Files](#configuration--files)
9. [Troubleshooting](#troubleshooting)

---

## What the CLI Does

- **One-command setup** — Authenticate, detect your IDE and repo, connect GitHub, analyze your code, and configure MCP. All from a single command.
- **Upload code for indexing** — Push your repo so unerr can build a knowledge graph.
- **Pull graph snapshots** — Download pre-built graphs for fast local queries.
- **Run a local MCP server** — Use the graph locally in Cursor, VS Code, Claude Code, or Windsurf.
- **Manage the prompt ledger** — Work with timelines, branches, and revert points.
- **Verify and repair MCP config** — Keep IDE config aligned after branch switches.

---

## Installation

```bash
npx @autorail/unerr --version
```

Or install globally:

```bash
npm install -g @autorail/unerr
```

**Requirements:** Node.js ≥ 20.9.0

---

## Quick Start

Run this inside your project directory:

```bash
npx @autorail/unerr
```

That's it. The wizard handles everything:

1. **Authenticate** — Opens your browser for a one-click device login (or pass `--key` to skip).
2. **Detect your coding agent** — Auto-detects Cursor, Claude Code, VS Code, or Windsurf. Asks you to pick if it can't tell.
3. **Detect your repository** — Reads your git remote and branch. Detects whether it's GitHub, GitLab, Bitbucket, or plain git.
4. **Check unerr** — Looks up whether your repo is already indexed. Skips ahead if it is.
5. **Connect GitHub** — If your repo is on GitHub and the unerr GitHub App isn't installed, it opens your browser to install it. The CLI waits for you to finish.
6. **Select repos** — Shows an interactive list of repos from your GitHub installations. Your current repo is pre-selected.
7. **Analyze** — Triggers indexing and shows a progress spinner. Waits until analysis is complete.
8. **Configure MCP** — Writes the unerr entry to your IDE's MCP config file (`.cursor/mcp.json`, `.vscode/settings.json`, `.windsurf/mcp.json`, or prints a `claude mcp add` command).
9. **Install git hooks** — Adds `post-checkout` / `post-merge` hooks to keep MCP config in sync.

**Happy path (already set up):**

If you're already authenticated, the GitHub App is installed, and the repo is indexed, the whole thing collapses to a few seconds:

```
$ npx @autorail/unerr

  unerr  Code intelligence for AI agents

  ✓ Authenticated as Jaswanth's Organization
  ✓ Detected Cursor
  ✓ GitHub repo: jaswanth/unerr-server (main)
  ✓ Already indexed: jaswanth/unerr-server
  ✓ Written: .cursor/mcp.json

  ✓ Ready! Your AI agent now has access to your codebase graph.
```

**Options:**

```bash
npx @autorail/unerr --key unerr_sk_xxxxx       # Skip browser login
npx @autorail/unerr --ide cursor                # Skip IDE detection
npx @autorail/unerr --server https://my.host    # Custom server URL
```

### Non-GitHub repos

If your repo is on GitLab, Bitbucket, or has no remote, the CLI uses the local flow instead:

1. Registers the repo with unerr (`unerr init`)
2. Creates a `.gitignore`-aware zip and uploads it
3. Triggers indexing on the server
4. Configures MCP

---

## Authentication

Credentials are stored in `~/.unerr/credentials.json` with `0600` permissions.

| Command | Description |
|--------|-------------|
| `unerr auth login` | Authenticate via browser (RFC 8628 device flow) or `--key` |
| `unerr auth logout` | Delete stored credentials |
| `unerr auth status` | Show current auth status (server, org, masked key) |

**Options for `auth login`:**
- `--server <url>` — Server URL (default: `https://app.unerr.dev`)
- `--key <apiKey>` — Use an API key instead of the browser flow

---

## Commands Reference

### Setup (Default)

| Command | Description |
|---------|-------------|
| `unerr` | Full setup wizard: auth → IDE detect → git → GitHub → index → MCP config |
| `unerr connect` | Quick connect: auth → git detect → MCP config (no GitHub flow or indexing) |
| `unerr init` | Register a local repo with the unerr server (creates `.unerr/config.json`) |

**Default command options:**
- `--server <url>` — Server URL (default: `https://app.unerr.dev`)
- `--key <apiKey>` — Use API key (skip browser login)
- `--ide <type>` — IDE: `cursor`, `vscode`, `claude-code`, `windsurf` (auto-detected if omitted)

**`connect` options:**
- `--server <url>` — Server URL (default: `https://app.unerr.dev`)
- `--key <apiKey>` — Use API key (skip browser login)
- `--ide <type>` — IDE: `cursor`, `vscode`, or `claude-code` (auto-detected if omitted)
- `--ephemeral` — Create a short-lived sandbox (4-hour expiry)

**`init` options:**
- `--server <url>` — Server URL (default: `UNERR_SERVER_URL` env var or `http://localhost:3000`)
- `--branch <branch>` — Default branch (default: `main`)
- `--ephemeral` — Create an ephemeral sandbox (4-hour expiry)

### Graph Sync

| Command | Description |
|---------|-------------|
| `unerr push` | Upload the repo for cloud indexing (`.gitignore`-aware zip) |
| `unerr pull --repo <repoId>` | Download graph snapshot to `~/.unerr/snapshots/` |
| `unerr serve` | Start a local MCP server using pulled snapshots |
| `unerr watch` | Watch files and sync diffs to the server |

**`push` options:**
- `--local-parse` — Use local AST extraction (requires `unerr-parse` binary)

**`pull` options:**
- `--force` — Re-download even if the local snapshot checksum matches the server

**`serve` options:**
- `--repo <repoId>` — Serve a specific repo (default: all pulled repos)
- `--prefetch` / `--no-prefetch` — Turn predictive context pre-fetching on or off (default: off)

On startup, `serve` checks snapshot age. Snapshots older than 24 hours trigger a staleness warning suggesting you re-pull.

**`watch` options:**
- `--debounce <ms>` — Debounce interval (default: 2000)

`watch` also monitors MCP config integrity every 60 seconds. If it detects that the unerr entry was removed from your IDE config (e.g. after a branch switch), it auto-repairs it.

### Ephemeral Sandboxes

| Command | Description |
|---------|-------------|
| `unerr connect --ephemeral` | Create a temporary sandbox (expires in 4 hours) |
| `unerr init --ephemeral` | Register a local repo as an ephemeral sandbox |
| `unerr promote` | Promote an ephemeral repo to permanent |

Use ephemeral mode for quick experiments, then run `unerr promote` when you're ready to keep the repo.

### Prompt Ledger (Timeline)

The prompt ledger records agent edits and supports timelines and reverts.

| Command | Description |
|---------|-------------|
| `unerr timeline` | List ledger entries (formatted table) |
| `unerr branches` | List timeline branches with entry counts and statuses |
| `unerr mark-working <entry-id>` | Mark an entry as a known-good state |
| `unerr rewind <entry-id>` | Revert to a previous state |

**`timeline` options:**
- `--branch <branch>` — Filter by git branch
- `--status <status>` — Filter: `pending`, `working`, `broken`, `committed`, `reverted`
- `--limit <n>` — Max entries (default: 20)

**`rewind` options:**
- `--dry-run` — Show blast radius (safe files, conflicted files, at-risk files) without making changes

### Circuit Breaker & Config

| Command | Description |
|---------|-------------|
| `unerr circuit-reset <entity-key>` | Reset a tripped circuit breaker for an entity |
| `unerr config verify` | Check MCP config for Cursor, VS Code, Windsurf |
| `unerr config install-hooks` | Install git hooks for MCP config verification |

**`config verify` options:**
- `--repair` — Auto-fix MCP config issues
- `--silent` — Only report errors
- `--ide <ide>` — Limit to `vscode`, `cursor`, or `windsurf`

`config verify` checks the global IDE config paths (e.g. `~/.cursor/mcp.json`). This is separate from the project-level configs that the setup wizard and `connect` write (e.g. `.cursor/mcp.json` in the project root).

---

## Concepts

### How IDE Detection Works

The CLI auto-detects which coding agent you're using:

| Priority | Signal | IDE |
|----------|--------|-----|
| 1 | `CURSOR_TRACE_ID` environment variable | Cursor |
| 2 | `CLAUDE_CODE` environment variable | Claude Code |
| 3 | `TERM_PROGRAM=vscode` with Cursor paths | Cursor |
| 4 | `claude` in parent process name | Claude Code |
| 5 | `.cursor/` directory in project | Cursor |
| 6 | `.windsurf/` directory in project | Windsurf |
| 7 | `TERM_PROGRAM=vscode` | VS Code |
| 8 | `.vscode/` directory in project | VS Code |

If none of these match, the CLI asks you to pick from an interactive menu.

### GitHub vs Local Flow

The setup wizard automatically chooses the right flow based on your git remote:

- **GitHub repos** (`github.com`) — Uses the GitHub App flow: installs the unerr GitHub App, lists available repos, selects repos, and triggers server-side cloning + indexing.
- **Non-GitHub repos** (GitLab, Bitbucket, plain git, no remote) — Uses the local flow: registers the repo, uploads a `.gitignore`-aware zip, and triggers indexing.

### Graph Snapshot

A snapshot is a packed view of the code graph (entities, edges, rules, patterns). Pulled snapshots are stored in `~/.unerr/snapshots/{repoId}.msgpack` with a manifest in `~/.unerr/manifests/`.

- **v1:** entities + edges
- **v2:** also includes rules and patterns

Snapshots are verified by SHA-256 checksum after download. The `pull` command skips re-downloading when the local checksum already matches the server unless `--force` is used.

### Local vs Cloud MCP

When you run `unerr serve`:

- **Local tools (9)** — Use the pulled snapshot (CozoDB): `get_function`, `get_class`, `get_file`, `get_callers`, `get_callees`, `get_imports`, `search_code`, `get_rules`, `check_rules`
- **Cloud tools (4)** — Call the unerr server: `semantic_search`, `find_similar`, `get_project_stats`, `sync_local_diff`

Local tools return quickly; cloud tools need the server. If a local tool fails, it automatically falls back to the cloud.

`get_rules` and `check_rules` fall back to cloud when the local snapshot doesn't contain rules (v1 snapshots or empty rule sets).

### Ephemeral Sandbox

An ephemeral sandbox is a temporary repo that expires in 4 hours. It's useful for try-before-commit. Use `unerr promote` to turn it into a permanent repo.

### Prompt Ledger

The ledger tracks agent edits over time. Entries have states like `working`, `broken`, `committed`, `reverted`. You can inspect branches, mark working points, and rewind.

---

## MCP Tools (Local Serve)

When you run `unerr serve`, these 13 tools are available:

| Tool | Source | Description |
|------|--------|-------------|
| `get_function` | Local | Function by key |
| `get_class` | Local | Class by key |
| `get_file` | Local | File entities by key |
| `get_callers` | Local | Callers of an entity |
| `get_callees` | Local | Callees of an entity |
| `get_imports` | Local | Imports for a file path |
| `search_code` | Local | Search entities by name (default limit: 20) |
| `get_rules` | Local | Rules for a file path (falls back to cloud if no local rules) |
| `check_rules` | Local | Evaluate structural + naming rules on content (falls back to cloud if no local rules) |
| `semantic_search` | Cloud | Semantic vector search |
| `find_similar` | Cloud | Find similar entities by key |
| `get_project_stats` | Cloud | Project-level stats |
| `sync_local_diff` | Cloud | Sync local changes to server |

Rules tools require a v2 snapshot. With a v1 snapshot, rule queries are routed to the cloud.

---

## Configuration & Files

### Project-level (per repo)

| Location | Purpose |
|----------|---------|
| `.unerr/config.json` | Repo config (`repoId`, `serverUrl`, `orgId`, `branch`) |
| `.unerr/logs/setup-{date}.log` | Setup wizard logs (API calls, responses, errors) |
| `.cursor/mcp.json` | Cursor MCP config (written by setup wizard / `connect`) |
| `.vscode/settings.json` | VS Code MCP config (written by setup wizard / `connect`) |
| `.windsurf/mcp.json` | Windsurf MCP config (written by setup wizard / `connect`) |

`.unerr/` is added to `.gitignore` by `unerr init` and the setup wizard.

### User-level (global)

| Location | Purpose |
|----------|---------|
| `~/.unerr/credentials.json` | Auth (API key, server URL, org) |
| `~/.unerr/snapshots/{repoId}.msgpack` | Pulled graph snapshots |
| `~/.unerr/manifests/{repoId}.json` | Snapshot metadata (checksum, counts, pull timestamp) |
| `~/.cursor/mcp.json` | Global Cursor MCP config (checked by `config verify`) |
| `~/.vscode/settings.json` | Global VS Code MCP config (checked by `config verify`) |
| `~/.windsurf/mcp.json` | Global Windsurf MCP config (checked by `config verify`) |

---

## Troubleshooting

### "Not authenticated. Run: unerr auth login"

Run `unerr auth login` or just `npx @autorail/unerr` to start the full setup.

### "Could not auto-detect your coding agent"

The CLI will show an interactive prompt to let you pick. You can also pass `--ide cursor` (or `vscode`, `claude-code`, `windsurf`) to skip detection.

### "No git repository detected"

Run the CLI from the project root (inside a git repo). For repos without a remote, the CLI uses the local upload flow.

### "This repo isn't on unerr yet"

The setup wizard handles this automatically — it installs the GitHub App and adds the repo. If running `unerr connect` instead, it will show the dashboard URL to add the repo manually.

### "No snapshots found. Run: unerr pull --repo &lt;repoId&gt;"

`unerr serve` needs at least one pulled snapshot. Use `unerr pull --repo <repoId>` first. Repo ID comes from the dashboard or `.unerr/config.json`.

### "Snapshot for X is Xh old (stale)"

The local snapshot is older than 24 hours. Run `unerr pull --repo <repoId>` to get the latest graph.

### "Default key already exists. Use --key to provide it manually."

Your organization already has a default API key. Retrieve it from the dashboard or pass it directly with `--key unerr_sk_xxxxx`.

### "GitHub App not installed for this organization"

Run `npx @autorail/unerr` — the setup wizard will prompt you to install the GitHub App. Or install it manually from the dashboard settings.

### MCP config removed or wrong after switching branches

Use `unerr config verify --repair` or ensure `post-checkout` / `post-merge` hooks are installed with `unerr config install-hooks`. The `watch` command also auto-repairs config drift every 60 seconds while running.

### Ephemeral sandbox expired

Run `unerr promote` before expiry, or re-create with `unerr connect --ephemeral` if it has already expired.

### "Not initialized. Run: unerr init"

Commands like `push`, `watch`, `timeline`, `branches`, `mark-working`, `rewind`, and `circuit-reset` require a `.unerr/config.json` in the current directory. Run `unerr init` or use the setup wizard (`npx @autorail/unerr`).

### Checking setup logs

All setup wizard API calls and errors are logged to `.unerr/logs/setup-{date}.log`. Check this file for detailed debugging information when something goes wrong.

---

*unerr CLI v0.1.0 — Local-first code intelligence for AI coding agents.*
