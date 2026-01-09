"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import type { OnboardingStep } from "@/lib/onboarding/flow"

const steps: { key: OnboardingStep; title: string; description: string }[] = [
  { key: "welcome", title: "Welcome", description: "Get started with your account" },
  { key: "profile", title: "Profile", description: "Complete your profile" },
  { key: "organization", title: "Organization", description: "Create or join an organization" },
  { key: "preferences", title: "Preferences", description: "Set your preferences" },
]

export function OnboardingFlow({
  initialStep,
  userId: _userId,
}: {
  initialStep: OnboardingStep
  userId: string
}) {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(initialStep)
  const [loading, setLoading] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [formData, setFormData] = useState<Record<string, any>>({})

  const currentStepIndex = steps.findIndex((s) => s.key === currentStep)
  const progress = ((currentStepIndex + 1) / steps.length) * 100

  const handleNext = async () => {
    setLoading(true)

    try {
      const response = await fetch("/api/onboarding/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: currentStep,
          data: formData,
        }),
      })

      if (!response.ok) throw new Error("Failed to update")

      const data = (await response.json()) as { nextStep?: string; progress?: unknown }
      const nextStep = data.nextStep

      if (nextStep === "complete") {
        router.push("/")
        router.refresh()
      } else if (nextStep && ["welcome", "profile", "organization", "preferences", "complete"].includes(nextStep)) {
        setCurrentStep(nextStep as typeof currentStep)
      }
    } catch (error) {
      console.error("Onboarding error:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleSkip = async () => {
    await handleNext()
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Welcome! Let's get started</h1>
        <p className="text-muted-foreground mt-2">
          Complete these steps to set up your account
        </p>
      </div>

      <Progress value={progress} className="h-2" />

      <Card>
        <CardHeader>
          <CardTitle>{steps[currentStepIndex]?.title}</CardTitle>
          <CardDescription>{steps[currentStepIndex]?.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentStep === "welcome" && (
            <div className="space-y-4">
              <p>Welcome to the platform! Let's set up your account.</p>
            </div>
          )}

          {currentStep === "profile" && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  value={formData.name || ""}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="John Doe"
                />
              </div>
            </div>
          )}

          {currentStep === "organization" && (
            <div className="space-y-4">
              <p>Would you like to create an organization or join an existing one?</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setFormData({ ...formData, action: "create" })
                    handleNext()
                  }}
                >
                  Create Organization
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setFormData({ ...formData, action: "skip" })
                    handleNext()
                  }}
                >
                  Skip for Now
                </Button>
              </div>
            </div>
          )}

          {currentStep === "preferences" && (
            <div className="space-y-4">
              <p>Set your preferences to personalize your experience.</p>
            </div>
          )}

          <div className="flex justify-between pt-4">
            <Button variant="ghost" onClick={handleSkip} disabled={loading}>
              Skip
            </Button>
            <Button onClick={handleNext} disabled={loading}>
              {currentStepIndex === steps.length - 1 ? "Complete" : "Next"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

