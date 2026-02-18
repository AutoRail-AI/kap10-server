import Link from "next/link"

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="text-[120px] font-grotesk font-bold leading-none text-rail-purple/20 mb-4">
          404
        </p>
        <h1 className="text-2xl font-grotesk font-bold text-foreground mb-3">
          Page not found
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg font-medium text-sm bg-transparent border border-rail-purple/30 text-electric-cyan hover:bg-rail-purple/10 transition-all duration-300"
        >
          Back to Home
        </Link>
      </div>
    </div>
  )
}
