"use client"

const statusConfig = {
  pending: { label: "Pending", className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  reviewing: { label: "Reviewing", className: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
  completed: { label: "Completed", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  failed: { label: "Failed", className: "bg-red-500/10 text-red-400 border-red-500/20" },
} as const

export function ReviewStatusBadge({ status }: { status: string }) {
  const config = statusConfig[status as keyof typeof statusConfig] ?? statusConfig.pending
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  )
}

export function AutoApprovedBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
      Low Risk — Auto-Approved
    </span>
  )
}
