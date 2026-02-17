import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { advanceOnboardingStep } from "@/lib/onboarding/flow"

const stepOrder = ["welcome", "profile", "organization", "preferences", "complete"] as const
type OnboardingStep = typeof stepOrder[number]

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json()) as {
    step?: string
    data?: Record<string, unknown>
  }
  const { step, data } = body

  if (!step || !stepOrder.includes(step as OnboardingStep)) {
    return NextResponse.json(
      { error: "Invalid step" },
      { status: 400 }
    )
  }

  try {
    const updated = await advanceOnboardingStep(session.user.id, step, data)

    // Get next step from the updated result
    const nextStep = updated.current_step

    return NextResponse.json({
      nextStep,
      progress: {
        currentStep: updated.current_step,
        completedSteps: updated.completed_steps,
        completed: updated.completed,
      },
    })
  } catch (error) {
    console.error("Onboarding update error:", error)
    return NextResponse.json(
      { error: "Failed to update onboarding" },
      { status: 500 }
    )
  }
}
