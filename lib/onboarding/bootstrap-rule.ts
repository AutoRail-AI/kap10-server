/**
 * Bootstrap Rule generator — produces .cursor/rules/kap10.mdc content.
 * This rule instructs AI agents to sync context before/after code generation.
 */

const RULE_VERSION = "1.0.0"

/**
 * Generate the kap10 Bootstrap Rule for Cursor IDE.
 * The rule contains pre-flight and post-flight sync instructions.
 */
export function generateBootstrapRule(repoName: string): string {
  return `---
kap10_rule_version: "${RULE_VERSION}"
description: "kap10 Code Intelligence — sync context with the cloud knowledge graph"
globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go", "**/*.rs", "**/*.java"]
alwaysApply: true
---

# kap10 Code Intelligence

This repository is connected to **kap10** — a cloud-hosted code intelligence platform that provides your AI agent with deep understanding of the codebase structure, dependencies, and call graphs.

## Pre-flight: Before Writing Code

Before making changes, gather context from the knowledge graph:

1. **Check applicable rules** to understand constraints:
   \`\`\`
   Call: get_rules with file_path="path/to/file.ts"
   \`\`\`

2. **Understand the function** you're modifying:
   \`\`\`
   Call: get_function with name="functionName"
   \`\`\`
   This returns the function signature, body, callers, and callees.

3. **Check who calls it** to understand impact:
   \`\`\`
   Call: get_callers with name="functionName" depth=2
   \`\`\`

4. **Search for related code** if exploring:
   \`\`\`
   Call: search_code with query="relevant keyword"
   \`\`\`

5. **Get conventions** to follow established patterns:
   \`\`\`
   Call: get_conventions
   \`\`\`

## Post-flight: After Writing Code

After making changes:

1. **Check your code against rules**:
   \`\`\`
   Call: check_rules with code="<your new code>"
   \`\`\`

2. **Sync your local modifications** so the knowledge graph stays current:
   \`\`\`
   Call: sync_local_diff with diff="$(git diff)"
   \`\`\`

This updates the cloud knowledge graph with your uncommitted changes, so subsequent queries reflect your latest code.

## Important Notes

- **Always use repo-root-relative paths** when calling MCP tools (e.g., \`src/auth/login.ts\`, not just \`login.ts\`).
- **Exclude lockfiles from diffs**: The sync tool automatically strips lockfiles (\`package-lock.json\`, \`pnpm-lock.yaml\`, etc.) and build directories (\`node_modules/\`, \`dist/\`, \`.next/\`).
- The knowledge graph is updated on every push to the default branch. Your local sync overlay expires after 12 hours of inactivity.
- Repository: **${repoName}**
`
}

/**
 * Get the current Bootstrap Rule version.
 */
export function getBootstrapRuleVersion(): string {
  return RULE_VERSION
}
