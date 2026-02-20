"use client"

import { Building2, GitBranch, Plus, Trash2, User } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
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
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

interface Connection {
  id: string
  installationId: number
  accountLogin: string
  accountType: string
  createdAt: string
  repoCount: number
}

export function GitHubConnectionsList({
  connections,
  orgId,
  orgName,
}: {
  connections: Connection[]
  orgId: string
  orgName: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [deleteTarget, setDeleteTarget] = useState<Connection | null>(null)

  const handleDelete = async (connectionId: string) => {
    const res = await fetch("/api/github/connections", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId }),
    })
    if (res.ok) {
      startTransition(() => router.refresh())
    }
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Organization: <span className="text-foreground font-medium">{orgName}</span>
        </p>
        <Button
          size="sm"
          className="bg-rail-fade hover:opacity-90"
          asChild
        >
          <a href={`/api/github/install?orgId=${encodeURIComponent(orgId)}`}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Connect GitHub Account
          </a>
        </Button>
      </div>

      {connections.length === 0 ? (
        <Card className="glass-card border-border">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <GitBranch className="h-8 w-8 text-muted-foreground" />
              <div className="space-y-1">
                <p className="font-grotesk text-sm font-semibold text-foreground">
                  No GitHub accounts connected
                </p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Connect a GitHub account or org to import repositories into
                  this organization.
                </p>
              </div>
              <Button size="sm" className="bg-rail-fade hover:opacity-90 mt-2" asChild>
                <a href={`/api/github/install?orgId=${encodeURIComponent(orgId)}`}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Connect GitHub
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {connections.map((conn) => (
            <Card key={conn.id} className="glass-card border-border">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted/30">
                      {conn.accountType === "Organization" ? (
                        <Building2 className="h-4 w-4 text-foreground" />
                      ) : (
                        <User className="h-4 w-4 text-foreground" />
                      )}
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">
                        @{conn.accountLogin}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {conn.accountType === "Organization"
                          ? "GitHub Organization"
                          : "GitHub User"}
                        {" · "}
                        {conn.repoCount}{" "}
                        {conn.repoCount === 1 ? "repo" : "repos"} connected
                        {" · "}
                        Added {new Date(conn.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteTarget(conn)}
                    disabled={isPending}
                    aria-label={`Remove @${conn.accountLogin}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent className="glass-panel border-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-grotesk text-foreground">
              Remove GitHub connection?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This will disconnect <strong>@{deleteTarget?.accountLogin}</strong>{" "}
              from this organization. Existing repos from this connection will
              remain but won&apos;t receive updates until reconnected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  void handleDelete(deleteTarget.id)
                }
              }}
            >
              Remove Connection
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
