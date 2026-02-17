import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { OnboardingCreateOrg } from "@/components/onboarding/onboarding-create-org"
import { auth, listOrganizations } from "@/lib/auth"

export default async function OnboardingPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    redirect("/login")
  }

  let organizations: { id: string }[] = []
  try {
    organizations = await listOrganizations(await headers())
  } catch {
    organizations = []
  }

  if (organizations.length > 0) {
    redirect("/")
  }

  return (
    <div className="container mx-auto flex min-h-screen items-center justify-center p-6">
      <OnboardingCreateOrg />
    </div>
  )
}
