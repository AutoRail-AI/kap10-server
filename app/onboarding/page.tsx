import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow"
import { auth } from "@/lib/auth"
import { getOnboarding, isOnboardingComplete } from "@/lib/onboarding/flow"

export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    redirect("/login")
  }

  // Check if already completed
  const completed = await isOnboardingComplete(session.user.id)
  if (completed) {
    redirect("/")
  }

  const onboarding = await getOnboarding(session.user.id)

  return (
    <div className="container mx-auto p-6">
      <OnboardingFlow initialStep={onboarding.currentStep} userId={session.user.id} />
    </div>
  )
}

