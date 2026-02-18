import { Resend } from "resend"
import dns from "node:dns"

/** Auth instance type (from module type so better-auth is not loaded at build). */
type AuthInstance = ReturnType<(typeof import("better-auth"))["betterAuth"]>

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
  process.env.EMAIL_FROM || "Kap10 <noreply@kap10.dev>"

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 48)
}

// Build auth config. Receives database and organization plugin (lazy-loaded in getAuth).
function buildAuthConfig(
  pool: import("pg").Pool,
  database: Parameters<(typeof import("better-auth"))["betterAuth"]>[0]["database"],
  organization: (config: {
    allowUserToCreateOrganization?: boolean
    organizationLimit?: number
    membershipLimit?: number
    creatorRole?: string
    sendInvitationEmail?: (data: { id: string; email: string; inviter: { user: { name?: string | null; email: string } }; organization: { name: string } }) => Promise<void>
  }) => unknown,
  generateId: () => string
) {
  return {
    database,

    // App configuration
    appName: "Kap10",
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
        async sendInvitationEmail(data: { id: string; email: string; inviter: { user: { name?: string | null; email: string } }; organization: { name: string } }) {
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
                        <table width="100%" max-width="600" cellpadding="0" cellspacing="0" style="background-color: #0A0A0F; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.3); border: 1px solid rgba(250,250,250,0.1);">
                          <tr>
                            <td style="background: linear-gradient(135deg, #8134CE 0%, #6E18B3 100%); padding: 32px; border-radius: 8px 8px 0 0; text-align: center;">
                              <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; font-family: 'Space Grotesk', sans-serif;">Organization Invitation</h1>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding: 40px 32px;">
                              <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 20px; font-weight: 600;">You've been invited!</h2>
                              <p style="color: rgba(250,250,250,0.6); margin: 0 0 24px 0; font-size: 16px; line-height: 1.6;">
                                ${data.inviter.user.name || data.inviter.user.email} invited you to join <strong style="color: #FAFAFA;">${data.organization.name}</strong>.
                              </p>
                              <table width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                  <td align="center" style="padding: 16px 0;">
                                    <a href="${inviteLink}" style="display: inline-block; background: linear-gradient(135deg, #8134CE 0%, #6E18B3 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
                                      Accept Invitation
                                    </a>
                                  </td>
                                </tr>
                              </table>
                              <p style="color: rgba(250,250,250,0.4); margin: 24px 0 0 0; font-size: 14px; line-height: 1.6;">
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
            subject: "Verify your Kap10 account",
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
                      <table width="100%" max-width="600" cellpadding="0" cellspacing="0" style="background-color: #0A0A0F; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.3); border: 1px solid rgba(250,250,250,0.1);">
                        <!-- Header -->
                        <tr>
                          <td style="background: linear-gradient(135deg, #8134CE 0%, #6E18B3 100%); padding: 32px; border-radius: 8px 8px 0 0; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; font-family: 'Space Grotesk', sans-serif;">Kap10</h1>
                            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Code Intelligence Platform</p>
                          </td>
                        </tr>
                        <!-- Content -->
                        <tr>
                          <td style="padding: 40px 32px;">
                            <h2 style="color: #FAFAFA; margin: 0 0 16px 0; font-size: 20px; font-weight: 600;">Verify your email address</h2>
                            <p style="color: rgba(250,250,250,0.6); margin: 0 0 24px 0; font-size: 16px; line-height: 1.6;">
                              Hi ${user.name || "there"},
                            </p>
                            <p style="color: rgba(250,250,250,0.6); margin: 0 0 24px 0; font-size: 16px; line-height: 1.6;">
                              Thanks for signing up for Kap10! Please verify your email address by clicking the button below.
                            </p>
                            <table width="100%" cellpadding="0" cellspacing="0">
                              <tr>
                                <td align="center" style="padding: 16px 0;">
                                  <a href="${url}" style="display: inline-block; background: linear-gradient(135deg, #8134CE 0%, #6E18B3 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-size: 16px; font-weight: 600;">
                                    Verify Email Address
                                  </a>
                                </td>
                              </tr>
                            </table>
                            <p style="color: rgba(250,250,250,0.4); margin: 24px 0 0 0; font-size: 14px; line-height: 1.6;">
                              If you didn't create an account, you can safely ignore this email.
                            </p>
                            <p style="color: rgba(250,250,250,0.4); margin: 16px 0 0 0; font-size: 14px; line-height: 1.6;">
                              This link will expire in 24 hours.
                            </p>
                          </td>
                        </tr>
                        <!-- Footer -->
                        <tr>
                          <td style="padding: 24px 32px; border-top: 1px solid rgba(250,250,250,0.1); text-align: center;">
                            <p style="color: rgba(250,250,250,0.4); margin: 0; font-size: 12px;">
                              &copy; ${new Date().getFullYear()} Kap10. All rights reserved.
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
      ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
        ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
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

    // Auto-provision a personal workspace on signup so every user has an org immediately
    databaseHooks: {
      user: {
        create: {
          after: async (user: { id: string; email: string; name?: string | null }) => {
            const displayName = user.name || user.email.split("@")[0] || "My"
            const orgName = `${displayName}'s workspace`
            const orgSlug = slugify(displayName) || "workspace"
            const orgId = generateId()
            const memberId = generateId()
            const now = new Date()

            try {
              await pool.query(
                `INSERT INTO "organization" ("id", "name", "slug", "createdAt") VALUES ($1, $2, $3, $4)`,
                [orgId, orgName, orgSlug, now]
              )
              await pool.query(
                `INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt") VALUES ($1, $2, $3, $4, $5)`,
                [memberId, orgId, user.id, "owner", now]
              )
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err)
              // Slug conflict (user signed up twice, race condition) — log but don't block signup
              console.error("[databaseHooks] Auto-create org failed:", message)
            }
          },
        },
      },
    },
  } as Parameters<(typeof import("better-auth"))["betterAuth"]>[0]
}

// Lazy init: pg and better-auth are required() inside getAuth so the build never loads or connects.
// See Temporal/ArangoDB/Supabase docs: infra deps should be loaded at runtime only.
let authInstance: AuthInstance | null = null

function getAuth(): AuthInstance {
  if (authInstance) return authInstance

  // During build (e.g. CI), SUPABASE_DB_URL may be unset - use stub to avoid "Failed to initialize database adapter"
  if (!process.env.SUPABASE_DB_URL) {
    authInstance = createAuthStub()
    return authInstance
  }

  try {
    const { Pool } = require("pg") as typeof import("pg")
    const { betterAuth, generateId } = require("better-auth") as {
      betterAuth: (config: Parameters<(typeof import("better-auth"))["betterAuth"]>[0]) => AuthInstance
      generateId: () => string
    }
    const { organization } = require("better-auth/plugins") as { organization: (config: object) => unknown }
    const dbUrl = process.env.SUPABASE_DB_URL
    const connectionString =
      dbUrl +
      (dbUrl?.includes("?") ? "&" : "?") +
      "options=-c%20search_path%3Dpublic"
    const pool = new Pool({
      connectionString,
      ssl: dbUrl?.includes("supabase.co")
        ? { rejectUnauthorized: false }
        : undefined,
    })
    const config = buildAuthConfig(pool, pool, organization, generateId)
    authInstance = betterAuth(config)
    return authInstance
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[Better Auth] Failed to initialize:", message)
    authInstance = createAuthStub()
    return authInstance
  }
}

function createAuthStub(): AuthInstance {
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
  return stub as unknown as AuthInstance
}

export const auth = new Proxy({} as AuthInstance, {
  get(_, prop) {
    return getAuth()[prop as keyof AuthInstance]
  },
  has(_, prop) {
    return prop in getAuth()
  },
})

// Export types
export type Session = {
  user: { id: string; email: string; name?: string | null; image?: string | null }
  session: { id: string; expiresAt: Date; token: string; userId: string }
} | null
export type User = NonNullable<Session>["user"]

/** Organization list shape from Better Auth organization plugin (used for type assertion). */
export type OrgListItem = { id: string; name: string; slug: string }

/**
 * List organizations for the current session. Use this instead of auth.api.listOrganizations
 * so the organization plugin API is correctly typed at build time.
 */
export async function listOrganizations(headers: Headers): Promise<OrgListItem[]> {
  const api = auth.api as unknown as {
    listOrganizations: (opts: { headers: Headers }) => Promise<OrgListItem[]>
  }
  return api.listOrganizations({ headers })
}

/**
 * Create an organization server-side for the currently authenticated user.
 * Used when auto-provisioning a workspace (e.g. during GitHub App callback).
 */
export async function createOrganizationForUser(
  reqHeaders: Headers,
  orgName: string,
  orgSlug: string
): Promise<OrgListItem> {
  const api = auth.api as unknown as {
    createOrganization: (opts: {
      body: { name: string; slug: string }
      headers: Headers
    }) => Promise<OrgListItem>
  }
  return api.createOrganization({
    body: { name: orgName, slug: orgSlug },
    headers: reqHeaders,
  })
}

/**
 * Set the active organization for the current session (server-side).
 * Pass null to clear. Used after auto-provisioning a workspace so the
 * session cookie reflects the new org immediately.
 */
export async function setActiveOrganization(
  reqHeaders: Headers,
  organizationId: string | null
): Promise<unknown> {
  const api = auth.api as unknown as {
    setActiveOrganization: (opts: {
      body: { organizationId: string | null }
      headers: Headers
    }) => Promise<unknown>
  }
  return api.setActiveOrganization({
    body: { organizationId },
    headers: reqHeaders,
  })
}
