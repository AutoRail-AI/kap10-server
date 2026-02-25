# Phase 11 — Native IDE Integrations: Deep Dive & Implementation Tracker

> **Phase Feature Statement:** _"I can see my codebase's architecture, impact graphs, and AI session timelines directly in my IDE — not just in a browser dashboard. The knowledge graph is a first-class citizen of my development environment."_
>
> **Source:** [`VERTICAL_SLICING_PLAN.md`](./VERTICAL_SLICING_PLAN.md) — Phase 11
>
> **Prerequisites:** [Phase 10b — Local-First Intelligence Proxy (Full)](./PHASE_10b_LOCAL_FIRST_INTELLIGENCE_PROXY_FULL.md) (local CozoDB graph, pre-fetch module, query router); [Phase 5.5 — Prompt Ledger](./PHASE_5.5_PROMPT_LEDGER_REWIND_AND_LOCAL_INGESTION.md) (ledger timeline data); All visualization-source phases (Phases 2-7) stable
>
> **What this is NOT:** Phase 11 does not add new data or intelligence capabilities — it provides IDE-native rendering of data that already exists in the cloud and local graph. It does not replace the web dashboard — the dashboard remains the primary management surface. It does not implement multiplayer collaboration or collision detection (Phase 12).
>
> **Delivery position:** Post-launch feature. Ships after Phase 10b. See [dependency graph](./VERTICAL_SLICING_PLAN.md#phase-summary--dependencies).

---

## Table of Contents

- [Part 1: Architectural Deep Dive](#part-1-architectural-deep-dive)
  - [1.1 Canonical Terminology](#11-canonical-terminology)
  - [1.2 Core User Flows](#12-core-user-flows)
  - [1.3 System Logic & State Management](#13-system-logic--state-management)
  - [1.4 Reliability & Resilience](#14-reliability--resilience)
  - [1.5 Performance Considerations](#15-performance-considerations)
  - [1.6 Phase Bridge → Phase 12](#16-phase-bridge--phase-12)
- [Part 2: Implementation & Tracing Tracker](#part-2-implementation--tracing-tracker)
  - [2.1 Infrastructure Layer](#21-infrastructure-layer)
  - [2.2 Database & Schema Layer](#22-database--schema-layer)
  - [2.3 Ports & Adapters Layer](#23-ports--adapters-layer)
  - [2.4 Backend / API Layer](#24-backend--api-layer)
  - [2.5 Frontend / UI Layer](#25-frontend--ui-layer)
  - [2.6 Testing & Verification](#26-testing--verification)

---

# Part 1: Architectural Deep Dive

## 1.1 Canonical Terminology

| Canonical term | DB / TS field | NOT called |
|---|---|---|
| **VS Code extension** | `packages/vscode-extension/`; published as `unerr-vscode` on VS Code Marketplace | "plugin", "add-on", "module" (use "plugin" only for JetBrains) |
| **JetBrains plugin** | `packages/jetbrains-plugin/`; published on JetBrains Marketplace | "extension" (use "extension" only for VS Code) |
| **`@unerr/ui`** | `packages/ui/`; shared React component library with no Next.js dependencies | "component lib", "design system" (those terms refer to the web app's internal components) |
| **WebView panel** | VS Code `WebviewView` or `WebviewPanel` rendering `@unerr/ui` React components | "iframe", "embedded browser", "webview" (lowercase) |
| **JCEF panel** | JetBrains JCEF (`JBCefBrowser`) rendering `@unerr/ui` React components | "WebView" (avoid — that's VS Code terminology), "embedded browser" |
| **Blueprint Dashboard** | Swimlane visualization of repo architecture (entities grouped by file/module) | "architecture diagram", "code map", "dependency graph" |
| **Impact Graph** | N-hop force-directed graph centered on an entity showing callers, callees, imports | "call graph", "dependency tree" (impact graph is entity-centric, not file-centric) |
| **Ledger Timeline** | Visual timeline of Prompt Ledger entries for a workspace (Phase 5.5 data) | "history", "audit log", "commit history" |
| **Diff Viewer** | Side-by-side or inline view of workspace overlay diff (Phase 2 data) | "code diff", "change view" |
| **postMessage bridge** | VS Code's `webview.postMessage()` / `acquireVsCodeApi().postMessage()` communication | "IPC", "message bus" |
| **CefMessageRouter** | JetBrains' `CefMessageRouter` for JS ↔ Kotlin bidirectional communication | "JS bridge", "native bridge" |

---

## 1.2 Core User Flows

Phase 11 has six actor journeys. Three are user-initiated (install, view panels, navigate), two are agent-initiated (MCP show tools), and one is system-initiated (real-time panel updates).

### Flow 1: VS Code Extension Installation and Setup

**Actor:** Developer using VS Code
**Precondition:** unerr account exists; repo connected via Phase 2
**Outcome:** unerr panels available in VS Code sidebar and command palette

```
Step  Actor Action                           System Action                                                      State Change
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────────────────────────
1     Developer installs unerr               VS Code Marketplace → extension installed                          Extension activated
      extension from Marketplace             → Extension activates on workspace open
      (or via `code --install-extension`)

2     Extension detects unerr config         Check for existing config:                                         None (read-only)
                                             a) ~/.unerr/credentials.json (from CLI auth)
                                             b) .cursor/mcp.json or .vscode/settings.json
                                                (from `unerr connect`)
                                             → If found: auto-configure API client
                                             → If not found: show "Sign In" button
                                               in sidebar

3a    (If no config) User clicks             Extension opens browser to unerr OAuth flow                        ~/.unerr/credentials.json
      "Sign In" in sidebar                   → Same device auth flow as CLI                                     created
                                             → Callback captures token
                                             → Stores in VS Code SecretStorage
                                               (encrypted, per-user)

3b    (If config exists)                     Extension reads API key / OAuth token                               None
                                             → Validates against cloud API
                                             → Auto-detects repoId from git remote

4     Extension activates panels             Register sidebar views:                                             VS Code sidebar populated
                                             → "unerr: Blueprint" view container
                                             → "unerr: Impact" view container
                                             → "unerr: Timeline" view container
                                             Register commands:
                                             → unerr.showBlueprint
                                             → unerr.showImpactGraph
                                             → unerr.showTimeline
                                             → unerr.showDiff
                                             Register context menu items:
                                             → "Show Impact Graph" on function/class

5     Developer sees unerr icon              Sidebar shows unerr tree view:                                     None
      in activity bar                        → Blueprint Dashboard (click to open)
                                             → Impact Graph (click to open)
                                             → Timeline (click to open)
                                             → Workspace Diff (click to open)
                                             Status bar: "unerr: Connected (org/repo)"
```

**Credential reuse:** The extension shares credentials with the CLI (`~/.unerr/credentials.json`). If the developer already ran `unerr auth login`, the extension picks up the token automatically. If the developer hasn't used the CLI, the extension runs its own device auth flow and writes the same `credentials.json` — the CLI then works without re-authenticating.

### Flow 2: Developer Views Impact Graph for a Function

**Actor:** Developer in VS Code or JetBrains
**Precondition:** Extension installed and authenticated; repo indexed
**Outcome:** Force-directed graph showing the entity's callers, callees, and related entities

```
Step  Actor Action                           System Action                                                      Latency
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────
1     Developer right-clicks a function      Context menu shows:                                                 ~0ms
      name in the editor                     "unerr: Show Impact Graph"

2     Developer clicks                       Extension host:                                                     ~5ms
      "Show Impact Graph"                    → Extract symbol name from cursor position
                                             → Determine entity key:
                                               Option A: local CozoDB lookup (if unerr serve running)
                                               Option B: cloud API call (if no local graph)

3                                            Extension host fetches graph data:                                  ~10-300ms
                                             → Call MCP tool: get_callers(entity, depth=2)                      (local: ~10ms)
                                             → Call MCP tool: get_callees(entity, depth=2)                      (cloud: ~300ms)
                                             → Combine into graph structure:
                                               { nodes: EntityNode[], edges: Edge[] }

4                                            Extension opens WebView panel:                                      ~100ms
                                             → Create or focus "unerr: Impact Graph" panel
                                             → Send graph data via postMessage:
                                               { type: "setGraphData", data: graphStructure }

5                                            @unerr/ui ImpactGraph component renders:                           ~200ms
                                             → Force-directed layout (d3-force or Cytoscape)
                                             → Center node = selected entity (highlighted)
                                             → Caller nodes (inbound edges, colored by depth)
                                             → Callee nodes (outbound edges)
                                             → Click node → navigates to file:line in editor

6     Developer sees interactive graph       Graph is zoomable, pannable, clickable                              Total: ~300-600ms
      in side panel                          → Click any node → postMessage to extension host
                                             → Extension host opens file at line
                                             → vscode.workspace.openTextDocument(uri)
                                             → vscode.window.showTextDocument(doc, { selection })
```

### Flow 3: Agent Triggers IDE Panel — `show_blueprint`

**Actor:** AI agent via MCP client
**Precondition:** Agent is working in an IDE with unerr extension installed
**Outcome:** Blueprint Dashboard panel opens in the IDE with repo architecture visualization

```
Step  Actor Action                           System Action                                                      Latency
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────
1     Agent calls MCP tool:                  MCP server receives tool call                                      ~1ms
      show_blueprint({
        repoId: "repo_123",
        groupBy: "module"
      })

2                                            Cloud fetches blueprint data:                                       ~200ms
                                             → AQL: entity counts by file path prefix (module grouping)
                                             → AQL: edge counts between modules (cross-module deps)
                                             → Structure: { modules: Module[], dependencies: Dep[] }

3                                            MCP response includes render hint:                                  ~1ms
                                             {
                                               content: [{ type: "text", text: "Blueprint data..." }],
                                               _meta: {
                                                 renderHint: "blueprint",
                                                 renderData: { modules, dependencies }
                                               }
                                             }

4                                            IDE extension detects renderHint:                                   ~5ms
                                             → MCP client receives tool response
                                             → Extension intercepts responses with
                                               _meta.renderHint
                                             → Dispatches to appropriate panel:
                                               "blueprint" → BlueprintPanel
                                               "impact_graph" → ImpactPanel
                                               "timeline" → TimelinePanel
                                               "diff" → DiffPanel

5                                            WebView panel renders:                                              ~200ms
                                             → @unerr/ui BlueprintDashboard component
                                             → Swimlane layout with entity counts
                                             → Dependency arrows between modules

6     Agent's text response also             Agent can reference the visualization:                               —
      visible in chat                        "I've opened the Blueprint Dashboard showing
                                              the module structure. The auth module has
                                              the most cross-module dependencies..."
```

**Render hint pattern:** MCP tool responses include an optional `_meta.renderHint` field. IDEs without the unerr extension ignore this field — they just see the text content. IDEs with the extension intercept it and open the appropriate visualization panel. This is a progressive enhancement — the tool response is useful as text even without the extension.

### Flow 4: Developer Views Ledger Timeline

**Actor:** Developer in VS Code
**Precondition:** Extension installed; Phase 5.5 Prompt Ledger has entries for the workspace
**Outcome:** Timeline panel shows chronological ledger entries with rewind/branch points

```
Step  Actor Action                           System Action                                                      Latency
────  ─────────────────────────────────────  ─────────────────────────────────────────────────────────────────   ──────────
1     Developer clicks "Timeline"            Extension host fetches ledger data:                                 ~200ms
      in unerr sidebar                       → Call MCP tool: show_timeline({
                                                 workspaceId: current workspace
                                               })
                                             → Cloud returns ledger entries:
                                               [{ entryId, action, entityRef,
                                                  timestamp, status, timeline }]

2                                            WebView renders LedgerTimeline:                                     ~150ms
                                             → Vertical timeline with entry cards
                                             → Each card: action type icon, entity name,
                                               timestamp, status badge
                                             → Branch points shown as timeline forks
                                             → Rewind points marked with ⏪ icon
                                             → Click entry → navigates to affected entity

3     Developer clicks a ledger entry        postMessage → extension host:                                       ~50ms
                                             → Opens file at the entity's location
                                             → Highlights affected line range
```

### Flow 5: JetBrains Plugin — Same Flows, Different Bridge

**Actor:** Developer using IntelliJ IDEA / WebStorm / PyCharm
**Precondition:** unerr plugin installed from JetBrains Marketplace
**Outcome:** Same panels and features as VS Code, rendered via JCEF

```
Architecture difference from VS Code:

VS Code:                              JetBrains:
┌──────────────────────┐              ┌──────────────────────┐
│ WebView Panel        │              │ JCEF Panel           │
│ (Chromium in VS Code)│              │ (JBCefBrowser)       │
│                      │              │                      │
│ @unerr/ui React      │              │ @unerr/ui React      │
│ components           │              │ components           │
│                      │              │ (same bundle)        │
└─────────┬────────────┘              └─────────┬────────────┘
          │ postMessage                         │ CefMessageRouter
          ▼                                     ▼
┌──────────────────────┐              ┌──────────────────────┐
│ Extension Host       │              │ Plugin Service       │
│ (Node.js)            │              │ (Kotlin/JVM)         │
│                      │              │                      │
│ unerr API client     │              │ unerr API client     │
│ MCP tool invocation  │              │ MCP tool invocation  │
│ File navigation      │              │ File navigation      │
└──────────────────────┘              └──────────────────────┘

Key differences:
1. Communication: postMessage (VS Code) vs CefMessageRouter (JetBrains)
2. Host language: TypeScript (VS Code) vs Kotlin (JetBrains)
3. File navigation: vscode.workspace API vs IntelliJ OpenFileDescriptor
4. Auth storage: VS Code SecretStorage vs IntelliJ PasswordSafe
5. Panel registration: registerWebviewViewProvider vs ToolWindowFactory
```

**Shared:** The `@unerr/ui` React bundle is identical. Both IDEs load the same HTML+JS bundle. Only the native bridge layer differs.

### Flow 6: Real-Time Panel Updates via SSE

**Actor:** System (extension background process)
**Precondition:** Extension connected; panels open
**Outcome:** Panels update automatically when data changes (e.g., new index completes, new ledger entry)

```
Step  System Action                                                                State Change
────  ──────────────────────────────────────────────────────────────────────────    ──────────────────────────────
1     Extension connects to SSE endpoint:                                          SSE connection established
      GET /mcp (with Accept: text/event-stream)
      Headers: Authorization: Bearer {token}

2     Cloud pushes events when data changes:                                        None
      event: index_complete
      data: { repoId: "repo_123", entityCount: 5231 }

      event: ledger_entry
      data: { workspaceId: "ws_abc", entryId: "le_xyz", action: "edit" }

      event: workspace_sync
      data: { workspaceId: "ws_abc", overlayEntityCount: 15 }

3     Extension host receives event:                                               Panel data refreshed
      → Determine which panels need update:
        index_complete → refresh Blueprint, Impact Graph
        ledger_entry → refresh Timeline
        workspace_sync → refresh Diff Viewer
      → Fetch fresh data from API
      → Send updated data to WebView via postMessage

4     @unerr/ui components re-render                                                UI updated
      with fresh data
```

**SSE vs WebSocket:** The existing MCP transport already has an SSE stub at `GET /mcp`. Phase 11 extends this with real event types. SSE is simpler than WebSocket (unidirectional server→client), which is sufficient for panel updates. Phase 12 (Multiplayer) may add WebSocket for bidirectional collision communication.

---

## 1.3 System Logic & State Management

### `@unerr/ui` Package Architecture

The shared component library extracts visualization components from the web dashboard (even though they don't exist yet — they are built fresh in Phase 11 and used in both web and IDE contexts):

```
packages/ui/
├── src/
│   ├── BlueprintDashboard.tsx     # Swimlane architecture visualization
│   │   Props: { modules: Module[], dependencies: Dep[], onNodeClick: (id) => void }
│   │
│   ├── ImpactGraph.tsx            # Force-directed entity graph
│   │   Props: { nodes: GraphNode[], edges: GraphEdge[], centerEntity: string,
│   │            onNodeClick: (id) => void, depth: number }
│   │
│   ├── LedgerTimeline.tsx         # Prompt Ledger timeline
│   │   Props: { entries: LedgerEntry[], branches: Branch[],
│   │            onEntryClick: (id) => void, onRewind: (id) => void }
│   │
│   ├── DiffViewer.tsx             # Workspace overlay diff
│   │   Props: { hunks: DiffHunk[], mode: "inline" | "side-by-side",
│   │            onLineClick: (file, line) => void }
│   │
│   ├── types.ts                   # Shared data types
│   └── index.ts                   # Public exports
│
├── package.json                    # peer deps: react@^19, no next.js
├── vite.config.ts                  # Build as ES library
└── tsconfig.json                   # Strict, no JSX transform
```

**Build configuration:** Vite builds the package as an ES module library (`lib` mode). The output is a single JS bundle + CSS file that both VS Code WebView and JetBrains JCEF can load. No server-side rendering, no Next.js dependencies, no Node.js APIs — pure browser React.

**Styling:** The `@unerr/ui` package uses the same design tokens from the web app (Void Black background, Rail Purple accent) but via CSS variables, not Tailwind. This avoids Tailwind build complexity in WebView/JCEF contexts. The package ships its own small CSS file with the design token variables.

### MCP Render Hint Protocol

The four new `show_*` MCP tools follow a render-hint pattern that enables progressive enhancement:

```
MCP Tool Response Structure (with render hint):

{
  content: [
    {
      type: "text",
      text: "Blueprint for org/backend-api:\n\n
             Modules: auth (42 entities), db (38 entities), api (65 entities)\n
             Dependencies: auth → db (12 edges), api → auth (8 edges), api → db (15 edges)"
    }
  ],
  _meta: {
    renderHint: "blueprint",
    renderData: {
      modules: [
        { id: "auth", name: "auth", entityCount: 42, filePaths: ["lib/auth/*"] },
        { id: "db", name: "db", entityCount: 38, filePaths: ["lib/db/*"] },
        { id: "api", name: "api", entityCount: 65, filePaths: ["app/api/*"] }
      ],
      dependencies: [
        { from: "auth", to: "db", edgeCount: 12 },
        { from: "api", to: "auth", edgeCount: 8 },
        { from: "api", to: "db", edgeCount: 15 }
      ]
    }
  }
}
```

**Progressive enhancement levels:**

| Client | renderHint handling | Experience |
|---|---|---|
| **Agent without IDE extension** | Ignored — agent sees text content | Textual summary (fully functional) |
| **Agent with unerr VS Code extension** | Extension intercepts renderHint, opens panel | Interactive visualization + text in chat |
| **Agent with unerr JetBrains plugin** | Plugin intercepts renderHint, opens tool window | Interactive visualization + text in chat |
| **Web dashboard** (future) | Dashboard uses same `@unerr/ui` components | Embedded visualization |

### Extension Host ↔ WebView Communication Protocol

Both VS Code and JetBrains use a structured message protocol between the native host and the web-rendered panel:

```
Host → WebView messages:
  { type: "setGraphData", data: GraphData }           # Set/replace graph data
  { type: "updateTimeline", entries: LedgerEntry[] }   # Append timeline entries
  { type: "setDiffData", hunks: DiffHunk[] }           # Set diff data
  { type: "setBlueprintData", data: BlueprintData }    # Set blueprint data
  { type: "setTheme", theme: "dark" | "light" }        # Sync IDE theme
  { type: "setLoading", loading: boolean }              # Loading state

WebView → Host messages:
  { type: "nodeClick", nodeId: string, filePath: string, line: number }
  { type: "entryClick", entryId: string }
  { type: "rewindRequest", entryId: string }
  { type: "refreshRequest", panel: string }
  { type: "ready" }                                    # WebView initialization complete
```

The WebView sends a `ready` message after React mounts. The host waits for `ready` before sending data, avoiding race conditions during panel initialization.

### Data Sources for Each Panel

| Panel | Primary data source | MCP tool | Fallback |
|---|---|---|---|
| **Blueprint Dashboard** | `show_blueprint` → cloud ArangoDB (entity counts by module) | `show_blueprint` | `get_project_stats` (text-only) |
| **Impact Graph** | `get_callers` + `get_callees` → local CozoDB (Phase 10a) or cloud | `show_impact_graph` | `get_callers` + `get_callees` (text-only) |
| **Ledger Timeline** | `show_timeline` → cloud ArangoDB ledger collection (Phase 5.5) | `show_timeline` | None (Phase 5.5 required) |
| **Diff Viewer** | `show_diff` → cloud workspace overlay (Phase 2) | `show_diff` | `sync_local_diff` response (text-only) |

### SSE Event Types

Phase 11 extends the existing SSE stub in `lib/mcp/transport.ts` with real event types:

```
Event: index_complete
Trigger: indexRepoWorkflow finishes
Payload: { repoId, entityCount, edgeCount, timestamp }
Panels refreshed: Blueprint, Impact Graph

Event: ledger_entry
Trigger: New ledger entry created via sync_local_diff
Payload: { workspaceId, entryId, action, entityRef, timestamp }
Panels refreshed: Timeline

Event: workspace_sync
Trigger: Workspace overlay updated
Payload: { workspaceId, overlayEntityCount, timestamp }
Panels refreshed: Diff Viewer

Event: snapshot_ready
Trigger: syncLocalGraphWorkflow completes (Phase 10a)
Payload: { repoId, snapshotVersion, entityCount }
Panels refreshed: Blueprint (local data available)

Event: rules_updated
Trigger: Phase 6 rules changed for the repo
Payload: { repoId, ruleCount }
Panels refreshed: None (but extension can show notification)
```

Events are scoped by `orgId` — each SSE connection only receives events for the authenticated user's org.

---

## 1.4 Reliability & Resilience

### Failure Scenario Matrix

| # | Failure | Detection | Recovery | User Impact |
|---|---------|-----------|----------|-------------|
| 1 | **Extension cannot authenticate** | 401 from cloud API | Show "Sign In" button in sidebar. If token expired, attempt refresh. If refresh fails, prompt re-auth. | Panels show "Sign in to view" placeholder. MCP tools still work via separate MCP session. |
| 2 | **WebView panel fails to load React bundle** | `@unerr/ui` bundle returns 404 or parse error | Extension logs error. Panel shows fallback HTML: "Failed to load visualization. Try reloading: Cmd+Shift+P → unerr: Reload Panels" | One panel fails. Other panels unaffected. Text-only MCP responses still work. |
| 3 | **SSE connection drops** | HTTP connection closed or timeout | Extension reconnects with exponential backoff (1s, 3s, 9s, max 30s). After 5 failed reconnects, fall back to polling (30s interval). | Brief gap in real-time updates. Panels may show stale data for up to 30s. Manual refresh always works. |
| 4 | **Impact graph — too many nodes (>500)** | `get_callers` depth=5 returns >500 nodes | Truncate display to 200 nodes. Show notification: "Graph truncated to 200 nodes. Reduce depth or select a more specific entity." User can adjust depth slider. | Partial graph displayed. Performance stays smooth. |
| 5 | **Cloud API unreachable (for cloud-sourced panels)** | HTTP timeout (10s) | If local CozoDB available (Phase 10a): use local data for Impact Graph and Blueprint. For Timeline and Diff: show "Cloud unavailable" with retry button. | Impact Graph works locally. Timeline/Diff require cloud. |
| 6 | **JetBrains JCEF not available** | `JBCefApp.isSupported()` returns false | Plugin shows notification: "unerr visualizations require JCEF. Enable it in Settings → IDE → JCEF." Falls back to opening web dashboard in browser. | No in-IDE panels. Browser fallback works. |
| 7 | **renderHint not recognized by extension** | Extension receives unknown renderHint value | Ignore — agent sees text response. Log warning for debugging. | No panel opened. Agent still has text data. Future extension update will handle new hints. |
| 8 | **WebView ↔ host message delivery failure** | postMessage returns without acknowledgment | No retry (fire-and-forget by design). If critical (e.g., setGraphData), host re-sends after 2s timeout if no `ready` or `ack` received. | Panel may show stale data. User can manually refresh. |
| 9 | **Multiple IDE windows for same repo** | Extension detects multiple workspace folders | Each window gets its own API client and panels. SSE connections are per-window. No cross-window coordination (Phase 12 handles that). | Independent panels per window. No conflicts. |
| 10 | **Extension update — WebView bundle version mismatch** | New extension sends messages the old WebView doesn't understand | WebView ignores unknown message types (defensive). Extension checks `@unerr/ui` version on `ready` message and reloads if mismatched. | Brief panel reload after extension update. |

### Graceful Degradation Hierarchy

```
Full experience:
  Extension installed + authenticated + cloud reachable + local graph available
  → All panels work, local-speed Impact Graph, real-time SSE updates

Local-only:
  Extension installed + authenticated + cloud unreachable + local graph available
  → Impact Graph works (local CozoDB)
  → Blueprint works (estimated from local data)
  → Timeline and Diff unavailable (cloud-only data)
  → SSE disconnected, polling fallback

Cloud-only:
  Extension installed + authenticated + cloud reachable + no local graph
  → All panels work but Impact Graph has ~300ms latency (cloud round-trip)

No extension:
  Agent calls show_blueprint, show_impact_graph, etc.
  → Text-only responses (renderHint ignored)
  → Fully functional, just no visualization

Not authenticated:
  Extension installed but no credentials
  → Sidebar shows "Sign In" placeholder
  → No panels available
```

---

## 1.5 Performance Considerations

### Latency Budgets

| Operation | Target | Expected | Notes |
|---|---|---|---|
| Extension activation | <500ms | ~200ms | Register views + commands. No data fetching on activate. |
| Panel open (first time) | <1s | ~600ms | Load WebView HTML + @unerr/ui bundle + initial render |
| Panel open (cached) | <200ms | ~100ms | WebView already loaded, just show and send data |
| Impact Graph render (local, 50 nodes) | <300ms | ~150ms | CozoDB query (~10ms) + postMessage (~5ms) + d3-force layout (~100ms) + React render (~35ms) |
| Impact Graph render (cloud, 50 nodes) | <600ms | ~450ms | Cloud query (~300ms) + postMessage + layout + render |
| Impact Graph render (200 nodes) | <1s | ~700ms | Force layout scales O(n log n) with Barnes-Hut |
| Blueprint render (20 modules) | <500ms | ~300ms | Cloud query (~200ms) + swimlane layout (~50ms) + render |
| Timeline render (50 entries) | <500ms | ~250ms | Cloud query (~200ms) + vertical list render (~50ms) |
| Diff Viewer render (10 files) | <500ms | ~300ms | Cloud query (~200ms) + diff parse + render |
| SSE event → panel update | <500ms | ~200ms | Event received → fetch fresh data → postMessage → re-render |
| Node click → file navigation | <200ms | ~50ms | postMessage → extension host → openTextDocument |

### `@unerr/ui` Bundle Size Budget

| Component | Estimated size (gzipped) | Notes |
|---|---|---|
| React 19 (peer dep, not bundled) | 0 KB | Loaded by WebView shell, not in bundle |
| BlueprintDashboard | ~15 KB | Swimlane layout engine |
| ImpactGraph | ~40 KB | d3-force or Cytoscape (largest component) |
| LedgerTimeline | ~8 KB | Vertical list with timeline decorations |
| DiffViewer | ~12 KB | Diff parser + line renderer |
| CSS (design tokens) | ~3 KB | CSS variables, minimal reset |
| **Total @unerr/ui** | **~78 KB** | Acceptable for WebView loading |

**React loading strategy:** The WebView shell includes React via CDN or bundled inline. The `@unerr/ui` bundle expects React as a peer dependency. This avoids duplicating React across panels (each panel's WebView loads React once).

### Graph Visualization Library Choice

| Library | Bundle size | Graph types | Interaction | Phase 11 fit |
|---|---|---|---|---|
| **d3-force** | ~20 KB (d3-force + d3-selection) | Force-directed | Pan/zoom/click (manual) | Good — lightweight, full control |
| **Cytoscape.js** | ~170 KB | Force-directed, hierarchical, grid | Built-in gestures | Overkill — too large for WebView |
| **React Flow** | ~80 KB | Directed graphs, flowcharts | Built-in controls | Good for Blueprint swimlanes |
| **vis-network** | ~200 KB | All graph types | Full-featured | Too large |

**Decision:** Use **d3-force** for Impact Graph (lightweight, full control over rendering) and **React Flow** for Blueprint Dashboard (swimlane layout is a natural fit). Total: ~100 KB.

### Memory Budget (Extension)

| Component | Memory | Notes |
|---|---|---|
| Extension host (VS Code) | ~20 MB | Node.js baseline + API client |
| WebView panel (per panel) | ~30-50 MB | Chromium process + React + graph data |
| Graph data cache | ~1-5 MB | Last fetched graph/blueprint/timeline data |
| SSE connection | ~1 MB | HTTP connection + event buffer |
| **Total (3 panels open)** | **~130 MB** | Acceptable for VS Code extensions |

---

## 1.6 Phase Bridge → Phase 12

Phase 11 is designed so that Phase 12 (Multiplayer Collaboration & Collision Detection) requires **zero refactoring** of the IDE extension code — only additions.

### What Phase 12 inherits from Phase 11

| Phase 11 artifact | Phase 12 usage | Change type |
|---|---|---|
| **VS Code extension scaffold** | Add collision decorator + notification handler | Additive — new file, register in activate() |
| **JetBrains plugin scaffold** | Add CollisionAnnotator + notification handler | Additive — new Kotlin class |
| **SSE infrastructure** | Add `collision` event type | Additive — new event in existing SSE stream |
| **postMessage protocol** | Add `collision` message type for WebView warnings | Additive — new message type |
| **`@unerr/ui` package** | Add `CollisionBadge` component for panel overlays | Additive — new component export |
| **API client in extension** | Add collision check endpoint calls | Additive — new API method |

### What Phase 11 must NOT do (to avoid Phase 12 rework)

1. **Do not use a single-panel WebView architecture.** Each visualization (Blueprint, Impact, Timeline, Diff) should be its own WebView panel, independently creatable and closable. Phase 12 adds a "Collision" panel. If all visualizations were in one panel, adding a new one would require restructuring.
2. **Do not hardcode SSE event handlers.** Use a dispatched event handler pattern (`switch (event.type)`) so Phase 12 can add `case "collision"` without modifying existing handler code.
3. **Do not couple the API client to specific endpoints.** The extension's API client should be a generic HTTP client with auth headers, not a hardcoded set of endpoint methods. Phase 12 adds new endpoints (WebSocket upgrade, collision check).
4. **Do not embed the `@unerr/ui` bundle directly in the extension.** Load it from a well-known path (extension's `dist/` directory or CDN). Phase 12 updates the `@unerr/ui` bundle independently of the extension host code.
5. **Do not assume unidirectional communication.** While Phase 11 only needs SSE (server→client), Phase 12 needs WebSocket (bidirectional). Design the event handling layer to accept events from both SSE and WebSocket sources.

---

# Part 2: Implementation & Tracing Tracker

## 2.1 Infrastructure Layer

- [ ] **P11-INFRA-01: Create `packages/ui/` shared component package** — L
  - Initialize package: `@unerr/ui`, React 19 peer dep, no Next.js deps
  - Vite config: `lib` mode, ES module output, external React
  - TypeScript: strict, no JSX transform (use `react-jsx`)
  - CSS: design token variables (Void Black, Rail Purple, font families)
  - Export barrel: `BlueprintDashboard`, `ImpactGraph`, `LedgerTimeline`, `DiffViewer`
  - **Test:** `pnpm build` produces ES module bundle + CSS. Bundle size <100 KB gzipped. No Next.js or Node.js imports.
  - **Depends on:** Nothing
  - **Files:** `packages/ui/` (new package)
  - Notes: _____

- [ ] **P11-INFRA-02: Create `packages/vscode-extension/` package scaffold** — L
  - Initialize VS Code extension:
    - `package.json` with `engines.vscode: "^1.90.0"`, `activationEvents`, `contributes` (viewContainers, views, commands, menus)
    - `tsconfig.json` targeting ES2022
    - `src/extension.ts` entry point with `activate()`/`deactivate()`
    - Build: `esbuild` for bundling extension host code
  - Register:
    - Activity bar icon (unerr logo)
    - 4 sidebar views: Blueprint, Impact, Timeline, Diff
    - 4 commands: `unerr.showBlueprint`, `unerr.showImpactGraph`, `unerr.showTimeline`, `unerr.showDiff`
    - Context menu: "unerr: Show Impact Graph" on editor text selection
  - **Test:** `vsce package` produces .vsix. Install in VS Code → activity bar icon appears. Commands registered in palette.
  - **Depends on:** Nothing
  - **Files:** `packages/vscode-extension/` (new package)
  - Notes: _____

- [ ] **P11-INFRA-03: Create `packages/jetbrains-plugin/` scaffold** — L
  - Initialize IntelliJ Platform plugin:
    - `build.gradle.kts` with `intellij` plugin config (target: 2024.1+)
    - `plugin.xml` with tool window extensions
    - `src/main/kotlin/com/unerr/plugin/` source directory
    - Register 4 tool windows: Blueprint, Impact, Timeline, Diff
  - JCEF dependency check: `JBCefApp.isSupported()` guard
  - **Test:** `./gradlew buildPlugin` produces .zip. Install in IntelliJ → tool windows available. JCEF check passes on supported IDEs.
  - **Depends on:** Nothing
  - **Files:** `packages/jetbrains-plugin/` (new package)
  - Notes: _____

- [ ] **P11-INFRA-04: Add graph visualization dependencies to `@unerr/ui`** — M
  - Add dependencies:
    - `d3-force`, `d3-selection`, `d3-zoom` — for Impact Graph force-directed layout
    - `@xyflow/react` (React Flow) — for Blueprint Dashboard swimlane layout
  - Configure Vite to external React (peer dep)
  - **Test:** Both libraries import and initialize correctly. Force simulation runs. React Flow renders.
  - **Depends on:** P11-INFRA-01
  - **Files:** `packages/ui/package.json`
  - Notes: _____

---

## 2.2 Database & Schema Layer

- [ ] **P11-DB-01: Define render data types for MCP show tools** — M
  - New types in `lib/ports/types.ts` or `lib/mcp/tools/types.ts`:
    ```
    BlueprintData {
      modules: { id, name, entityCount, filePaths[], kinds: { function, class, interface }[] }[]
      dependencies: { from, to, edgeCount, edgeKinds[] }[]
      stats: { totalEntities, totalEdges, languages[] }
    }

    ImpactGraphData {
      nodes: { id, name, kind, filePath, line, depth, isCenter }[]
      edges: { from, to, kind }[]
      centerEntity: { id, name, kind, signature }
    }

    TimelineData {
      entries: { id, action, entityRef, entityName, timestamp, status, timeline }[]
      branches: { id, name, branchedFrom, createdAt }[]
      currentTimeline: number
    }

    DiffData {
      files: { path, hunks: { startLine, lineCount, content, type }[] }[]
      stats: { filesChanged, insertions, deletions }
    }
    ```
  - **Test:** Types compile. All fields documented.
  - **Depends on:** Nothing
  - **Files:** `lib/mcp/tools/types.ts` (new or extended)
  - Notes: _____

---

## 2.3 Ports & Adapters Layer

- [ ] **P11-ADAPT-01: Create VS Code API client module** — M
  - `packages/vscode-extension/src/api-client.ts`:
    - HTTP client using `https` module (no external deps in extension host)
    - Auth: reads from VS Code SecretStorage or `~/.unerr/credentials.json`
    - Methods: generic `fetch(path, options)` with auth headers
    - Token refresh: automatic if OAuth token expired
    - Timeout: 10s per request
  - **Test:** Mock HTTP → authenticated requests include Bearer header. Token refresh triggered on 401.
  - **Depends on:** P11-INFRA-02
  - **Files:** `packages/vscode-extension/src/api-client.ts` (new)
  - Notes: _____

- [ ] **P11-ADAPT-02: Create VS Code WebView panel manager** — L
  - `packages/vscode-extension/src/panel-manager.ts`:
    - Factory for creating/showing WebView panels
    - Loads `@unerr/ui` bundle into WebView HTML shell
    - Manages postMessage protocol (host → WebView, WebView → host)
    - Handles `ready` synchronization
    - Handles `nodeClick` → file navigation (`vscode.workspace.openTextDocument`)
    - Supports dark/light theme sync (`vscode.window.activeColorTheme`)
  - **Test:** Panel created → WebView loads React bundle. postMessage → data received. nodeClick → file opens at correct line.
  - **Depends on:** P11-INFRA-01, P11-INFRA-02
  - **Files:** `packages/vscode-extension/src/panel-manager.ts` (new)
  - Notes: _____

- [ ] **P11-ADAPT-03: Create VS Code SSE client** — M
  - `packages/vscode-extension/src/sse-client.ts`:
    - Connects to `GET /mcp` SSE endpoint with auth headers
    - Parses SSE event stream (`event:` + `data:` lines)
    - Dispatches events to registered handlers
    - Reconnect with exponential backoff on disconnect
    - Falls back to 30s polling after 5 failed reconnects
  - **Test:** Mock SSE stream → events dispatched. Connection drop → reconnect after backoff. 5 failures → switch to polling.
  - **Depends on:** P11-ADAPT-01
  - **Files:** `packages/vscode-extension/src/sse-client.ts` (new)
  - Notes: _____

- [ ] **P11-ADAPT-04: Create JetBrains API client and JCEF bridge** — L
  - `packages/jetbrains-plugin/src/.../UnerrApiClient.kt`:
    - HTTP client using OkHttp or IntelliJ HTTP client
    - Auth: reads from IntelliJ PasswordSafe or `~/.unerr/credentials.json`
  - `packages/jetbrains-plugin/src/.../UnerrDataHandler.kt`:
    - `CefMessageRouter.Handler` implementation
    - Handles messages from JS → Kotlin (nodeClick, refreshRequest)
    - Sends data Kotlin → JS via `browser.cefBrowser.executeJavaScript()`
  - **Test:** API client makes authenticated requests. CefMessageRouter delivers messages bidirectionally.
  - **Depends on:** P11-INFRA-03
  - **Files:** `packages/jetbrains-plugin/src/main/kotlin/com/unerr/plugin/` (new files)
  - Notes: _____

---

## 2.4 Backend / API Layer

### MCP Tools

- [ ] **P11-API-01: Create `show_blueprint` MCP tool** — L
  - Tool definition:
    ```
    name: "show_blueprint"
    description: "Show the Blueprint Dashboard — a swimlane visualization of the repo's
                  module structure and cross-module dependencies."
    inputSchema: { repoId (optional, defaults to session repo), groupBy: "module" | "directory" }
    ```
  - Handler:
    1. Query ArangoDB: entity counts grouped by file path prefix (module inference)
    2. Query ArangoDB: edge counts between modules (cross-module dependencies)
    3. Assemble `BlueprintData` structure
    4. Return text summary + `_meta.renderHint: "blueprint"` + `_meta.renderData`
  - Module inference: group entities by first-level directory under repo root (e.g., `lib/auth/`, `lib/db/`, `app/api/`)
  - **Test:** Repo with 3 modules → 3 module nodes + dependency edges. Empty repo → empty blueprint. renderHint present in response.
  - **Depends on:** P11-DB-01, register in `lib/mcp/tools/index.ts`
  - **Files:** `lib/mcp/tools/show-blueprint.ts` (new), `lib/mcp/tools/index.ts` (modified)
  - Notes: _____

- [ ] **P11-API-02: Create `show_impact_graph` MCP tool** — L
  - Tool definition:
    ```
    name: "show_impact_graph"
    description: "Show the Impact Graph — a force-directed visualization of an entity's
                  callers, callees, and related entities up to N hops."
    inputSchema: { entityId or name (required), depth (default 2, max 5) }
    ```
  - Handler:
    1. Resolve entity (by key or name search)
    2. `getCallersOf(entityId, depth)` → inbound nodes
    3. `getCalleesOf(entityId, depth)` → outbound nodes
    4. Combine into `ImpactGraphData` with center entity highlighted
    5. Truncate to 200 nodes if exceeded (sort by depth, keep closest)
    6. Return text summary + `_meta.renderHint: "impact_graph"` + `_meta.renderData`
  - **Test:** Entity with 5 callers + 3 callees → 9 nodes + 8 edges. Depth 1 vs depth 3 → different node counts. >200 nodes → truncated with notification.
  - **Depends on:** P11-DB-01, register in `lib/mcp/tools/index.ts`
  - **Files:** `lib/mcp/tools/show-impact-graph.ts` (new), `lib/mcp/tools/index.ts` (modified)
  - Notes: _____

- [ ] **P11-API-03: Create `show_timeline` MCP tool** — M
  - Tool definition:
    ```
    name: "show_timeline"
    description: "Show the Prompt Ledger timeline — a chronological view of AI agent
                  actions in the current workspace."
    inputSchema: { workspaceId (optional, defaults to session workspace), limit (default 50) }
    ```
  - Handler:
    1. Query ArangoDB `ledger` collection for workspace entries
    2. Query timeline branches (Phase 5.5)
    3. Assemble `TimelineData` structure
    4. Return text summary + `_meta.renderHint: "timeline"` + `_meta.renderData`
  - **Test:** Workspace with 10 entries → 10 timeline entries. Branch point → branch data included. Empty ledger → empty timeline.
  - **Depends on:** P11-DB-01, Phase 5.5 ledger data
  - **Files:** `lib/mcp/tools/show-timeline.ts` (new), `lib/mcp/tools/index.ts` (modified)
  - Notes: _____

- [ ] **P11-API-04: Create `show_diff` MCP tool** — M
  - Tool definition:
    ```
    name: "show_diff"
    description: "Show the workspace overlay diff — uncommitted changes tracked by unerr."
    inputSchema: { workspaceId (optional, defaults to session workspace) }
    ```
  - Handler:
    1. Fetch workspace overlay entities from ArangoDB
    2. Compute diff against base entities (original vs overlay)
    3. Format as `DiffData` with hunks
    4. Return text summary + `_meta.renderHint: "diff"` + `_meta.renderData`
  - Reuses `parseDiffHunks()` from existing `lib/mcp/tools/diff-filter.ts`
  - **Test:** Workspace with 3 modified entities → diff with 3 files. No overlay → empty diff. renderHint present.
  - **Depends on:** P11-DB-01, Phase 2 workspace overlay
  - **Files:** `lib/mcp/tools/show-diff.ts` (new), `lib/mcp/tools/index.ts` (modified)
  - Notes: _____

### SSE Infrastructure

- [ ] **P11-API-05: Extend SSE endpoint with real event types** — M
  - Modify `lib/mcp/transport.ts` `handleMcpSse()`:
    - Accept `orgId` from auth context
    - Subscribe to Redis pub/sub channels: `events:{orgId}`
    - Forward events to SSE stream with correct `event:` type
    - Event types: `index_complete`, `ledger_entry`, `workspace_sync`, `snapshot_ready`, `rules_updated`
  - Publishing side: add `publishEvent(orgId, eventType, payload)` helper
  - Call `publishEvent` from relevant workflow completion hooks
  - **Test:** Subscribe to SSE → receive `index_complete` event when workflow completes. Disconnect → no error. Different org → no cross-org events.
  - **Depends on:** Existing SSE stub
  - **Files:** `lib/mcp/transport.ts` (modified), `lib/mcp/events.ts` (new helper)
  - Notes: _____

- [ ] **P11-API-06: Add event publishing to workflow completion hooks** — M
  - After `indexRepoWorkflow` completes → publish `index_complete`
  - After ledger entry created (via `sync_local_diff`) → publish `ledger_entry`
  - After workspace overlay updated → publish `workspace_sync`
  - After `syncLocalGraphWorkflow` completes → publish `snapshot_ready`
  - Uses Redis pub/sub via `ICacheStore`
  - **Test:** Workflow completes → event published to Redis → SSE clients receive it.
  - **Depends on:** P11-API-05
  - **Files:** Various workflow/activity files (modified — add publish calls)
  - Notes: _____

### Extension Distribution

- [ ] **P11-API-07: Add VS Code extension CI/CD pipeline** — M
  - GitHub Actions workflow:
    - Build `@unerr/ui` → build extension → `vsce package`
    - Run extension tests
    - On tag: publish to VS Code Marketplace via `vsce publish`
  - Version synced with `@unerr/ui` version
  - **Test:** CI builds .vsix artifact. Marketplace publish succeeds (staging first).
  - **Depends on:** P11-INFRA-02, P11-INFRA-01
  - **Files:** `.github/workflows/vscode-extension.yml` (new)
  - Notes: _____

- [ ] **P11-API-08: Add JetBrains plugin CI/CD pipeline** — M
  - GitHub Actions workflow:
    - Build `@unerr/ui` → build plugin → `./gradlew buildPlugin`
    - Run plugin tests
    - On tag: publish to JetBrains Marketplace via `publishPlugin` Gradle task
  - **Test:** CI builds .zip artifact. Marketplace publish succeeds (staging first).
  - **Depends on:** P11-INFRA-03, P11-INFRA-01
  - **Files:** `.github/workflows/jetbrains-plugin.yml` (new)
  - Notes: _____

---

## 2.5 Frontend / UI Layer

### `@unerr/ui` Components

- [ ] **P11-UI-01: Build `ImpactGraph` component** — L
  - Force-directed graph using d3-force:
    - Center node highlighted with Rail Purple border
    - Caller nodes colored by depth (darker = closer)
    - Callee nodes colored differently (outbound direction)
    - Edge arrows showing direction (calls, imports, extends)
    - Pan, zoom, drag interactions
    - Click node → fires `onNodeClick(id, filePath, line)`
    - Depth slider (1-5) to adjust traversal depth
    - Node tooltip: entity name, kind, file path, signature preview
  - Truncation: >200 nodes → show warning + truncated graph
  - Responsive: fills container dimensions
  - **Test:** Render 50-node graph → all nodes visible. Click node → callback fires. Zoom works. Depth slider changes node count. >200 nodes → truncation warning.
  - **Depends on:** P11-INFRA-04
  - **Files:** `packages/ui/src/ImpactGraph.tsx` (new)
  - Notes: _____

- [ ] **P11-UI-02: Build `BlueprintDashboard` component** — L
  - Swimlane layout using React Flow:
    - Each module = a container node (rectangle with entity count)
    - Dependency edges between modules (animated arrows)
    - Module color intensity proportional to entity count
    - Click module → expands to show top entities
    - Module labels: name + entity count + language badges
  - Group-by toggle: "module" (first-level directory) or "directory" (full path)
  - Responsive: fills container
  - **Test:** Render 5-module blueprint → all modules visible. Dependency edges rendered. Click module → expansion. Toggle groupBy → re-layouts.
  - **Depends on:** P11-INFRA-04
  - **Files:** `packages/ui/src/BlueprintDashboard.tsx` (new)
  - Notes: _____

- [ ] **P11-UI-03: Build `LedgerTimeline` component** — M
  - Vertical timeline:
    - Each entry = a card with: action icon, entity name, timestamp, status badge
    - Branch points shown as timeline forks (branching line)
    - Rewind markers with ⏪ icon
    - Status colors: committed (green), working (yellow), reverted (red)
    - Click entry → fires `onEntryClick(id)`
    - Scroll to load more (virtual scrolling for >100 entries)
  - Current timeline indicator at top
  - **Test:** Render 20 entries → all visible. Branch point → fork visualization. Click entry → callback. Scroll → loads more.
  - **Depends on:** P11-INFRA-01
  - **Files:** `packages/ui/src/LedgerTimeline.tsx` (new)
  - Notes: _____

- [ ] **P11-UI-04: Build `DiffViewer` component** — M
  - Diff display:
    - Inline mode: unified diff with green (additions) / red (deletions)
    - Side-by-side mode: two columns, original vs modified
    - File headers with file path + change count
    - Line numbers on both sides
    - Click line → fires `onLineClick(filePath, line)`
    - Toggle: inline vs side-by-side
  - Syntax highlighting: basic keyword highlighting (no full tree-sitter in browser)
  - **Test:** Render diff with 3 files → all files visible. Click line → callback. Toggle mode → re-renders. Empty diff → "No changes" message.
  - **Depends on:** P11-INFRA-01
  - **Files:** `packages/ui/src/DiffViewer.tsx` (new)
  - Notes: _____

### VS Code Extension Panels

- [ ] **P11-UI-05: Implement VS Code Blueprint panel** — M
  - `packages/vscode-extension/src/blueprint-panel.ts`:
    - Creates WebView panel with `@unerr/ui` bundle
    - Fetches blueprint data via `show_blueprint` MCP tool or API
    - Sends data to WebView via postMessage
    - Handles node clicks → file navigation
    - Refreshes on `index_complete` SSE event
  - **Test:** Command `unerr.showBlueprint` → panel opens. Data renders. Node click → file opens. SSE event → panel refreshes.
  - **Depends on:** P11-ADAPT-02, P11-UI-02
  - **Files:** `packages/vscode-extension/src/blueprint-panel.ts` (new)
  - Notes: _____

- [ ] **P11-UI-06: Implement VS Code Impact Graph panel** — M
  - `packages/vscode-extension/src/impact-panel.ts`:
    - Creates WebView panel with `@unerr/ui` bundle
    - Fetches graph data via `show_impact_graph` MCP tool or API
    - Accepts entity selection from context menu or command
    - Sends graph data to WebView
    - Handles node clicks → file navigation
  - **Test:** Right-click function → "Show Impact Graph" → panel opens with centered entity. Node click → file opens. Depth change → re-fetches.
  - **Depends on:** P11-ADAPT-02, P11-UI-01
  - **Files:** `packages/vscode-extension/src/impact-panel.ts` (new)
  - Notes: _____

- [ ] **P11-UI-07: Implement VS Code Timeline panel** — M
  - `packages/vscode-extension/src/timeline-panel.ts`:
    - Creates WebView panel with `@unerr/ui` bundle
    - Fetches timeline data via `show_timeline` MCP tool or API
    - Handles entry clicks → file navigation to affected entity
    - Refreshes on `ledger_entry` SSE event
  - **Test:** Panel shows timeline entries. Click entry → navigates to entity. SSE event → new entry appears.
  - **Depends on:** P11-ADAPT-02, P11-UI-03
  - **Files:** `packages/vscode-extension/src/timeline-panel.ts` (new)
  - Notes: _____

- [ ] **P11-UI-08: Implement VS Code Diff panel** — M
  - `packages/vscode-extension/src/diff-panel.ts`:
    - Creates WebView panel with `@unerr/ui` bundle
    - Fetches diff data via `show_diff` MCP tool or API
    - Handles line clicks → file navigation
    - Refreshes on `workspace_sync` SSE event
  - **Test:** Panel shows workspace diff. Click line → file opens at line. SSE event → diff refreshes.
  - **Depends on:** P11-ADAPT-02, P11-UI-04
  - **Files:** `packages/vscode-extension/src/diff-panel.ts` (new)
  - Notes: _____

### JetBrains Plugin Panels

- [ ] **P11-UI-09: Implement JetBrains tool windows (Blueprint, Impact, Timeline, Diff)** — L
  - `BlueprintToolWindow.kt`, `ImpactToolWindow.kt`, `TimelineToolWindow.kt`, `DiffToolWindow.kt`:
    - Each implements `ToolWindowFactory`
    - Creates `JBCefBrowser` with `@unerr/ui` HTML bundle
    - Uses `CefMessageRouter` for bidirectional communication
    - Handles JS→Kotlin messages (node clicks → `OpenFileDescriptor`)
    - Handles Kotlin→JS data updates (via `executeJavaScript`)
  - All four share a common `UnerrDataHandler` for message routing
  - **Test:** Each tool window opens with JCEF. Data renders. Click node → file opens in editor. JCEF not supported → fallback message.
  - **Depends on:** P11-ADAPT-04, P11-UI-01..04
  - **Files:** `packages/jetbrains-plugin/src/main/kotlin/com/unerr/plugin/` (4 new Kotlin files)
  - Notes: _____

### MCP renderHint Integration

- [ ] **P11-UI-10: Implement renderHint interception in VS Code extension** — M
  - When agent calls a `show_*` MCP tool, the IDE receives the response with `_meta.renderHint`
  - Extension intercepts MCP tool responses (via MCP client event or output channel parsing)
  - Dispatches to appropriate panel based on `renderHint` value:
    - `"blueprint"` → BlueprintPanel
    - `"impact_graph"` → ImpactPanel
    - `"timeline"` → TimelinePanel
    - `"diff"` → DiffPanel
  - Unknown renderHint → ignored (forward-compatible)
  - **Test:** Agent calls `show_blueprint` → extension detects renderHint → panel opens automatically. Unknown hint → no action.
  - **Depends on:** P11-UI-05..08
  - **Files:** `packages/vscode-extension/src/render-hint-handler.ts` (new)
  - Notes: _____

---

## 2.6 Testing & Verification

### Unit Tests

- [ ] **P11-TEST-01: `@unerr/ui` ImpactGraph component tests** — M
  - Renders with 10 nodes → all nodes in DOM
  - Click node → `onNodeClick` callback fires with correct id
  - 0 nodes → empty state message
  - >200 nodes → truncation warning displayed
  - Depth slider changes → `onDepthChange` callback fires
  - **Depends on:** P11-UI-01
  - **Files:** `packages/ui/src/__tests__/ImpactGraph.test.tsx`
  - Notes: _____

- [ ] **P11-TEST-02: `@unerr/ui` BlueprintDashboard component tests** — M
  - Renders with 5 modules → all module nodes visible
  - Dependency edges rendered between correct modules
  - Click module → expansion callback fires
  - 0 modules → empty state
  - GroupBy toggle → re-renders with different grouping
  - **Depends on:** P11-UI-02
  - **Files:** `packages/ui/src/__tests__/BlueprintDashboard.test.tsx`
  - Notes: _____

- [ ] **P11-TEST-03: `@unerr/ui` LedgerTimeline component tests** — S
  - Renders 10 entries → all entries in DOM
  - Branch point → fork visualization rendered
  - Click entry → callback fires
  - 0 entries → empty state
  - **Depends on:** P11-UI-03
  - **Files:** `packages/ui/src/__tests__/LedgerTimeline.test.tsx`
  - Notes: _____

- [ ] **P11-TEST-04: `@unerr/ui` DiffViewer component tests** — S
  - Renders diff with 3 files → all files visible
  - Toggle inline/side-by-side → mode changes
  - Click line → callback fires
  - Empty diff → "No changes" message
  - **Depends on:** P11-UI-04
  - **Files:** `packages/ui/src/__tests__/DiffViewer.test.tsx`
  - Notes: _____

- [ ] **P11-TEST-05: MCP show_blueprint tool tests** — M
  - Repo with entities → blueprint data with modules and dependencies
  - Empty repo → empty blueprint
  - renderHint = "blueprint" in response _meta
  - Text content includes human-readable summary
  - **Depends on:** P11-API-01
  - **Files:** `lib/mcp/tools/__tests__/show-blueprint.test.ts`
  - Notes: _____

- [ ] **P11-TEST-06: MCP show_impact_graph tool tests** — M
  - Entity with 5 callers + 3 callees → 9 nodes
  - Depth 1 → direct callers/callees only
  - Depth 3 → transitive callers/callees
  - >200 nodes → truncated to 200
  - Entity not found → error response
  - renderHint = "impact_graph" in response
  - **Depends on:** P11-API-02
  - **Files:** `lib/mcp/tools/__tests__/show-impact-graph.test.ts`
  - Notes: _____

- [ ] **P11-TEST-07: SSE event dispatching tests** — M
  - Publish `index_complete` event → SSE client receives it
  - Publish event for org_A → client subscribed to org_B does not receive
  - SSE connection drop → reconnect after backoff
  - 5 failed reconnects → switch to polling
  - **Depends on:** P11-API-05
  - **Files:** `lib/mcp/__tests__/sse-events.test.ts`
  - Notes: _____

### Integration Tests

- [ ] **P11-TEST-08: VS Code extension integration test** — L
  - Use `@vscode/test-electron` to launch VS Code with extension:
    - Extension activates → sidebar views registered
    - Command `unerr.showBlueprint` → panel opens
    - Mock API data → graph renders in WebView
    - Node click in WebView → file opens in editor
  - **Depends on:** P11-UI-05..08
  - **Files:** `packages/vscode-extension/src/__tests__/extension.integration.test.ts`
  - Notes: _____

- [ ] **P11-TEST-09: `@unerr/ui` bundle integration test** — M
  - Build bundle → load in minimal HTML page → all 4 components render
  - Verify: no Next.js imports, no Node.js APIs, no CSR hydration errors
  - Bundle size assertion: < 100 KB gzipped
  - **Depends on:** P11-INFRA-01, P11-UI-01..04
  - **Files:** `packages/ui/src/__tests__/bundle.integration.test.ts`
  - Notes: _____

- [ ] **P11-TEST-10: renderHint end-to-end test** — M
  - Agent calls `show_impact_graph` → MCP response includes renderHint → extension detects and opens panel → graph renders with correct data
  - Agent calls same tool without extension → text response only, no error
  - **Depends on:** P11-API-02, P11-UI-10
  - **Files:** `packages/vscode-extension/src/__tests__/render-hint.integration.test.ts`
  - Notes: _____

### Manual Verification

- [ ] **P11-TEST-11: Manual VS Code extension verification** — L
  - Install extension in VS Code
  - Authenticate via "Sign In"
  - Open each panel: Blueprint, Impact, Timeline, Diff
  - Right-click function → "Show Impact Graph" → verify graph
  - Click node in graph → verify file navigation
  - Trigger re-index → verify SSE event → panel refresh
  - **Depends on:** All P11 VS Code items
  - Notes: _____

- [ ] **P11-TEST-12: Manual JetBrains plugin verification** — L
  - Install plugin in IntelliJ IDEA
  - Authenticate
  - Open each tool window
  - Verify JCEF renders correctly
  - Verify file navigation from panel clicks
  - Verify on IDE without JCEF → graceful fallback
  - **Depends on:** All P11 JetBrains items
  - Notes: _____

---

## Dependency Graph

```
P11-INFRA-01 (@unerr/ui package) ─── independent
P11-INFRA-02 (VS Code scaffold) ──── independent
P11-INFRA-03 (JetBrains scaffold) ── independent
P11-INFRA-04 (graph viz deps) ─────── depends on P11-INFRA-01

P11-DB-01 (render data types) ─────── independent

P11-ADAPT-01 (VS Code API client) ── depends on P11-INFRA-02
P11-ADAPT-02 (WebView panel mgr) ─── depends on P11-INFRA-01, P11-INFRA-02
P11-ADAPT-03 (SSE client) ────────── depends on P11-ADAPT-01
P11-ADAPT-04 (JetBrains bridge) ──── depends on P11-INFRA-03

P11-API-01 (show_blueprint tool) ─── depends on P11-DB-01
P11-API-02 (show_impact_graph) ───── depends on P11-DB-01
P11-API-03 (show_timeline) ────────── depends on P11-DB-01, Phase 5.5
P11-API-04 (show_diff) ───────────── depends on P11-DB-01, Phase 2
P11-API-05 (SSE event types) ─────── depends on existing transport
P11-API-06 (event publishing) ─────── depends on P11-API-05
P11-API-07 (VS Code CI/CD) ────────── depends on P11-INFRA-02, P11-INFRA-01
P11-API-08 (JetBrains CI/CD) ─────── depends on P11-INFRA-03, P11-INFRA-01

P11-UI-01 (ImpactGraph) ──────────── depends on P11-INFRA-04
P11-UI-02 (BlueprintDashboard) ───── depends on P11-INFRA-04
P11-UI-03 (LedgerTimeline) ────────── depends on P11-INFRA-01
P11-UI-04 (DiffViewer) ───────────── depends on P11-INFRA-01
P11-UI-05 (VS Code Blueprint) ────── depends on P11-ADAPT-02, P11-UI-02
P11-UI-06 (VS Code Impact) ────────── depends on P11-ADAPT-02, P11-UI-01
P11-UI-07 (VS Code Timeline) ─────── depends on P11-ADAPT-02, P11-UI-03
P11-UI-08 (VS Code Diff) ─────────── depends on P11-ADAPT-02, P11-UI-04
P11-UI-09 (JetBrains panels) ─────── depends on P11-ADAPT-04, P11-UI-01..04
P11-UI-10 (renderHint handler) ───── depends on P11-UI-05..08

P11-TEST-01..12 ── depend on corresponding implementation items
```

**Recommended implementation order:**

1. **Infrastructure** (P11-INFRA-01..04) — `@unerr/ui` package, VS Code scaffold, JetBrains scaffold, graph visualization deps
2. **Types** (P11-DB-01) — render data type definitions
3. **`@unerr/ui` components** (P11-UI-01..04) — ImpactGraph, BlueprintDashboard, LedgerTimeline, DiffViewer
4. **MCP tools** (P11-API-01..04) — show_blueprint, show_impact_graph, show_timeline, show_diff
5. **SSE** (P11-API-05..06) — Event types, publishing hooks
6. **VS Code adapters** (P11-ADAPT-01..03) — API client, panel manager, SSE client
7. **VS Code panels** (P11-UI-05..08) — Blueprint, Impact, Timeline, Diff panels
8. **renderHint** (P11-UI-10) — MCP response interception
9. **JetBrains** (P11-ADAPT-04, P11-UI-09) — API client, JCEF bridge, tool windows
10. **CI/CD** (P11-API-07..08) — Extension/plugin publishing pipelines
11. **Testing** (P11-TEST-01..12) — Component tests, integration, manual verification

---

## New Files Summary

```
packages/ui/
  src/
    BlueprintDashboard.tsx         ← Swimlane architecture visualization (React Flow)
    ImpactGraph.tsx                ← Force-directed entity graph (d3-force)
    LedgerTimeline.tsx             ← Prompt Ledger timeline view
    DiffViewer.tsx                 ← Workspace overlay diff viewer
    types.ts                       ← Shared data types for render data
    index.ts                       ← Public exports
  package.json                     ← Standalone React package (no Next.js)
  vite.config.ts                   ← ES module library build

packages/vscode-extension/
  src/
    extension.ts                   ← VS Code extension entry point
    api-client.ts                  ← unerr API client for extension host
    panel-manager.ts               ← WebView panel factory + postMessage protocol
    sse-client.ts                  ← SSE event stream client + reconnection
    blueprint-panel.ts             ← Blueprint Dashboard panel
    impact-panel.ts                ← Impact Graph panel
    timeline-panel.ts              ← Ledger Timeline panel
    diff-panel.ts                  ← Diff Viewer panel
    render-hint-handler.ts         ← MCP renderHint interception + dispatch
  package.json                     ← VS Code extension manifest

packages/jetbrains-plugin/
  src/main/kotlin/com/unerr/plugin/
    BlueprintToolWindow.kt         ← JCEF Blueprint panel
    ImpactToolWindow.kt            ← JCEF Impact Graph panel
    TimelineToolWindow.kt          ← JCEF Timeline panel
    DiffToolWindow.kt              ← JCEF Diff panel
    UnerrApiClient.kt              ← HTTP API client
    UnerrDataHandler.kt            ← CefMessageRouter handler
  build.gradle.kts                 ← IntelliJ Platform plugin config
  src/main/resources/META-INF/
    plugin.xml                     ← Plugin descriptor

lib/mcp/tools/
  show-blueprint.ts                ← MCP tool: show_blueprint
  show-impact-graph.ts             ← MCP tool: show_impact_graph
  show-timeline.ts                 ← MCP tool: show_timeline
  show-diff.ts                     ← MCP tool: show_diff
lib/mcp/
  events.ts                        ← Event publishing helper (Redis pub/sub → SSE)
```

### Modified Files

```
lib/mcp/transport.ts               ← SSE real event types (extend ping-only stub)
lib/mcp/tools/index.ts             ← Register 4 new show_* tools
lib/mcp/tools/types.ts             ← Render data type definitions
lib/temporal/workflows/index-repo.ts  ← Publish index_complete event on completion
lib/mcp/tools/sync.ts              ← Publish ledger_entry event on sync_local_diff
.github/workflows/
  vscode-extension.yml             ← CI/CD for VS Code extension
  jetbrains-plugin.yml             ← CI/CD for JetBrains plugin
```

---

## Revision Log

| Date | Author | Change |
|------|--------|--------|
| 2026-02-21 | — | Initial document created. 4 INFRA, 1 DB, 4 ADAPT, 8 API, 10 UI, 12 TEST items. Total: **39 tracker items.** |
