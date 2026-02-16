import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import { Pool } from "pg"
import { Resend } from "resend"
import dns from "node:dns"

// Prefer IPv4 when connecting to Supabase/Postgres (avoids ECONNREFUSED on IPv6-only resolutions)
dns.setDefaultResultOrder("ipv4first")

// Lazy Resend client
function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  return new Resend(apiKey)
}

// Email sender configuration
const getEmailFrom = () =>
  process.env.EMAIL_FROM || "AppealGen AI <noreply@appealgen.ai>"

// Build auth config (database is set dynamically in getAuth - see below)
function buildAuthConfig(database: Parameters<typeof betterAuth>[0]["database"]) {
  return {
    database,

    // App configuration
    appName: "AppealGen AI",
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
    secret:
      process.env.BETTER_AUTH_SECRET ||
      "development-secret-change-in-production-min-32-chars",

    // Plugins
    plugins: [
      organization({
        // Configuration options
        allowUserToCreateOrganization: true,
        organizationLimit: parseInt(process.env.ORGANIZATION_LIMIT || "5", 10),
        membershipLimit: parseInt(process.env.MEMBERSHIP_LIMIT || "100", 10),
        creatorRole: "owner",

        // Invitation email handler
        async sendInvitationEmail(data) {
          const resend = getResendClient()
          if (!resend) {
            console.warn("Resend not configured, skipping invitation email")
            console.log(
              "Invitation link:",
              `${process.env.BETTER_AUTH_URL}/accept-invitation/${data.id}`
            )
            return
          }

          const inviteLink = `${process.env.BETTER_AUTH_URL}/accept-invitation/${data.id}`

          try {
            await resend.emails.send({
              from: getEmailFrom(),
              to: data.email,
              subject: `Invitation to join ${data.organization.name}`,
              html: `
              <!DOCTYPE html>
              <html>
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>Organization Invitation</title>
                </head>
                <body style="font-family: 'Poppins', Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
                    <tr>
                      <td align="center">
                        <table width="100%" max-width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                          <tr>
                            <td style="background: linear-gradient(135deg, #559EFF 0%, #0065BA 100%); padding: 32px; border-radius: 8px 8px 0 0; text-align: center;">
                              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">Organization Invitation</h1>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding: 40px 32px;">
                              <h2 style="color: #001320; margin: 0 0 16px 0; font-size: 20px; font-weight: 600;">You've been invited!</h2>
                              <p style="color: #52525b; margin: 0 0 24px 0; font-size: 16px; line-height: 1.6;">
                                ${data.inviter.user.name || data.inviter.user.email} invited you to join <strong>${data.organization.name}</strong>.
                              </p>
                              <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                  <td align="center" style="padding: 16px 0;">
                                    <a href="${inviteLink}" style="display: inline-block; background-color: #568AFF; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
                                      Accept Invitation
                                    </a>
                                  </td>
                                </tr>
                              </table>
                              <p style="color: #71717a; margin: 24px 0 0 0; font-size: 14px; line-height: 1.6;">
                                This invitation will expire in 48 hours.
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
            console.error("Failed to send invitation email:", error)
            throw error
          }
        },
      }),
    ],

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
      sendVerificationEmail: async ({ user, url }: { user: { email: string; name?: string | null }; url: string }) => {
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

    // Social providers (only enable when credentials are configured)
    socialProviders: {
      ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          },
        }
        : {}),
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
  } as Parameters<typeof betterAuth>[0]
}

// Lazy init: Only create real auth when database is configured (avoids build-time errors in CI)
let authInstance: ReturnType<typeof betterAuth> | null = null

function getAuth(): ReturnType<typeof betterAuth> {
  if (authInstance) return authInstance

  // During build (e.g. CI), SUPABASE_DB_URL may be unset - use stub to avoid "Failed to initialize database adapter"
  if (!process.env.SUPABASE_DB_URL) {
    authInstance = createAuthStub()
    return authInstance
  }

  try {
    const dbUrl = process.env.SUPABASE_DB_URL
    // Explicitly use public schema to avoid "Schema '$user' does not exist" warning
    const connectionString =
      dbUrl +
      (dbUrl?.includes("?") ? "&" : "?") +
      "options=-c%20search_path%3Dpublic"
    // Better Auth's Kysely adapter requires a pg Pool (with "connect" method), not { provider, url }
    const pool = new Pool({
      connectionString,
      ssl: dbUrl?.includes("supabase.co")
        ? { rejectUnauthorized: false }
        : undefined,
    })
    const config = buildAuthConfig(pool)
    authInstance = betterAuth(config)
    return authInstance
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[Better Auth] Failed to initialize:", message)
    // Fallback stub if betterAuth throws (e.g. DB connection fails during build)
    authInstance = createAuthStub()
    return authInstance
  }
}

function createAuthStub() {
  const stub = {
    api: {
      getSession: async () => null,
      getSessionFromToken: async () => null,
    },
    handler: (_req: Request) =>
      new Response(
        JSON.stringify({
          error: "Auth not configured",
          message:
            "SUPABASE_DB_URL is required. Set environment variables and restart.",
        }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ),
    $Infer: { Session: { user: {} } },
  }
  return stub as unknown as ReturnType<typeof betterAuth>
}

export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
  get(_, prop) {
    return getAuth()[prop as keyof ReturnType<typeof betterAuth>]
  },
  has(_, prop) {
    // toNextJsHandler checks "handler" in auth to choose auth.handler vs auth(request)
    return prop in getAuth()
  },
})

// Export types
export type Session = {
  user: { id: string; email: string; name?: string | null; image?: string | null }
  session: { id: string; expiresAt: Date; token: string; userId: string }
} | null
export type User = NonNullable<Session>["user"]
