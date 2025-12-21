import type { Document, OptionalUnlessRequiredId, WithoutId } from "mongodb"
import { getCollection } from "./mongodb"
import { DEFAULT_PROVIDERS } from "@/lib/utils/constants"
import type { Provider } from "@/lib/types"

type ProviderInsert = WithoutId<Provider>

export async function seedProviders(): Promise<void> {
  const providers = await getCollection<Document>("providers")

  // Check if already seeded
  const count = await providers.countDocuments()
  if (count > 0) {
    console.log("Providers already seeded, skipping...")
    return
  }

  const defaultProviders = DEFAULT_PROVIDERS.map((p) => ({
    name: p.name,
    code: p.code,
    category: "insurance" as const,
    isActive: true,
    isDefault: true,
    requirements: {
      appealDeadlineDays: 180,
      requiredFields: [
        "patient_name",
        "member_id",
        "date_of_service",
        "provider_name",
        "diagnosis_codes",
        "procedure_codes",
      ],
      preferredFormat: "pdf",
      submissionMethods: ["fax", "portal", "mail"],
    },
    rulesetIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }))

  const result = await providers.insertMany(defaultProviders)
  console.log(`Seeded ${result.insertedCount} providers`)
}

export async function seedDatabase(): Promise<void> {
  console.log("Starting database seed...")

  try {
    await seedProviders()
    console.log("Database seeding complete!")
  } catch (error) {
    console.error("Error seeding database:", error)
    throw error
  }
}

// Allow running as standalone script
// Run with: npx tsx lib/db/seed.ts
if (typeof require !== "undefined" && require.main === module) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
