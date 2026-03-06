import { SubTabNav } from "@/components/repo/sub-tab-nav"

export default async function BlueprintLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ repoId: string }>
}) {
  const { repoId } = await params
  const basePath = `/repos/${repoId}/blueprint`

  return (
    <div className="space-y-6 py-6 animate-fade-in">
      <div className="space-y-1">
        <h1 className="font-grotesk text-lg font-semibold text-foreground">Blueprint</h1>
        <p className="text-sm text-foreground mt-0.5">Feature map, entities, patterns, and impact analysis</p>
      </div>
      <SubTabNav
        basePath={basePath}
        tabs={[
          { label: "Features", href: "" },
          { label: "Entities", href: "/entities" },
          { label: "Patterns", href: "/patterns" },
          { label: "Impact", href: "/impact" },
        ]}
      />
      {children}
    </div>
  )
}
