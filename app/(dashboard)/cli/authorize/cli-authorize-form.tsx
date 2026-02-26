"use client"

import { CheckCircle2, Terminal, XCircle } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { authorizeDevice } from "./actions"

interface CliAuthorizeFormProps {
  userCode: string
  orgId: string
  orgName: string
  userName: string
}

export function CliAuthorizeForm({
  userCode,
  orgName,
  userName,
}: CliAuthorizeFormProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMessage, setErrorMessage] = useState("")

  async function handleAuthorize() {
    setStatus("loading")
    const result = await authorizeDevice(userCode)
    if (result.success) {
      setStatus("success")
    } else {
      setStatus("error")
      setErrorMessage(result.error ?? "Authorization failed")
    }
  }

  if (status === "success") {
    return (
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          <p className="text-sm text-foreground font-medium">CLI authorized</p>
        </div>
        <p className="text-sm text-muted-foreground">
          You can close this tab and return to your terminal.
        </p>
      </div>
    )
  }

  if (status === "error") {
    return (
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <XCircle className="h-5 w-5 text-destructive" />
          <p className="text-sm text-foreground font-medium">Authorization failed</p>
        </div>
        <p className="text-sm text-muted-foreground">{errorMessage}</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setStatus("idle")}
        >
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="glass-card p-6 space-y-6 max-w-md">
      {/* Code display */}
      <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg border border-border/50">
        <Terminal className="h-5 w-5 text-muted-foreground shrink-0" />
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Verification code</p>
          <p className="font-mono text-lg font-bold tracking-widest text-foreground">
            {userCode}
          </p>
        </div>
      </div>

      {/* Context */}
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          Signing in as <span className="text-foreground font-medium">{userName}</span>
        </p>
        <p>
          Organization: <span className="text-foreground font-medium">{orgName}</span>
        </p>
      </div>

      {/* Action */}
      <Button
        size="sm"
        className="bg-rail-fade hover:opacity-90 w-full"
        onClick={handleAuthorize}
        disabled={status === "loading"}
      >
        {status === "loading" ? "Authorizing..." : "Authorize CLI"}
      </Button>

      <p className="text-xs text-muted-foreground text-center">
        Only authorize if you initiated this from your terminal.
      </p>
    </div>
  )
}
