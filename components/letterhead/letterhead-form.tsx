"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Save } from "lucide-react"
import type { LetterheadSettings } from "@/lib/types/letterhead"

interface LetterheadFormProps {
  initialData?: LetterheadSettings | null
  onSave: (data: LetterheadSettings) => Promise<boolean>
  isSaving?: boolean
}

export function LetterheadForm({ initialData, onSave, isSaving }: LetterheadFormProps) {
  const [formData, setFormData] = useState<LetterheadSettings>({
    organizationName: "",
    address: "",
    phone: "",
    email: "",
    fax: "",
    website: "",
  })

  useEffect(() => {
    if (initialData) {
      setFormData({
        logo: initialData.logo,
        logoKey: initialData.logoKey,
        organizationName: initialData.organizationName || "",
        address: initialData.address || "",
        phone: initialData.phone || "",
        email: initialData.email || "",
        fax: initialData.fax || "",
        website: initialData.website || "",
      })
    }
  }, [initialData])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSave(formData)
  }

  const handleChange = (field: keyof LetterheadSettings, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="organizationName">Organization Name *</Label>
        <Input
          id="organizationName"
          value={formData.organizationName}
          onChange={(e) => handleChange("organizationName", e.target.value)}
          placeholder="Your Organization Name"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="address">Address</Label>
        <Textarea
          id="address"
          value={formData.address || ""}
          onChange={(e) => handleChange("address", e.target.value)}
          placeholder="123 Main Street&#10;City, State 12345"
          rows={3}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            type="tel"
            value={formData.phone || ""}
            onChange={(e) => handleChange("phone", e.target.value)}
            placeholder="(555) 123-4567"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="fax">Fax</Label>
          <Input
            id="fax"
            type="tel"
            value={formData.fax || ""}
            onChange={(e) => handleChange("fax", e.target.value)}
            placeholder="(555) 123-4568"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={formData.email || ""}
            onChange={(e) => handleChange("email", e.target.value)}
            placeholder="contact@organization.com"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="website">Website</Label>
          <Input
            id="website"
            type="url"
            value={formData.website || ""}
            onChange={(e) => handleChange("website", e.target.value)}
            placeholder="https://www.organization.com"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSaving || !formData.organizationName.trim()}>
          {isSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2 h-4 w-4" />
              Save Settings
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
