"use client"

import { useEffect, useState, use } from "react"
import Link from "next/link"
import { useAppeals } from "@/hooks"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowLeft, Download, Copy, CheckCircle } from "lucide-react"
import { toast } from "sonner"
import type { AppealHistoryItem } from "@/lib/types/dashboard"

const statusConfig = {
  draft: { label: "Draft", className: "bg-gray-100 text-gray-800" },
  generated: { label: "Generated", className: "bg-blue-100 text-blue-800" },
  downloaded: { label: "Downloaded", className: "bg-green-100 text-green-800" },
  submitted: { label: "Submitted", className: "bg-purple-100 text-purple-800" },
}

export default function AppealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const { getAppeal, updateAppealStatus } = useAppeals({ initialFetch: false })
  const [appeal, setAppeal] = useState<AppealHistoryItem | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const fetchAppeal = async () => {
      setIsLoading(true)
      const result = await getAppeal(id)
      setAppeal(result)
      setIsLoading(false)
    }
    fetchAppeal()
  }, [id, getAppeal])

  const handleCopy = async () => {
    if (!appeal?.content) return

    try {
      await navigator.clipboard.writeText(appeal.content)
      setCopied(true)
      toast.success("Appeal copied to clipboard")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy")
    }
  }

  const handleDownload = async () => {
    if (!appeal?.content) return

    const blob = new Blob([appeal.content], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `appeal-${appeal.id}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    // Update status to downloaded
    await updateAppealStatus(appeal.id, "downloaded")
    setAppeal((prev) => prev ? { ...prev, status: "downloaded" } : null)
    toast.success("Appeal downloaded")
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-4 mb-8">
          <Skeleton className="h-10 w-10" />
          <div className="flex-1">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-32 mt-2" />
          </div>
        </div>
        <Skeleton className="h-[400px]" />
      </div>
    )
  }

  if (!appeal) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center py-12">
          <h2 className="text-xl font-semibold">Appeal not found</h2>
          <p className="text-muted-foreground mt-2">
            The appeal you're looking for doesn't exist or has been deleted.
          </p>
          <Button asChild className="mt-4">
            <Link href="/history">Back to history</Link>
          </Button>
        </div>
      </div>
    )
  }

  const status = statusConfig[appeal.status]

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/history">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{appeal.title}</h1>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              {appeal.providerName && <span>{appeal.providerName}</span>}
              <span>{new Date(appeal.createdAt).toLocaleDateString()}</span>
              <Badge variant="secondary" className={status.className}>
                {status.label}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleCopy}>
            {copied ? (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </>
            )}
          </Button>
          <Button onClick={handleDownload}>
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        </div>
      </div>

      {/* Content */}
      <Card>
        <CardHeader>
          <CardTitle>Appeal Content</CardTitle>
          <CardDescription>
            Generated on {new Date(appeal.createdAt).toLocaleString()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {appeal.content ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                {appeal.content}
              </pre>
            </div>
          ) : (
            <p className="text-muted-foreground italic">
              No content available for this appeal.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
