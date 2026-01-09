import { headers } from "next/headers"
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { getOnboardingProgress, updateOnboardingStep } from "@/lib/onboarding/flow"
import type { OnboardingStep } from "@/lib/onboarding/flow"

const stepOrder: OnboardingStep[] = ["welcome", "profile", "organization", "preferences", "complete"]

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = (await req.json()) as {
    step?: OnboardingStep
    data?: Record<string, unknown>
  }
  const { step, data } = body

  if (!step || !stepOrder.includes(step)) {
    return NextResponse.json(
      { error: "Invalid step" },
      { status: 400 }
    )
  }

  try {
    await updateOnboardingStep(session.user.id, step, data)

    // Get next step
    const currentIndex = stepOrder.indexOf(step)
    const nextStep = currentIndex < stepOrder.length - 1 ? stepOrder[currentIndex + 1] : "complete"

    const progress = await getOnboardingProgress(session.user.id)

    return NextResponse.json({
      nextStep,
      progress,
    })
  } catch (error) {
    console.error("Onboarding update error:", error)
    return NextResponse.json(
      { error: "Failed to update onboarding" },
      { status: 500 }
    )
  }
}

