/**
 * GitHub App client — installation token generation via @octokit/auth-app.
 * Lazy init so build never connects to GitHub.
 */

import type { Octokit } from "@octokit/rest"

let createAppAuth: typeof import("@octokit/auth-app").createAppAuth
let OctokitRest: typeof import("@octokit/rest").Octokit

function getCreateAppAuth(): typeof import("@octokit/auth-app").createAppAuth {
  if (!createAppAuth) {
    // Lazy load so build never connects to GitHub
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@octokit/auth-app") as typeof import("@octokit/auth-app")
    createAppAuth = mod.createAppAuth
  }
  return createAppAuth
}

function getOctokitRest(): typeof import("@octokit/rest").Octokit {
  if (!OctokitRest) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@octokit/rest") as typeof import("@octokit/rest")
    OctokitRest = mod.Octokit
  }
  return OctokitRest
}

export function getInstallationOctokit(installationId: number): Octokit {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required for GitHub App")
  }
  const OctokitClass = getOctokitRest()
  const createAppAuthFn = getCreateAppAuth()
  return new OctokitClass({
    authStrategy: createAppAuthFn,
    auth: {
      appId,
      privateKey: privateKey.replace(/\\n/g, "\n"),
      installationId,
    },
  })
}

export async function getInstallationToken(installationId: number): Promise<string> {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
  if (!appId || !privateKey) {
    throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required for GitHub App")
  }
  const auth = getCreateAppAuth()({
    appId,
    privateKey: privateKey.replace(/\\n/g, "\n"),
  })
  const { token } = await auth({ type: "installation", installationId })
  return token
}
