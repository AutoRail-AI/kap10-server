/**
 * Stub IGitHost (Phase 0). Phase 1+ will implement with Octokit.
 */

import type { IGitHost } from "@/lib/ports/git-host"
import { NotImplementedError } from "./errors"

export class GitHubHost implements IGitHost {
  async cloneRepo(): Promise<void> {
    throw new NotImplementedError("IGitHost.cloneRepo not implemented in Phase 0")
  }

  async getPullRequest(): Promise<never> {
    throw new NotImplementedError("IGitHost.getPullRequest not implemented in Phase 0")
  }

  async createPullRequest(): Promise<never> {
    throw new NotImplementedError("IGitHost.createPullRequest not implemented in Phase 0")
  }

  async getDiff(): Promise<string> {
    throw new NotImplementedError("IGitHost.getDiff not implemented in Phase 0")
  }

  async listFiles(): Promise<never[]> {
    throw new NotImplementedError("IGitHost.listFiles not implemented in Phase 0")
  }

  async createWebhook(): Promise<void> {
    throw new NotImplementedError("IGitHost.createWebhook not implemented in Phase 0")
  }
}
