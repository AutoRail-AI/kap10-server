import { connectDB } from "@/lib/db/mongoose"
import mongoose, { Schema } from "mongoose"

export type OnboardingStep =
  | "welcome"
  | "profile"
  | "organization"
  | "preferences"
  | "complete"

export interface IOnboarding extends mongoose.Document {
  userId: string
  organizationId?: string
  currentStep: OnboardingStep
  completedSteps: OnboardingStep[]
  data: Record<string, any>
  completed: boolean
  completedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const OnboardingSchema = new Schema<IOnboarding>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    organizationId: { type: String, index: true },
    currentStep: {
      type: String,
      enum: ["welcome", "profile", "organization", "preferences", "complete"],
      default: "welcome",
    },
    completedSteps: [{ type: String }],
    data: { type: Schema.Types.Mixed, default: {} },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date },
  },
  { timestamps: true }
)

export const Onboarding =
  mongoose.models.Onboarding ||
  mongoose.model<IOnboarding>("Onboarding", OnboardingSchema)

// Get or create onboarding
export async function getOnboarding(userId: string): Promise<IOnboarding> {
  await connectDB()

  let onboarding = await Onboarding.findOne({ userId })
  if (!onboarding) {
    onboarding = await Onboarding.create({
      userId,
      currentStep: "welcome",
      completedSteps: [],
      data: {},
    })
  }

  return onboarding
}

// Update onboarding step
export async function updateOnboardingStep(
  userId: string,
  step: OnboardingStep,
  data?: Record<string, any>
): Promise<IOnboarding> {
  await connectDB()

  const onboarding = await Onboarding.findOne({ userId })
  if (!onboarding) {
    throw new Error("Onboarding not found")
  }

  onboarding.currentStep = step
  if (!onboarding.completedSteps.includes(step)) {
    onboarding.completedSteps.push(step)
  }
  if (data) {
    onboarding.data = { ...onboarding.data, ...data }
  }

  if (step === "complete") {
    onboarding.completed = true
    onboarding.completedAt = new Date()
  }

  await onboarding.save()
  return onboarding
}

// Check if onboarding is complete
export async function isOnboardingComplete(userId: string): Promise<boolean> {
  await connectDB()

  const onboarding = await Onboarding.findOne({ userId })
  return onboarding?.completed || false
}

// Get onboarding progress
export async function getOnboardingProgress(userId: string): Promise<{
  currentStep: OnboardingStep
  completedSteps: OnboardingStep[]
  progress: number
}> {
  await connectDB()

  const onboarding = await getOnboarding(userId)
  const totalSteps = 4 // welcome, profile, organization, preferences
  const progress = (onboarding.completedSteps.length / totalSteps) * 100

  return {
    currentStep: onboarding.currentStep,
    completedSteps: onboarding.completedSteps,
    progress: Math.round(progress),
  }
}

