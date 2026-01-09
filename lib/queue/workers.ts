import { type Job, Worker } from "bullmq"
import { createRedisConnection } from "./redis"
import {
  type EmailJobData,
  type JobResult,
  type ProcessingJobData,
  QUEUE_NAMES,
  type WebhookJobData,
} from "./types"

// Worker instances
const workers: Worker[] = []

/**
 * Email job processor
 * Customize this function to send emails via your email provider
 */
async function processEmailJob(job: Job<EmailJobData>): Promise<JobResult> {
  const { to, subject: _subject, body: _body, templateId: _templateId, variables: _variables } = job.data

  console.log(`Processing email job ${job.id}: sending to ${to}`)

  try {
    // TODO: Implement your email sending logic here
    // Example with Resend:
    // const resend = new Resend(process.env.RESEND_API_KEY)
    // await resend.emails.send({ from: process.env.EMAIL_FROM, to, subject, html: body })

    // Simulate email sending for now
    await new Promise((resolve) => setTimeout(resolve, 100))

    console.log(`Email sent successfully to ${to}`)
    return { success: true, message: `Email sent to ${to}` }
  } catch (error) {
    console.error(`Failed to send email to ${to}:`, error)
    throw error // This will trigger retry
  }
}

/**
 * Processing job processor
 * Customize this for your long-running background tasks
 */
async function processProcessingJob(
  job: Job<ProcessingJobData>
): Promise<JobResult> {
  const { userId, taskId, payload } = job.data

  console.log(`Processing job ${job.id}: task ${taskId} for user ${userId}`)

  try {
    // TODO: Implement your processing logic here
    // This is where you'd handle long-running tasks like:
    // - File processing
    // - Data transformation
    // - Report generation
    // - AI/ML tasks

    // Update progress (visible in job status)
    await job.updateProgress(10)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await job.updateProgress(50)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await job.updateProgress(100)

    console.log(`Task ${taskId} completed successfully`)
    return { success: true, message: `Task ${taskId} completed`, data: payload }
  } catch (error) {
    console.error(`Task ${taskId} failed:`, error)
    throw error
  }
}

/**
 * Webhook job processor
 * Sends HTTP requests to external services
 */
async function processWebhookJob(job: Job<WebhookJobData>): Promise<JobResult> {
  const { url, method, headers, body } = job.data

  console.log(`Processing webhook job ${job.id}: ${method} ${url}`)

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      throw new Error(`Webhook failed with status ${response.status}`)
    }

    const responseData = await response.json().catch(() => null)
    console.log(`Webhook to ${url} succeeded`)
    return { success: true, data: responseData }
  } catch (error) {
    console.error(`Webhook to ${url} failed:`, error)
    throw error
  }
}

/**
 * Start all workers
 * Call this when your application starts (e.g., in a separate worker process)
 */
export function startWorkers(): void {
  console.log("Starting job workers...")

  // Email worker
  const emailWorker = new Worker(QUEUE_NAMES.EMAIL, processEmailJob, {
    connection: createRedisConnection(),
    concurrency: 5,
  })
  workers.push(emailWorker)

  // Processing worker
  const processingWorker = new Worker(
    QUEUE_NAMES.PROCESSING,
    processProcessingJob,
    {
      connection: createRedisConnection(),
      concurrency: 3, // Lower concurrency for heavy tasks
    }
  )
  workers.push(processingWorker)

  // Webhooks worker
  const webhooksWorker = new Worker(QUEUE_NAMES.WEBHOOKS, processWebhookJob, {
    connection: createRedisConnection(),
    concurrency: 10,
  })
  workers.push(webhooksWorker)

  // Set up event handlers for all workers
  workers.forEach((worker) => {
    worker.on("completed", (job) => {
      console.log(`Job ${job.id} completed in queue ${worker.name}`)
    })

    worker.on("failed", (job, error) => {
      console.error(`Job ${job?.id} failed in queue ${worker.name}:`, error)
    })

    worker.on("error", (error) => {
      console.error(`Worker error in ${worker.name}:`, error)
    })
  })

  console.log("All workers started")
}

/**
 * Stop all workers gracefully
 */
export async function stopWorkers(): Promise<void> {
  console.log("Stopping workers...")
  await Promise.all(workers.map((w) => w.close()))
  workers.length = 0
  console.log("All workers stopped")
}
