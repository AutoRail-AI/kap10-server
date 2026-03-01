/**
 * L-24: Git Temporal Analysis — pure functions for mining commit history,
 * computing co-change edges, and building per-entity temporal context.
 *
 * No DI dependencies — uses child_process.execFile for `git log`.
 */

import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CommitFileEntry {
  sha: string
  subject: string
  authorEmail: string
  timestamp: number // epoch seconds
  files: string[] // relative paths changed
}

export interface CoChangeEdge {
  fileA: string
  fileB: string
  support: number // co-commits count
  confidence: number // support / commits-where-A-changed
  jaccard: number // support / union-of-commits
}

export interface TemporalContext {
  change_frequency: number // total commits touching this file
  recent_change_frequency: number // commits in last 90 days
  author_count: number // unique authors
  author_concentration: number // Herfindahl index (0-1, 1=single author)
  stability_score: number // 0-1, higher = less change recently
  commit_intents: string[] // classified intent labels (top 3)
  last_changed_at: string // ISO timestamp
}

// ── Intent Classification ──────────────────────────────────────────────────────

const INTENT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(fix|bug|patch|hotfix|resolve|issue)\b/i, "bugfix"],
  [/\b(feat|add|new|implement|introduce)\b/i, "feature"],
  [/\b(refactor|rename|move|clean|restructure)\b/i, "refactoring"],
  [/\b(test|spec|coverage|assert)\b/i, "testing"],
  [/\b(doc|readme|comment|jsdoc|typedoc)\b/i, "documentation"],
  [/\b(perf|optim|speed|cache|fast)\b/i, "performance"],
  [/\b(chore|ci|build|deps|dependency|bump|upgrade)\b/i, "maintenance"],
]

function classifyCommitIntent(subject: string): string | null {
  for (const [pattern, label] of INTENT_PATTERNS) {
    if (pattern.test(subject)) return label
  }
  return null
}

// ── Core Functions ─────────────────────────────────────────────────────────────

const SEPARATOR = "SEP"

/**
 * Mine commit history from a git repository.
 * Runs `git log --name-only` and parses into structured entries.
 */
export async function mineCommitHistory(
  workspacePath: string,
  maxDays = 365,
  maxCommits = 5000,
): Promise<CommitFileEntry[]> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "log",
      "--name-only",
      `--format=${SEPARATOR}%H|%s|%ae|%at`,
      "--no-merges",
      `--since=${maxDays} days ago`,
      `-n`,
      String(maxCommits),
    ],
    { cwd: workspacePath, maxBuffer: 50 * 1024 * 1024 },
  )

  return parseGitLogOutput(stdout)
}

/**
 * Parse raw git log output into CommitFileEntry[].
 * Exported for testing.
 */
export function parseGitLogOutput(stdout: string): CommitFileEntry[] {
  const commits: CommitFileEntry[] = []
  const blocks = stdout.split(SEPARATOR).filter((b) => b.trim())

  for (const block of blocks) {
    const lines = block.trim().split("\n")
    const headerLine = lines[0]
    if (!headerLine) continue

    const parts = headerLine.split("|")
    if (parts.length < 4) continue

    const sha = parts[0]!
    const subject = parts[1]!
    const authorEmail = parts[2]!
    const timestamp = parseInt(parts[3]!, 10)

    if (!sha || isNaN(timestamp)) continue

    const files = lines
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith(SEPARATOR))

    if (files.length > 0) {
      commits.push({ sha, subject, authorEmail, timestamp, files })
    }
  }

  return commits
}

/**
 * Compute file-level co-change edges from commit history.
 * For each pair of files changed together, tracks support, confidence, and Jaccard.
 */
export function computeCoChangeEdges(
  commits: CommitFileEntry[],
  supportThreshold = 3,
  confidenceThreshold = 0.3,
): CoChangeEdge[] {
  // Build file → set of commit SHAs
  const fileToCommits = new Map<string, Set<string>>()
  for (const commit of commits) {
    for (const file of commit.files) {
      let set = fileToCommits.get(file)
      if (!set) {
        set = new Set()
        fileToCommits.set(file, set)
      }
      set.add(commit.sha)
    }
  }

  // Prune files with too few commits to reduce O(F^2) computation
  let activeFiles = Array.from(fileToCommits.entries()).filter(([, shas]) => shas.size >= 2)

  // If too many files, further prune
  if (activeFiles.length > 5000) {
    activeFiles = activeFiles.filter(([, shas]) => shas.size >= 3)
  }

  const edges: CoChangeEdge[] = []

  // Pairwise co-occurrence
  for (let i = 0; i < activeFiles.length; i++) {
    const [fileA, shaSetA] = activeFiles[i]!
    for (let j = i + 1; j < activeFiles.length; j++) {
      const [fileB, shaSetB] = activeFiles[j]!

      // Count intersection
      let support = 0
      shaSetA.forEach((sha) => {
        if (shaSetB.has(sha)) support++
      })

      if (support < supportThreshold) continue

      const confidence = support / shaSetA.size
      const unionSet = new Set(Array.from(shaSetA))
      shaSetB.forEach((sha) => unionSet.add(sha))
      const union = unionSet.size
      const jaccard = support / union

      if (confidence >= confidenceThreshold) {
        edges.push({ fileA: fileA!, fileB: fileB!, support, confidence, jaccard })
      }
    }
  }

  return edges
}

/**
 * Compute temporal context for a specific file path.
 */
export function computeTemporalContext(
  commits: CommitFileEntry[],
  filePath: string,
): TemporalContext | null {
  const fileCommits = commits.filter((c) => c.files.includes(filePath))
  if (fileCommits.length === 0) return null

  const now = Math.floor(Date.now() / 1000)
  const ninetyDaysAgo = now - 90 * 24 * 60 * 60

  // Change frequency
  const changeFrequency = fileCommits.length
  const recentChangeFrequency = fileCommits.filter(
    (c) => c.timestamp >= ninetyDaysAgo,
  ).length

  // Author concentration (Herfindahl index)
  const authorCounts = new Map<string, number>()
  for (const commit of fileCommits) {
    authorCounts.set(
      commit.authorEmail,
      (authorCounts.get(commit.authorEmail) ?? 0) + 1,
    )
  }
  const authorCount = authorCounts.size
  let authorConcentration = 0
  for (const count of Array.from(authorCounts.values())) {
    const share = count / changeFrequency
    authorConcentration += share * share
  }

  // Stability score: 1 - (recent / total) with time decay
  const recentRatio = recentChangeFrequency / Math.max(changeFrequency, 1)
  const stabilityScore = Math.max(0, Math.min(1, 1 - recentRatio))

  // Commit intent classification (top 3 by frequency)
  const intentCounts = new Map<string, number>()
  for (const commit of fileCommits) {
    const intent = classifyCommitIntent(commit.subject)
    if (intent) {
      intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1)
    }
  }
  const commitIntents = Array.from(intentCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label]) => label)

  // Last changed
  const lastTimestamp = Math.max(...fileCommits.map((c) => c.timestamp))
  const lastChangedAt = new Date(lastTimestamp * 1000).toISOString()

  return {
    change_frequency: changeFrequency,
    recent_change_frequency: recentChangeFrequency,
    author_count: authorCount,
    author_concentration: Math.round(authorConcentration * 1000) / 1000,
    stability_score: Math.round(stabilityScore * 1000) / 1000,
    commit_intents: commitIntents,
    last_changed_at: lastChangedAt,
  }
}

/**
 * Convert file-level co-change edges to entity-level edges.
 * Uses entityFileMap to find entities in each co-changing file pair.
 */
export function mapFileEdgesToEntityEdges(
  coChangeEdges: CoChangeEdge[],
  entityFileMap: Map<string, string[]>,
  maxEdgesPerPair = 5,
): Array<{
  fromId: string
  toId: string
  support: number
  confidence: number
  jaccard: number
}> {
  const entityEdges: Array<{
    fromId: string
    toId: string
    support: number
    confidence: number
    jaccard: number
  }> = []

  for (const edge of coChangeEdges) {
    const entitiesA = entityFileMap.get(edge.fileA)
    const entitiesB = entityFileMap.get(edge.fileB)
    if (!entitiesA || !entitiesB) continue

    // Create edges between entities from co-changing files (capped)
    let count = 0
    for (const fromId of entitiesA) {
      if (count >= maxEdgesPerPair) break
      for (const toId of entitiesB) {
        if (count >= maxEdgesPerPair) break
        entityEdges.push({
          fromId,
          toId,
          support: edge.support,
          confidence: edge.confidence,
          jaccard: edge.jaccard,
        })
        count++
      }
    }
  }

  return entityEdges
}
