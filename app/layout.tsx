import type { Metadata } from "next"
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google"
import { Providers } from "@/components/providers"
import "styles/tailwind.css"

// Design system: Space Grotesk (headlines), Inter (UI/body), JetBrains Mono (code) — docs/brand/brand.md §7
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
})

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter-var",
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "kap10 — The AI Tech Lead | autorail",
    template: "%s | kap10",
  },
  description:
    "kap10 by autorail — Supervise, review, and ship with AI coding agents. Context-aware guardrails for Cursor, Claude Code, and Windsurf.",
  keywords: [
    "AI coding",
    "code review",
    "Cursor",
    "Claude Code",
    "Windsurf",
    "developer tools",
    "autorail",
  ],
  authors: [{ name: "autorail", url: "https://autorail.dev" }],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
