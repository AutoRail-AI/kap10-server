"use client"

import { AlertTriangle, Info, XCircle } from "lucide-react"

interface ReviewCommentCardProps {
  comment: {
    filePath: string
    lineNumber: number
    checkType: string
    severity: string
    message: string
    suggestion: string | null
    ruleTitle: string | null
  }
}

const severityIcon = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
} as const

const severityColor = {
  error: "text-red-400 border-red-500/20",
  warning: "text-yellow-400 border-yellow-500/20",
  info: "text-blue-400 border-blue-500/20",
} as const

export function ReviewCommentCard({ comment }: ReviewCommentCardProps) {
  const Icon = severityIcon[comment.severity as keyof typeof severityIcon] ?? Info
  const colorClass = severityColor[comment.severity as keyof typeof severityColor] ?? severityColor.info

  return (
    <div className={`glass-panel p-3 border-l-2 ${colorClass}`}>
      <div className="flex items-start gap-2">
        <Icon className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{comment.filePath}:{comment.lineNumber}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{comment.checkType}</span>
            {comment.ruleTitle && <span>{comment.ruleTitle}</span>}
          </div>
          <p className="text-sm text-foreground mt-1 whitespace-pre-wrap">{comment.message}</p>
          {comment.suggestion && (
            <div className="mt-2 rounded bg-muted/50 p-2 text-xs font-mono text-muted-foreground">
              {comment.suggestion}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
