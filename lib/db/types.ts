export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete'
export type PlanId = 'free' | 'pro' | 'enterprise'
export type ActivityType = 'user.created' | 'user.updated' | 'organization.created' | 'organization.updated' | 'member.invited' | 'member.joined' | 'project.created' | 'project.updated' | 'project.deleted' | 'ai_agent.run' | 'document.created' | 'document.updated' | 'comment.created' | 'subscription.created' | 'subscription.updated'
export type AuditAction = 'create' | 'read' | 'update' | 'delete' | 'login' | 'logout' | 'invite' | 'subscribe' | 'cancel' | 'admin_action'
export type OnboardingStep = 'welcome' | 'profile' | 'organization' | 'preferences' | 'complete'
export type UsageType = 'api_call' | 'ai_request' | 'storage' | 'bandwidth' | 'feature_usage'
export type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'invitation' | 'mention' | 'system'
export type WebhookEvent = 'user.created' | 'user.updated' | 'organization.created' | 'organization.updated' | 'subscription.created' | 'subscription.updated' | 'subscription.cancelled' | 'payment.succeeded' | 'payment.failed'
export type TemplateType = 'prompt' | 'workflow' | 'agent' | 'form'

export interface Database {
    public: {
        Tables: {
            subscriptions: {
                Row: {
                    id: string
                    user_id: string
                    organization_id: string | null
                    stripe_customer_id: string
                    stripe_subscription_id: string
                    stripe_price_id: string
                    status: SubscriptionStatus
                    current_period_start: string
                    current_period_end: string
                    cancel_at_period_end: boolean
                    plan_id: PlanId
                    metadata: Json | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    organization_id?: string | null
                    stripe_customer_id: string
                    stripe_subscription_id: string
                    stripe_price_id: string
                    status: SubscriptionStatus
                    current_period_start: string
                    current_period_end: string
                    cancel_at_period_end?: boolean
                    plan_id: PlanId
                    metadata?: Json | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    organization_id?: string | null
                    stripe_customer_id?: string
                    stripe_subscription_id?: string
                    stripe_price_id?: string
                    status?: SubscriptionStatus
                    current_period_start?: string
                    current_period_end?: string
                    cancel_at_period_end?: boolean
                    plan_id?: PlanId
                    metadata?: Json | null
                    created_at?: string
                    updated_at?: string
                }
                Relationships: []
            }
            activities: {
                Row: {
                    id: string
                    user_id: string | null
                    organization_id: string
                    type: string
                    action: string
                    resource: string
                    resource_id: string | null
                    metadata: Json | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id?: string | null
                    organization_id: string
                    type: string
                    action: string
                    resource: string
                    resource_id?: string | null
                    metadata?: Json | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string | null
                    organization_id?: string
                    type?: string
                    action?: string
                    resource?: string
                    resource_id?: string | null
                    metadata?: Json | null
                    created_at?: string
                }
                Relationships: []
            }
            audit_logs: {
                Row: {
                    id: string
                    user_id: string | null
                    organization_id: string | null
                    action: string
                    resource: string
                    resource_id: string | null
                    metadata: Json | null
                    ip_address: string | null
                    user_agent: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id?: string | null
                    organization_id?: string | null
                    action: string
                    resource: string
                    resource_id?: string | null
                    metadata?: Json | null
                    ip_address?: string | null
                    user_agent?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string | null
                    organization_id?: string | null
                    action?: string
                    resource?: string
                    resource_id?: string | null
                    metadata?: Json | null
                    ip_address?: string | null
                    user_agent?: string | null
                    created_at?: string
                }
                Relationships: []
            }
            onboarding: {
                Row: {
                    id: string
                    user_id: string
                    current_step: string
                    completed_steps: string[]
                    data: Json | null
                    completed: boolean
                    completed_at: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    current_step?: string
                    completed_steps?: string[]
                    data?: Json | null
                    completed?: boolean
                    completed_at?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    current_step?: string
                    completed_steps?: string[]
                    data?: Json | null
                    completed?: boolean
                    completed_at?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Relationships: []
            }
            costs: {
                Row: {
                    id: string
                    user_id: string
                    organization_id: string | null
                    provider: string
                    model: string
                    input_tokens: number
                    output_tokens: number
                    total_tokens: number
                    cost: number
                    metadata: Json | null
                    timestamp: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    organization_id?: string | null
                    provider: string
                    model: string
                    input_tokens?: number
                    output_tokens?: number
                    total_tokens: number
                    cost: number
                    metadata?: Json | null
                    timestamp?: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    organization_id?: string | null
                    provider?: string
                    model?: string
                    input_tokens?: number
                    output_tokens?: number
                    total_tokens?: number
                    cost?: number
                    metadata?: Json | null
                    timestamp?: string
                    created_at?: string
                }
                Relationships: []
            }
            usage: {
                Row: {
                    id: string
                    user_id: string
                    organization_id: string | null
                    api_key_id: string | null
                    type: string
                    resource: string
                    quantity: number
                    cost: number | null
                    metadata: Json | null
                    timestamp: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    organization_id?: string | null
                    api_key_id?: string | null
                    type: string
                    resource: string
                    quantity: number
                    cost?: number | null
                    metadata?: Json | null
                    timestamp?: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    organization_id?: string | null
                    api_key_id?: string | null
                    type?: string
                    resource?: string
                    quantity?: number
                    cost?: number | null
                    metadata?: Json | null
                    timestamp?: string
                    created_at?: string
                }
                Relationships: []
            }
            feature_flags: {
                Row: {
                    id: string
                    key: string
                    name: string
                    description: string | null
                    enabled: boolean
                    rollout_percentage: number
                    target_users: string[] | null
                    target_organizations: string[] | null
                    environments: string[]
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    key: string
                    name: string
                    description?: string | null
                    enabled?: boolean
                    rollout_percentage?: number
                    target_users?: string[] | null
                    target_organizations?: string[] | null
                    environments?: string[]
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    key?: string
                    name?: string
                    description?: string | null
                    enabled?: boolean
                    rollout_percentage?: number
                    target_users?: string[] | null
                    target_organizations?: string[] | null
                    environments?: string[]
                    created_at?: string
                    updated_at?: string
                }
                Relationships: []
            }
            api_keys: {
                Row: {
                    id: string
                    user_id: string
                    organization_id: string | null
                    name: string
                    key: string
                    key_prefix: string
                    last_used_at: string | null
                    expires_at: string | null
                    scopes: string[]
                    rate_limit: Json | null
                    enabled: boolean
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    organization_id?: string | null
                    name: string
                    key: string
                    key_prefix: string
                    last_used_at?: string | null
                    expires_at?: string | null
                    scopes?: string[]
                    rate_limit?: Json | null
                    enabled?: boolean
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    organization_id?: string | null
                    name?: string
                    key?: string
                    key_prefix?: string
                    last_used_at?: string | null
                    expires_at?: string | null
                    scopes?: string[]
                    rate_limit?: Json | null
                    enabled?: boolean
                    created_at?: string
                    updated_at?: string
                }
                Relationships: []
            }
            notifications: {
                Row: {
                    id: string
                    user_id: string
                    organization_id: string | null
                    type: string
                    title: string
                    message: string
                    link: string | null
                    read: boolean
                    read_at: string | null
                    metadata: Json | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    organization_id?: string | null
                    type: string
                    title: string
                    message: string
                    link?: string | null
                    read?: boolean
                    read_at?: string | null
                    metadata?: Json | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    organization_id?: string | null
                    type?: string
                    title?: string
                    message?: string
                    link?: string | null
                    read?: boolean
                    read_at?: string | null
                    metadata?: Json | null
                    created_at?: string
                }
                Relationships: []
            }
            search_index: {
                Row: {
                    id: string
                    organization_id: string | null
                    resource: string
                    resource_id: string
                    title: string
                    content: string
                    tags: string[] | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    organization_id?: string | null
                    resource: string
                    resource_id: string
                    title: string
                    content: string
                    tags?: string[] | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    organization_id?: string | null
                    resource?: string
                    resource_id?: string
                    title?: string
                    content?: string
                    tags?: string[] | null
                    created_at?: string
                    updated_at?: string
                }
                Relationships: []
            }
            webhooks: {
                Row: {
                    id: string
                    organization_id: string | null
                    url: string
                    secret: string
                    events: string[]
                    enabled: boolean
                    last_triggered_at: string | null
                    failure_count: number
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    organization_id?: string | null
                    url: string
                    secret: string
                    events: string[]
                    enabled?: boolean
                    last_triggered_at?: string | null
                    failure_count?: number
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    organization_id?: string | null
                    url?: string
                    secret?: string
                    events?: string[]
                    enabled?: boolean
                    last_triggered_at?: string | null
                    failure_count?: number
                    created_at?: string
                    updated_at?: string
                }
                Relationships: []
            }
            templates: {
                Row: {
                    id: string
                    user_id: string | null
                    organization_id: string | null
                    name: string
                    description: string | null
                    type: string
                    category: string | null
                    tags: string[] | null
                    content: Json
                    variables: Json | null
                    public: boolean
                    featured: boolean
                    usage_count: number
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id?: string | null
                    organization_id?: string | null
                    name: string
                    description?: string | null
                    type: string
                    category?: string | null
                    tags?: string[] | null
                    content: Json
                    variables?: Json | null
                    public?: boolean
                    featured?: boolean
                    usage_count?: number
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string | null
                    organization_id?: string | null
                    name?: string
                    description?: string | null
                    type?: string
                    category?: string | null
                    tags?: string[] | null
                    content?: Json
                    variables?: Json | null
                    public?: boolean
                    featured?: boolean
                    usage_count?: number
                    created_at?: string
                    updated_at?: string
                }
                Relationships: []
            }
            rate_limits: {
                Row: {
                    id: string
                    key: string
                    count: number
                    reset_at: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    key: string
                    count?: number
                    reset_at: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    key?: string
                    count?: number
                    reset_at?: string
                    created_at?: string
                }
                Relationships: []
            }
            agent_conversations: {
                Row: {
                    id: string
                    user_id: string
                    organization_id: string | null
                    messages: Json
                    metadata: Json | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    user_id: string
                    organization_id?: string | null
                    messages?: Json
                    metadata?: Json | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    user_id?: string
                    organization_id?: string | null
                    messages?: Json
                    metadata?: Json | null
                    created_at?: string
                    updated_at?: string
                }
                Relationships: []
            }
        }
        Views: {
            [_ in never]: never
        }
        Functions: {
            [_ in never]: never
        }
        Enums: {
            [_ in never]: never
        }
        CompositeTypes: {
            [_ in never]: never
        }
    }
}
