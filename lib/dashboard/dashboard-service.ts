import { ObjectId } from "mongodb"
import { getCollection } from "@/lib/db"
import type { User, Appeal, Conversation, Document, Provider } from "@/lib/types/database"
import type {
  DashboardStats,
  DashboardData,
  UsageData,
  RecentAppeal,
  RecentConversation,
  AppealHistoryItem,
  AppealHistoryFilters,
  PaginatedAppeals,
} from "@/lib/types/dashboard"

/**
 * Get dashboard statistics for a user
 */
export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const users = await getCollection<User>("users")
  const appeals = await getCollection<Appeal>("appeals")
  const documents = await getCollection<Document>("documents")
  const conversations = await getCollection<Conversation>("conversations")

  const userObjectId = new ObjectId(userId)

  // Get user for usage data
  const user = await users.findOne({ _id: userObjectId })

  // Get total appeals count
  const totalAppeals = await appeals.countDocuments({ userId: userObjectId })

  // Get appeals this month
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  const appealsThisMonth = await appeals.countDocuments({
    userId: userObjectId,
    createdAt: { $gte: startOfMonth },
  })

  // Calculate success rate (appeals that were downloaded or submitted)
  const successfulAppeals = await appeals.countDocuments({
    userId: userObjectId,
    status: { $in: ["downloaded", "submitted"] },
  })
  const successRate = totalAppeals > 0 ? Math.round((successfulAppeals / totalAppeals) * 100) : 0

  // Get documents count
  const documentsUploaded = await documents.countDocuments({ userId: userObjectId })

  // Get conversations count
  const conversationsCount = await conversations.countDocuments({
    userId: userObjectId,
  })

  // Get last activity date
  const lastAppeal = await appeals.findOne(
    { userId: userObjectId },
    { sort: { createdAt: -1 } }
  )

  return {
    totalAppeals,
    appealsThisMonth,
    successRate,
    documentsUploaded,
    conversationsCount,
    lastActivityDate: user?.usage?.lastAppealDate || lastAppeal?.createdAt,
  }
}

/**
 * Get usage history for the last 6 months
 */
export async function getUsageHistory(userId: string): Promise<UsageData[]> {
  const appeals = await getCollection<Appeal>("appeals")
  const userObjectId = new ObjectId(userId)

  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

  const pipeline = [
    {
      $match: {
        userId: userObjectId,
        createdAt: { $gte: sixMonthsAgo },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { "_id.year": 1 as const, "_id.month": 1 as const },
    },
  ]

  const result = await appeals.aggregate(pipeline).toArray()

  // Fill in missing months
  const months: UsageData[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const monthName = date.toLocaleDateString("en-US", { month: "short" })
    const found = result.find(
      (r) => r._id.year === date.getFullYear() && r._id.month === date.getMonth() + 1
    )
    months.push({
      month: monthName,
      appeals: found?.count || 0,
    })
  }

  return months
}

/**
 * Get recent appeals for a user
 */
export async function getRecentAppeals(userId: string, limit = 5): Promise<RecentAppeal[]> {
  const appeals = await getCollection<Appeal>("appeals")
  const providers = await getCollection<Provider>("providers")

  const userObjectId = new ObjectId(userId)

  const recentAppeals = await appeals
    .find({ userId: userObjectId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()

  // Get provider names
  const providerIds = recentAppeals
    .filter((a) => a.providerId)
    .map((a) => a.providerId)
  const providerDocs = await providers.find({ _id: { $in: providerIds } }).toArray()
  const providerMap = new Map(providerDocs.map((p) => [p._id.toString(), p.name]))

  return recentAppeals.map((appeal) => ({
    id: appeal._id.toString(),
    title: appeal.originalInput.denialReason?.substring(0, 50) || "Untitled Appeal",
    provider: appeal.providerId ? providerMap.get(appeal.providerId.toString()) : undefined,
    status: appeal.status,
    createdAt: appeal.createdAt,
  }))
}

/**
 * Get recent conversations for a user
 */
export async function getRecentConversations(userId: string, limit = 5): Promise<RecentConversation[]> {
  const conversations = await getCollection<Conversation>("conversations")
  const messages = await getCollection("messages")

  const recentConversations = await conversations
    .find({
      userId: new ObjectId(userId),
      status: "active",
    })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray()

  // Get message counts
  const conversationIds = recentConversations.map((c) => c._id)
  const messageCounts = await messages
    .aggregate([
      { $match: { conversationId: { $in: conversationIds } } },
      { $group: { _id: "$conversationId", count: { $sum: 1 } } },
    ])
    .toArray()
  const countMap = new Map(messageCounts.map((m) => [m._id.toString(), m.count]))

  return recentConversations.map((conv) => ({
    id: conv._id.toString(),
    title: conv.title || "New Conversation",
    messageCount: countMap.get(conv._id.toString()) || 0,
    updatedAt: conv.updatedAt,
  }))
}

/**
 * Get full dashboard data
 */
export async function getDashboardData(userId: string): Promise<DashboardData> {
  const [stats, usageHistory, recentAppeals, recentConversations] = await Promise.all([
    getDashboardStats(userId),
    getUsageHistory(userId),
    getRecentAppeals(userId),
    getRecentConversations(userId),
  ])

  return {
    stats,
    usageHistory,
    recentAppeals,
    recentConversations,
  }
}

/**
 * Get paginated appeal history
 */
export async function getAppealHistory(params: {
  userId: string
  page?: number
  pageSize?: number
  filters?: AppealHistoryFilters
}): Promise<PaginatedAppeals> {
  const appeals = await getCollection<Appeal>("appeals")
  const providers = await getCollection<Provider>("providers")

  const { userId, page = 1, pageSize = 10, filters } = params
  const userObjectId = new ObjectId(userId)

  // Build query
  const query: Record<string, unknown> = { userId: userObjectId }

  if (filters?.status) {
    query.status = filters.status
  }

  if (filters?.provider) {
    query.providerId = new ObjectId(filters.provider)
  }

  if (filters?.dateFrom || filters?.dateTo) {
    query.createdAt = {}
    if (filters.dateFrom) {
      (query.createdAt as Record<string, Date>).$gte = filters.dateFrom
    }
    if (filters.dateTo) {
      (query.createdAt as Record<string, Date>).$lte = filters.dateTo
    }
  }

  if (filters?.search) {
    query.$or = [
      { "originalInput.denialReason": { $regex: filters.search, $options: "i" } },
      { "generatedAppeal.content": { $regex: filters.search, $options: "i" } },
    ]
  }

  // Get total count
  const total = await appeals.countDocuments(query)

  // Get paginated results
  const skip = (page - 1) * pageSize
  const appealDocs = await appeals
    .find(query)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(pageSize)
    .toArray()

  // Get provider names
  const providerIds = appealDocs
    .filter((a) => a.providerId)
    .map((a) => a.providerId)
  const providerDocs = await providers.find({ _id: { $in: providerIds } }).toArray()
  const providerMap = new Map(providerDocs.map((p) => [p._id.toString(), p.name]))

  const items: AppealHistoryItem[] = appealDocs.map((appeal) => ({
    id: appeal._id.toString(),
    title: appeal.originalInput.denialReason?.substring(0, 100) || "Untitled Appeal",
    provider: appeal.providerId?.toString(),
    providerName: appeal.providerId ? providerMap.get(appeal.providerId.toString()) : undefined,
    status: appeal.status,
    createdAt: appeal.createdAt,
    updatedAt: appeal.updatedAt,
    content: appeal.generatedAppeal?.content,
  }))

  return {
    appeals: items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

/**
 * Get a single appeal by ID
 */
export async function getAppeal(params: {
  userId: string
  appealId: string
}): Promise<AppealHistoryItem | null> {
  const appeals = await getCollection<Appeal>("appeals")
  const providers = await getCollection<Provider>("providers")

  const appeal = await appeals.findOne({
    _id: new ObjectId(params.appealId),
    userId: new ObjectId(params.userId),
  })

  if (!appeal) {
    return null
  }

  // Get provider name
  let providerName: string | undefined
  if (appeal.providerId) {
    const provider = await providers.findOne({ _id: appeal.providerId })
    providerName = provider?.name
  }

  return {
    id: appeal._id.toString(),
    title: appeal.originalInput.denialReason?.substring(0, 100) || "Untitled Appeal",
    provider: appeal.providerId?.toString(),
    providerName,
    status: appeal.status,
    createdAt: appeal.createdAt,
    updatedAt: appeal.updatedAt,
    content: appeal.generatedAppeal?.content,
  }
}

/**
 * Update appeal status
 */
export async function updateAppealStatus(params: {
  userId: string
  appealId: string
  status: "draft" | "generated" | "downloaded" | "submitted"
}): Promise<boolean> {
  const appeals = await getCollection<Appeal>("appeals")

  const result = await appeals.updateOne(
    {
      _id: new ObjectId(params.appealId),
      userId: new ObjectId(params.userId),
    },
    {
      $set: {
        status: params.status,
        updatedAt: new Date(),
      },
    }
  )

  return result.modifiedCount > 0
}
