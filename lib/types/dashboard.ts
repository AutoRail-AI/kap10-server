// Dashboard Types

export interface DashboardStats {
  totalAppeals: number
  appealsThisMonth: number
  successRate: number
  documentsUploaded: number
  conversationsCount: number
  lastActivityDate?: Date
}

export interface UsageData {
  month: string
  appeals: number
}

export interface RecentAppeal {
  id: string
  title: string
  provider?: string
  status: "draft" | "generated" | "downloaded" | "submitted"
  createdAt: Date
}

export interface RecentConversation {
  id: string
  title: string
  messageCount: number
  updatedAt: Date
}

export interface DashboardData {
  stats: DashboardStats
  usageHistory: UsageData[]
  recentAppeals: RecentAppeal[]
  recentConversations: RecentConversation[]
}

export interface AppealHistoryItem {
  id: string
  title: string
  provider?: string
  providerName?: string
  status: "draft" | "generated" | "downloaded" | "submitted"
  createdAt: Date
  updatedAt: Date
  content?: string
}

export interface AppealHistoryFilters {
  status?: string
  provider?: string
  dateFrom?: Date
  dateTo?: Date
  search?: string
}

export interface PaginatedAppeals {
  appeals: AppealHistoryItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
