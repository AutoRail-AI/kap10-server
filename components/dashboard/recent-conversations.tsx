"use client"

import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { MessageSquare, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { RecentConversation } from "@/lib/types/dashboard"

interface RecentConversationsProps {
  conversations: RecentConversation[] | undefined
  isLoading?: boolean
}

export function RecentConversations({ conversations, isLoading }: RecentConversationsProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Recent Conversations</CardTitle>
          <CardDescription>Continue where you left off</CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/chat">
            View all
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations && conversations.length > 0 ? (
          <div className="space-y-4">
            {conversations.map((conversation) => (
              <Link
                key={conversation.id}
                href={`/c/${conversation.id}`}
                className="flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <MessageSquare className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{conversation.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {conversation.messageCount} messages ·{" "}
                    {new Date(conversation.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <MessageSquare className="h-10 w-10 text-muted-foreground mb-4" />
            <p className="text-sm text-muted-foreground">No conversations yet</p>
            <Button variant="link" size="sm" asChild className="mt-2">
              <Link href="/chat">Start chatting</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
