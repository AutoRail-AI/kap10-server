import { proxyActivities } from "@temporalio/workflow"
import type * as light from "../activities/indexing-light"

const lightActivities = proxyActivities<typeof light>({
  taskQueue: "light-llm-queue",
  startToCloseTimeout: "5m",
  retry: { maximumAttempts: 3 },
})

export interface DeleteRepoInput {
  orgId: string
  repoId: string
}

export async function deleteRepoWorkflow(input: DeleteRepoInput): Promise<void> {
  await lightActivities.deleteRepoData(input)
}
