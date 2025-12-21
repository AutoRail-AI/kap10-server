"use client"

import { useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { MessageSquare, MoreHorizontal, Pencil, Trash2, Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ConversationListItem } from "@/lib/types/chat"

interface ConversationListProps {
  conversations: ConversationListItem[]
  onDelete?: (id: string) => Promise<boolean>
  onRename?: (id: string, title: string) => Promise<boolean>
  onSelect?: () => void
}

export function ConversationList({
  conversations,
  onDelete,
  onRename,
  onSelect,
}: ConversationListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const handleSelect = (id: string) => {
    router.push(`/c/${id}`)
    onSelect?.()
  }

  const handleStartEdit = (conversation: ConversationListItem) => {
    setEditingId(conversation.id)
    setEditTitle(conversation.title)
  }

  const handleSaveEdit = async (id: string) => {
    if (editTitle.trim() && onRename) {
      await onRename(id, editTitle.trim())
    }
    setEditingId(null)
    setEditTitle("")
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditTitle("")
  }

  const handleDelete = async () => {
    if (deleteId && onDelete) {
      const success = await onDelete(deleteId)
      if (success && pathname === `/c/${deleteId}`) {
        router.push("/chat")
      }
    }
    setDeleteId(null)
  }

  if (conversations.length === 0) {
    return (
      <div className="px-2 py-4 text-center text-sm text-muted-foreground">
        No conversations yet
      </div>
    )
  }

  return (
    <>
      <div className="space-y-1 px-2">
        {conversations.map((conversation) => {
          const isActive = pathname === `/c/${conversation.id}`
          const isEditing = editingId === conversation.id

          return (
            <div
              key={conversation.id}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-2 py-2 text-sm transition-colors",
                isActive
                  ? "bg-muted"
                  : "hover:bg-muted/50"
              )}
            >
              {isEditing ? (
                <div className="flex flex-1 items-center gap-1">
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit(conversation.id)
                      if (e.key === "Escape") handleCancelEdit()
                    }}
                    className="h-7 text-sm"
                    autoFocus
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={() => handleSaveEdit(conversation.id)}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={handleCancelEdit}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <button
                    className="flex flex-1 items-center gap-2 truncate text-left"
                    onClick={() => handleSelect(conversation.id)}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{conversation.title}</span>
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">More options</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleStartEdit(conversation)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteId(conversation.id)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              )}
            </div>
          )
        })}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this conversation and all its messages.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
