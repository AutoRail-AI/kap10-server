import { SubTabNav } from "@/components/repo/sub-tab-nav"

export default async function IntelligenceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  const basePath = `/repos/${repoId}/intelligence`

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Intelligence</h1>
        <p className="text-sm text-foreground mt-0.5">Cruft detection, domain vocabulary, and architectural drift</p>
      </div>
      <SubTabNav
        basePath={basePath}
        tabs={[
          { label: "Domain", href: "" },
          { label: "Glossary", href: "/glossary" },
          { label: "Drift", href: "/drift" },
        ]}
      />
      {children}
    </div>
  )
}
