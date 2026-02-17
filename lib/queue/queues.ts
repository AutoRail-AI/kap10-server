import { type ConnectionOptions, Queue, type QueueOptions } from "bullmq"
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

// Queue instances (lazy loaded) - let TypeScript infer the exact type to avoid BullMQ v5 type issues
let emailQueue: Queue<EmailJobData> | null = null
let processingQueue: Queue<ProcessingJobData> | null = null
let webhooksQueue: Queue<WebhookJobData> | null = null

/**
 * Get or create the email queue
 * Only creates queue at runtime, not during build
 */
export function getEmailQueue(): Queue<EmailJobData> {
  if (!emailQueue) {
    // Only create queue when actually called at runtime
    // Don't specify generics in constructor - let TypeScript infer to avoid type conflicts
    // Use type assertion for connection to handle ioredis version compatibility
    emailQueue = new Queue(QUEUE_NAMES.EMAIL, {
      connection: getRedis() as unknown as ConnectionOptions,
      ...defaultQueueOptions,
    }) as Queue<EmailJobData>
  }
  return emailQueue
}

/**
 * Get or create the processing queue
 * Only creates queue at runtime, not during build
 */
export function getProcessingQueue(): Queue<ProcessingJobData> {
  if (!processingQueue) {
    // Only create queue when actually called at runtime
    // Don't specify generics in constructor - let TypeScript infer to avoid type conflicts
    // Use type assertion for connection to handle ioredis version compatibility
    processingQueue = new Queue(QUEUE_NAMES.PROCESSING, {
      connection: getRedis() as unknown as ConnectionOptions,
      ...defaultQueueOptions,
    }) as Queue<ProcessingJobData>
  }
  return processingQueue
}

/**
 * Get or create the webhooks queue
 * Only creates queue at runtime, not during build
 */
export function getWebhooksQueue(): Queue<WebhookJobData> {
  if (!webhooksQueue) {
    // Only create queue when actually called at runtime
    // Don't specify generics in constructor - let TypeScript infer to avoid type conflicts
    // Use type assertion for connection to handle ioredis version compatibility
    webhooksQueue = new Queue(QUEUE_NAMES.WEBHOOKS, {
      connection: getRedis() as unknown as ConnectionOptions,
      ...defaultQueueOptions,
      defaultJobOptions: {
        ...defaultQueueOptions.defaultJobOptions,
        attempts: 5, // More retries for webhooks
      },
    }) as Queue<WebhookJobData>
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
