"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth/client"

const ORG_NAME_MIN = 2
const ORG_NAME_MAX = 50
const ORG_NAME_REGEX = /^[a-zA-Z0-9\s-]+$/

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
}

export function OnboardingCreateOrg() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (trimmed.length < ORG_NAME_MIN || trimmed.length > ORG_NAME_MAX) {
      setError(`Organization name must be between ${ORG_NAME_MIN} and ${ORG_NAME_MAX} characters.`)
      return
    }
    if (!ORG_NAME_REGEX.test(trimmed)) {
      setError("Use only letters, numbers, spaces, and hyphens.")
      return
    }
    setLoading(true)
    try {
      const slug = slugify(trimmed) || "org"
      const data = await authClient.organization.create({
        name: trimmed,
        slug,
      })
      if (!data?.id) {
        setError("Failed to create organization.")
        setLoading(false)
        return
      }
      const res = await fetch("/api/org/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: data.id, name: trimmed }),
      })
      if (!res.ok) {
        console.warn("Bootstrap failed, continuing to dashboard")
      }
      router.push("/")
      router.refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="glass-card border-border w-full max-w-md">
      <CardContent className="pt-6">
        <div className="space-y-1 mb-6">
          <h1 className="font-grotesk text-lg font-semibold text-foreground">
            Create your organization
          </h1>
          <p className="text-sm text-foreground mt-0.5">
            Give your organization a name to get started.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="org-name">Organization name</Label>
            <Input
              id="org-name"
              className="h-9"
              placeholder="Acme Inc"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={ORG_NAME_MAX}
              disabled={loading}
              aria-invalid={!!error}
            />
            <p className="text-muted-foreground text-xs">
              {ORG_NAME_MIN}–{ORG_NAME_MAX} characters, letters, numbers, spaces, hyphens
            </p>
          </div>
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            size="sm"
            className="bg-rail-fade hover:opacity-90 w-full"
            disabled={loading}
          >
            {loading ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              "Create organization"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
