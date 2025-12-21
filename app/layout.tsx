import type { Metadata } from "next"
import { Poppins, Sofia_Sans_Extra_Condensed } from "next/font/google"
import { Providers } from "@/components/providers"
import "styles/tailwind.css"

// Primary font: Poppins (Semi Bold for headings, Regular for body)
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
})

// Accent font: Sofia Sans Extra Condensed (for labels, tags, decorative)
const sofiaSans = Sofia_Sans_Extra_Condensed({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-sofia",
  display: "swap",
})

export const metadata: Metadata = {
  title: {
    default: "AppealGen AI - Medical Denial Appeal Generator | 10XR",
    template: "%s | AppealGen AI",
  },
  description:
    "AppealGen AI by 10XR - AI-powered medical denial appeal generator. Generate citation-backed appeals in seconds, not hours.",
  keywords: [
    "medical appeals",
    "denial appeals",
    "healthcare",
    "AI",
    "medical necessity",
    "insurance appeals",
    "10XR",
  ],
  authors: [{ name: "10XR", url: "https://10xr.co" }],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${sofiaSans.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
