"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth/client"

export function CreateOrgForm() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const result = await authClient.organization.create({
        name,
        slug,
      })

      if (result.error) {
        setError(result.error.message || "Failed to create organization")
        return
      }

      // Redirect to organization dashboard
      if (result.data) {
        router.push(`/org/${result.data.slug}`)
        router.refresh()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <div className="space-y-2">
        <Label htmlFor="name">Organization Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My Organization"
          required
          disabled={loading}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="slug">Organization Slug</Label>
        <Input
          id="slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
          placeholder="my-org"
          required
          disabled={loading}
          pattern="[a-z0-9-]+"
        />
        <p className="text-xs text-muted-foreground">
          URL-friendly identifier (lowercase letters, numbers, and hyphens only)
        </p>
      </div>

      <Button type="submit" disabled={loading} size="sm" className="w-full bg-rail-fade hover:opacity-90">
        {loading ? (
          <>
            <Spinner className="mr-2 h-4 w-4" />
            Creating...
          </>
        ) : (
          "Create Organization"
        )}
      </Button>
    </form>
  )
}

