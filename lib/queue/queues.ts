import { Queue, type QueueOptions } from "bullmq"
import { getRedis } from "./redis"
import {
  type EmailJobData,
  type ProcessingJobData,
  QUEUE_NAMES,
  type WebhookJobData,
} from "./types"

// Default queue options
const defaultQueueOptions: Partial<QueueOptions> = {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
      age: 24 * 60 * 60, // Keep for 24 hours
    },
    removeOnFail: {
      count: 500, // Keep last 500 failed jobs for debugging
      age: 7 * 24 * 60 * 60, // Keep for 7 days
    },
  },
}

// Queue instances (lazy loaded)
let emailQueue: Queue<EmailJobData> | null = null
let processingQueue: Queue<ProcessingJobData> | null = null
let webhooksQueue: Queue<WebhookJobData> | null = null

/**
 * Get or create the email queue
 */
export function getEmailQueue(): Queue<EmailJobData> {
  if (!emailQueue) {
    emailQueue = new Queue<EmailJobData>(QUEUE_NAMES.EMAIL, {
      connection: getRedis(),
      ...defaultQueueOptions,
    })
  }
  return emailQueue
}

/**
 * Get or create the processing queue
 */
export function getProcessingQueue(): Queue<ProcessingJobData> {
  if (!processingQueue) {
    processingQueue = new Queue<ProcessingJobData>(QUEUE_NAMES.PROCESSING, {
      connection: getRedis(),
      ...defaultQueueOptions,
    })
  }
  return processingQueue
}

/**
 * Get or create the webhooks queue
 */
export function getWebhooksQueue(): Queue<WebhookJobData> {
  if (!webhooksQueue) {
    webhooksQueue = new Queue<WebhookJobData>(QUEUE_NAMES.WEBHOOKS, {
      connection: getRedis(),
      ...defaultQueueOptions,
      defaultJobOptions: {
        ...defaultQueueOptions.defaultJobOptions,
        attempts: 5, // More retries for webhooks
      },
    })
  }
  return webhooksQueue
}

/**
 * Add an email job to the queue
 */
export async function queueEmail(
  data: EmailJobData,
  options?: { delay?: number; priority?: number }
) {
  const queue = getEmailQueue()
  return queue.add("send-email", data, {
    delay: options?.delay,
    priority: options?.priority,
  })
}

/**
 * Add a processing job to the queue
 */
export async function queueProcessing(
  data: ProcessingJobData,
  options?: { delay?: number; priority?: number }
) {
  const queue = getProcessingQueue()
  return queue.add("process-task", data, {
    delay: options?.delay,
    priority: options?.priority,
  })
}

/**
 * Add a webhook job to the queue
 */
export async function queueWebhook(
  data: WebhookJobData,
  options?: { delay?: number; priority?: number }
) {
  const queue = getWebhooksQueue()
  return queue.add("send-webhook", data, {
    delay: options?.delay,
    priority: options?.priority,
  })
}

/**
 * Close all queue connections gracefully
 */
export async function closeAllQueues(): Promise<void> {
  const queues = [emailQueue, processingQueue, webhooksQueue].filter(Boolean)
  await Promise.all(queues.map((q) => q?.close()))
  emailQueue = null
  processingQueue = null
  webhooksQueue = null
}
