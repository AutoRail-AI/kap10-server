"use client"

import Image from "next/image"
import Link from "next/link"

const DOCS_URL = "https://docs.autorail.dev"

/**
 * Resend-style fixed top bar. Logo (left) | Docs (right).
 * User profile and org switcher stay in the sidebar.
 */
export function DashboardHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-[#0A0A0F] px-6">
      <Link
        href="/"
        className="flex items-center gap-2.5 transition-opacity hover:opacity-90"
        aria-label="unerr home"
      >
        <Image src="/autorail.svg" alt="autorail" width={28} height={28} className="h-6 w-6" />
        <span className="font-grotesk text-sm font-semibold tracking-tight text-foreground">
          unerr
        </span>
      </Link>

      <a
        href={DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-muted-foreground transition-colors hover:text-electric-cyan"
      >
        Docs
      </a>
    </header>
  )
}
