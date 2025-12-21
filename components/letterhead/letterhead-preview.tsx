"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import Image from "next/image"
import type { LetterheadSettings } from "@/lib/types/letterhead"

interface LetterheadPreviewProps {
  settings: LetterheadSettings | null
}

export function LetterheadPreview({ settings }: LetterheadPreviewProps) {
  if (!settings?.organizationName) {
    return (
      <Card className="h-full">
        <CardContent className="p-6 flex items-center justify-center h-full min-h-[400px] text-muted-foreground">
          <p className="text-center">
            Fill in your organization details to see a preview of your letterhead.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-full">
      <CardContent className="p-6">
        <div className="border rounded-lg bg-white p-8 shadow-sm min-h-[500px]">
          {/* Letterhead Header */}
          <div className="flex items-start gap-6 mb-6">
            {settings.logo && (
              <div className="relative h-16 w-16 shrink-0">
                <Image
                  src={settings.logo}
                  alt="Logo"
                  fill
                  className="object-contain"
                />
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-xl font-bold text-gray-900">
                {settings.organizationName}
              </h1>
              {settings.address && (
                <p className="text-sm text-gray-600 whitespace-pre-line mt-1">
                  {settings.address}
                </p>
              )}
            </div>
            <div className="text-right text-sm text-gray-600">
              {settings.phone && <p>Tel: {settings.phone}</p>}
              {settings.fax && <p>Fax: {settings.fax}</p>}
              {settings.email && <p>{settings.email}</p>}
              {settings.website && <p>{settings.website}</p>}
            </div>
          </div>

          <Separator className="my-6" />

          {/* Sample Letter Content */}
          <div className="space-y-4 text-sm text-gray-700">
            <p className="text-gray-500">{new Date().toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}</p>

            <div className="space-y-1">
              <p className="font-medium">Insurance Company Name</p>
              <p>Appeals Department</p>
              <p>123 Insurance Blvd</p>
              <p>City, State 12345</p>
            </div>

            <p className="mt-6">RE: Appeal of Claim Denial</p>
            <p>Member ID: XXXXXXXXX</p>
            <p>Claim Number: XXXXXXXXX</p>

            <p className="mt-6">Dear Appeals Committee,</p>

            <p className="text-gray-400 italic">
              [Your appeal letter content will appear here...]
            </p>

            <p className="mt-8">Sincerely,</p>

            <div className="mt-8">
              <div className="h-12 border-b border-gray-300 w-48" />
              <p className="mt-2">{settings.organizationName}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
