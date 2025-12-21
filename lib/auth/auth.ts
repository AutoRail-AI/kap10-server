import { betterAuth } from "better-auth"
import { mongodbAdapter } from "better-auth/adapters/mongodb"
import { MongoClient, type Db } from "mongodb"
import { Resend } from "resend"

// Cached MongoDB client and database
let cachedClient: MongoClient | null = null
let cachedDb: Db | null = null

async function getMongoDb(): Promise<Db> {
  if (cachedDb) {
    return cachedDb
  }

  const uri = process.env.MONGODB_URI
  if (!uri) {
    throw new Error("MONGODB_URI is not defined")
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(uri)
    await cachedClient.connect()
  }

  cachedDb = cachedClient.db("appealgen")
  return cachedDb
}

// For build time, we need a dummy/mock approach
// Better Auth requires sync db access, so we use a workaround
function getMongoDbSync(): Db {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    // During build, return a mock that won't be used
    // This is safe because the route handlers are only called at runtime
    console.warn("MONGODB_URI not set - auth features will not work until configured")
    return new MongoClient("mongodb://localhost:27017").db("appealgen")
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(uri)
  }

  return cachedClient.db("appealgen")
}

// Lazy Resend client
function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  return new Resend(apiKey)
}

// Email sender configuration
const getEmailFrom = () =>
  process.env.EMAIL_FROM || "AppealGen AI <noreply@appealgen.ai>"

export const auth = betterAuth({
  // Database adapter
  database: mongodbAdapter(getMongoDbSync()),

  // App configuration
  appName: "AppealGen AI",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET,

  // Email & Password authentication
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },

  // Email verification
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const resend = getResendClient()
      if (!resend) {
        console.warn("Resend not configured, skipping verification email")
        console.log("Verification URL:", url)
        return
      }

      try {
        await resend.emails.send({
          from: getEmailFrom(),
          to: user.email,
          subject: "Verify your AppealGen AI account",
          html: `
            <!DOCTYPE html>
            <html>
              <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Verify your email</title>
              </head>
              <body style="font-family: 'Poppins', Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
                  <tr>
                    <td align="center">
                      <table width="100%" max-width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <!-- Header -->
                        <tr>
                          <td style="background: linear-gradient(135deg, #559EFF 0%, #0065BA 100%); padding: 32px; border-radius: 8px 8px 0 0; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">AppealGen AI</h1>
                            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">by 10XR</p>
                          </td>
                        </tr>
                        <!-- Content -->
                        <tr>
                          <td style="padding: 40px 32px;">
                            <h2 style="color: #001320; margin: 0 0 16px 0; font-size: 20px; font-weight: 600;">Verify your email address</h2>
                            <p style="color: #52525b; margin: 0 0 24px 0; font-size: 16px; line-height: 1.6;">
                              Hi ${user.name || "there"},
                            </p>
                            <p style="color: #52525b; margin: 0 0 24px 0; font-size: 16px; line-height: 1.6;">
                              Thanks for signing up for AppealGen AI! Please verify your email address by clicking the button below.
                            </p>
                            <table width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td align="center" style="padding: 16px 0;">
                                  <a href="${url}" style="display: inline-block; background-color: #568AFF; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
                                    Verify Email Address
                                  </a>
                                </td>
                              </tr>
                            </table>
                            <p style="color: #71717a; margin: 24px 0 0 0; font-size: 14px; line-height: 1.6;">
                              If you didn't create an account, you can safely ignore this email.
                            </p>
                            <p style="color: #71717a; margin: 16px 0 0 0; font-size: 14px; line-height: 1.6;">
                              This link will expire in 24 hours.
                            </p>
                          </td>
                        </tr>
                        <!-- Footer -->
                        <tr>
                          <td style="padding: 24px 32px; border-top: 1px solid #e4e4e7; text-align: center;">
                            <p style="color: #a1a1aa; margin: 0; font-size: 12px;">
                              &copy; ${new Date().getFullYear()} 10XR. All rights reserved.
                            </p>
                            <p style="color: #a1a1aa; margin: 8px 0 0 0; font-size: 12px;">
                              <a href="https://10xr.co" style="color: #568AFF; text-decoration: none;">10xr.co</a>
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </body>
            </html>
          `,
        })
      } catch (error) {
        console.error("Failed to send verification email:", error)
        throw error
      }
    },
  },

  // Social providers
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
  },

  // Session configuration
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Update session every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },

  // User configuration
  user: {
    additionalFields: {
      tier: {
        type: "string",
        defaultValue: "free",
      },
    },
  },

  // Account configuration
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
    },
  },

  // Rate limiting
  rateLimit: {
    window: 60, // 60 seconds
    max: 10, // 10 requests per window
  },
})

// Export types
export type Session = typeof auth.$Infer.Session
export type User = typeof auth.$Infer.Session.user

// Export getMongoDb for other uses
export { getMongoDb }
