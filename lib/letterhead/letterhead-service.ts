import { ObjectId } from "mongodb"
import { getCollection } from "@/lib/db"
import type { User, Letterhead } from "@/lib/types/database"
import type { LetterheadSettings } from "@/lib/types/letterhead"

/**
 * Get letterhead settings for a user
 */
export async function getLetterhead(userId: string): Promise<LetterheadSettings | null> {
  const users = await getCollection<User>("users")

  const user = await users.findOne({ _id: new ObjectId(userId) })

  if (!user?.customSettings?.letterhead) {
    return null
  }

  const letterhead = user.customSettings.letterhead
  return {
    logo: letterhead.logo,
    logoKey: letterhead.logoKey,
    organizationName: letterhead.organizationName,
    address: letterhead.address,
    phone: letterhead.phone,
    email: letterhead.email,
    fax: letterhead.fax,
    website: letterhead.website,
  }
}

/**
 * Update letterhead settings for a user
 */
export async function updateLetterhead(params: {
  userId: string
  settings: LetterheadSettings
}): Promise<boolean> {
  const users = await getCollection<User>("users")

  const letterhead: Letterhead = {
    logo: params.settings.logo,
    logoKey: params.settings.logoKey,
    organizationName: params.settings.organizationName,
    address: params.settings.address,
    phone: params.settings.phone,
    email: params.settings.email,
    fax: params.settings.fax,
    website: params.settings.website,
  }

  const result = await users.updateOne(
    { _id: new ObjectId(params.userId) },
    {
      $set: {
        "customSettings.letterhead": letterhead,
        updatedAt: new Date(),
      },
    }
  )

  return result.modifiedCount > 0
}

/**
 * Update just the logo for a user
 */
export async function updateLetterheadLogo(params: {
  userId: string
  logo: string
  logoKey: string
}): Promise<boolean> {
  const users = await getCollection<User>("users")

  const result = await users.updateOne(
    { _id: new ObjectId(params.userId) },
    {
      $set: {
        "customSettings.letterhead.logo": params.logo,
        "customSettings.letterhead.logoKey": params.logoKey,
        updatedAt: new Date(),
      },
    }
  )

  return result.modifiedCount > 0
}

/**
 * Remove the logo from letterhead
 */
export async function removeLetterheadLogo(userId: string): Promise<{ success: boolean; logoKey?: string }> {
  const users = await getCollection<User>("users")

  // First, get the current logoKey so we can delete the file
  const user = await users.findOne({ _id: new ObjectId(userId) })
  const logoKey = user?.customSettings?.letterhead?.logoKey

  const result = await users.updateOne(
    { _id: new ObjectId(userId) },
    {
      $unset: {
        "customSettings.letterhead.logo": "",
        "customSettings.letterhead.logoKey": "",
      },
      $set: {
        updatedAt: new Date(),
      },
    }
  )

  return {
    success: result.modifiedCount > 0,
    logoKey,
  }
}

/**
 * Delete all letterhead settings
 */
export async function deleteLetterhead(userId: string): Promise<boolean> {
  const users = await getCollection<User>("users")

  const result = await users.updateOne(
    { _id: new ObjectId(userId) },
    {
      $unset: {
        "customSettings.letterhead": "",
      },
      $set: {
        updatedAt: new Date(),
      },
    }
  )

  return result.modifiedCount > 0
}
