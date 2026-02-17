import Link from "next/link"
import { APP_NAME } from "@/lib/utils/constants"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex bg-background">
      {/* Left side - Branding (Void Black + Industrial Glass) */}
      <div className="hidden lg:flex lg:w-1/2 glass-panel border-r border-border relative overflow-hidden">
        <div className="relative z-10 flex flex-col justify-between p-12 text-foreground">
          <div>
            <Link href="/" className="flex items-center space-x-2">
              <span className="font-grotesk text-2xl font-bold text-foreground">{APP_NAME}</span>
            </Link>
          </div>

          <div className="space-y-6">
            <blockquote className="font-grotesk text-xl font-medium leading-relaxed text-foreground">
              &ldquo;Supervise, review, and ship with AI coding agents. Context-aware guardrails for Cursor, Claude Code, and Windsurf.&rdquo;
            </blockquote>
            <div className="flex items-center space-x-4">
              <div className="h-px flex-1 bg-border" />
              <span className="text-sm text-muted-foreground">
                Start building faster
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            &copy; {new Date().getFullYear()} {APP_NAME}. MIT License.
          </div>
        </div>

        {/* Decorative elements (design system: no raw white) */}
        <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full border border-border bg-card/30" />
        <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full border border-border bg-card/30" />
      </div>

      {/* Right side - Auth forms */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-md space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden text-center">
            <Link href="/" className="inline-flex items-center space-x-2">
              <span className="font-grotesk text-2xl font-bold text-foreground">{APP_NAME}</span>
            </Link>
          </div>

          {children}
        </div>
      </div>
    </div>
  )
}
