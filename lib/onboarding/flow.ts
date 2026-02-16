import { supabase } from "@/lib/db"
import type { Database, Json } from "@/lib/db/types"

export type Onboarding = Database["public"]["Tables"]["onboarding"]["Row"]
export type OnboardingInsert = Database["public"]["Tables"]["onboarding"]["Insert"]
export type OnboardingUpdate = Database["public"]["Tables"]["onboarding"]["Update"]

// Steps definition
export const ONBOARDING_STEPS = [
  "welcome",
  "profile",
  "organization",
  "preferences",
  "complete",
] as const

export type OnboardingStep = typeof ONBOARDING_STEPS[number]

// Onboarding Flow functions

export async function getOnboarding(userId: string): Promise<Onboarding | null> {
  const { data, error } = await supabase
    .from("onboarding")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function createOnboarding(userId: string): Promise<Onboarding> {
  const { data: onboarding, error } = await supabase
    .from("onboarding")
    .insert({
      user_id: userId,
      current_step: "welcome",
      completed_steps: [],
      data: {} as Json,
      completed: false,
    })
    .select()
    .single()

  if (error) throw error
  return onboarding
}

export async function getOrCreateOnboarding(userId: string): Promise<Onboarding> {
  const existing = await getOnboarding(userId)
  if (existing) return existing
  return createOnboarding(userId)
}

export async function advanceOnboardingStep(
  userId: string,
  step: string,
  stepData?: Record<string, unknown>
): Promise<Onboarding> {
  const onboarding = await getOrCreateOnboarding(userId)

  const completedSteps = [...(onboarding.completed_steps || [])]
  if (!completedSteps.includes(step)) {
    completedSteps.push(step)
  }

  const stepIndex = ONBOARDING_STEPS.indexOf(step as typeof ONBOARDING_STEPS[number])
  const nextStep =
    stepIndex >= 0 && stepIndex < ONBOARDING_STEPS.length - 1
      ? ONBOARDING_STEPS[stepIndex + 1]
      : "complete"

  const isComplete = nextStep === "complete"

  const existingData = (onboarding.data as Record<string, unknown>) || {}
  const mergedData = stepData ? { ...existingData, [step]: stepData } : existingData

  const { data: updated, error } = await supabase
    .from("onboarding")
    .update({
      current_step: nextStep,
      completed_steps: completedSteps,
      data: mergedData as Json,
      completed: isComplete,
      completed_at: isComplete ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select()
    .single()

  if (error) throw error
  return updated
}

export async function resetOnboarding(userId: string): Promise<Onboarding> {
  const { data: onboarding, error } = await supabase
    .from("onboarding")
    .update({
      current_step: "welcome",
      completed_steps: [],
      data: {} as Json,
      completed: false,
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select()
    .single()

  if (error) throw error
  return onboarding
}

export async function isOnboardingComplete(userId: string): Promise<boolean> {
  const onboarding = await getOnboarding(userId)
  return onboarding?.completed ?? false
}
