/**
 * Better Auth config for CLI (migrate, generate).
 * Exports a direct instance with pg Pool — CLI cannot use the app's lazy Proxy.
 * Run: pnpm migrate (uses dotenv-cli to load .env.local) or:
 *   pnpm dlx dotenv-cli -e .env.local -- pnpm dlx @better-auth/cli@latest migrate --config ./lib/auth/better-auth.cli.ts --yes
 */
import { betterAuth } from "better-auth"
import { organization } from "better-auth/plugins"
import { Pool } from "pg"
import { Resend } from "resend"
import dns from "node:dns"

// Force IPv4 to avoid DNS resolution issues with some providers
dns.setDefaultResultOrder("ipv4first")

const getResendClient = () =>
  process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const getEmailFrom = () =>
  process.env.EMAIL_FROM || "unerr <noreply@unerr.dev>"

const dbUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL
if (!dbUrl) {
  throw new Error(
    "SUPABASE_DB_URL or DATABASE_URL is required. Run: pnpm migrate (uses .env.local)"
  )
}

const connectionString =
  dbUrl +
  (dbUrl.includes("?") ? "&" : "?") +
  "options=-c%20search_path%3Dpublic"

const pool = new Pool({
  connectionString,
  ssl: dbUrl.includes("supabase.co")
    ? { rejectUnauthorized: false }
    : undefined,
  connectionTimeoutMillis: 10000,
})

export const auth = betterAuth({
  database: pool,
  appName: "unerr",
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  secret:
    process.env.BETTER_AUTH_SECRET ||
    "development-secret-change-in-production-min-32-chars",
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: parseInt(process.env.ORGANIZATION_LIMIT || "5", 10),
      membershipLimit: parseInt(process.env.MEMBERSHIP_LIMIT || "100", 10),
      creatorRole: "owner",
      async sendInvitationEmail(data) {
        const resend = getResendClient()
        if (!resend) return
        await resend.emails.send({
          from: getEmailFrom(),
          to: data.email,
          subject: `Invitation to join ${data.organization.name}`,
          html: `<p>Accept: ${process.env.BETTER_AUTH_URL}/accept-invitation/${data.id}</p>`,
        })
      },
    }),
  ],
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const resend = getResendClient()
      if (!resend) return
      await resend.emails.send({
        from: getEmailFrom(),
        to: user.email,
        subject: "Verify your unerr account",
        html: `<p>Verify: <a href="${url}">${url}</a></p>`,
      })
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  user: {
    additionalFields: { tier: { type: "string", defaultValue: "free" } },
  },
  account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
  rateLimit: { window: 60, max: 10 },
})
