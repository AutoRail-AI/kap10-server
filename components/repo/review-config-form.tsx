"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { ReviewConfig } from "@/lib/ports/types"

interface ReviewConfigFormProps {
  config: ReviewConfig
  repoId: string
}

export function ReviewConfigForm({ config, repoId }: ReviewConfigFormProps) {
  const [formState, setFormState] = useState<ReviewConfig>(config)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch(`/api/repos/${repoId}/settings/review`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formState),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium text-foreground">Enable Reviews</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Automatically review PRs when opened</p>
        </div>
        <Switch
          checked={formState.enabled}
          onCheckedChange={(v) => setFormState((s) => ({ ...s, enabled: v }))}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium text-foreground">Auto-approve clean PRs</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Approve PRs with no findings</p>
        </div>
        <Switch
          checked={formState.autoApproveOnClean}
          onCheckedChange={(v) => setFormState((s) => ({ ...s, autoApproveOnClean: v }))}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium text-foreground">Skip draft PRs</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Don&apos;t review draft pull requests</p>
        </div>
        <Switch
          checked={formState.skipDraftPrs}
          onCheckedChange={(v) => setFormState((s) => ({ ...s, skipDraftPrs: v }))}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium text-foreground">Semantic LGTM</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Auto-approve low-risk horizontal changes</p>
        </div>
        <Switch
          checked={formState.semanticLgtmEnabled}
          onCheckedChange={(v) => setFormState((s) => ({ ...s, semanticLgtmEnabled: v }))}
        />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium text-foreground">Nudge &amp; Assist</Label>
          <p className="text-xs text-muted-foreground mt-0.5">Send follow-up on blocked PRs after delay</p>
        </div>
        <Switch
          checked={formState.nudgeEnabled}
          onCheckedChange={(v) => setFormState((s) => ({ ...s, nudgeEnabled: v }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground">Impact Threshold</Label>
          <Input
            type="number"
            className="h-9 mt-1"
            value={formState.impactThreshold}
            onChange={(e) => setFormState((s) => ({ ...s, impactThreshold: parseInt(e.target.value, 10) || 15 }))}
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Complexity Threshold</Label>
          <Input
            type="number"
            className="h-9 mt-1"
            value={formState.complexityThreshold}
            onChange={(e) => setFormState((s) => ({ ...s, complexityThreshold: parseInt(e.target.value, 10) || 10 }))}
          />
        </div>
      </div>

      <div>
        <Label className="text-xs text-muted-foreground">Target Branches (comma-separated)</Label>
        <Input
          className="h-9 mt-1"
          value={formState.targetBranches.join(", ")}
          onChange={(e) => setFormState((s) => ({
            ...s,
            targetBranches: e.target.value.split(",").map((b) => b.trim()).filter(Boolean),
          }))}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Check Types</Label>
        {(Object.keys(formState.checksEnabled) as Array<keyof typeof formState.checksEnabled>).map((key) => (
          <div key={key} className="flex items-center justify-between py-1">
            <span className="text-sm text-foreground capitalize">{key}</span>
            <Switch
              checked={formState.checksEnabled[key]}
              onCheckedChange={(v) => setFormState((s) => ({
                ...s,
                checksEnabled: { ...s.checksEnabled, [key]: v },
              }))}
            />
          </div>
        ))}
      </div>

      <Button
        size="sm"
        className="bg-rail-fade hover:opacity-90"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? "Saving..." : "Save Configuration"}
      </Button>
    </div>
  )
}
