"use client"

import { useLetterhead } from "@/hooks"
import { LetterheadForm, LogoUpload, LetterheadPreview } from "@/components/letterhead"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import type { LetterheadSettings } from "@/lib/types/letterhead"

export default function LetterheadPage() {
  const {
    letterhead,
    isLoading,
    isSaving,
    saveLetterhead,
    updateLogo,
    removeLogo,
  } = useLetterhead()

  const handleSave = async (data: LetterheadSettings): Promise<boolean> => {
    const success = await saveLetterhead({
      ...data,
      logo: letterhead?.logo,
      logoKey: letterhead?.logoKey,
    })

    if (success) {
      toast.success("Letterhead settings saved")
    } else {
      toast.error("Failed to save letterhead settings")
    }

    return success
  }

  const handleLogoUpload = async (logo: string, logoKey: string): Promise<boolean> => {
    const success = await updateLogo(logo, logoKey)

    if (success) {
      toast.success("Logo uploaded successfully")
    } else {
      toast.error("Failed to upload logo")
    }

    return success
  }

  const handleLogoRemove = async (): Promise<boolean> => {
    const success = await removeLogo()

    if (success) {
      toast.success("Logo removed")
    } else {
      toast.error("Failed to remove logo")
    }

    return success
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-96 mt-2" />
        </div>
        <div className="grid gap-8 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </CardContent>
          </Card>
          <Skeleton className="h-[500px]" />
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Letterhead Settings</h1>
        <p className="text-muted-foreground mt-1">
          Customize the letterhead that appears on your generated appeal letters.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Settings Form */}
        <div className="space-y-6">
          {/* Logo Upload */}
          <Card>
            <CardHeader>
              <CardTitle>Logo</CardTitle>
              <CardDescription>
                Upload your organization's logo (PNG, JPG, SVG - max 4MB)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LogoUpload
                currentLogo={letterhead?.logo}
                onUpload={handleLogoUpload}
                onRemove={handleLogoRemove}
                isUploading={isSaving}
              />
            </CardContent>
          </Card>

          {/* Organization Details */}
          <Card>
            <CardHeader>
              <CardTitle>Organization Details</CardTitle>
              <CardDescription>
                Enter your organization's contact information
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LetterheadForm
                initialData={letterhead}
                onSave={handleSave}
                isSaving={isSaving}
              />
            </CardContent>
          </Card>
        </div>

        {/* Preview */}
        <div className="lg:sticky lg:top-8">
          <h2 className="text-lg font-semibold mb-4">Preview</h2>
          <LetterheadPreview settings={letterhead} />
        </div>
      </div>
    </div>
  )
}
